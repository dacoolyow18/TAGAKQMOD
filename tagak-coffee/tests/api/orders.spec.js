const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let superCookie;
let managerCookie;
let cashierCookie;
const ADDON_SHOT = randomUUID();
const ADDON_BUTTER = randomUUID();

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

test.beforeAll(async ({ request }) => {
  await resetDatabase();


  await withClient(async c => {
    await c.query(`INSERT INTO branches (id, code, name, location) VALUES ('brn-main', '1001805', 'Tagak Main', 'Davao')`);
    await c.query(`INSERT INTO menu_items (id, name, category, price, has_temperature) VALUES
      ('menu-latte', 'Cafe Latte', 'Drinks', 100, true),
      ('menu-scone', 'Scone', 'Pastries', 70, false),
      ('menu-hidden', 'Hidden Drink', 'Drinks', 90, false)`);
    await c.query(`UPDATE menu_items SET active = false WHERE id = 'menu-hidden'`);
    await c.query(`INSERT INTO add_ons (id, name, applies_to, price) VALUES
      ('${ADDON_SHOT}', 'Extra Shot', 'drink', 20),
      ('${ADDON_BUTTER}', 'Butter', 'pastry', 10)`);
    await c.query(`INSERT INTO settings (key, value) VALUES ('vat_rate', '0.12'), ('large_upcharge', '30')`);
  });

  await insertAccount({ id: 'emp-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678', branchId: 'brn-main' });
  await insertAccount({ id: 'emp-cashier', name: 'Maria Santos', role: 'Cashier', pin: '2468', branchId: 'brn-main' });
  server = await startServer();
  superCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  }));
  managerCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-mgr@tagak.test', pin: '5678' },
  }));
  cashierCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-cashier@tagak.test', pin: '2468' },
  }));
});

test.afterAll(async () => {
  await server?.close();
});

function orderBody(overrides = {}) {
  return {
    branchId: 'brn-main',
    customerName: 'Sam',
    payment: 'cash',
    lines: [{
      menuItemId: 'menu-latte',
      temperature: 'iced',
      size: 'Regular',
      addOnIds: [ADDON_SHOT],
      qty: 2,
      instructions: 'Less sugar',
    }],
    ...overrides,
  };
}

test('ticket numbers reset daily in Asia/Manila and increment', async () => {
  const { nextTicketNo } = require('../../server/tickets');
  const first = await withClient(async c => {
    await c.query("DELETE FROM ticket_counters WHERE day IN ('2026-11-09', '2026-11-10')");
    const a = await nextTicketNo(c, new Date('2026-11-09T15:59:00Z'));
    const b = await nextTicketNo(c, new Date('2026-11-09T15:59:30Z'));
    const c2 = await nextTicketNo(c, new Date('2026-11-09T16:01:00Z'));
    return { a, b, c: c2 };
  });
  expect(first.a).toBe('TK-20261109-0001');
  expect(first.b).toBe('TK-20261109-0002');
  expect(first.c).toBe('TK-20261110-0001');
});

test('a public order is stored with copied prices, VAT, and a ticket number', async ({ request, playwright }) => {
  const res = await call(request, 'POST', '/api/public/orders', null, orderBody());
  expect(res.status()).toBe(201);
  const created = await res.json();
  expect(created.ticketNo).toMatch(/^TK-\d{8}-\d{4}$/);
  expect(created.total).toBe(268.8);
  expect(created.subtotal).toBe(240);
  expect(created.vat).toBe(28.8);
  expect(created.items[0]).toMatchObject({
    menuItemId: 'menu-latte',
    name: 'Cafe Latte',
    temperature: 'iced',
    size: 'Regular',
    addOnIds: [ADDON_SHOT],
    qty: 2,
    unitPrice: 100,
    addOnPrice: 20,
    instructions: 'Less sugar',
  });

  const tracked = await request.get(`${server.baseURL}/api/public/orders/${created.ticketNo}`);
  expect(tracked.status()).toBe(200);
  const pending = await tracked.json();
  expect(pending.status).toBe('pending_payment');
  expect(pending.items).toBeUndefined();
  expect(Date.parse(pending.cashDueAt) - pending.serverNow).toBeGreaterThan(295000);
  const outsider = await playwright.request.newContext();
  try {
    const base = server.baseURL + '/api/public/orders';
    expect((await outsider.get(base + '/' + created.ticketNo)).status()).toBe(404);
    expect(await (await outsider.get(base + '?tickets=' + created.ticketNo)).json()).toEqual([]);
    expect((await outsider.get(base + '/events?tickets=' + created.ticketNo)).status()).toBe(404);
  } finally {
    await outsider.dispose();
  }
});

