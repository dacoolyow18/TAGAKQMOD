const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let superCookie;
let cashierCookie;

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

test('settings start empty and round-trip when saved', async ({ request }) => {
  const empty = await (await call(request, 'GET', '/api/settings', superCookie)).json();
  expect(empty).toEqual({ large_upcharge: '', vat_rate: '', estimated_minutes: '' });

  const saved = await call(request, 'PUT', '/api/settings', superCookie, {
    large_upcharge: 30, vat_rate: 0.12, estimated_minutes: 12,
  });
  expect(saved.status()).toBe(200);
  const after = await (await call(request, 'GET', '/api/settings', superCookie)).json();
  expect(after).toMatchObject({ large_upcharge: '30', vat_rate: '0.12', estimated_minutes: '12' });
});

test('settings reject a VAT rate outside 0 to 1 and a negative upcharge', async ({ request }) => {
  const badVat = await call(request, 'PUT', '/api/settings', superCookie, { vat_rate: 1.5 });
  expect(badVat.status()).toBe(400);
  const badUpcharge = await call(request, 'PUT', '/api/settings', superCookie, { large_upcharge: -1 });
  expect(badUpcharge.status()).toBe(400);
});

test('a Cashier cannot change settings or supplies', async ({ request }) => {
  const settings = await call(request, 'PUT', '/api/settings', cashierCookie, { vat_rate: 0.1 });
  expect(settings.status()).toBe(403);
  const supply = await call(request, 'POST', '/api/supplies', cashierCookie, {
    name: 'Milk', unit: 'ml', stock: 1000, priceLogs: [],
  });
  expect(supply.status()).toBe(403);
});

test('a supply is created with its first price, and its price history is kept in date order', async ({ request }) => {
  const created = await (await call(request, 'POST', '/api/supplies', superCookie, {
    name: 'Whole Milk', unit: 'ml', stock: 10000, price: 0.15, effectiveAt: '2026-01-05T00:00:00Z',
  })).json();
  expect(created.id).toBeTruthy();

  await call(request, 'POST', `/api/supplies/${created.id}/price-logs`, superCookie, {
    price: 0.165, effectiveAt: '2026-06-15T00:00:00Z',
  });
  const supply = await (await call(request, 'GET', `/api/supplies/${created.id}`, superCookie)).json();
  expect(supply.priceLogs.map(l => l.price)).toEqual([0.15, 0.165]);
  expect(supply.currentPrice).toBe(0.165);
});

test('an earlier price log does not change the price used for later dates', async ({ request }) => {
  const created = await (await call(request, 'POST', '/api/supplies', superCookie, {
    name: 'Espresso Beans', unit: 'g', stock: 5000, price: 1.2, effectiveAt: '2026-01-05T00:00:00Z',
  })).json();
  await call(request, 'POST', `/api/supplies/${created.id}/price-logs`, superCookie, {
    price: 1.35, effectiveAt: '2026-07-01T00:00:00Z',
  });

  const march = await (await call(request, 'GET',
    `/api/supplies/${created.id}?at=2026-03-10T00:00:00Z`, superCookie)).json();
  expect(march.priceAt).toBe(1.2);

  await call(request, 'POST', `/api/supplies/${created.id}/price-logs`, superCookie, {
    price: 9.99, effectiveAt: '2026-02-01T00:00:00Z',
  });
  const stillMarch = await (await call(request, 'GET',
    `/api/supplies/${created.id}?at=2026-03-10T00:00:00Z`, superCookie)).json();
  expect(stillMarch.priceAt).toBe(9.99);
  const august = await (await call(request, 'GET',
    `/api/supplies/${created.id}?at=2026-08-10T00:00:00Z`, superCookie)).json();
  expect(august.priceAt).toBe(1.35);
});

test('cash log entries are saved and listed newest first', async ({ request }) => {
  const first = await call(request, 'POST', '/api/cash-logs', superCookie, {
    type: 'payIn', amount: 500, reason: 'Opening change fund',
  });
  expect(first.status()).toBe(201);
  await call(request, 'POST', '/api/cash-logs', superCookie, {
    type: 'payOut', amount: 50, reason: 'Bought ice',
  });

  const list = await (await call(request, 'GET', '/api/cash-logs', superCookie)).json();
  expect(list[0]).toMatchObject({ type: 'payOut', amount: 50, reason: 'Bought ice' });
  expect(list[1]).toMatchObject({ type: 'payIn', amount: 500 });
});

test('a cash log with an unknown type is rejected', async ({ request }) => {
  const res = await call(request, 'POST', '/api/cash-logs', superCookie, { type: 'steal', amount: 10 });
  expect(res.status()).toBe(400);
});

test('a supply rejects invalid units and cash logs reject zero or excessive amounts', async ({ request }) => {
  const badUnit = await call(request, 'POST', '/api/supplies', superCookie, {
    name: 'XSS Supply', unit: '<img src=x onerror=alert(1)>', stock: 10,
  });
  expect(badUnit.status()).toBe(400);

  const zeroCash = await call(request, 'POST', '/api/cash-logs', superCookie, {
    type: 'payIn', amount: 0, reason: 'Zero',
  });
  expect(zeroCash.status()).toBe(400);

  const hugeCash = await call(request, 'POST', '/api/cash-logs', superCookie, {
    type: 'payOut', amount: 5_000_000, reason: 'Too large',
  });
  expect(hugeCash.status()).toBe(400);
});
