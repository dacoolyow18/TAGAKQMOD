const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient } = require('../api/helpers');

test.skip(({ viewport }) => viewport.width < 800, 'Order sync is checked on desktop');

const BRANCH_ID = 'brn-e2e';

test.beforeAll(async () => {
  await resetDatabase();
  await withClient(async c => {
    await c.query(
      `INSERT INTO branches (id, code, name, location) VALUES ($1, '1001', 'Tagak Main', 'Davao')`,
      [BRANCH_ID],
    );
    await c.query(`INSERT INTO menu_items (id, name, category, price, has_temperature) VALUES
      ('menu-latte', 'Cafe Latte', 'Drinks', 100, true),
      ('menu-scone', 'Scone', 'Pastries', 70, false)`);
    await c.query(`INSERT INTO add_ons (id, name, applies_to, price) VALUES
      (gen_random_uuid(), 'Extra Shot', 'drink', 20)`);
    await c.query(`INSERT INTO settings (key, value) VALUES
      ('vat_rate', '0.12'), ('large_upcharge', '30'), ('estimated_minutes', '5')`);
  });
  await insertAccount({
    id: 'e2e-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678', branchId: BRANCH_ID,
  });
});

async function signInAsManager(page) {
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
  await expect(page.locator('.reg-tile[data-id="menu-latte"]')).toBeVisible();
}

test('a parked cart can be queued and collected before preparation', async ({ page }) => {
  await signInAsManager(page);
  await page.click('.reg-tile[data-id="menu-latte"]');
  await page.click('#btn-customization-confirm');
  await page.fill('#reg-customer-name', 'Held guest');
  await page.click('#btn-hold-order');
  await expect(page.locator('#toast-container')).toContainText('parked in Held state');
  await page.click('[data-view="orders"]');
  const card = page.locator('.order-card', { hasText: 'Held guest' });
  await expect(card.locator('.badge')).toHaveText('held');
  await card.getByRole('button', { name: 'Queue Order' }).click();
  await expect(card.locator('.badge')).toHaveText('Pending Payment');
  await card.getByRole('button', { name: 'Confirm cash received' }).click();
  await expect(card.getByRole('button', { name: 'Start Brewing' })).toBeVisible();
});

test('a POS sale gets a daily ticket and the public tracker sees it', async ({ page, request, baseURL }) => {
  await page.route('**/api/xendit/enabled', route => route.fulfill({ json: { enabled: true } }));
  await signInAsManager(page);

  await page.click('.reg-tile[data-id="menu-latte"]');
  await expect(page.locator('#customization-temperature-section')).toBeVisible();
  await page.check('input[name="customization-temperature"][value="iced"]');
  await page.check('input[data-addon]');
  await page.click('#btn-customization-confirm');
  await expect(page.locator('#reg-cart-count')).toHaveText('1 item');
  await expect(page.locator('#reg-total')).toHaveText('₱134.40');
  await page.fill('#reg-customer-name', '  ');
  await page.click('#reg-pay');
  await expect(page.locator('#reg-customer-name')).toBeFocused();
  await expect(page.getByText('Nickname is required before approving this order.')).toBeVisible();
  await page.fill('#reg-customer-name', '  Walk-in Guest  ');

  await page.click('#reg-pay');
  await expect(page.locator('#tender-modal')).toHaveClass(/open/);
  await expect(page.locator('#reg-tender-vat')).toHaveText('₱14.40');
  await page.click('.reg-tender-opt[data-method="qr"]');
  const received = page.locator('#reg-tender-received');
  await expect(received).toBeDisabled();
  await expect(received).toHaveValue('134.40');
  await expect(page.locator('#reg-amount-locked')).toBeVisible();
  await page.click('.reg-tender-opt[data-method="cash"]');
  await expect(received).toBeEditable();
  await expect(received).toHaveValue('');
  await received.fill('150');
  await page.click('#btn-tender-confirm');

  const ticket = (await page.locator('#receipt-body .receipt-meta span').first().textContent()).trim();
  expect(ticket).toMatch(/^TK-\d{8}-\d{4}$/);
  await expect(page.locator('#receipt-body')).toContainText('Walk-in Guest');

  const link = await page.locator('.receipt-tracking').getAttribute('href');
  const token = new URLSearchParams(link.split('#')[1]).get('track');
  expect((await request.get(`${baseURL}/api/public/orders/${ticket}`)).status()).toBe(404);
  expect((await request.post(`${baseURL}/api/public/orders/claim`, { data: { token } })).status()).toBe(200);
  const tracked = await request.get(`${baseURL}/api/public/orders/${ticket}`);
  expect(tracked.status()).toBe(200);
  const order = await tracked.json();
  expect(order).toMatchObject({ ticketNo: ticket, status: 'queued', payment: 'cash', total: 134.4, customerName: 'Walk-in Guest' });
  expect(order.items[0]).toMatchObject({
    menuItemId: 'menu-latte', temperature: 'iced', addOnPrice: 20, qty: 1, unitPrice: 100,
  });

  await page.click('#btn-receipt-close');
  await page.click('[data-view="orders"]');
  const card = page.locator('.order-card', { hasText: ticket });
  await expect(card).toBeVisible({ timeout: 6000 });
  await expect(card.locator('.badge')).toHaveText('queued');
  await expect(page.locator('.kanban-column', { hasText: 'Queued' }).locator('.order-card', { hasText: ticket })).toBeVisible();
});