test('a public order requires a nickname and keeps it attached for the barista', async ({ request }) => {
  const missing = await call(request, 'POST', '/api/public/orders', null, orderBody({ customerName: '   ' }));
  expect(missing.status()).toBe(400);
  expect((await missing.json()).error).toMatch(/nickname/i);

  const tooLong = await call(request, 'POST', '/api/public/orders', null, orderBody({ customerName: 'x'.repeat(31) }));
  expect(tooLong.status()).toBe(400);

  const res = await call(request, 'POST', '/api/public/orders', null, orderBody({ customerName: '  Sam   the  Barista  ' }));
  expect(res.status()).toBe(201);
  const created = await res.json();
  expect(created.customerName).toBe('Sam the Barista');

  expect((await call(request, 'POST', `/api/orders/${created.ticketNo}/collect-cash`, managerCookie)).status()).toBe(200);
  // Survives a customer refresh: the tracker reloads it from the server.
  const tracked = await (await request.get(`${server.baseURL}/api/public/orders/${created.ticketNo}`)).json();
  expect(tracked.customerName).toBe('Sam the Barista');

  // The barista sees it on the POS board.
  const board = await (await call(request, 'GET', '/api/orders', managerCookie)).json();
  expect(board.find(order => order.ticketNo === created.ticketNo).customerName).toBe('Sam the Barista');
});

test('a register order requires a nickname', async ({ request }) => {
  for (const customerName of [undefined, '', '   ']) {
    const res = await call(request, 'POST', '/api/orders', managerCookie, orderBody({ customerName }));
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Nickname is required before approving this order.');
  }
});

test('orders store dine-in or takeout service mode and reject invalid modes', async ({ request }) => {
  const defaultMode = await (await call(request, 'POST', '/api/public/orders', null, orderBody())).json();
  expect(defaultMode.orderMode).toBe('dine-in');

  const takeoutRes = await call(request, 'POST', '/api/public/orders', null, orderBody({ orderMode: 'takeout' }));
  expect(takeoutRes.status()).toBe(201);
  const takeoutOrder = await takeoutRes.json();
  expect(takeoutOrder.orderMode).toBe('takeout');

  expect((await call(request, 'POST', `/api/orders/${takeoutOrder.ticketNo}/collect-cash`, managerCookie)).status()).toBe(200);
  const tracked = await (await request.get(`${server.baseURL}/api/public/orders/${takeoutOrder.ticketNo}`)).json();
  expect(tracked.orderMode).toBe('takeout');

  const invalidMode = await call(request, 'POST', '/api/public/orders', null, orderBody({ orderMode: 'delivery' }));
  expect(invalidMode.status()).toBe(400);
});

test('two orders placed at the same time get different ticket numbers', async ({ request }) => {
  const [a, b] = await Promise.all([
    call(request, 'POST', '/api/public/orders', null, orderBody({ lines: [{ menuItemId: 'menu-scone', addOnIds: [], qty: 1 }] })),
    call(request, 'POST', '/api/public/orders', null, orderBody({ lines: [{ menuItemId: 'menu-scone', addOnIds: [], qty: 1 }] })),
  ]);
  expect(a.status()).toBe(201);
  expect(b.status()).toBe(201);
  const one = await a.json();
  const two = await b.json();
  expect(one.ticketNo).not.toBe(two.ticketNo);
});

test('concurrent guest cash retries share a ticket and conflicting retries are rejected', async ({ request }) => {
  const headers = { 'Idempotency-Key': randomUUID() };
  const submit = data => request.post(server.baseURL + '/api/public/orders', { data, headers });
  const responses = await Promise.all([submit(orderBody()), submit(orderBody())]);
  for (const response of responses) expect(response.status()).toBe(201);
  const [first, second] = await Promise.all(responses.map(response => response.json()));
  expect(first.paymentStatus).toBe('unpaid');
  expect(second.ticketNo).toBe(first.ticketNo);
  expect(second.trackingToken).toBe(first.trackingToken);
  expect((await submit(orderBody({ customerName: 'Different Guest' }))).status()).toBe(409);
});

test('an inactive item is rejected with 400', async ({ request }) => {
  const res = await call(request, 'POST', '/api/public/orders', null, orderBody({
    lines: [{ menuItemId: 'menu-hidden', addOnIds: [], qty: 1 }],
  }));
  expect(res.status()).toBe(400);
});

test('a temperature on a pastry, and a pastry add-on on a drink, are rejected', async ({ request }) => {
  const temp = await call(request, 'POST', '/api/public/orders', null, orderBody({
    lines: [{ menuItemId: 'menu-scone', temperature: 'hot', addOnIds: [], qty: 1 }],
  }));
  expect(temp.status()).toBe(400);

  const scope = await call(request, 'POST', '/api/public/orders', null, orderBody({
    lines: [{ menuItemId: 'menu-latte', temperature: 'hot', addOnIds: [ADDON_BUTTER], qty: 1 }],
  }));
  expect(scope.status()).toBe(400);
});

