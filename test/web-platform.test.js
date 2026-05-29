const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startWebsiteServer } = require('../src/web/server');

function httpRequest(port, method, pathname, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      ...(payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        : {}),
      ...(extraHeaders || {})
    };
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers
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

  const fetchStub = async (url) => {
    if (url.includes('apis.roblox.com/universes/v1/places/5555/universe')) {
      return {
        ok: true,
        json: async () => ({ universeId: 9999 })
      };
    }

    if (url.includes('games.roblox.com/v1/games?universeIds=9999')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 9999,
              name: 'Sky Arena',
              rootPlaceId: 5555,
              playing: 42,
              visits: 1000,
              creator: { name: 'LuminaStudio' }
            }
          ]
        })
      };
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({})
    };
  };

  const app = await startWebsiteServer({
    host: '127.0.0.1',
    port: 0,
    usersFile,
    fetchImpl: fetchStub
  });

  const port = app.port;

  try {
    const landing = await httpRequest(port, 'GET', '/');
    assert.equal(landing.statusCode, 200);
    assert.match(landing.body, /LuminaDB Platform/);

    const dashboardPage = await httpRequest(port, 'GET', '/dashboard');
    assert.equal(dashboardPage.statusCode, 200);
    assert.match(dashboardPage.body, /Operations Dashboard/);

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

    const dashboardNoAuth = await httpRequest(port, 'GET', '/api/dashboard');
    assert.equal(dashboardNoAuth.statusCode, 401);

    const authHeaders = { 'x-session-token': loginPayload.token };

    const dashboard = await httpRequest(port, 'GET', '/api/dashboard', undefined, authHeaders);
    assert.equal(dashboard.statusCode, 200);
    const dashboardPayload = JSON.parse(dashboard.body);
    assert.equal(dashboardPayload.metrics.linkedGames, 0);
    assert.equal(dashboardPayload.metrics.apiKeys, 0);

    const createdApiKey = await httpRequest(
      port,
      'POST',
      '/api/dashboard/api-keys',
      { name: 'Primary key' },
      authHeaders
    );
    assert.equal(createdApiKey.statusCode, 201);
    const apiKeyPayload = JSON.parse(createdApiKey.body);
    assert.match(apiKeyPayload.apiKey, /^lumina_[a-f0-9]{48}$/);

    const apiKeys = await httpRequest(port, 'GET', '/api/dashboard/api-keys', undefined, authHeaders);
    assert.equal(apiKeys.statusCode, 200);
    const apiKeysPayload = JSON.parse(apiKeys.body);
    assert.equal(apiKeysPayload.apiKeys.length, 1);

    const linkedGame = await httpRequest(
      port,
      'POST',
      '/api/dashboard/games/link',
      { placeId: '5555' },
      authHeaders
    );
    assert.equal(linkedGame.statusCode, 201);

    const linkedGames = await httpRequest(port, 'GET', '/api/dashboard/games', undefined, authHeaders);
    assert.equal(linkedGames.statusCode, 200);
    const linkedGamesPayload = JSON.parse(linkedGames.body);
    assert.equal(linkedGamesPayload.games.length, 1);
    assert.equal(linkedGamesPayload.games[0].playerCount, 42);

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
