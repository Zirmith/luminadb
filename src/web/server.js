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

async function readUsers(usersFile) {
  await ensureUserStore(usersFile);
  const raw = await fs.promises.readFile(usersFile, 'utf8');
  return JSON.parse(raw);
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

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt
  };
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

function createWebsiteServer(options = {}) {
  const publicDir = options.publicDir || DEFAULT_PUBLIC_DIR;
  const usersFile = options.usersFile || DEFAULT_USERS_FILE;
  const sessions = new Map();
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
          { method: 'POST', path: '/api/auth/login', description: 'Authenticate an account' }
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
          createdAt: new Date().toISOString()
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

    if (req.method === 'GET' && pathname.startsWith('/assets/')) {
      const target = pathname.replace('/assets/', '');
      return serveFile(path.join(publicDir, target), res);
    }

    const pages = {
      '/': 'index.html',
      '/docs': 'docs.html',
      '/api': 'api.html',
      '/auth': 'auth.html'
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
