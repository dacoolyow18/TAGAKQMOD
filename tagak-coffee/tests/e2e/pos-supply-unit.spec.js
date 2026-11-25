const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount } = require('../api/helpers');

test('a manager can create and edit a supply measured in pieces', async ({ page }) => {
  await resetDatabase();
  await insertAccount({ id: 'piece-manager', name: 'Supply Manager', role: 'Manager', pin: '5678' });
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'piece-manager@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
  await page.locator('[data-view="supplies"]').evaluate(button => button.click());
  await page.click('#btn-add-supply');
  await page.fill('#sup-name', 'Paper cup');
  await page.selectOption('#sup-unit', 'pc');
  await page.click('#btn-supply-save');
  await page.click('.edit-supply');
  await expect(page.locator('#sup-unit')).toHaveValue('pc');
  await page.fill('#sup-stock', '12');
  await page.click('#btn-supply-save');
  await expect(page.locator('#supplies-modal')).not.toHaveClass(/\bopen\b/);
  const supplies = await (await page.request.get('/api/supplies')).json();
  expect(supplies).toContainEqual(expect.objectContaining({ name: 'Paper cup', unit: 'pcs', stock: 12 }));
});
