const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient } = require('../api/helpers');

test.skip(({ viewport }) => viewport.width < 800, 'Customer store status is checked on desktop');

const BRANCH_CODE = '1001809';

test.beforeAll(async () => {
  await resetDatabase();
  await withClient(async c => {
    await c.query(`INSERT INTO branches (id, code, name) VALUES ('brn-store', $1, 'Store Branch')`, [BRANCH_CODE]);
    await c.query(`INSERT INTO menu_items (id, name, category, price) VALUES ('menu-scone', 'Butter Scone', 'Pastries', 70)`);
  });
  await insertAccount({ id: 'e2e-store-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678' });
});

async function setStore(request, baseURL, open) {
  const login = await request.post(`${baseURL}/api/auth/pin`, {
    data: { email: 'e2e-store-mgr@tagak.test', pin: '5678' },
  });
  const cookie = login.headers()['set-cookie'].match(/tagak_session=[^;]+/)[0];
  const res = await request.put(`${baseURL}/api/store`, { headers: { Cookie: cookie }, data: { open } });
  expect(res.status()).toBe(200);
}

test('closing the register shows Store Closed to customers and locks ordering, and reopening restores it', async ({ page, request, baseURL }) => {
  test.setTimeout(60000);
  await page.goto('/customer-app/index.html');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await page.fill('#branch-input', BRANCH_CODE);
  await page.click('#btn-enter');
  await page.click('#btn-continue');
  await page.locator('#menu-list .item-card', { hasText: 'Butter Scone' }).click();
  await page.click('#btn-add-order');
  await page.click('#basket-pill');

  const banner = page.locator('#screen-checkout .store-closed-banner');
  await expect(banner).toBeHidden();
  await expect(page.locator('#btn-place-order')).toBeEnabled();

  await setStore(request, baseURL, false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(banner).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#btn-place-order')).toBeDisabled();

  await setStore(request, baseURL, true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(banner).toBeHidden({ timeout: 12000 });
  await expect(page.locator('#btn-place-order')).toBeEnabled();
});
