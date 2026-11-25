const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, solidPng } = require('../api/helpers');
const { publishNewItem } = require('./menu-helpers');

test.skip(({ viewport }) => viewport.width < 800, 'Menu manager is checked on desktop');

test.beforeAll(async ({ request, baseURL }) => {
  await resetDatabase();
  await insertAccount({ id: 'e2e-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678' });
  const login = await request.post(`${baseURL}/api/auth/admin-login`, {
    data: { email: process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test', password: process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123' },
  });
  const cookie = login.headers()['set-cookie'].match(/tagak_session=[^;]+/)[0];
  await request.post(`${baseURL}/api/supplies`, {
    headers: { Cookie: cookie },
    data: { name: 'Espresso Beans', unit: 'g', stock: 1000, price: 1.2 },
  });
});

async function signInAsManager(page) {
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
  await expect(page.locator('#view-title')).toBeVisible();
  await page.locator('[data-view="menu-recipes"]').click();
}

test('a Manager adds a drink with Hot / Iced on, and it reaches the public menu', async ({ page, request, baseURL }) => {
  await signInAsManager(page);
  await publishNewItem(page, { name: 'Test Latte', price: 100, hasTemperature: true });

  const items = await (await request.get(`${baseURL}/api/public/menu`)).json();
  const latte = items.find(i => i.name === 'Test Latte');
  expect(latte).toMatchObject({ category: 'Drinks', price: 100, hasTemperature: true });
});

test('a pastry has no Hot / Iced option, and the category uses Drinks and Pastries only', async ({ page, request, baseURL }) => {
  await signInAsManager(page);
  await page.click('#btn-add-menu-item');
  await page.fill('#mr-name', 'Test Scone');
  await page.selectOption('#mr-category', 'Pastries');
  await expect(page.locator('#mr-temp')).toBeHidden();
  await expect(page.locator('#mr-category option')).toHaveText(['Drinks', 'Pastries']);
  await page.fill('#mr-price', '70');
  await page.click('#btn-save-details');
  await page.selectOption('#recipe-add-supply', { index: 1 });
  await page.click('#btn-add-ingredient');
  await page.click('#btn-recipe-save');
  await expect(page.locator('#toast-container')).toContainText('Recipe saved successfully!');
  await page.check('#mr-published');
  await page.click('#btn-save-details');

  const items = await (await request.get(`${baseURL}/api/public/menu`)).json();
  expect(items.find(i => i.name === 'Test Scone')).toMatchObject({ category: 'Pastries', hasTemperature: false });
});

test('a Manager uploads a full rectangular menu image, replaces it, and removes it', async ({ page, request, baseURL }) => {
  await signInAsManager(page);
  await publishNewItem(page, { name: 'Photo Latte', price: 90 });

  await page.setInputFiles('#mr-image-file', { name: 'latte.png', mimeType: 'image/png', buffer: solidPng(128, 64) });
  await expect(page.locator('#mr-image-preview')).toHaveAttribute('src', /\/uploads\/menu\/fixture-branch\/[0-9a-f-]+\.png$/);
  await expect.poll(() => page.locator('#mr-image-preview').evaluate(img => img.naturalWidth / img.naturalHeight)).toBe(2);
  await page.click('#btn-save-details');
  await expect(page.locator('#toast-container')).toContainText('Item details saved successfully!');

  const items = await (await request.get(`${baseURL}/api/public/menu`)).json();
  expect(items.find(i => i.name === 'Photo Latte').imagePath).toMatch(/^\/uploads\/menu\/fixture-branch\/[0-9a-f-]+\.png$/);

  const first = items.find(i => i.name === 'Photo Latte').imagePath;
  expect((await page.request.get(first)).ok()).toBeTruthy();
  await page.setInputFiles('#mr-image-file', { name: 'replacement.png', mimeType: 'image/png', buffer: solidPng(96, 96) });
  await expect(page.locator('#mr-image-preview')).not.toHaveAttribute('src', first);
  await page.click('#btn-save-details');
  await expect.poll(async () => {
    const rows = await (await request.get(baseURL + '/api/public/menu')).json();
    return rows.find(i => i.name === 'Photo Latte').imagePath;
  }).not.toBe(first);
  await page.click('#btn-mr-image-remove');
  await page.click('#btn-save-details');
  await expect.poll(async () => {
    const rows = await (await request.get(baseURL + '/api/public/menu')).json();
    return rows.find(i => i.name === 'Photo Latte').imagePath;
  }).toBe('');
  await expect(page.locator('.reg-mono').filter({hasText: /^PL$/}).first()).toBeVisible();
});
