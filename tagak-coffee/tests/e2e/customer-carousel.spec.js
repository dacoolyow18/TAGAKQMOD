const { test, expect } = require('@playwright/test');
const { resetDatabase, withClient } = require('../api/helpers');

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const BRANCH_CODE = '1001806';

test.skip(({ viewport }) => viewport.width < 800, 'Carousel is checked on desktop');

test.beforeAll(async () => {
  await resetDatabase();
  await withClient(c => c.query(`INSERT INTO branches (id, code, name) VALUES ('brn-carousel', $1, 'Carousel Branch')`, [BRANCH_CODE]));
});

test('the customer carousel cycles through every uploaded image', async ({ page, request, baseURL }) => {
  test.setTimeout(120000);
  const login = await request.post(`${baseURL}/api/auth/admin-login`, {
    data: { email: process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test', password: process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123' },
  });
  const cookie = login.headers()['set-cookie'].match(/tagak_session=[^;]+/)[0];
  for (let i = 0; i < 5; i++) {
    const res = await request.post(`${baseURL}/api/uploads/carousel`, {
      headers: { Cookie: cookie },
      multipart: { file: { name: `slide-${i}.png`, mimeType: 'image/png', buffer: PNG_1PX } },
    });
    expect(res.status()).toBe(201);
  }

  await page.goto('/customer-app/index.html');
  await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await page.fill('#branch-input', BRANCH_CODE);
  await page.click('#btn-enter');
  await page.click('#btn-continue');
  await expect(page.locator('#menu-hero .hero-slide')).toHaveCount(5);

  await page.evaluate(() => {
    window.__seen = new Set();
    const hero = document.querySelector('#menu-hero');
    setInterval(() => {
      let nearest = 0;
      let distance = Infinity;
      hero.querySelectorAll('.hero-slide').forEach((slide, index) => {
        const d = Math.abs(slide.getBoundingClientRect().left - hero.getBoundingClientRect().left);
        if (d < distance) { distance = d; nearest = index; }
      });
      window.__seen.add(nearest);
    }, 300);
  });
  await page.waitForFunction(() => window.__seen.size === 5, null, { timeout: 90000 });
});
