const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let superCookie;
let managerCookie;
let milkId;
let latteId;

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

async function milkStock(request) {
  const supplies = await (await call(request, 'GET', '/api/supplies', superCookie)).json();
  return supplies.find(s => s.id === milkId).stock;
}

async function placePublic(request) {
  const res = await request.post(`${server.baseURL}/api/public/orders`, {
    data: { branchId: 'brn-main', customerName: 'Sam', payment: 'cash', lines: [{ menuItemId: latteId, temperature: 'hot', qty: 2 }] },
  });
  const { ticketNo } = await res.json();
  expect((await call(request, 'POST', '/api/orders/' + ticketNo + '/collect-cash', managerCookie)).status()).toBe(200);
  return ticketNo;
}

test.beforeAll(async ({ request }) => {
  await resetDatabase();
  await withClient(c => c.query(`INSERT INTO branches (id, code, name) VALUES ('brn-main', '1001', 'Main')`));
  await insertAccount({ id: 'emp-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678', branchId: 'brn-main' });
  server = await startServer();
  superCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  }));
  managerCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-mgr@tagak.test', pin: '5678' },
  }));

  milkId = (await (await call(request, 'POST', '/api/supplies', superCookie, {
    name: 'Milk', unit: 'ml', stock: 1000,
  })).json()).id;
  latteId = (await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Stock Latte', category: 'Drinks', price: 100, hasTemperature: true,
  })).json()).id;
  await call(request, 'PUT', `/api/menu-items/${latteId}/recipe`, superCookie, [{ supplyId: milkId, qty: 200 }]);
  await call(request, 'PUT', `/api/menu-items/${latteId}`, superCookie, {
    name: 'Stock Latte', category: 'Drinks', price: 100, hasTemperature: true, active: true,
  });
});

test.afterAll(async () => {
  await server?.close();
});

test('a queued order does not touch stock', async ({ request }) => {
  await placePublic(request);
  expect(await milkStock(request)).toBe(1000);
});

test('completing an order deducts recipe supplies times quantity', async ({ request }) => {
  const ticket = await placePublic(request);
  const done = await call(request, 'PATCH', `/api/orders/${ticket}`, managerCookie, { status: 'completed' });
  expect(done.status()).toBe(200);
  expect(await milkStock(request)).toBe(600);
});

test('completing the same order twice does not deduct twice', async ({ request }) => {
  const ticket = await placePublic(request);
  await call(request, 'PATCH', `/api/orders/${ticket}`, managerCookie, { status: 'completed' });
  await call(request, 'PATCH', `/api/orders/${ticket}`, managerCookie, { status: 'completed' });
  expect(await milkStock(request)).toBe(200);
});

test('voiding a completed order restores its supplies', async ({ request }) => {
  const ticket = await placePublic(request);
  await call(request, 'PATCH', `/api/orders/${ticket}`, managerCookie, { status: 'completed' });
  const before = await milkStock(request);
  const previous = await withClient(async c => (await c.query(
    "UPDATE orders SET time_out=now()-interval '1 hour' WHERE ticket_no=$1 RETURNING time_out", [ticket])).rows[0].time_out);
  const cancel = () => call(request, 'PATCH', '/api/orders/' + ticket, managerCookie, { status: 'cancelled' });
  const voided = await (await cancel()).json();
  expect(Date.parse(voided.timeOut)).toBeGreaterThan(previous.getTime());
  expect((await (await cancel()).json()).timeOut).toBe(voided.timeOut);
  const sales = await (await call(request, 'GET', '/api/orders?status=completed', managerCookie)).json();
  expect(sales.map(order => order.ticketNo)).not.toContain(ticket);
  const open = await (await call(request, 'GET', '/api/orders?status=open', managerCookie)).json();
  expect(open.map(order => order.ticketNo)).not.toContain(ticket);
  expect(await milkStock(request)).toBe(before + 400);
});

test('voiding a queued order leaves stock unchanged', async ({ request }) => {
  const ticket = await placePublic(request);
  const before = await milkStock(request);
  await call(request, 'PATCH', `/api/orders/${ticket}`, managerCookie, { status: 'cancelled' });
  expect(await milkStock(request)).toBe(before);
});

test('an add-on uses its linked supply when the order completes', async ({ request }) => {
  const addOn = await (await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Stock Shot', appliesTo: 'drink', price: 20, supplies: [{ supplyId: milkId, qty: 30 }],
  })).json();
  const before = await milkStock(request);
  const order = await (await call(request, 'POST', '/api/orders', managerCookie, {
    branchId: 'brn-main', customerName: 'Stock Guest', payment: 'cash', lines: [{ menuItemId: latteId, temperature: 'hot', addOnIds: [addOn.id], qty: 1 }],
  })).json();
  expect(await milkStock(request)).toBe(before);

  await call(request, 'PATCH', `/api/orders/${order.ticketNo}`, managerCookie, { status: 'completed' });
  expect(await milkStock(request)).toBe(before - 200 - 30);
});

test('a register cash sale starts queued and deducts stock only when completed', async ({ request }) => {
  const before = await milkStock(request);
  const res = await call(request, 'POST', '/api/orders', managerCookie, {
    branchId: 'brn-main', customerName: 'Stock Guest', payment: 'cash', lines: [{ menuItemId: latteId, temperature: 'iced', qty: 1 }],
  });
  const order = await res.json();
  expect(res.status()).toBe(201);
  expect(order.status).toBe('queued');
  expect(await milkStock(request)).toBe(before);

  await call(request, 'PATCH', `/api/orders/${order.ticketNo}`, managerCookie, { status: 'completed' });
  expect(await milkStock(request)).toBe(before - 200);
});

test('a Large drink deducts the recipe Large quantity, and a regular one still deducts the regular quantity', async ({ request }) => {
  await call(request, 'PUT', `/api/menu-items/${latteId}/recipe`, superCookie, [{ supplyId: milkId, qty: 200, largeQty: 300 }]);
  const before = await milkStock(request);
  const large = await (await call(request, 'POST', '/api/orders', managerCookie, {
    branchId: 'brn-main', customerName: 'Stock Guest', payment: 'cash', lines: [{ menuItemId: latteId, temperature: 'hot', size: 'Large', qty: 1 }],
  })).json();
  await call(request, 'PATCH', `/api/orders/${large.ticketNo}`, managerCookie, { status: 'completed' });
  expect(await milkStock(request)).toBe(before - 300);

  const regular = await (await call(request, 'POST', '/api/orders', managerCookie, {
    branchId: 'brn-main', customerName: 'Stock Guest', payment: 'cash', lines: [{ menuItemId: latteId, temperature: 'hot', size: 'Regular', qty: 1 }],
  })).json();
  await call(request, 'PATCH', `/api/orders/${regular.ticketNo}`, managerCookie, { status: 'completed' });
  expect(await milkStock(request)).toBe(before - 300 - 200);
});