test('changing a menu price after an order does not change that order', async ({ request }) => {
  const created = await (await call(request, 'POST', '/api/public/orders', null, orderBody())).json();
  await withClient(c => c.query("UPDATE menu_items SET price = 999 WHERE id = 'menu-latte'"));
  expect((await call(request, 'POST', `/api/orders/${created.ticketNo}/collect-cash`, managerCookie)).status()).toBe(200);
  const after = await (await request.get(`${server.baseURL}/api/public/orders/${created.ticketNo}`)).json();
  expect(after.items[0].unitPrice).toBe(100);
  expect(after.total).toBe(268.8);
  await withClient(c => c.query("UPDATE menu_items SET price = 100 WHERE id = 'menu-latte'"));
});

test('expired cash cannot win a simultaneous collection or be voided twice', async ({ request }) => {
  const { expireCash } = require('../../server/cashExpiry');
  const created = await (await call(request, 'POST', '/api/public/orders', null, orderBody())).json();
  await withClient(c => c.query("UPDATE orders SET cash_due_at=clock_timestamp()-interval '1 second' WHERE ticket_no=$1", [created.ticketNo]));
  const collect = () => call(request, 'POST', '/api/orders/' + created.ticketNo + '/collect-cash', cashierCookie);
  const [attempt] = await Promise.all([collect(), withClient(c => expireCash(c, created.ticketNo))]);
  expect(attempt.status()).toBe(409);
  expect((await withClient(c => expireCash(c, created.ticketNo))).rowCount).toBe(0);
  expect((await collect()).status()).toBe(409);
  expect((await call(request, 'PATCH', '/api/orders/' + created.ticketNo, managerCookie, { status: 'brewing' })).status()).toBe(409);
  const status = await (await request.get(server.baseURL + '/api/public/orders/' + created.ticketNo)).json();
  expect(status).toMatchObject({ status: 'cancelled', paymentStatus: 'unpaid', cashExpired: true });
  expect(status.items).toBeUndefined();
  const transitions = await withClient(c => c.query(
    "SELECT 1 FROM order_state_transitions WHERE ticket_no=$1 AND from_state='queued' AND to_state='cancelled'",
    [created.ticketNo]));
  expect(transitions.rowCount).toBe(1);
});

