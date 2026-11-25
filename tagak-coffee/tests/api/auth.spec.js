const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;

test.beforeAll(async () => {
  await resetDatabase();
  await insertAccount({ id: 'emp-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678' });
  await insertAccount({ id: 'emp-admin', name: 'Admin User', role: 'Admin', email: 'admin@tagak.test', password: 'admin-pass-123', pin: '1111' });
  await withClient(c => c.query(
    `INSERT INTO accounts (id, name, role, email, active, phone) VALUES
       ('emp-inactive', 'Inactive Admin', 'Admin', 'inactive@tagak.test', false, '09981110001'),
       ('emp-mgr-email', 'Manager With Email', 'Manager', 'manager@tagak.test', true, '09981110002')`,
  ));
  server = await startServer({ maxAttempts: 10 });
});

test.afterAll(async () => {
  await server?.close();
});

async function postJson(request, path, data) {
  return request.post(`${server.baseURL}${path}`, { data });
}

function sessionCookie(response) {
  const header = response.headers()['set-cookie'] || '';
  const match = header.match(/tagak_session=([^;]+)/);
  return match ? match[1] : null;
}

test('admin login with the correct password sets an httpOnly session cookie', async ({ request }) => {
  const res = await postJson(request, '/api/auth/admin-login', { email: SUPER_EMAIL, password: SUPER_PASSWORD });
  expect(res.status()).toBe(200);
  const header = res.headers()['set-cookie'];
  expect(header).toContain('tagak_session=');
  expect(header).toContain('HttpOnly');
  expect(header).toContain('SameSite=Lax');
});

test('wrong password and unknown email return the same 401 message', async ({ request }) => {
  const wrong = await postJson(request, '/api/auth/admin-login', { email: SUPER_EMAIL, password: 'nope' });
  const unknown = await postJson(request, '/api/auth/admin-login', { email: 'ghost@tagak.test', password: 'nope' });
  expect(wrong.status()).toBe(401);
  expect(unknown.status()).toBe(401);
  expect((await wrong.json()).error).toBe('Invalid credentials');
  expect((await unknown.json()).error).toBe('Invalid credentials');
});

test('an admin account cannot log in with a PIN', async ({ request }) => {
  const res = await postJson(request, '/api/auth/pin', { email: 'admin@tagak.test', pin: '1111' });
  expect(res.status()).toBe(401);
});

test('a Manager email and PIN logs in to the POS and a bad PIN or missing/invalid/mismatched email fails', async ({ request }) => {
  const ok = await postJson(request, '/api/auth/pin', { email: 'emp-mgr@tagak.test', pin: '5678' });
  expect(ok.status()).toBe(200);
  expect(sessionCookie(ok)).toBeTruthy();
  const bad = await postJson(request, '/api/auth/pin', { email: 'emp-mgr@tagak.test', pin: '0000' });
  expect(bad.status()).toBe(401);
  const wrongEmail = await postJson(request, '/api/auth/pin', { email: 'other@tagak.test', pin: '5678' });
  expect(wrongEmail.status()).toBe(401);
  const missingEmail = await postJson(request, '/api/auth/pin', { pin: '5678' });
  expect(missingEmail.status()).toBe(401);
  expect(sessionCookie(missingEmail)).toBeNull();
  const emptyEmail = await postJson(request, '/api/auth/pin', { email: '', pin: '5678' });
  expect(emptyEmail.status()).toBe(401);
  expect(sessionCookie(emptyEmail)).toBeNull();
  const whitespaceEmail = await postJson(request, '/api/auth/pin', { email: '   ', pin: '5678' });
  expect(whitespaceEmail.status()).toBe(401);
  expect(sessionCookie(whitespaceEmail)).toBeNull();
  const invalidEmail = await postJson(request, '/api/auth/pin', { email: 'not-an-email', pin: '5678' });
  expect(invalidEmail.status()).toBe(401);
  expect(sessionCookie(invalidEmail)).toBeNull();
});

