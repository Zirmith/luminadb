(function () {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.querySelector('[data-nav-toggle]');

  if (toggle && sidebar) {
    toggle.addEventListener('click', function () {
      sidebar.classList.toggle('open');
    });
  }

  const path = window.location.pathname;
  document.querySelectorAll('.nav a').forEach((link) => {
    if (link.getAttribute('href') === path) {
      link.classList.add('active');
    }
  });

  async function submitJson(url, payload, method = 'POST') {
    const token = sessionStorage.getItem('luminaToken');
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  async function fetchJson(url) {
    const token = sessionStorage.getItem('luminaToken');
    const response = await fetch(url, {
      headers: token ? { Authorization: 'Bearer ' + token } : undefined
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  function setStatus(node, text, type) {
    if (!node) return;
    node.textContent = text;
    node.className = `status ${type}`;
  }

  const signupForm = document.querySelector('[data-signup-form]');
  if (signupForm) {
    signupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const statusNode = signupForm.querySelector('[data-status]');
      try {
        const payload = {
          username: signupForm.username.value,
          email: signupForm.email.value,
          password: signupForm.password.value
        };
        const result = await submitJson('/api/auth/signup', payload);
        setStatus(statusNode, `Account created for ${result.user.username}.`, 'success');
        signupForm.reset();
      } catch (error) {
        setStatus(statusNode, error.message, 'error');
      }
    });
  }

  const loginForm = document.querySelector('[data-login-form]');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const statusNode = loginForm.querySelector('[data-status]');
      try {
        const payload = {
          identifier: loginForm.identifier.value,
          password: loginForm.password.value
        };
        const result = await submitJson('/api/auth/login', payload);
        sessionStorage.setItem('luminaToken', result.token);
        sessionStorage.setItem('luminaTokenExpiresAt', result.expiresAt);
        setStatus(statusNode, 'Authenticated successfully. Open the dashboard to manage games and keys.', 'success');
      } catch (error) {
        setStatus(statusNode, error.message, 'error');
      }
    });
  }

  function createActionButton(text, clickHandler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost-button small-button';
    button.textContent = text;
    button.addEventListener('click', clickHandler);
    return button;
  }

  function createCell(row, value) {
    const cell = document.createElement('td');
    if (value instanceof Node) {
      cell.appendChild(value);
    } else {
      cell.textContent = String(value);
    }
    row.appendChild(cell);
    return cell;
  }

  const dashboardStatus = document.querySelector('[data-dashboard-status]');
  const metricsLinkedGames = document.querySelector('[data-metric-linked-games]');
  const metricsApiKeys = document.querySelector('[data-metric-api-keys]');
  const apiKeysList = document.querySelector('[data-api-keys-list]');
  const gamesList = document.querySelector('[data-games-list]');

  async function loadDashboardData() {
    if (!dashboardStatus || !apiKeysList || !gamesList) {
      return;
    }

    try {
      const [dashboard, apiKeysPayload, gamesPayload] = await Promise.all([
        fetchJson('/api/dashboard'),
        fetchJson('/api/dashboard/api-keys'),
        fetchJson('/api/dashboard/games')
      ]);

      metricsLinkedGames.textContent = String(dashboard.metrics.linkedGames || 0);
      metricsApiKeys.textContent = String(dashboard.metrics.apiKeys || 0);

      apiKeysList.innerHTML = '';
      if (!apiKeysPayload.apiKeys.length) {
        apiKeysList.innerHTML = '<tr><td colspan="4" class="small">No API keys yet.</td></tr>';
      } else {
        apiKeysPayload.apiKeys.forEach((key) => {
          const row = document.createElement('tr');
          createCell(row, key.name);
          const codeNode = document.createElement('code');
          codeNode.textContent = `${key.keyPrefix}...`;
          createCell(row, codeNode);
          createCell(row, new Date(key.createdAt).toLocaleString());
          const actionCell = createCell(row, '');
          actionCell.appendChild(
            createActionButton('Delete', async () => {
              await submitJson(`/api/dashboard/api-keys/${key.id}`, undefined, 'DELETE');
              await loadDashboardData();
              setStatus(dashboardStatus, 'API key deleted.', 'success');
            })
          );
          apiKeysList.appendChild(row);
        });
      }

      gamesList.innerHTML = '';
      if (!gamesPayload.games.length) {
        gamesList.innerHTML = '<tr><td colspan="5" class="small">No linked games yet.</td></tr>';
      } else {
        gamesPayload.games.forEach((game) => {
          const row = document.createElement('tr');
          const link = document.createElement('a');
          link.href = game.gameUrl;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = game.name;
          createCell(row, link);
          createCell(row, game.universeId);
          createCell(row, game.playerCount === null ? 'Unavailable' : game.playerCount);
          createCell(row, game.visits === null ? 'Unavailable' : game.visits);
          const actionCell = createCell(row, '');
          actionCell.appendChild(
            createActionButton('Unlink', async () => {
              await submitJson(`/api/dashboard/games/${game.id}`, undefined, 'DELETE');
              await loadDashboardData();
              setStatus(dashboardStatus, 'Game unlinked.', 'success');
            })
          );
          gamesList.appendChild(row);
        });
      }

      setStatus(dashboardStatus, 'Dashboard synchronized with live data.', 'success');
    } catch (error) {
      setStatus(dashboardStatus, error.message, 'error');
      if (error.message.includes('authentication')) {
        dashboardStatus.textContent = 'Authentication required. Sign in on the Account page first.';
      }
    }
  }

  const apiKeyForm = document.querySelector('[data-api-key-form]');
  if (apiKeyForm) {
    apiKeyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const statusNode = apiKeyForm.querySelector('[data-api-key-status]');
      const secretNode = apiKeyForm.querySelector('[data-api-key-secret]');

      try {
        const result = await submitJson('/api/dashboard/api-keys', {
          name: apiKeyForm.name.value
        });

        setStatus(statusNode, 'API key created. Copy it now; it will not be shown again.', 'success');
        secretNode.hidden = false;
        secretNode.textContent = result.apiKey;
        apiKeyForm.reset();
        await loadDashboardData();
      } catch (error) {
        secretNode.hidden = true;
        setStatus(statusNode, error.message, 'error');
      }
    });
  }

  const linkGameForm = document.querySelector('[data-link-game-form]');
  if (linkGameForm) {
    linkGameForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const statusNode = linkGameForm.querySelector('[data-link-game-status]');

      try {
        await submitJson('/api/dashboard/games/link', {
          placeId: linkGameForm.placeId.value
        });

        setStatus(statusNode, 'Roblox game linked successfully.', 'success');
        linkGameForm.reset();
        await loadDashboardData();
      } catch (error) {
        setStatus(statusNode, error.message, 'error');
      }
    });
  }

  document.querySelectorAll('[data-refresh-dashboard]').forEach((button) => {
    button.addEventListener('click', () => {
      loadDashboardData();
    });
  });

  if (path === '/dashboard') {
    loadDashboardData();
  }

  if (window.feather) {
    window.feather.replace();
  }
})();
