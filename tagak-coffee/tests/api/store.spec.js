const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let managerCookie;

async function cookieFrom(res) {
  const header = res.headers()['set-cookie'] || '';
  return `tagak_session=${header.match(/tagak_session=([^;]+)/)[1]}`;
}

function call(request, method, path, cookie, data) {
  return request.fetch(`${server.baseURL}${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
    data,
  });
}

function orderBody() {
  return { branchId: 'brn-main', customerName: 'Sam', payment: 'cash', lines: [{ menuItemId: 'menu-scone', qty: 1 }] };
}

test.beforeAll(async ({ request }) => {
  await resetDatabase();
  await withClient(async c => {
    await c.query(`INSERT INTO branches (id, code, name) VALUES ('brn-main', '1001', 'Main')`);
    await c.query(`INSERT INTO menu_items (id, name, category, price) VALUES ('menu-scone', 'Scone', 'Pastries', 70)`);
  });
  await insertAccount({ id: 'emp-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678', branchId: 'brn-main' });
  server = await startServer();
  managerCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-mgr@tagak.test', pin: '5678' },
  }));
});

test.afterAll(async () => {
  await server?.close();
});

test('the store is open by default, for the register and the customer app alike', async ({ request }) => {
  const register = await (await call(request, 'GET', '/api/store', managerCookie)).json();
  expect(register).toEqual({ open: true });
  const customer = await (await request.get(`${server.baseURL}/api/public/settings`)).json();
  expect(customer.storeOpen).toBe(true);
});

test('closing the register stops new customer orders right away, and reopening allows them again', async ({ request }) => {
  const closed = await call(request, 'PUT', '/api/store', managerCookie, { open: false });
  expect(closed.status()).toBe(200);
  expect((await closed.json()).open).toBe(false);

  const customer = await (await request.get(`${server.baseURL}/api/public/settings`)).json();
  expect(customer.storeOpen).toBe(false);

  const refused = await request.post(`${server.baseURL}/api/public/orders`, { data: orderBody() });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error).toMatch(/closed/);

  const reopened = await call(request, 'PUT', '/api/store', managerCookie, { open: true });
  expect(reopened.status()).toBe(200);

  const accepted = await request.post(`${server.baseURL}/api/public/orders`, { data: orderBody() });
  expect(accepted.status()).toBe(201);
});

test('the store status must be sent as true or false, and only staff can change it', async ({ request }) => {
  const bad = await call(request, 'PUT', '/api/store', managerCookie, { open: 'no' });
  expect(bad.status()).toBe(400);

  const anonymous = await call(request, 'PUT', '/api/store', null, { open: false });
  expect(anonymous.status()).toBe(401);
});
