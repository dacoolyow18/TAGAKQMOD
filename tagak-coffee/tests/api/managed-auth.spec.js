const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { resetDatabase, startServer, withClient } = require('./helpers');
const identity = require('../../server/auth/provider');

test('Google callback refuses state issued to another browser', async ({ request, playwright }) => {
  const previous = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET];
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-only';
  let server, other;
  try {
    server = await startServer();
    const start = await request.get(server.baseURL + '/auth/google', { maxRedirects: 0 });
    const state = new URL(start.headers().location).searchParams.get('state');
    expect(state).toBeTruthy();
    expect(start.headers()['set-cookie']).toContain('HttpOnly');
    other = await playwright.request.newContext();
    const callback = server.baseURL + '/auth/google/callback?state=' + encodeURIComponent(state);
    await other.get(callback, { maxRedirects: 0 });
    const lookup = () => withClient(db => db.query('SELECT 1 FROM oauth_states WHERE state=$1', [state]));
    expect((await lookup()).rowCount).toBe(1);
    await request.get(callback, { maxRedirects: 0 });
    expect((await lookup()).rowCount).toBe(0);
  } finally {
    await other?.dispose();
    await server?.close();
    for (const [i, key] of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'].entries()) {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }
  }
});

test('managed sign-in requires an explicitly linked confirmed identity and checks it again on access', async ({ request }) => {
  await resetDatabase();
  const previous = process.env.AUTH_PROVIDER;
  const originalClient = identity.authClient;
  const user = { id: randomUUID(), email_confirmed_at: new Date().toISOString() };
  user.email = await withClient(async db =>
    (await db.query("SELECT email FROM accounts WHERE id='super-admin'")).rows[0].email);
  const session = { access_token: randomUUID(), expires_at: Math.floor(Date.now() / 1000) + 3600 };
  let server;
  try {
    process.env.AUTH_PROVIDER = 'supabase';
    identity.authClient = () => ({
      signInWithPassword: async () => ({ data: { user, session } }),
      getUser: async () => ({ data: { user } }),
    });
    server = await startServer();
    const login = () => request.post(server.baseURL + '/api/auth/managed-login', {
      data: { email: user.email, password: 'test-fixture', app: 'admin' },
    });
    expect((await login()).status()).toBe(401);
    await withClient(db => db.query("UPDATE accounts SET auth_user_id=$1 WHERE id='super-admin'", [user.id]));
    const response = await login();
    expect(response.status()).toBe(200);
    expect(response.headers()['set-cookie']).toContain('HttpOnly');
    expect((await request.get(server.baseURL + '/api/auth/me')).status()).toBe(200);
    user.id = randomUUID();
    expect((await request.get(server.baseURL + '/api/auth/me')).status()).toBe(401);
    expect((await request.post(server.baseURL + '/api/auth/admin-login')).status()).toBe(404);
  } finally {
    await server?.close();
    identity.authClient = originalClient;
    if (previous === undefined) delete process.env.AUTH_PROVIDER;
    else process.env.AUTH_PROVIDER = previous;
  }
});