test('an open POS board and customer tracker receive committed changes and recover after disconnect', async ({ page, request, baseURL, browser }) => {
  await signInAsManager(page);
  await page.click('[data-view="orders"]');
  await expect(page.locator('#btn-refresh-orders')).toHaveCount(0);
  const created = await (await request.post(`${baseURL}/api/public/orders`, {
    data: {
      branchId: BRANCH_ID,
      customerName: 'Sam',
      payment: 'cash',
      lines: [{ menuItemId: 'menu-scone', addOnIds: [], qty: 1 }],
    },
  })).json();
  expect(created.ticketNo).toMatch(/^TK-\d{8}-\d{4}$/);

  const customer = await browser.newContext({ baseURL });
  const tracker = await customer.newPage();
  await tracker.goto('/customer-app/index.html#track=' + created.trackingToken);
  await expect(tracker.locator('#tracker-refresh')).toHaveCount(0);
  await expect(tracker.locator('#cash-ticket')).toHaveText(created.ticketNo);

  const card = page.locator('.order-card', { hasText: created.ticketNo });
  await expect(card).toBeVisible({ timeout: 6000 });
  await expect(card.locator('.badge')).toHaveText('Pending Payment');
  await expect(card.locator('.order-claim-value')).toHaveText('Sam');

  await card.getByText('Confirm cash received').click();
  await card.locator('.act-brew').click();
  await expect(card.locator('.badge')).toHaveText('brewing');
  await expect(tracker.locator('#tracker-list .brewing.current')).toBeVisible();
  let tracked = await (await request.get(`${baseURL}/api/public/orders/${created.ticketNo}`)).json();
  expect(tracked.status).toBe('brewing');

  await customer.setOffline(true);
  await card.locator('.act-ready').click();
  await expect(card.locator('.badge')).toHaveText('ready');
  tracked = await (await request.get(`${baseURL}/api/public/orders/${created.ticketNo}`)).json();
  expect(tracked.status).toBe('ready');
  await customer.setOffline(false);
  await expect(tracker.locator('#tracker-list .ready.current')).toBeVisible();
  await customer.close();

  await card.locator('.act-complete').click();
  await expect(card.locator('.badge')).toHaveText('completed');
  tracked = await (await request.get(`${baseURL}/api/public/orders/${created.ticketNo}`)).json();
  expect(tracked.status).toBe('completed');
  expect(tracked.timeOut).toBeTruthy();

  await page.click('[data-view="analytics"]');
  await expect(page.locator('#report-summary-orders')).toHaveText('1');
  await expect(page.locator('#report-summary-revenue')).toContainText('70.00');
});

