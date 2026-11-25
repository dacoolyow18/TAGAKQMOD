const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient } = require('../api/helpers');

test.skip(({ viewport }) => viewport.width < 800, 'Add-on manager is checked on desktop');

test.beforeAll(async () => {
  await resetDatabase();
  await insertAccount({ id: 'e2e-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678' });
  await withClient(c => c.query(`INSERT INTO supplies (id, name, unit, stock) VALUES
    ('sup-oat', 'Oat Milk Carton', 'ml', 5000), ('sup-butter', 'Butter', 'g', 500), ('sup-shot', 'Shot Beans', 'g', 2000)`));
});

async function openAddOns(page) {
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
  await page.locator('[data-view="add-ons"]').click();
}

async function addAddOn(page, name, price, applies, supplyId) {
  await page.click('#btn-add-addon');
  await page.fill('#addon-name', name);
  await page.fill('#addon-price', price);
  await page.selectOption('#addon-applies', applies);
  await page.selectOption('#addon-supply-select', supplyId);
  await page.click('#btn-addon-add-supply');
  await page.click('#addon-form button[type="submit"]');
  await expect(page.locator('#addons-table-body')).toContainText(name);
}

test('add-ons are split into Add-ons for Drinks and Add-ons for Pastries', async ({ page }) => {
  await openAddOns(page);
  await addAddOn(page, 'Oat Milk', '40', 'drink', 'sup-oat');
  await addAddOn(page, 'Butter', '10', 'pastry', 'sup-butter');

  const body = page.locator('#addons-table-body');
  await expect(body.locator('tr.addon-section-head', { hasText: 'Add-ons for Drinks' })).toBeVisible();
  await expect(body.locator('tr.addon-section-head', { hasText: 'Add-ons for Pastries' })).toBeVisible();

  const drinksSection = body.locator('tr', { hasText: 'Oat Milk' });
  await expect(drinksSection).toBeVisible();
  const pastriesSection = body.locator('tr', { hasText: 'Butter' });
  await expect(pastriesSection).toBeVisible();
  const order = await body.locator('tr').evaluateAll(rows => rows.map(r => r.textContent));
  const at = (text) => order.findIndex(t => t.includes(text));
  expect(at('Add-ons for Drinks')).toBeGreaterThanOrEqual(0);
  expect(at('Add-ons for Drinks')).toBeLessThan(at('Oat Milk'));
  expect(at('Add-ons for Pastries')).toBeLessThan(at('Butter'));
  expect(at('Oat Milk')).toBeLessThan(at('Add-ons for Pastries'));
});

test('an add-on cannot be created without a supply, and the form blocks it', async ({ page }) => {
  await openAddOns(page);
  await page.click('#btn-add-addon');
  await page.fill('#addon-name', 'No Supply Shot');
  await page.fill('#addon-price', '25');
  await page.click('#addon-form button[type="submit"]');
  await expect(page.locator('#toast-container')).toContainText('Connect at least one supply');
  await expect(page.locator('#addons-table-body')).not.toContainText('No Supply Shot');
});

test('the price shown in the POS matches the saved price', async ({ page, request, baseURL }) => {
  await openAddOns(page);
  await addAddOn(page, 'Extra Shot', '35', 'drink', 'sup-shot');
  await expect(page.locator('#addons-table-body', { hasText: 'Extra Shot' })).toContainText('35.00');

  const list = await (await request.get(`${baseURL}/api/public/add-ons?appliesTo=drink`)).json();
  expect(list.find(a => a.name === 'Extra Shot')).toMatchObject({ price: 35, appliesTo: 'drink' });
});
