const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount } = require('../api/helpers');

test.beforeAll(async () => {
  await resetDatabase();
  await insertAccount({ id: 'lab-manager', name: 'Lab Manager', role: 'Manager', pin: '2457' });
});

test('a signed-in manager can open and recalculate the QMODSIM lab', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'lab-manager@tagak.test');
  await page.fill('#pos-pin', '2457');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
  if (await page.locator('#btn-hamburger').isVisible()) await page.locator('#btn-hamburger').click();
  await page.locator('[data-view="qmodsim"]').click();
  await expect(page.locator('#view-qmodsim')).toBeVisible();
  await page.locator('#btn-qmod-recalc-all').click();
  await expect(page.getByText('All 7 QMODSIM mathematical models recalculated.')).toBeVisible();
  expect(errors).toEqual([]);
});