test('the POS board lists pending orders oldest first and lets a brewing order be voided', async ({ page, request, baseURL }) => {
  const place = async () => (await (await request.post(`${baseURL}/api/public/orders`, {
    data: { branchId: BRANCH_ID, customerName: 'Sam', payment: 'cash', lines: [{ menuItemId: 'menu-scone', addOnIds: [], qty: 1 }] },
  })).json()).ticketNo;
  const first = await place();
  const second = await place();

  await signInAsManager(page);
  await page.click('[data-view="orders"]');
  await expect(page.locator(`[data-order-id="${second}"]`)).toBeVisible();
  const queuedIds = await page.locator('.kanban-column', { hasText: 'Pending Payment' }).locator('.order-card').evaluateAll(
    cards => cards.map(card => card.dataset.orderId),
  );
  expect(queuedIds.indexOf(first)).toBeLessThan(queuedIds.indexOf(second));

  const card = page.locator('.order-card', { hasText: first });
  await card.getByText('Confirm cash received').click();
  await card.locator('.act-brew').click();
  await expect(card.locator('.badge')).toHaveText('brewing');
  await expect(card.locator('.act-void')).toBeVisible();
  const observer = await page.context().newPage();
  await observer.goto('/pos-app/index.html');
  await observer.click('[data-view="orders"]');
  const voidCard = screen => screen.locator('.kanban-column').filter({ has: screen.getByText('Voided', { exact: true }).first() })
    .locator('[data-order-id="' + first + '"]');
  await expect(observer.locator('[data-order-id="' + first + '"] .badge')).toHaveText('brewing');
  await card.locator('.act-void').click();
  await page.click('#btn-void-confirm');
  await expect(voidCard(page)).toHaveCount(1);
  await expect(voidCard(observer)).toContainText('Voided ·');
  await expect(voidCard(page)).toContainText('Scone');
  await expect(voidCard(page)).toContainText('Sam');
  await expect(card).toHaveCount(1);
  const record = await withClient(async c => (await c.query(
    'SELECT status, time_out, cash_expired FROM orders WHERE ticket_no=$1', [first])).rows[0]);
  expect(record.status).toBe('cancelled');
  expect(record.cash_expired).toBe(false);
  expect(record.time_out).toBeInstanceOf(Date);
  await observer.close();
  await page.reload();
  await page.click('[data-view="orders"]');
  await expect(voidCard(page)).toHaveCount(1);
  await page.click('#btn-logout');
  await page.waitForURL(/unified-login/);
  await signInAsManager(page);
  await page.click('[data-view="orders"]');
  await expect(voidCard(page)).toHaveCount(1);
});

test('an open Supplies page shows completed-order deductions without a reload', async ({ page, request, baseURL }) => {
  await withClient(c => c.query(
    `INSERT INTO supplies (id, name, unit, stock, branch_id) VALUES ('sup-sync-milk', 'Sync Test Milk', 'ml', 1000, $1)`, [BRANCH_ID]));
  await signInAsManager(page);
  expect((await page.request.put(`${baseURL}/api/menu-items/menu-scone/recipe`, {
    data: [{ supplyId: 'sup-sync-milk', qty: 100 }],
  })).status()).toBe(200);

  const created = await request.post(`${baseURL}/api/public/orders`, {
    data: { branchId: BRANCH_ID, customerName: 'Stock Test', payment: 'cash', lines: [{ menuItemId: 'menu-scone', qty: 1 }] },
  });
  expect(created.status()).toBe(201);
  const { ticketNo } = await created.json();

  await page.click('[data-view="supplies"]');
  const row = page.locator('#supplies-table-body tr', { hasText: 'Sync Test Milk' });
  await expect(row).toContainText('1,000');

  expect((await page.request.post(`${baseURL}/api/orders/${ticketNo}/collect-cash`)).status()).toBe(200);
  expect((await page.request.patch(`${baseURL}/api/orders/${ticketNo}`, { data: { status: 'completed' } })).status()).toBe(200);
  await expect(row).toContainText('900', { timeout: 8000 });
});

