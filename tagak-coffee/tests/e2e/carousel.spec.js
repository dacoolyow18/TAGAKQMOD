const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, solidPng } = require('../api/helpers');

const PNG_1PX = solidPng(64, 64);

test.skip(({ viewport }) => viewport.width < 800, 'Carousel is checked on desktop');

test.beforeAll(async () => {
  await resetDatabase();
  await insertAccount({ id: 'e2e-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678' });
});

async function signInAsManager(page) {
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
  await page.locator('[data-view="tools"]').click();
}

test('an image uploaded in the POS appears in the customer carousel, and removal clears it', async ({ page }) => {
  await signInAsManager(page);
  await page.setInputFiles('#tools-carousel-url', {
    name: 'promo.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  await expect(page.locator('#image-crop-modal')).toHaveJSProperty('open', true);
  await page.click('#image-crop-confirm');
  const preview = page.locator('#tools-carousel-preview img');
  await expect(preview).toHaveCount(1);
  const src = await preview.getAttribute('src');
  expect(src).toMatch(/^\/uploads\/carousel\/fixture-branch\/[0-9a-f-]+\.png$/);

  await page.goto('/customer-app/index.html');
  const heroImages = page.locator('#home-hero img');
  await expect(heroImages).toHaveCount(1);
  await expect(heroImages).toHaveAttribute('src', src);

  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
  await page.locator('[data-view="tools"]').click();
  await page.click('[data-carousel-remove]');
  await expect(page.locator('#tools-carousel-preview img')).toHaveCount(0);

  await page.goto('/customer-app/index.html');
  await expect(page.locator('#home-hero img')).toHaveCount(0);
});
