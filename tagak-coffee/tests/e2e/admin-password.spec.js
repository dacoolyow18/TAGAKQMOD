const { test, expect } = require('@playwright/test');
const { resetDatabase } = require('../api/helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

test.skip(({ viewport }) => viewport.width < 800, 'Admin form is checked on desktop');

test.beforeAll(async () => {
  await resetDatabase();
});

test('the new admin password can be shown and hidden while typing', async ({ page }) => {
  await page.goto('/unified-login/index.html?app=admin');
  await page.fill('#admin-email', SUPER_EMAIL);
  await page.fill('#admin-password', SUPER_PASSWORD);
  await page.click('#admin-form button[type="submit"]');
  await page.waitForURL(/\/admin-app\//);
  await page.getByTestId('nav-admins').click();
  await page.getByTestId('add-admin').click();

  const password = page.locator('#acct-password');
  await page.fill('#acct-phone', '09170000000');
  await expect(page.locator('#acct-phone-error')).toHaveText('This phone number is already registered to another account.');
  await page.fill('#acct-phone', '09181234567');
  await password.fill('new-admin-pass');
  await expect(page.locator('#acct-password-error')).toContainText('an uppercase letter, a number');
  await expect(page.getByTestId('save-account')).toBeDisabled();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.locator('#toggle-acct-password')).toHaveAttribute('aria-label', 'Show password');

  await page.click('#toggle-acct-password');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('new-admin-pass');
  await expect(page.locator('#toggle-acct-password')).toHaveAttribute('aria-label', 'Hide password');

  await page.click('#toggle-acct-password');
  await expect(password).toHaveAttribute('type', 'password');
  await password.fill('New-admin-123');
  await expect(page.locator('#acct-password-error')).toBeHidden();
  await expect(page.getByTestId('save-account')).toBeEnabled();
});
