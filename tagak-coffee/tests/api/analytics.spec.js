const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let superCookie;
let mainCookie;

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

async function insertOrder(c, { ticket, branch, status = 'completed', timeOut, total = 100 }) {
  await c.query(
    `INSERT INTO orders (ticket_no, order_date, branch_id, status, payment, items, subtotal, vat, total, time_in, time_out)
     VALUES ($1, $2, $3, $4, 'cash', '[]', $5, 0, $5, $6, $7)`,
    [ticket, '2026-11-11', branch, status, total, timeOut || '2026-11-11T05:00:00Z', timeOut],
  );
}

test.beforeAll(async ({ request }) => {
  await resetDatabase();
  await withClient(c => c.query(`INSERT INTO branches (id, code, name) VALUES
    ('brn-main', '1001', 'Main'), ('brn-south', '1002', 'South')`));
  await insertAccount({ id: 'emp-main', name: 'Main Manager', role: 'Manager', pin: '1111', branchId: 'brn-main' });
  await withClient(async c => {
    await insertOrder(c, { ticket: 'TK-20261111-0001', branch: 'brn-main', timeOut: '2026-11-11T06:00:00Z' });
    await insertOrder(c, { ticket: 'TK-20261111-0002', branch: 'brn-main', timeOut: '2026-11-11T17:30:00Z' });
    await insertOrder(c, { ticket: 'TK-20261111-0003', branch: 'brn-south', timeOut: '2026-11-11T06:00:00Z' });
    await insertOrder(c, { ticket: 'TK-20261110-0004', branch: 'brn-main', timeOut: '2026-11-10T16:30:00Z' });
    await insertOrder(c, { ticket: 'TK-20261111-0005', branch: 'brn-main', status: 'queued', timeOut: null });
  });

  server = await startServer();
  superCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  }));
  mainCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-main@tagak.test', pin: '1111' },
  }));
});

test.afterAll(async () => {
  await server?.close();
});

const ranged = (from, to) => `/api/orders?status=completed&from=${from}&to=${to}`;

test('a one-day range uses the Manila business day, not UTC midnight', async ({ request }) => {
  // 14:00 Manila on the 11th, and 00:30 Manila on the 11th (16:30 UTC on the 10th), are both inside the 11th.
  const mine = await (await call(request, 'GET', ranged('2026-11-11', '2026-11-11'), mainCookie)).json();
  expect(mine.map(o => o.ticketNo).sort()).toEqual(['TK-20261110-0004', 'TK-20261111-0001'].sort());
});

test('the range excludes sales outside the dates and non-completed orders', async ({ request }) => {
  const mine = await (await call(request, 'GET', ranged('2026-11-11', '2026-11-11'), mainCookie)).json();
  expect(mine.map(o => o.ticketNo)).not.toContain('TK-20261111-0002');
  expect(mine.map(o => o.ticketNo)).not.toContain('TK-20261111-0005');
});

test('a range only returns the branch of the signed-in user', async ({ request }) => {
  const all = await (await call(request, 'GET', ranged('2026-11-11', '2026-11-11'), superCookie)).json();
  expect(all.map(o => o.ticketNo)).toContain('TK-20261111-0003');
  const mine = await (await call(request, 'GET', ranged('2026-11-11', '2026-11-11'), mainCookie)).json();
  expect(mine.map(o => o.ticketNo)).not.toContain('TK-20261111-0003');
});

test('a range is not cut off at 200 orders', async ({ request }) => {
  await withClient(c => c.query(`
    INSERT INTO orders (ticket_no, order_date, branch_id, status, payment, items, subtotal, vat, total, time_in, time_out)
    SELECT 'TK-20260101-' || lpad(i::text, 4, '0'), '2026-01-01', 'brn-main', 'completed', 'cash', '[]', 10, 0, 10,
           '2026-01-01T02:00:00Z', '2026-01-01T02:00:00Z'
      FROM generate_series(1, 210) AS i`));
  const range = await (await call(request, 'GET', ranged('2026-01-01', '2026-01-01'), mainCookie)).json();
  expect(range).toHaveLength(210);
  const board = await (await call(request, 'GET', '/api/orders', mainCookie)).json();
  expect(board.length).toBeLessThanOrEqual(200);
});
