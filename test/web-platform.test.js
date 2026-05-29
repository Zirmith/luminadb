const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startWebsiteServer } = require('../src/web/server');

function httpRequest(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : undefined
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

test('web server handles page routes and auth endpoints', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-web-'));
  const usersFile = path.join(tempDir, 'users.json');

  const app = await startWebsiteServer({
    host: '127.0.0.1',
    port: 0,
    usersFile
  });

  const port = app.port;

  try {
    const landing = await httpRequest(port, 'GET', '/');
    assert.equal(landing.statusCode, 200);
    assert.match(landing.body, /LuminaDB Platform/);

    const signup = await httpRequest(port, 'POST', '/api/auth/signup', {
      username: 'playerone',
      email: 'playerone@example.com',
      password: 'StrongPass1234'
    });
    assert.equal(signup.statusCode, 201);
    const signupPayload = JSON.parse(signup.body);
    assert.equal(signupPayload.user.username, 'playerone');

    const duplicate = await httpRequest(port, 'POST', '/api/auth/signup', {
      username: 'playerone',
      email: 'playerone@example.com',
      password: 'StrongPass1234'
    });
    assert.equal(duplicate.statusCode, 409);

    const login = await httpRequest(port, 'POST', '/api/auth/login', {
      identifier: 'playerone',
      password: 'StrongPass1234'
    });
    assert.equal(login.statusCode, 200);
    const loginPayload = JSON.parse(login.body);
    assert.ok(loginPayload.token);
    assert.match(loginPayload.token, /^[a-f0-9]{64}$/);

    const status = await httpRequest(port, 'GET', '/api/status');
    assert.equal(status.statusCode, 200);
    const statusPayload = JSON.parse(status.body);
    assert.equal(statusPayload.status, 'ok');

    const badLogin = await httpRequest(port, 'POST', '/api/auth/login', {
      identifier: 'playerone',
      password: 'WrongPass'
    });
    assert.equal(badLogin.statusCode, 401);
  } finally {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
