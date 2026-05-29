const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_USERS_FILE = path.join(DEFAULT_DATA_DIR, 'users.json');
const MAX_PAYLOAD_SIZE_BYTES = 1_000_000;
const PBKDF2_ITERATIONS = 600_000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const ROBLOX_REQUEST_TIMEOUT_MS = 10_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      if (body.length + chunk.length > MAX_PAYLOAD_SIZE_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function ensureUserStore(usersFile) {
  await fs.promises.mkdir(path.dirname(usersFile), { recursive: true });
  if (!fs.existsSync(usersFile)) {
    await fs.promises.writeFile(usersFile, '[]', 'utf8');
  }
}

function normalizeUser(user) {
  return {
    ...user,
    apiKeys: Array.isArray(user.apiKeys) ? user.apiKeys : [],
    linkedGames: Array.isArray(user.linkedGames) ? user.linkedGames : []
  };
}

async function readUsers(usersFile) {
  await ensureUserStore(usersFile);
  const raw = await fs.promises.readFile(usersFile, 'utf8');
  const users = JSON.parse(raw);
  return users.map(normalizeUser);
}

async function writeUsers(usersFile, users) {
  await fs.promises.writeFile(usersFile, JSON.stringify(users, null, 2), 'utf8');
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, 64, 'sha512', (error, derivedKey) => {
      if (error) {
        return reject(error);
      }
      return resolve(derivedKey.toString('hex'));
    });
  });
}

function hashApiKey(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt
  };
}

function toPublicApiKey(apiKey) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    createdAt: apiKey.createdAt
  };
}

function getSessionToken(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  const legacyToken = req.headers['x-session-token'];
  if (typeof legacyToken === 'string') {
    return legacyToken.trim();
  }

  return '';
}

function getAuthenticatedSession(req, sessions) {
  const token = getSessionToken(req);
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) {
      sessions.delete(token);
    }
    return null;
  }

  return { token, session };
}

