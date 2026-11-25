const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount } = require('../api/helpers');

test.beforeAll(async () => {
  await resetDatabase();
  await insertAccount({ id: 'nav-cashier', name: 'Test Cashier', role: 'Cashier', pin: '3891' });
});

test('Offline Mode opens from the sidebar and preserves the selected POS workflow', async ({ page, viewport }) => {
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'nav-cashier@tagak.test');
  await page.fill('#pos-pin', '3891');
  await page.click('#pos-form button[type="submit"]');
  await expect(page.locator('#view-register')).toBeVisible();
  await expect(page.locator('#offline-status')).toContainText('Register online');
  const sidebar = page.getByRole('navigation', { name: 'POS sections' });
  async function navigate(label) {
    if (viewport.width < 768) await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await sidebar.getByRole('button', { name: label, exact: true }).click();
  }
  await navigate('Offline Mode');
  await expect(page.locator('#view-title')).toHaveText('Offline Mode');
  await expect(page.locator('header #offline-status')).toHaveCount(0);
  await expect(page.locator('#offline-status')).toHaveCount(1);
  await expect(page.locator('#offline-status')).toContainText('Register online');
  await expect(page.locator('#offline-manager')).toBeHidden();
  await page.route('**/api/pos/offline/ready', route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Check connection and retry' }).click();
  await expect(page.locator('#offline-status')).toContainText('OFFLINE EMERGENCY MODE');
  await expect(page.locator('#view-offline')).toBeVisible();
  await navigate('Register');
  await expect(page.locator('#view-register')).toBeVisible();
  await navigate('Offline Mode');
  await expect(page.locator('#offline-status')).toBeVisible();
});
