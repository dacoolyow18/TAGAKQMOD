const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient } = require('../api/helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

test.beforeAll(async () => {
  await resetDatabase();
  await withClient(c => c.query(
    `INSERT INTO branches (id, code, name, location) VALUES ('brn-login', '1001805', 'Tagak Main', 'Davao City')`,
  ));
  await insertAccount({ id: 'e2e-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678', branchId: 'brn-login' });
});

test('admin signs in with the database password and reaches the admin app', async ({ page }) => {
  await page.goto('/unified-login/index.html?app=admin');
  await page.fill('#admin-email', SUPER_EMAIL);
  await page.fill('#admin-password', SUPER_PASSWORD);
  await page.click('#admin-form button[type="submit"]');
  await page.waitForURL(/\/admin-app\//);
  await expect(page.locator('#btn-logout')).toBeVisible();
});

test('a wrong admin password shows the error and stays on login', async ({ page }) => {
  await page.goto('/unified-login/index.html?app=admin');
  await page.fill('#admin-email', SUPER_EMAIL);
  await page.fill('#admin-password', 'wrong-password');
  await page.click('#admin-form button[type="submit"]');
  await expect(page.locator('#admin-error')).toHaveText('Enter valid admin credentials.');
  expect(page.url()).toContain('/unified-login/');
});

test('a Manager PIN signs in to the POS', async ({ page }) => {
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
});

test('a bad PIN shows the error', async ({ page }) => {
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-mgr@tagak.test');
  await page.fill('#pos-pin', '0000');
  await page.click('#pos-form button[type="submit"]');
  await expect(page.locator('#pos-error')).toHaveText('Enter a valid staff email and 4-digit PIN.');
});

test('entering a valid PIN with an empty or invalid email does not submit or log in', async ({ page }) => {
  let pinRequests = 0;
  page.on('request', req => {
    if (req.url().includes('/api/auth/pin')) pinRequests += 1;
  });

  await page.goto('/unified-login/index.html');
  await page.fill('#pos-pin', '5678');
  await page.press('#pos-pin', 'Enter');
  await expect(page.locator('#pos-error')).toHaveText('Enter a valid staff email and 4-digit PIN.');
  expect(page.url()).toContain('/unified-login/');
  expect(pinRequests).toBe(0);

  await page.click('#pos-form button[type="submit"]');
  await expect(page.locator('#pos-error')).toHaveText('Enter a valid staff email and 4-digit PIN.');
  expect(page.url()).toContain('/unified-login/');
  expect(pinRequests).toBe(0);

  await page.fill('#pos-email', 'invalid-email');
  await page.click('#pos-form button[type="submit"]');
  await expect(page.locator('#pos-error')).toHaveText('Enter a valid staff email and 4-digit PIN.');
  expect(page.url()).toContain('/unified-login/');
  expect(pinRequests).toBe(0);
});

test('the admin app redirects to login when there is no session', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/admin-app/index.html');
  await page.waitForURL(/\/unified-login\/index\.html/);
});

test('hitting the attempt limit shows the PIN lockout duration and an admin can unlock the employee from the admin panel', async ({ page, request, baseURL }) => {
  for (let i = 0; i < 10; i++) {
    await request.post(`${baseURL}/api/auth/pin`, {
      data: { email: 'e2e-mgr@tagak.test', pin: '0000' },
    });
  }

  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await expect(page.locator('#pos-error')).toHaveText(
    'Too many attempts. Wait 5 minutes to try again or contact admin support.',
  );

  // Admin signs in and unlocks the employee from the Admin panel
  await page.goto('/unified-login/index.html?app=admin');
  await page.fill('#admin-email', SUPER_EMAIL);
  await page.fill('#admin-password', SUPER_PASSWORD);
  await page.click('#admin-form button[type="submit"]');
  await page.waitForURL(/\/admin-app\//);
  await expect(page.locator('#overview-branches')).toHaveText('1');
  if (await page.locator('#btn-hamburger').isVisible()) {
    await page.click('#btn-hamburger');
  }
  await page.getByTestId('nav-employees').click();
  await page.locator('.branch-group-head', { hasText: 'Tagak Main' }).click();

  const row = page.locator('tr', { hasText: 'Juan Dela Cruz' });
  await expect(row).toContainText('Locked');
  await row.getByRole('button', { name: 'Unlock' }).click();
  await expect(row).not.toContainText('Locked');

  // Employee can immediately sign in to the POS without waiting 15 minutes
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
});
