const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let superCookie;
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

/** Changes only the given Manager permissions, keeping the rest of the matrix as it is. */
async function setManagerPermissions(request, changes) {
  const matrix = await (await call(request, 'GET', '/api/permissions', superCookie)).json();
  const res = await call(request, 'PUT', '/api/permissions', superCookie, {
    Manager: { ...matrix.Manager, ...changes },
  });
  expect(res.status()).toBe(200);
}

test.beforeAll(async ({ request }) => {
  await resetDatabase();
  await withClient(async c => {
    await c.query(`INSERT INTO branches (id, code, name) VALUES ('brn-main', '1001', 'Main')`);
    await c.query(`INSERT INTO menu_items (id, name, category, price, has_temperature) VALUES ('menu-latte', 'Cafe Latte', 'Drinks', 100, true)`);
    await c.query(`INSERT INTO supplies (id, name, unit, stock) VALUES ('sup-milk', 'Milk', 'ml', 1000)`);
    await c.query(`INSERT INTO add_ons (name, applies_to, price) VALUES ('Extra Shot', 'drink', 20)`);
  });
  await insertAccount({ id: 'emp-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678', branchId: 'brn-main' });
  server = await startServer();
  superCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  }));
  managerCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-mgr@tagak.test', pin: '5678' },
  }));
});

test.afterAll(async () => {
  await server?.close();
});

test('a Manager with every View permission can read the four modules', async ({ request }) => {
  await setManagerPermissions(request, {
    view_menu: true, view_supplies: true, view_analytics: true, view_addons: true, view_tools: true, access_terminal: true,
  });
  expect((await call(request, 'GET', '/api/menu-items', managerCookie)).status()).toBe(200);
  expect((await call(request, 'GET', '/api/menu-items/menu-latte/recipe', managerCookie)).status()).toBe(200);
  expect((await call(request, 'GET', '/api/supplies', managerCookie)).status()).toBe(200);
  expect((await call(request, 'GET', '/api/add-ons', managerCookie)).status()).toBe(200);
});

test('without View permission, the Menu & Recipes, Supplies, and Add-ons reads are blocked', async ({ request }) => {
  await setManagerPermissions(request, {
    view_menu: false, view_supplies: false, view_analytics: false, view_addons: false, access_terminal: false,
  });
  expect((await call(request, 'GET', '/api/menu-items', managerCookie)).status()).toBe(403);
  expect((await call(request, 'GET', '/api/menu-items/menu-latte/recipe', managerCookie)).status()).toBe(403);
  expect((await call(request, 'GET', '/api/supplies', managerCookie)).status()).toBe(403);
  expect((await call(request, 'GET', '/api/supplies/sup-milk', managerCookie)).status()).toBe(403);
  expect((await call(request, 'GET', '/api/add-ons', managerCookie)).status()).toBe(403);
});

test('register staff still get the menu and add-ons they need to ring up sales', async ({ request }) => {
  await setManagerPermissions(request, { view_menu: false, view_addons: false, access_terminal: true });
  expect((await call(request, 'GET', '/api/menu-items', managerCookie)).status()).toBe(200);
  expect((await call(request, 'GET', '/api/add-ons', managerCookie)).status()).toBe(200);
  expect((await call(request, 'GET', '/api/menu-items/menu-latte/recipe', managerCookie)).status()).toBe(403);
});

test('each POS action follows its toggle on an existing session', async ({ request }) => {
  const range = '?from=2026-11-01&to=2026-11-02';
  const cases = [
    ['view_orders', 'GET', '/api/orders', 200],
    ['manage_orders', 'PATCH', '/api/orders/missing', 404, { status: 'ready' }],
    ['void_orders', 'PATCH', '/api/orders/missing', 404, { status: 'cancelled' }],
    ['view_analytics', 'GET', '/api/orders/analytics' + range, 200],
    ['export_reports', 'GET', '/api/orders/report-export' + range, 200],
    ['view_menu', 'GET', '/api/menu-items/menu-latte/recipe', 200],
    ['edit_menu', 'POST', '/api/menu-items', 400, {}],
    ['view_supplies', 'GET', '/api/supplies', 200],
    ['edit_supplies', 'POST', '/api/supplies', 400, {}],
    ['edit_addons', 'POST', '/api/add-ons', 400, {}],
    ['view_tools', 'GET', '/api/carousel', 200],
    ['edit_tools', 'GET', '/api/carousel', 200],
    ['access_cash_drawer', 'POST', '/api/cash-logs', 400, {}],
    ['access_terminal', 'GET', '/api/store', 200],
  ];
  await setManagerPermissions(request, Object.fromEntries([...cases.map(([key]) => [key, true]), ['view_addons', true], ['view_supplies', true]]));
  for (const [key, method, path, authorized, data] of cases) {
    for (const enabled of [false, true]) {
      const update = await call(request, 'PATCH', '/api/permissions', superCookie, { role: 'Manager', key, enabled });
      expect(update.status()).toBe(204);
      const res = await call(request, method, path, managerCookie, data);
      expect(res.status(), key + ' = ' + enabled).toBe(enabled ? authorized : 403);
      if (enabled && key === 'export_reports') expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
    }
  }
});

test('analytics can report while order history and supply management are disabled', async ({ request }) => {
  await setManagerPermissions(request, { view_orders: false, view_analytics: true, view_supplies: false });
  await withClient(c => c.query(
    `INSERT INTO orders(ticket_no,order_date,branch_id,status,payment,items,subtotal,vat,total,time_in,time_out)
     VALUES('TK-20261101-0100','2026-11-01','brn-main','completed','cash',$1,100,0,100,'2026-11-01','2026-11-01')`,
    [JSON.stringify([{ menuItemId: 'menu-latte', qty: 1, unitPrice: 100 }])],
  ));
  const response = await call(request, 'GET', '/api/orders/analytics?from=2026-01-01&to=2026-12-31', managerCookie);
  expect(response.status()).toBe(200);
  const report = await response.json();
  expect(report.items).toEqual([expect.objectContaining({ id: 'menu-latte', sold: 1, revenue: 100 })]);
  expect(report.sales).toHaveLength(1);
  expect(Object.keys(report.sales[0]).sort()).toEqual(['timeIn', 'timeOut', 'total']);
  expect((await call(request, 'GET', '/api/orders', managerCookie)).status()).toBe(403);
  expect((await call(request, 'GET', '/api/supplies', managerCookie)).status()).toBe(403);
});
