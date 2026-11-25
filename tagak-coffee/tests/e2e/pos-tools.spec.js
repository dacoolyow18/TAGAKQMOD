const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount } = require('../api/helpers');

test.skip(({ viewport }) => viewport.width < 800, 'Tools layout is checked on desktop');

test.beforeAll(async () => {
  await resetDatabase();
  await insertAccount({ id: 'e2e-tools-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678' });
});

test('store settings live inside Tools, and Settings is no longer a sidebar item', async ({ page }) => {
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-tools-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);

  await expect(page.locator('[data-view="settings"]')).toHaveCount(0);
  await page.locator('[data-view="tools"]').click();
  await expect(page.locator('#view-title')).toHaveText('Tools');
  await expect(page.locator('#view-tools #settings-form')).toBeVisible();
  await expect(page.locator('#view-tools #tools-carousel-url')).toBeVisible();
});
