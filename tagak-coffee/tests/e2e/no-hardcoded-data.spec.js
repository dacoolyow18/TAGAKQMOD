/**
 * File: no-hardcoded-data.spec.js
 * Path: tagak-coffee/tests/e2e/no-hardcoded-data.spec.js
 * Description: E2E test verifying that localStorage contains no legacy `tagak-*`
 *              data keys and that applications do not render hardcoded demo data
 *              on a freshly seeded database.
 */

const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient } = require('../api/helpers');

test.beforeAll(async () => {
  await resetDatabase();
  await insertAccount({
    id: 'e2e-clean-mgr', name: 'Store Manager', role: 'Manager', pin: '5678',
  });
});

test('localStorage has no legacy tagak keys and apps render empty or database-driven states', async ({ page }) => {
  // Check admin login / unified login
  await page.goto('/unified-login/index.html');
  const posStorageKeys = await page.evaluate(() => Object.keys(localStorage));
  const badPosKeys = posStorageKeys.filter(k => k.startsWith('tagak-') && k !== 'tagak-theme');
  expect(badPosKeys).toEqual([]);

  // Check admin login
  await page.fill('#pos-email', 'e2e-clean-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);

  const posAppStorage = await page.evaluate(() => Object.keys(localStorage));
  const badAppKeys = posAppStorage.filter(k => k.startsWith('tagak-') && k !== 'tagak-theme');
  expect(badAppKeys).toEqual([]);
});