async function serveFile(filePath, res) {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const content = await fs.promises.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    respondJson(res, 404, { error: 'Not found' });
  }
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function createWebsiteServer(options = {}) {
  const publicDir = options.publicDir || DEFAULT_PUBLIC_DIR;
  const usersFile = options.usersFile || DEFAULT_USERS_FILE;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sessions = new Map();

  const fetchJson = async (url) => {
    if (typeof fetchImpl !== 'function') {
      throw new Error('Fetch API is unavailable in this runtime');
    }

    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(ROBLOX_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LuminaDB/0.1'
      }
    });

    if (!response.ok) {
      throw new Error(`Roblox API request failed with status ${response.status}`);
    }

    return response.json();
  };

  const resolveUniverseIdFromPlace = async (placeId) => {
    const payload = await fetchJson(`https://apis.roblox.com/universes/v1/places/${encodeURIComponent(placeId)}/universe`);
    const universeId = Number(payload.universeId);

    if (!Number.isInteger(universeId) || universeId <= 0) {
      throw new Error('Unable to resolve Roblox universe ID');
    }

    return universeId;
  };

  const fetchRobloxGamesByUniverseIds = async (universeIds) => {
    const map = new Map();
    if (!universeIds.length) {
      return map;
    }

    const dedupedIds = [...new Set(universeIds.map((id) => String(id)))];
    const chunks = chunkArray(dedupedIds, 50);

    for (const chunk of chunks) {
      const payload = await fetchJson(`https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(chunk.join(','))}`);
      const games = Array.isArray(payload.data) ? payload.data : [];
      for (const game of games) {
        if (game && game.id !== undefined) {
          map.set(String(game.id), game);
        }
      }
    }

    return map;
  };

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
      if (session.expiresAt <= now) {
        sessions.delete(token);
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/api/status') {
      return respondJson(res, 200, {
        status: 'ok',
        service: 'LuminaDB Web Platform',
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'GET' && pathname === '/api/docs') {
      return respondJson(res, 200, {
        endpoints: [
          { method: 'GET', path: '/api/status', description: 'Health endpoint' },
          { method: 'GET', path: '/api/docs', description: 'API endpoint listing' },
          { method: 'POST', path: '/api/auth/signup', description: 'Create an account' },
          { method: 'POST', path: '/api/auth/login', description: 'Authenticate an account' },
          { method: 'GET', path: '/api/dashboard', description: 'Get authenticated dashboard data' },
          { method: 'POST', path: '/api/dashboard/api-keys', description: 'Create a new API key' },
          { method: 'GET', path: '/api/dashboard/api-keys', description: 'List API keys' },
          { method: 'DELETE', path: '/api/dashboard/api-keys/:id', description: 'Delete an API key' },
          { method: 'POST', path: '/api/dashboard/games/link', description: 'Link a Roblox game by place ID' },
          { method: 'GET', path: '/api/dashboard/games', description: 'List linked games with live player counts' },
          { method: 'DELETE', path: '/api/dashboard/games/:id', description: 'Unlink a Roblox game' }
        ]
      });
    }

    if (req.method === 'POST' && pathname === '/api/auth/signup') {
      try {
        const body = await readBody(req);
        const payload = JSON.parse(body || '{}');
        const username = String(payload.username || '').trim().toLowerCase();
        const email = String(payload.email || '').trim().toLowerCase();
        const password = String(payload.password || '');

        if (!username || !email || !password) {
          return respondJson(res, 400, { error: 'username, email, and password are required' });
        }
        if (username.length < 3) {
          return respondJson(res, 400, { error: 'username must be at least 3 characters' });
        }
        if (password.length < 12) {
          return respondJson(res, 400, { error: 'password must be at least 12 characters' });
        }

        const users = await readUsers(usersFile);
        const duplicate = users.find((user) => user.username === username || user.email === email);
        if (duplicate) {
          return respondJson(res, 409, { error: 'account already exists' });
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const user = {
          id: crypto.randomUUID(),
          username,
          email,
          salt,
          passwordHash: await hashPassword(password, salt),
          createdAt: new Date().toISOString(),
          apiKeys: [],
          linkedGames: []
        };

        users.push(user);
        await writeUsers(usersFile, users);
        return respondJson(res, 201, {
          message: 'account created',
          user: toPublicUser(user)
        });
      } catch {
        return respondJson(res, 400, { error: 'invalid request payload' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      try {
        const body = await readBody(req);
        const payload = JSON.parse(body || '{}');
        const identifier = String(payload.identifier || payload.username || payload.email || '').trim().toLowerCase();
        const password = String(payload.password || '');

        if (!identifier || !password) {
          return respondJson(res, 400, { error: 'identifier and password are required' });
        }

        const users = await readUsers(usersFile);
        const user = users.find((entry) => entry.username === identifier || entry.email === identifier);
        if (!user) {
          return respondJson(res, 401, { error: 'invalid credentials' });
        }

        const computed = await hashPassword(password, user.salt);
        const computedBuffer = Buffer.from(computed, 'hex');
        const storedBuffer = Buffer.from(user.passwordHash, 'hex');
        if (computedBuffer.length !== storedBuffer.length) {
          return respondJson(res, 401, { error: 'invalid credentials' });
        }
        if (!crypto.timingSafeEqual(computedBuffer, storedBuffer)) {
          return respondJson(res, 401, { error: 'invalid credentials' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        sessions.set(token, {
          userId: user.id,
          createdAt: now,
          expiresAt: now + SESSION_TTL_MS
        });

        return respondJson(res, 200, {
          token,
          expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
          user: toPublicUser(user)
        });
      } catch {
        return respondJson(res, 400, { error: 'invalid request payload' });
      }
    }

    if (pathname.startsWith('/api/dashboard')) {
      const auth = getAuthenticatedSession(req, sessions);
      if (!auth) {
        return respondJson(res, 401, { error: 'authentication required' });
      }

      const users = await readUsers(usersFile);
      const userIndex = users.findIndex((entry) => entry.id === auth.session.userId);
      if (userIndex === -1) {
        sessions.delete(auth.token);
        return respondJson(res, 401, { error: 'invalid session' });
      }

      const user = normalizeUser(users[userIndex]);
      users[userIndex] = user;

      if (req.method === 'GET' && pathname === '/api/dashboard') {
        return respondJson(res, 200, {
          user: toPublicUser(user),
          metrics: {
            linkedGames: user.linkedGames.length,
            apiKeys: user.apiKeys.length
          }
        });
      }

      if (req.method === 'GET' && pathname === '/api/dashboard/api-keys') {
        return respondJson(res, 200, {
          apiKeys: user.apiKeys.map(toPublicApiKey)
        });
      }

      if (req.method === 'POST' && pathname === '/api/dashboard/api-keys') {
        try {
          const body = await readBody(req);
          const payload = JSON.parse(body || '{}');
          const name = String(payload.name || 'Default').trim();

          if (!name) {
            return respondJson(res, 400, { error: 'name is required' });
          }
          if (name.length > 64) {
            return respondJson(res, 400, { error: 'name must be 64 characters or fewer' });
          }

          const rawApiKey = `lumina_${crypto.randomBytes(24).toString('hex')}`;
          const record = {
            id: crypto.randomUUID(),
            name,
            keyPrefix: rawApiKey.slice(0, 16),
            keyHash: hashApiKey(rawApiKey),
            createdAt: new Date().toISOString()
          };

          user.apiKeys.push(record);
          await writeUsers(usersFile, users);

          return respondJson(res, 201, {
            message: 'api key created',
            apiKey: rawApiKey,
            metadata: toPublicApiKey(record)
          });
        } catch {
          return respondJson(res, 400, { error: 'invalid request payload' });
        }
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/dashboard/api-keys/')) {
        const keyId = pathname.split('/').pop();
        if (!keyId) {
          return respondJson(res, 400, { error: 'api key id is required' });
        }

        const beforeCount = user.apiKeys.length;
        user.apiKeys = user.apiKeys.filter((entry) => entry.id !== keyId);

        if (user.apiKeys.length === beforeCount) {
          return respondJson(res, 404, { error: 'api key not found' });
        }

        await writeUsers(usersFile, users);
        return respondJson(res, 200, { message: 'api key deleted' });
      }

      if (req.method === 'POST' && pathname === '/api/dashboard/games/link') {
        try {
          const body = await readBody(req);
          const payload = JSON.parse(body || '{}');
          const placeIdRaw = String(payload.placeId || '').trim();

          if (!/^\d+$/.test(placeIdRaw)) {
            return respondJson(res, 400, { error: 'placeId must be a numeric Roblox place id' });
          }

          const universeId = await resolveUniverseIdFromPlace(placeIdRaw);
          const gameMap = await fetchRobloxGamesByUniverseIds([universeId]);
          const game = gameMap.get(String(universeId));

          if (!game) {
            return respondJson(res, 404, { error: 'Roblox game data not found for that placeId' });
          }

          const existing = user.linkedGames.find((entry) => String(entry.universeId) === String(universeId));
          if (existing) {
            return respondJson(res, 409, { error: 'game already linked' });
          }

          const linkedGame = {
            id: crypto.randomUUID(),
            placeId: String(game.rootPlaceId || placeIdRaw),
            universeId: String(universeId),
            name: game.name || `Universe ${universeId}`,
            gameUrl: `https://www.roblox.com/games/${game.rootPlaceId || placeIdRaw}`,
            linkedAt: new Date().toISOString(),
            creatorName: game.creator && game.creator.name ? game.creator.name : null,
            visits: Number.isFinite(game.visits) ? game.visits : null
          };

          user.linkedGames.push(linkedGame);
          await writeUsers(usersFile, users);

          return respondJson(res, 201, {
            message: 'game linked',
            game: {
              ...linkedGame,
              playerCount: Number.isFinite(game.playing) ? game.playing : null
            }
          });
        } catch (error) {
          if (error && error.name === 'TimeoutError') {
            return respondJson(res, 504, { error: 'Roblox API request timed out' });
          }
          return respondJson(res, 502, { error: 'Unable to link Roblox game at this time' });
        }
      }

      if (req.method === 'GET' && pathname === '/api/dashboard/games') {
        try {
          const universeIds = user.linkedGames.map((entry) => entry.universeId);
          const gameMap = await fetchRobloxGamesByUniverseIds(universeIds);
          return respondJson(res, 200, {
            games: user.linkedGames.map((entry) => {
              const live = gameMap.get(String(entry.universeId));
              return {
                ...entry,
                playerCount: live && Number.isFinite(live.playing) ? live.playing : null,
                visits: live && Number.isFinite(live.visits) ? live.visits : entry.visits,
                creatorName: live && live.creator && live.creator.name ? live.creator.name : entry.creatorName
              };
            })
          });
        } catch (error) {
          if (error && error.name === 'TimeoutError') {
            return respondJson(res, 504, { error: 'Roblox API request timed out' });
          }
          return respondJson(res, 502, { error: 'Unable to fetch Roblox live data right now' });
        }
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/dashboard/games/')) {
        const gameId = pathname.split('/').pop();
        if (!gameId) {
          return respondJson(res, 400, { error: 'linked game id is required' });
        }

        const beforeCount = user.linkedGames.length;
        user.linkedGames = user.linkedGames.filter((entry) => entry.id !== gameId);

        if (user.linkedGames.length === beforeCount) {
          return respondJson(res, 404, { error: 'linked game not found' });
        }

        await writeUsers(usersFile, users);
        return respondJson(res, 200, { message: 'linked game removed' });
      }

      return respondJson(res, 404, { error: 'Not found' });
    }

    if (req.method === 'GET' && pathname.startsWith('/assets/')) {
      const target = pathname.replace('/assets/', '');
      return serveFile(path.join(publicDir, target), res);
    }

    const pages = {
      '/': 'index.html',
      '/docs': 'docs.html',
      '/api': 'api.html',
      '/auth': 'auth.html',
      '/dashboard': 'dashboard.html'
    };

    if (req.method === 'GET' && pages[pathname]) {
      return serveFile(path.join(publicDir, pages[pathname]), res);
    }

    return respondJson(res, 404, { error: 'Not found' });
  });

  return {
    server,
    close: () => new Promise((resolve, reject) => {
      clearInterval(cleanupTimer);
      server.close((error) => (error ? reject(error) : resolve()));
    }),
    sessionCount: () => sessions.size
  };
}

function startWebsiteServer(options = {}) {
  const host = options.host || process.env.HOST || '127.0.0.1';
  const port = Number(options.port || process.env.PORT || 3000);
  const app = createWebsiteServer(options);

  return new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, host, () => {
      resolve({
        ...app,
        host,
        port: app.server.address().port
      });
    });
  });
}

if (require.main === module) {
  startWebsiteServer()
    .then(({ host, port }) => {
      console.log(`LuminaDB web platform running at http://${host}:${port}`);
    })
    .catch((error) => {
      console.error('Failed to start LuminaDB web platform:', error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  createWebsiteServer,
  startWebsiteServer
};
