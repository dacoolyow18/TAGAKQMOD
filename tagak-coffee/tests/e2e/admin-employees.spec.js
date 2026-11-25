const { test, expect } = require('@playwright/test');
const { resetDatabase, withClient } = require('../api/helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

test.skip(({ viewport }) => viewport.width < 800, 'Employees layout is checked on desktop');

test.beforeAll(async () => {
  await resetDatabase();
  await withClient(async c => {
    await c.query(`INSERT INTO branches (id, code, name, location) VALUES
      ('brn-main', '1001805', 'Tagak Main', '123 A. Pichon St, Davao City'),
      ('brn-sm', '1001806', 'SM City', 'SM City Lanang, Davao City')`);
    await c.query(`INSERT INTO accounts (id, name, role, branch_id, phone) VALUES
      ('emp-juan', 'Juan Dela Cruz', 'Manager', 'brn-main', '09981110001'),
      ('emp-maria', 'Maria Santos', 'Cashier', 'brn-sm', '09981110002')`);
  });
});

async function signInAsSuperAdmin(page) {
  await page.goto('/unified-login/index.html?app=admin');
  await page.fill('#admin-email', SUPER_EMAIL);
  await page.fill('#admin-password', SUPER_PASSWORD);
  await page.click('#admin-form button[type="submit"]');
  await page.waitForURL(/\/admin-app\//);
  await expect(page.locator('#overview-branches')).toHaveText('2');
  await page.getByTestId('nav-employees').click();
}

function branchHead(page, name) {
  return page.locator('.branch-group-head', { hasText: name });
}

test('branches are listed first and an employee appears only under its branch', async ({ page }) => {
  await signInAsSuperAdmin(page);
  await expect(branchHead(page, 'Tagak Main')).toBeVisible();
  await expect(branchHead(page, 'SM City')).toBeVisible();
  await expect(page.getByText('Juan Dela Cruz')).toBeHidden();

  await branchHead(page, 'Tagak Main').click();
  await expect(page.getByText('Juan Dela Cruz')).toBeVisible();
  await expect(page.getByText('Maria Santos')).toBeHidden();
});

test('add, edit, and delete work inside a branch', async ({ page }) => {
  await signInAsSuperAdmin(page);
  await branchHead(page, 'Tagak Main').click();

  await page.locator('.branch-group', { hasText: 'Tagak Main' }).getByRole('button', { name: 'Add employee' }).click();
  await expect(page.locator('#acct-middle-name-field')).toBeVisible();
  await expect(page.locator('#acct-middle-initial-field')).toBeHidden();
  await page.fill('#acct-first-name', 'Ana');
  await page.fill('#acct-middle-name', 'Lopez');
  await page.fill('#acct-last-name', 'Reyes');
  await page.fill('#acct-email', 'ana.reyes@tagak.test');
  await page.fill('#acct-phone', '09171234567');
  await page.fill('#acct-birthdate', '1999-03-15');
  await page.fill('#acct-pin', '4321');
  await page.click('#btn-account-save');
  const newRow = page.locator('tr', { hasText: 'Ana Lopez Reyes' });
  await expect(newRow).toBeVisible();

  await newRow.getByRole('button', { name: 'Edit' }).click();
  await page.fill('#acct-last-name', 'Reyeson');
  await page.click('#btn-account-save');
  await expect(page.locator('tr', { hasText: 'Ana Lopez Reyeson' })).toBeVisible();

  await page.locator('tr', { hasText: 'Ana Lopez Reyeson' }).getByRole('button', { name: 'Delete' }).click();
  await page.click('#btn-confirm-action');
  await expect(page.locator('tr', { hasText: 'Ana Lopez Reyeson' })).toHaveCount(0);
});

test('seeded demo emails from the old localStorage data are gone', async ({ page }) => {
  await signInAsSuperAdmin(page);
  await expect(page.getByText('juan@tagak.com')).toBeHidden();
  await expect(page.getByText('maria@tagak.com')).toBeHidden();
});

test('admin modal uses first name, middle initial, last name, email, phone number, and birthdate', async ({ page }) => {
  await signInAsSuperAdmin(page);
  await page.getByTestId('nav-admins').click();
  await page.getByTestId('add-admin').click();

  await expect(page.locator('#acct-middle-initial-field')).toBeVisible();
  await expect(page.locator('#acct-middle-name-field')).toBeHidden();

  await page.fill('#acct-first-name', 'Elena');
  await page.fill('#acct-middle-initial', 'R');
  await page.fill('#acct-last-name', 'Velasco');
  await page.fill('#acct-email', 'elena.velasco@tagak.test');
  await page.fill('#acct-phone', '09178889999');
  await page.fill('#acct-birthdate', '1991-09-21');
  await page.fill('#acct-password', 'Admin-pass-123');
  await page.click('#btn-account-save');

  const adminRow = page.locator('#admins-tbody tr', { hasText: 'Elena R. Velasco' });
  await expect(adminRow).toBeVisible();
  await expect(adminRow).toContainText('09178889999');

  // Also verify creating an admin with optional middle initial left blank
  await page.getByTestId('add-admin').click();
  await page.fill('#acct-first-name', 'Marco');
  await page.fill('#acct-last-name', 'Tan');
  await page.fill('#acct-email', 'marco.tan@tagak.test');
  await page.fill('#acct-phone', '09176667777');
  await page.fill('#acct-birthdate', '1993-02-10');
  await page.fill('#acct-password', 'Admin-pass-123');
  await page.click('#btn-account-save');

  const marcoRow = page.locator('#admins-tbody tr', { hasText: 'Marco Tan' });
  await expect(marcoRow).toBeVisible();
});
