const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient } = require('../api/helpers');

test.skip(({ viewport }) => viewport.width < 800, 'Notes layout is checked on desktop');

const BRANCH_ID = 'brn-notes';
const LONG_NOTE = 'extra-long-customer-note-without-spaces-'.repeat(5);

test.beforeAll(async () => {
  await resetDatabase();
  await withClient(async c => {
    await c.query(`INSERT INTO branches (id, code, name, location) VALUES ($1, '1001808', 'Notes Branch', 'Davao')`, [BRANCH_ID]);
    await c.query(`INSERT INTO menu_items (id, name, category, price, has_temperature) VALUES
      ('menu-latte', 'Cafe Latte', 'Drinks', 100, true),
      ('menu-scone', 'Scone', 'Pastries', 70, false)`);
    await c.query(`INSERT INTO settings (key, value) VALUES ('vat_rate', '0.12'), ('large_upcharge', '30')`);
  });
  await insertAccount({ id: 'e2e-notes-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678', branchId: BRANCH_ID });
});

async function signInAsManager(page) {
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-notes-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
  await expect(page.locator('.reg-tile[data-id="menu-latte"]')).toBeVisible();
}

test('a long note stays inside its box on the register', async ({ page }) => {
  await signInAsManager(page);
  await page.click('.reg-tile[data-id="menu-latte"]');
  await page.check('input[name="customization-temperature"][value="iced"]');
  await page.fill('#customization-note', LONG_NOTE);
  await page.click('#btn-customization-confirm');

  const line = page.locator('.reg-line').first();
  await expect(line).toContainText('extra-long-customer-note');
  expect(await line.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('a long note stays inside its card on the orders board', async ({ page, request, baseURL }) => {
  await request.post(`${baseURL}/api/public/orders`, {
    data: {
      branchId: BRANCH_ID,
      customerName: 'Sam',
      payment: 'cash',
      lines: [{ menuItemId: 'menu-scone', addOnIds: [], qty: 1, instructions: LONG_NOTE }],
    },
  });
  await signInAsManager(page);
  await page.click('[data-view="orders"]');

  const card = page.locator('.order-card').filter({ hasText: 'extra-long-customer-note' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
