const { test, expect } = require('@playwright/test');

async function paste(field, value) {
  await field.evaluate((input, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, value);
}

test('customer branch entry rejects invalid typing and overlong paste', async ({ page }) => {
  await page.goto('/customer-app/index.html');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  const field = page.locator('#branch-input');
  await expect(field).toHaveAttribute('inputmode', 'numeric');
  await expect(field).toHaveAttribute('maxlength', '7');
  await field.pressSequentially('12a');
  await expect(field).toHaveValue('12');
  await expect(page.locator('#branch-error')).toContainText('numbers only');
  await expect(page.locator('#btn-enter')).toBeDisabled();
  await field.fill('0001234');
  await expect(page.locator('#btn-enter')).toBeEnabled();
  await paste(field, '8');
  await expect(page.locator('#btn-enter')).toBeDisabled();
});

test('admin branch and employee forms reject invalid input inline', async ({ page }) => {
  await page.goto('/unified-login/index.html?app=admin');
  await page.fill('#admin-email', process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test');
  await page.fill('#admin-password', process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123');
  await page.locator('#admin-form button[type=submit]').click();
  await page.getByTestId('overview-branches').click();
  await page.getByTestId('add-branch').click();
  const code = page.locator('#branch-code');
  await paste(code, '12 34');
  await expect(page.locator('#branch-code-error')).toContainText('numbers only');
  await expect(page.getByTestId('save-branch')).toBeDisabled();
  await code.fill('0001234');
  await expect(page.getByTestId('save-branch')).toBeEnabled();
  await page.reload();
  await page.getByTestId('overview-add-employee').click();
  await page.fill('#acct-first-name', 'Maria');
  await page.fill('#acct-last-name', 'Santos');
  await page.fill('#acct-branch-code', '0001234');
  await page.fill('#acct-phone', '09181234567');
  await expect(page.getByTestId('save-account')).toBeEnabled();
  for (const id of ['acct-first-name', 'acct-middle-name', 'acct-last-name']) {
    await paste(page.locator('#' + id), '9!');
    await expect(page.locator('#' + id + '-error')).toContainText('Only letters are allowed in name fields.');
    await expect(page.getByTestId('save-account')).toBeDisabled();
    await page.locator('#' + id).pressSequentially('A');
  }
  await paste(page.locator('#acct-branch-code'), 'A');
  await expect(page.locator('#acct-branch-code-error')).toContainText('numbers only');
  await expect(page.getByTestId('save-account')).toBeDisabled();
});

test('add employee phone and PIN show a message for letters and keep digits only', async ({ page }) => {
  await page.goto('/unified-login/index.html?app=admin');
  await page.fill('#admin-email', process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test');
  await page.fill('#admin-password', process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123');
  await page.locator('#admin-form button[type=submit]').click();
  await page.getByTestId('overview-add-employee').click();

  const phone = page.locator('#acct-phone');
  await expect(phone).toHaveAttribute('maxlength', '11');
  await phone.pressSequentially('09a');
  await expect(phone).toHaveValue('09');
  await expect(page.locator('#acct-phone-error')).toContainText('Only numbers are allowed.');
  await phone.fill('09171234567');
  await expect(page.locator('#acct-phone-error')).toBeHidden();
  await phone.pressSequentially('123');
  await expect(phone).toHaveValue('09171234567');
  await phone.fill('');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('09171234567123'));
  await phone.focus();
  await page.keyboard.press('Control+V');
  await expect(phone).toHaveValue('09171234567');

  const pin = page.locator('#acct-pin');
  await paste(pin, '1x');
  await expect(pin).toHaveValue('');
  await expect(page.locator('#acct-pin-error')).toContainText('Only numbers are allowed.');
  await pin.pressSequentially('1234');
  await expect(pin).toHaveValue('1234');
  await expect(page.locator('#acct-pin-error')).toBeHidden();
});

test('add admin name fields reject numbers and accept letters, spaces, hyphens and apostrophes', async ({ page, viewport }) => {
  test.skip(viewport.width < 800, 'Admin navigation is checked on desktop');
  await page.goto('/unified-login/index.html?app=admin');
  await page.fill('#admin-email', process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test');
  await page.fill('#admin-password', process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123');
  await page.locator('#admin-form button[type=submit]').click();
  await page.getByTestId('nav-admins').click();
  await page.getByTestId('add-admin').click();
  await expect(page.locator('#acct-role')).not.toHaveValue('');

  const first = page.locator('#acct-first-name');
  await first.pressSequentially('Ana1');
  await expect(first).toHaveValue('Ana');
  await expect(page.locator('#acct-first-name-error')).toContainText('Only letters are allowed in name fields.');
  await first.fill("Mary-Jane O'Neil");
  await expect(page.locator('#acct-first-name-error')).toBeHidden();

  const initial = page.locator('#acct-middle-initial');
  await initial.pressSequentially('2');
  await expect(initial).toHaveValue('');
  await expect(page.locator('#acct-middle-initial-error')).toContainText('Only letters are allowed in name fields.');

  const last = page.locator('#acct-last-name');
  await last.pressSequentially('R3');
  await expect(last).toHaveValue('R');
  await expect(page.locator('#acct-last-name-error')).toContainText('Only letters are allowed in name fields.');
  await last.pressSequentially('yes');
  await expect(last).toHaveValue('Ryes');
  await expect(page.locator('#acct-last-name-error')).toBeHidden();
});