test('cash expires on the server and both open screens show the void', async ({ page, request, baseURL, browser }) => {
  await signInAsManager(page);
  await page.click('[data-view="orders"]');
  const { ticketNo, trackingToken } = await (await request.post(baseURL + '/api/public/orders', {
    data: { branchId: BRANCH_ID, customerName: 'Timeout Guest', payment: 'cash', lines: [{ menuItemId: 'menu-scone', qty: 1 }] },
  })).json();
  const customer = await browser.newContext({ baseURL });
  const stop = require('../../server/cashExpiry').startCashExpiryWorker();
  try {
    const screen = await customer.newPage();
    await screen.goto('/customer-app/index.html#track=' + trackingToken);
    await expect(screen.locator('#cash-ticket')).toHaveText(ticketNo);
    const card = page.locator('.order-card', { hasText: ticketNo });
    await expect(card.getByText('Confirm cash received')).toBeVisible();
    await withClient(c => c.query("UPDATE orders SET cash_due_at=clock_timestamp()+interval '5 seconds' WHERE ticket_no=$1", [ticketNo]));
    await screen.reload();
    await expect(screen.locator('#cash-time')).toHaveText(/0:0[0-5]/);
    await expect(screen.locator('#cash-title')).toHaveText('Order voided', { timeout: 10000 });
    await expect(screen.locator('#cash-message')).toContainText('five minutes');
    await expect(screen.locator('#screen-tracker')).not.toHaveClass(/active/);
    await expect(card.locator('.badge')).toHaveText('Voided');
    await expect(card.getByText('Confirm cash received')).toHaveCount(0);
    await screen.click('#cash-dismiss');
    await expect(screen.locator('#cash-dialog')).not.toBeVisible();
  } finally {
    stop();
    await customer.close();
  }
});

test('terminal columns roll over at Philippine midnight using the recorded status time', async ({ page }) => {
  const completed = 'TK-20280114-9101';
  const cancelled = 'TK-20280114-9102';
  const queued = 'TK-20280114-9103';
  const nextDay = 'TK-20280114-9104';
  await withClient(c => c.query(`
    INSERT INTO orders(ticket_no, order_date, branch_id, status, payment, items, subtotal, vat, total, time_in, time_out)
    SELECT ticket, '2028-01-14', $1, status, 'cash', '[]', 20, 0, 20, '2028-01-14 09:00+08', closed::timestamptz
    FROM (VALUES ($2::text,'completed','2028-01-15 00:00+08'), ($3,'cancelled','2028-01-15 23:58+08'),
                 ($4,'queued',NULL), ($5,'completed','2028-01-16 00:00+08')) AS fixtures(ticket,status,closed)`,
    [BRANCH_ID, completed, cancelled, queued, nextDay]));
  await page.clock.install({ time: new Date('2028-01-15T23:59:00+08:00') });
  await signInAsManager(page);
  await page.click('[data-view="orders"]');
  const card = id => page.locator('[data-order-id="' + id + '"]');
  await expect(card(completed)).toBeVisible();
  await expect(card(cancelled)).toBeVisible();
  await expect(card(nextDay)).toHaveCount(0);
  await page.clock.fastForward(60000);
  await expect(card(completed)).toHaveCount(0);
  await expect(card(cancelled)).toHaveCount(0);
  await expect(card(nextDay)).toBeVisible();
  await expect(card(queued)).toBeVisible();
  await page.reload();
  await page.click('[data-view="orders"]');
  await expect(card(nextDay)).toBeVisible();
  await expect(card(completed)).toHaveCount(0);
  await expect(card(cancelled)).toHaveCount(0);
  const response = await page.request.get('/api/orders?from=2028-01-15&to=2028-01-15');
  expect((await response.json()).map(o => o.ticketNo)).toEqual(expect.arrayContaining([completed, cancelled]));
});
