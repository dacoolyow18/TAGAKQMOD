/* Shared session bridge for the POS and admin applications. The server holds the session in an httpOnly cookie. */
(function () {
  const APP = location.pathname.includes('/admin-app/') ? 'admin' : 'pos';
  const APP_ROOT = new URL('../', location.href);
  const LOGIN_URL = new URL('unified-login/index.html', APP_ROOT);
  const ALLOWED_ROLES = APP === 'admin'
    ? ['Super Admin', 'Admin']
    : ['Manager', 'Barista', 'Cashier'];

  let session = null;

  function redirectToLogin() {
    LOGIN_URL.search = '';
    LOGIN_URL.searchParams.set('return_url', location.href);
    LOGIN_URL.searchParams.set('app', APP);
    location.replace(LOGIN_URL.href);
  }

  const emergency = APP === 'pos' && typeof offlinePOS !== 'undefined' ? offlinePOS : null;
  const ready = (async () => {
    if (emergency) await emergency.finishLogout();
    const res = await fetch(new URL('api/auth/me', APP_ROOT), { credentials: 'same-origin', signal:AbortSignal.timeout(6000) });
    if (res.status === 401 || res.status === 403) {
      if (emergency) await emergency.lock();
      return null;
    }
    if (!res.ok) throw Error('Session service unavailable');
    return res.json();
  })().catch(async () => {
    if (!emergency) return null;
    const user = await emergency.restore().catch(()=>null);
    if (!user) {
      window.addEventListener('online',()=>location.reload(),{once:true});
      document.body.textContent = 'POS unavailable. Reconnect and sign in to prepare the cached menu and register shift. Pending cash records are retained.';
      return { unavailable:true };
    }
    return user;
  })
    .then(user => {
      if (user?.unavailable) return null;
      if (!user || !ALLOWED_ROLES.includes(user.role)) {
        redirectToLogin();
        return null;
      }
      session = {
        user: {
          provider: user.provider,
          id: user.id,
          name: user.name,
          role: user.role,
          branchId: user.branchId || null,
          permissions: user.permissions || {},
        },
      };
      if (APP === 'admin') {
        let refreshing = false;
        const refresh = async () => {
          if (refreshing) return;
          refreshing = true;
          try {
            const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
            if ([401, 403].includes(response.status)) return redirectToLogin();
            if (!response.ok) return;
            const current = await response.json();
            if (current.id !== user.id || current.role !== user.role ||
                JSON.stringify(current.permissions) !== JSON.stringify(user.permissions)) location.reload();
          } catch { /* Retry when connectivity returns. */ }
          finally { refreshing = false; }
        };
        for (const event of ['focus', 'online']) window.addEventListener(event, refresh);
        setInterval(refresh, 30000);
      }
      return session;
    });

  function getSession() { return session; }

  async function logout() {
    if (emergency) {
      if(!await emergency.confirmLogout()) return;
      await emergency.lock(true);
      try { await emergency.finishLogout(); }
      catch { location.reload(); return; }
    } else await fetch(new URL('api/auth/logout', APP_ROOT), { method: 'POST', credentials: 'same-origin' });
    const target = new URL('unified-login/index.html', APP_ROOT);
    target.searchParams.set('logged_out', '1');
    location.replace(target.href);
  }

  function bindLogout(selector) { document.querySelector(selector)?.addEventListener('click', logout); }
  let fetchAuthorized = false;
  function authorizeFetch() {
    if (fetchAuthorized || typeof window.fetch !== 'function') return;
    fetchAuthorized = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = function (input, init = {}) {
      const branchId = session?.user?.branchId;
      if (!branchId) return origFetch(input, init);
      const headers = new Headers(init.headers || {});
      if (!headers.has('X-Branch-Id')) headers.set('X-Branch-Id', branchId);
      return origFetch(input, { ...init, headers });
    };
  }

  window.TAGAK_AUTH = { ready, getSession, logout, bindLogout, authorizeFetch, redirectToLogin };
})();
