const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_USERS_FILE = path.join(DEFAULT_DATA_DIR, 'users.json');

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
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
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
  return crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
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
        const username = String(payload.username || '').trim();
        const email = String(payload.email || '').trim().toLowerCase();
        const password = String(payload.password || '');

        if (!username || !email || !password) {
          return respondJson(res, 400, { error: 'username, email, and password are required' });
        }
        if (username.length < 3) {
          return respondJson(res, 400, { error: 'username must be at least 3 characters' });
        }
        if (password.length < 8) {
          return respondJson(res, 400, { error: 'password must be at least 8 characters' });
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
          passwordHash: hashPassword(password, salt),
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
        const user = users.find((entry) => entry.username.toLowerCase() === identifier || entry.email === identifier);
        if (!user) {
          return respondJson(res, 401, { error: 'invalid credentials' });
        }

        const computed = hashPassword(password, user.salt);
        if (!crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(user.passwordHash, 'hex'))) {
          return respondJson(res, 401, { error: 'invalid credentials' });
        }

        const token = crypto.randomBytes(24).toString('hex');
        sessions.set(token, { userId: user.id, createdAt: Date.now() });

        return respondJson(res, 200, {
          token,
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
