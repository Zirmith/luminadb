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

  async function submitJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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
        setStatus(statusNode, 'Authenticated successfully.', 'success');
      } catch (error) {
        setStatus(statusNode, error.message, 'error');
      }
    });
  }

  if (window.feather) {
    window.feather.replace();
  }
})();
