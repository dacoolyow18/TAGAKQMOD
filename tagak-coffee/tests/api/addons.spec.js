const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let superCookie;
let cashierCookie;
const SHOT_SUPPLY = [{ supplyId: 'sup-beans', qty: 18 }];

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
  await insertAccount({ id: 'emp-cashier', name: 'Maria Santos', role: 'Cashier', pin: '2468' });
  await withClient(c => c.query(`INSERT INTO supplies (id, name, unit, stock) VALUES
    ('sup-beans', 'Espresso Beans', 'g', 1000), ('sup-butter', 'Butter', 'g', 500)`));
  server = await startServer();
  superCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  }));
  cashierCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-cashier@tagak.test', pin: '2468' },
  }));
});

test.afterAll(async () => {
  await server?.close();
});

test('a Cashier cannot manage add-ons (403)', async ({ request }) => {
  const res = await call(request, 'POST', '/api/add-ons', cashierCookie, {
    name: 'Sneaky', appliesTo: 'drink', price: 5, supplies: SHOT_SUPPLY,
  });
  expect(res.status()).toBe(403);
});

test('an add-on needs a supply to be created', async ({ request }) => {
  const none = await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Unlinked', appliesTo: 'drink', price: 20,
  });
  expect(none.status()).toBe(400);
  expect((await none.json()).error).toMatch(/at least one supply/);

  const empty = await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Unlinked', appliesTo: 'drink', price: 20, supplies: [],
  });
  expect(empty.status()).toBe(400);

  const badQty = await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Unlinked', appliesTo: 'drink', price: 20, supplies: [{ supplyId: 'sup-beans', qty: 0 }],
  });
  expect(badQty.status()).toBe(400);

  const unknown = await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Unlinked', appliesTo: 'drink', price: 20, supplies: [{ supplyId: 'sup-missing', qty: 1 }],
  });
  expect(unknown.status()).toBe(400);
});

test('a linked add-on is saved with its supplies and listed with them', async ({ request }) => {
  const created = await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Extra Shot', appliesTo: 'drink', price: 35, supplies: SHOT_SUPPLY,
  });
  expect(created.status()).toBe(201);
  const addOn = await created.json();
  expect(addOn.supplies).toEqual(SHOT_SUPPLY);

  const list = await (await call(request, 'GET', '/api/add-ons', superCookie)).json();
  expect(list.find(a => a.id === addOn.id).supplies).toEqual(SHOT_SUPPLY);
});

test('an add-on for pastries appears only in the pastry list', async ({ request }) => {
  const drink = await (await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Oat Shot', appliesTo: 'drink', price: 35, supplies: SHOT_SUPPLY,
  })).json();
  const pastry = await (await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Butter', appliesTo: 'pastry', price: 10, supplies: [{ supplyId: 'sup-butter', qty: 10 }],
  })).json();
  expect(pastry.appliesTo).toBe('pastry');

  const pastryList = await (await request.get(`${server.baseURL}/api/public/add-ons?appliesTo=pastry`)).json();
  expect(pastryList.map(a => a.id)).toContain(pastry.id);
  expect(pastryList.map(a => a.id)).not.toContain(drink.id);
});

test('an invalid scope or a negative price is rejected with 400', async ({ request }) => {
  const badScope = await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Bad', appliesTo: 'coffee', price: 5, supplies: SHOT_SUPPLY,
  });
  expect(badScope.status()).toBe(400);
  const badPrice = await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Bad', appliesTo: 'drink', price: -1, supplies: SHOT_SUPPLY,
  });
  expect(badPrice.status()).toBe(400);
});

test('publishing an add-on needs a supply, and turning it off and on keeps its supplies', async ({ request }) => {
  const addOn = await (await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Toggle Shot', appliesTo: 'drink', price: 30, supplies: SHOT_SUPPLY,
  })).json();

  const off = await call(request, 'PUT', `/api/add-ons/${addOn.id}`, superCookie, {
    name: 'Toggle Shot', appliesTo: 'drink', price: 30, active: false,
  });
  expect(off.status()).toBe(200);
  expect((await off.json()).supplies).toEqual(SHOT_SUPPLY);

  const on = await call(request, 'PUT', `/api/add-ons/${addOn.id}`, superCookie, {
    name: 'Toggle Shot', appliesTo: 'drink', price: 30, active: true,
  });
  expect(on.status()).toBe(200);
  expect((await on.json()).active).toBe(true);

  const unlinkAndPublish = await call(request, 'PUT', `/api/add-ons/${addOn.id}`, superCookie, {
    name: 'Toggle Shot', appliesTo: 'drink', price: 30, active: true, supplies: [],
  });
  expect(unlinkAndPublish.status()).toBe(400);
  expect((await unlinkAndPublish.json()).error).toMatch(/at least one supply/);
  const stillLinked = await (await call(request, 'GET', '/api/add-ons', superCookie)).json();
  expect(stillLinked.find(a => a.id === addOn.id).supplies).toEqual(SHOT_SUPPLY);
});

test('an add-on on a past order is deactivated instead of deleted', async ({ request }) => {
  const addOn = await (await call(request, 'POST', '/api/add-ons', superCookie, {
    name: 'Oatside', appliesTo: 'drink', price: 40, supplies: SHOT_SUPPLY,
  })).json();
  await withClient(c => c.query(
    `INSERT INTO orders (ticket_no, order_date, status, payment, items, subtotal, vat, total, time_in)
     VALUES ('TK-20261109-0002', '2026-11-09', 'completed', 'cash', $1, 40, 0, 40, now())`,
    [JSON.stringify([{ name: 'Latte', qty: 1, unitPrice: 0, addOnIds: [addOn.id] }])],
  ));
  const res = await (await call(request, 'DELETE', `/api/add-ons/${addOn.id}`, superCookie)).json();
  expect(res.deactivated).toBe(true);
  const list = await (await call(request, 'GET', '/api/add-ons', superCookie)).json();
  expect(list.find(a => a.id === addOn.id).active).toBe(false);
});