test('a non-4-digit PIN is rejected', async ({ request }) => {
  const res = await postJson(request, '/api/auth/pin', { email: 'emp-mgr@tagak.test', pin: '12a4' });
  expect(res.status()).toBe(401);
});

test('repeated failed logins are rate limited with 429 and can be unlocked by an admin', async ({ request }) => {
  await withClient(c => c.query('DELETE FROM request_attempts'));
  const limited = await startServer({ maxAttempts: 3 });
  try {
    const adminRes = await request.post(`${limited.baseURL}/api/auth/admin-login`, {
      data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
    });
    const superCookie = `tagak_session=${sessionCookie(adminRes)}`;

    const statuses = [];
    let lastBody = null;
    for (let i = 0; i < 4; i++) {
      const res = await request.post(`${limited.baseURL}/api/auth/pin`, {
        data: { email: 'emp-mgr@tagak.test', pin: '0000' },
      });
      statuses.push(res.status());
      if (res.status() === 429) lastBody = await res.json();
    }
    expect(statuses.slice(0, 3).every(s => s === 401)).toBe(true);
    expect(statuses[3]).toBe(429);
    expect(lastBody.error).toBe('Too many attempts. Wait 5 minutes to try again or contact admin support.');

    // Account is reported as locked in GET /api/accounts
    const listBefore = await (await request.get(`${limited.baseURL}/api/accounts`, {
      headers: { Cookie: superCookie },
    })).json();
    expect(listBefore.find(a => a.id === 'emp-mgr').locked).toBe(true);

    // Admin unlocks the employee account
    const unlockRes = await request.post(`${limited.baseURL}/api/accounts/emp-mgr/unlock`, {
      headers: { Cookie: superCookie },
    });
    expect(unlockRes.status()).toBe(200);
    expect((await unlockRes.json()).locked).toBe(false);

    // Employee can immediately sign in without waiting 15 minutes
    const afterUnlock = await request.post(`${limited.baseURL}/api/auth/pin`, {
      data: { email: 'emp-mgr@tagak.test', pin: '5678' },
    });
    expect(afterUnlock.status()).toBe(200);
  } finally {
    await limited.close();
  }
});

test('Google sign-in only matches active Admin and Super Admin accounts', async () => {
  const { findAdminByEmail } = require('../../server/auth/google');

  const superAdmin = await findAdminByEmail(SUPER_EMAIL.toUpperCase());
  expect(superAdmin?.role).toBe('Super Admin');

  const admin = await findAdminByEmail('admin@tagak.test');
  expect(admin?.id).toBe('emp-admin');

  expect(await findAdminByEmail('inactive@tagak.test')).toBeNull();
  expect(await findAdminByEmail('manager@tagak.test')).toBeNull();
  expect(await findAdminByEmail('missing@tagak.test')).toBeNull();
  expect(await findAdminByEmail('')).toBeNull();
});

test('logout deletes the session so the cookie no longer works', async ({ request }) => {
  const login = await postJson(request, '/api/auth/pin', { email: 'emp-mgr@tagak.test', pin: '5678' });
  const token = sessionCookie(login);
  const logout = await request.post(`${server.baseURL}/api/auth/logout`, {
    headers: { Cookie: `tagak_session=${token}` },
  });
  expect(logout.status()).toBe(200);
  const check = await request.get(`${server.baseURL}/api/auth/me`, {
    headers: { Cookie: `tagak_session=${token}` },
  });
  expect(check.status()).toBe(401);
});

test('internal server and database files are hidden regardless of URL casing', async ({ request }) => {
  for (const p of ['/server/app.js', '/SERVER/app.js', '/Db/seed.js', '/PACKAGE.JSON', '/README.md']) {
    const res = await request.get(`${server.baseURL}${p}`);
    expect(res.status()).toBe(404);
  }
});
