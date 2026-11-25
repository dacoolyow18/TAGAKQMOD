const shell = document.querySelector('#auth-shell');
const params = new URLSearchParams(location.search);
const requestedApp = params.get('app') === 'admin' ? 'admin' : 'pos';
const returnUrl = params.get('return_url');
const posForm = document.querySelector('#pos-form');
const adminForm = document.querySelector('#admin-form');
const posError = document.querySelector('#pos-error');
const adminError = document.querySelector('#admin-error');
const adminPassword = document.querySelector('#admin-password');
const passwordToggle = document.querySelector('#toggle-admin-password');

function showAdmin() {
  shell.classList.add('right-panel-active');
  document.querySelector('#admin-email').focus();
}

function showPos() {
  shell.classList.remove('right-panel-active');
  document.querySelector('#pos-email').focus();
}

document.querySelector('#show-admin').addEventListener('click', showAdmin);
document.querySelector('#show-pos').addEventListener('click', showPos);

passwordToggle.addEventListener('click', () => {
  const isVisible = adminPassword.type === 'text';
  adminPassword.type = isVisible ? 'password' : 'text';
  passwordToggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
  passwordToggle.setAttribute('aria-pressed', String(!isVisible));
  passwordToggle.classList.toggle('is-visible', !isVisible);
});

if (requestedApp === 'admin') showAdmin();

const googleErrors = {
  cancelled: 'Google sign-in was cancelled. Try again.',
  not_admin: 'No admin account matches this Google email.',
  unverified: 'Use a verified Google email address.',
  not_configured: 'Google sign-in is not set up yet. Use your email and password.',
  failed: 'Google sign-in failed. Try again or use your password.',
};
const googleErrorCode = params.get('google_error');
if (googleErrorCode) {
  adminError.textContent = googleErrors[googleErrorCode] || googleErrors.failed;
  adminError.style.color = 'var(--rust)';
}

function destinationFor(app) {
  const fallback = app === 'admin' ? '../admin-app/index.html' : '../pos-app/index.html';
  let destination = new URL(fallback, location.href);
  try {
    const requested = new URL(returnUrl, location.href);
    const isSameOrigin = requested.origin === location.origin;
    const isAllowedApp = requested.pathname.includes('/pos-app/') || requested.pathname.includes('/admin-app/');
    if (isSameOrigin && isAllowedApp) destination = requested;
  } catch (_) { /* Use the app fallback for malformed or missing return URLs. */ }
  return destination;
}

function showError(element, message) {
  element.textContent = message;
  element.style.color = 'var(--rust)';
}

async function signIn(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
}

const posEmailInput = document.querySelector('#pos-email');
const posPinInput = document.querySelector('#pos-pin');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_PATTERN = /^\d{4}$/;
let managed = false;
const configureLogin = fetch('/api/auth/provider', { cache: 'no-store' })
  .then(async response => {
    if (!response.ok) throw new Error('Sign-in is unavailable.');
    const { provider } = await response.json();
    if (!['local', 'supabase'].includes(provider)) throw new Error('Sign-in is unavailable.');
    managed = provider === 'supabase';
    if (managed) {
      posForm.querySelector('label[for="pos-pin"]').textContent = 'Staff password';
      posForm.querySelector('.form-intro').textContent = 'Sign in with your staff email and password.';
      posPinInput.removeAttribute('inputmode');
      posPinInput.removeAttribute('maxlength');
      posPinInput.removeAttribute('pattern');
      posPinInput.autocomplete = 'current-password';
      posPinInput.placeholder = 'Enter your password';
    }
    return true;
  })
  .catch(() => {
    showError(adminError, 'Sign-in is unavailable. Reload to try again.');
    showError(posError, 'Sign-in is unavailable. Reload to try again.');
    return false;
  });
function staffError() {
  return managed ? 'Enter a valid staff email and password.' : 'Enter a valid staff email and 4-digit PIN.';
}

posPinInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !EMAIL_PATTERN.test(posEmailInput.value.trim())) {
    event.preventDefault();
    showError(posError, staffError());
    posEmailInput.focus();
  }
});

posForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!await configureLogin) return;
  const email = posEmailInput.value.trim().toLowerCase();
  const pin = managed ? posPinInput.value : posPinInput.value.trim();
  if (!EMAIL_PATTERN.test(email) || (managed ? !pin : !PIN_PATTERN.test(pin))) {
    showError(posError, staffError());
    if (!EMAIL_PATTERN.test(email)) posEmailInput.focus();
    else posPinInput.focus();
    return;
  }
  posError.textContent = '';
  const res = managed
    ? await signIn('/api/auth/managed-login', { email, password: pin, app: 'pos' })
    : await signIn('/api/auth/pin', { email, pin });
  if (res.ok) location.replace(destinationFor('pos').href);
  else if (res.status === 429) showError(posError, (await res.json()).error);
  else showError(posError, staffError());
});

adminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!await configureLogin) return;
  const email = document.querySelector('#admin-email').value.trim();
  const password = document.querySelector('#admin-password').value;
  const res = managed
    ? await signIn('/api/auth/managed-login', { email, password, app: 'admin' })
    : await signIn('/api/auth/admin-login', { email, password });
  if (res.ok) location.replace(destinationFor('admin').href);
  else if (res.status === 429) showError(adminError, (await res.json()).error);
  else showError(adminError, 'Enter valid admin credentials.');
});