test('serverless order reads expire overdue cash without a background worker', async ({ request }) => {
  const created = await (await call(request, 'POST', '/api/public/orders', null, orderBody())).json();
  await withClient(c => c.query("UPDATE orders SET cash_due_at=now()-interval '1 second' WHERE ticket_no=$1", [created.ticketNo]));
  const listener = await new Promise(resolve => {
    const instance = require('../../api').listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await request.get(`http://127.0.0.1:${listener.address().port}/api/orders?status=cancelled`, {
      headers: { Cookie: managerCookie },
    });
    expect(await response.json()).toContainEqual(expect.objectContaining({ ticketNo: created.ticketNo, cashExpired: true, channel: 'mobile' }));
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
});

test('a Manager moves an order through brewing and ready; a Cashier cannot', async ({ request }) => {
  const created = await (await call(request, 'POST', '/api/public/orders', null, orderBody())).json();

  const open = await (await call(request, 'GET', '/api/orders?status=open', managerCookie)).json();
  expect(open.map(o => o.ticketNo)).toContain(created.ticketNo);

  const denied = await call(request, 'PATCH', `/api/orders/${created.ticketNo}`, cashierCookie, { status: 'brewing' });
  expect(denied.status()).toBe(403);

  expect(created.paymentStatus).toBe('unpaid');
  expect((await call(request, 'PATCH', '/api/orders/' + created.ticketNo, managerCookie, { status: 'brewing' })).status()).toBe(409);
  const collection = '/api/orders/' + created.ticketNo + '/collect-cash';
  expect((await (await call(request, 'POST', collection, cashierCookie)).json()).paymentStatus).toBe('paid');
  expect((await call(request, 'POST', collection, managerCookie)).status()).toBe(200);
  const { rows: [collectionRecord] } = await withClient(c => c.query(
    'SELECT cash_collected_by, cash_collected_at FROM orders WHERE ticket_no=$1', [created.ticketNo]));
  expect(collectionRecord.cash_collected_by).toBe('emp-cashier');
  expect(collectionRecord.cash_collected_at).toBeTruthy();
  const brewed = await call(request, 'PATCH', `/api/orders/${created.ticketNo}`, managerCookie, { status: 'brewing' });
  expect(brewed.status()).toBe(200);
  expect((await brewed.json()).status).toBe('brewing');

  const tracked = await (await request.get(`${server.baseURL}/api/public/orders/${created.ticketNo}`)).json();
  expect(tracked.status).toBe('brewing');

  const bad = await call(request, 'PATCH', `/api/orders/${created.ticketNo}`, managerCookie, { status: 'flying' });
  expect(bad.status()).toBe(400);
});

test('a POS cash sale waits in the queue, and a size upcharge is applied', async ({ request }) => {
  const res = await call(request, 'POST', '/api/orders', managerCookie, orderBody({
    payment: 'cash',
    lines: [{
      menuItemId: 'menu-latte', temperature: 'hot', size: 'Large', addOnIds: [], qty: 1,
    }],
    pwdDiscount: true,
  }));
  expect(res.status()).toBe(201);
  const created = await res.json();
  expect(created.status).toBe('queued');
  expect(created.items[0].unitPrice).toBe(130);
  expect(created.subtotal).toBe(130);
  expect(created.discount).toBe(26);
  expect(created.vat).toBe(12.48);
  expect(created.total).toBe(116.48);
  expect(created.timeOut).toBeNull();
});

test('both checkouts reject unconfirmed QR orders without issuing a ticket', async ({ request }) => {
  const countOrders = () => withClient(async c => (await c.query('SELECT count(*) AS n FROM orders')).rows[0].n);
  const before = await countOrders();
  for (const [path, cookie] of [['/api/orders', managerCookie], ['/api/public/orders', null]]) {
    const res = await call(request, 'POST', path, cookie, orderBody({ payment: 'qr' }));
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('Xendit');
  }
  expect(await countOrders()).toBe(before);
});

test('an unknown ticket number returns 404', async ({ request }) => {
  const res = await request.get(`${server.baseURL}/api/public/orders/TK-20990101-9999`);
  expect(res.status()).toBe(404);
});

test('a public order ignores pwdDiscount and completed or cancelled orders cannot be reopened', async ({ request }) => {
  const pubRes = await call(request, 'POST', '/api/public/orders', null, orderBody({ pwdDiscount: true }));
  expect(pubRes.status()).toBe(201);
  const pubOrder = await pubRes.json();
  expect(pubOrder.discount).toBe(0);
  expect(pubOrder.total).toBe(268.8);

  expect((await call(request, 'POST', '/api/orders/' + pubOrder.ticketNo + '/collect-cash', managerCookie)).status()).toBe(200);
  const done = await call(request, 'PATCH', `/api/orders/${pubOrder.ticketNo}`, managerCookie, { status: 'completed' });
  expect(done.status()).toBe(200);

  const reopenCompleted = await call(request, 'PATCH', `/api/orders/${pubOrder.ticketNo}`, managerCookie, { status: 'brewing' });
  expect(reopenCompleted.status()).toBe(409);

  const voided = await call(request, 'PATCH', `/api/orders/${pubOrder.ticketNo}`, managerCookie, { status: 'cancelled' });
  expect(voided.status()).toBe(200);

  const reopenCancelled = await call(request, 'PATCH', `/api/orders/${pubOrder.ticketNo}`, managerCookie, { status: 'queued' });
  expect(reopenCancelled.status()).toBe(409);
});

test('completing an order deducts its ingredients once and voiding restores them', async ({ request }) => {
  const supplyId = randomUUID();
  await withClient(c => c.query(
    `INSERT INTO supplies (id, name, unit, stock, branch_id) VALUES ($1, 'Stock Test Milk', 'ml', 1000, 'brn-main')`, [supplyId]));
  const recipe = await call(request, 'PUT', '/api/menu-items/menu-scone/recipe', superCookie, [{ supplyId, qty: 100 }]);
  expect(recipe.status()).toBe(200);
  const created = await call(request, 'POST', '/api/public/orders', null, orderBody({ lines: [{ menuItemId: 'menu-scone', qty: 1 }] }));
  expect(created.status()).toBe(201);
  const { ticketNo } = await created.json();
  expect((await call(request, 'POST', '/api/orders/' + ticketNo + '/collect-cash', managerCookie)).status()).toBe(200);
  const stock = () => withClient(async c => (await c.query('SELECT stock::float8 AS stock FROM supplies WHERE id = $1', [supplyId])).rows[0].stock);
  const setStatus = status => call(request, 'PATCH', `/api/orders/${ticketNo}`, managerCookie, { status });

  expect((await setStatus('completed')).status()).toBe(200);
  expect(await stock()).toBe(900);
  expect((await setStatus('completed')).status()).toBe(200);
  expect(await stock()).toBe(900);

  expect((await setStatus('cancelled')).status()).toBe(200);
  expect(await stock()).toBe(1000);
  expect((await setStatus('cancelled')).status()).toBe(200);
  expect(await stock()).toBe(1000);
});
