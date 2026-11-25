const { test, expect } = require('@playwright/test');
const { resetDatabase } = require('../api/helpers');
const { publishNewItem } = require('./menu-helpers');
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';
const BRANCH_CODE = '1009001';
const MANAGER_PIN = '7531';

test.skip(({ viewport }) => viewport.width < 800, 'Full flow is checked on desktop');

test.beforeAll(async () => {
  await resetDatabase();
});

function cookieFrom(res) {
  const header = res.headers()['set-cookie'] || '';
  return `tagak_session=${header.match(/tagak_session=([^;]+)/)[1]}`;
}

test('admin sets up a branch, the manager runs the POS, and a customer order completes end to end', async ({ page, context, request, baseURL }) => {
  // 1. Admin creates a branch, a Manager in it, and add-ons.
  const adminCookie = cookieFrom(await request.post(`${baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  }));
  const branch = await (await request.post(`${baseURL}/api/branches`, {
    headers: { Cookie: adminCookie },
    data: { code: BRANCH_CODE, name: 'Full Flow Main', location: 'Davao City' },
  })).json();
  expect(branch.id).toBeTruthy();

  const employee = await request.post(`${baseURL}/api/accounts`, {
    headers: { Cookie: adminCookie },
    data: {
      firstName: 'Full',
      middleName: 'Flow',
      lastName: 'Manager',
      role: 'Manager',
      email: 'fullflow@tagak.test',
      phone: '09171234567',
      birthdate: '1994-08-12',
      pin: MANAGER_PIN,
      branchId: branch.id,
    },
  });
  expect(employee.status()).toBe(201);

  const supply = await (await request.post(`${baseURL}/api/supplies`, {
    headers: { Cookie: adminCookie },
    data: { name: 'Full Espresso Beans', unit: 'g', stock: 5000, price: 1.2 },
  })).json();
  await request.post(`${baseURL}/api/add-ons`, {
    headers: { Cookie: adminCookie },
    data: { name: 'Full Extra Shot', appliesTo: 'drink', price: 20, supplies: [{ supplyId: supply.id, qty: 18 }] },
  });
  await request.post(`${baseURL}/api/add-ons`, {
    headers: { Cookie: adminCookie },
    data: { name: 'Full Butter', appliesTo: 'pastry', price: 10, supplies: [{ supplyId: supply.id, qty: 5 }] },
  });

  await request.put(`${baseURL}/api/settings`, {
    headers: { Cookie: adminCookie },
    data: { vat_rate: 0.12, large_upcharge: 30, estimated_minutes: 5 },
  });

  // 2. Manager signs into the POS by email + PIN and adds a Hot / Iced drink and a pastry.
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'fullflow@tagak.test');
  await page.fill('#pos-pin', MANAGER_PIN);
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);
  await page.locator('[data-view="menu-recipes"]').click();

  await publishNewItem(page, { name: 'Full Latte', price: 100, hasTemperature: true });
  await publishNewItem(page, { name: 'Full Scone', price: 70, category: 'Pastries' });

  // 3. Admin uploads a carousel image through the API; the public carousel lists it.
  const upload = await request.post(`${baseURL}/api/uploads/carousel`, {
    headers: { Cookie: adminCookie },
    multipart: { file: { name: 'full.png', mimeType: 'image/png', buffer: PNG_1PX } },
  });
  expect(upload.status()).toBe(201);
  const carousel = await (await request.get(`${baseURL}/api/public/carousel`)).json();
  expect(carousel.length).toBeGreaterThan(0);

  // 4. Customer orders an iced latte with an extra shot and a scone with butter.
  const customer = await context.newPage();
  await customer.goto('/customer-app/index.html');
  await expect(customer.locator('body')).toHaveAttribute('data-app-ready', 'true');
  await customer.fill('#branch-input', BRANCH_CODE);
  await customer.click('#btn-enter');
  await expect(customer.locator('#modal-welcome')).not.toHaveClass(/hidden/);
  await customer.click('#btn-continue');
  await expect(customer.locator('#screen-menu')).toHaveClass(/active/);

  await customer.locator('#menu-list .item-card', { hasText: 'Full Latte' }).click();
  await expect(customer.locator('#sheet-item')).not.toHaveClass(/hidden/);
  await customer.locator('#temperature-options [data-temp="iced"]').click();
  await customer.locator('#addons-container .chip', { hasText: 'Full Extra Shot' }).click();
  await customer.click('#btn-add-order');
  await expect(customer.locator('#sheet-item')).toHaveClass(/hidden/);

  await customer.click('#category-tabs .tab[data-cat="Pastries"]');
  await customer.locator('#menu-list .item-card', { hasText: 'Full Scone' }).click();
  await customer.locator('#addons-container .chip', { hasText: 'Full Butter' }).click();
  await customer.click('#btn-add-order');
  await expect(customer.locator('#sheet-item')).toHaveClass(/hidden/);

  await customer.click('#basket-pill');
  await expect(customer.locator('#screen-checkout')).toHaveClass(/active/);
  await customer.fill('#order-nickname', 'Flow Guest');
  await customer.click('#pay-cash');
  await customer.click('#btn-place-order');
  await customer.click('#btn-confirm-pay');
  await expect(customer.locator('#cash-dialog')).toBeVisible();
  const ticket = await customer.locator('#cash-ticket').textContent();
  await expect(customer.locator('#cash-time')).toHaveText(/^(5:00|4:\d\d)$/);
  await customer.reload();
  await expect(customer.locator('#cash-ticket')).toHaveText(ticket);
  await customer.keyboard.press('Escape');
  await expect(customer.locator('#cash-dialog')).toBeVisible();
  await expect(customer.locator('#screen-tracker')).not.toHaveClass(/active/);
  expect(ticket).toMatch(/^TK-\d{8}-\d{4}$/);

  // 5. The POS board shows the ticket within a few seconds and the Manager moves it forward.
  await page.locator('[data-view="orders"]').click();
  const card = page.locator('.order-card', { hasText: ticket });
  await expect(card).toBeVisible({ timeout: 6000 });
  await expect(card.locator('.badge')).toHaveText('Pending Payment');
  await card.getByText('Confirm cash received').click();
  await customer.getByText('View receipt').click();
  await expect(customer.locator('#receipt-body')).toContainText('Paid by cash');
  await customer.click('#btn-receipt-close');
  await card.locator('.act-brew').click();
  await expect(card.locator('.badge')).toHaveText('brewing');
  await expect(card.locator('.order-claim-value')).toHaveText('Flow Guest');
  await card.locator('.act-ready').click();
  await expect(card.locator('.badge')).toHaveText('ready');
  await card.locator('.act-complete').click();
  await expect(card.locator('.badge')).toHaveText('completed');

  // 6. The customer tracker reflects completion.
  await expect(customer.locator(`.live-card[data-ticket="${ticket}"] .tl-step.ready`)).toContainText('Picked up', { timeout: 8000 });

  const order = await (await customer.request.get(`${baseURL}/api/public/orders/${ticket}`)).json();
  expect(order).toMatchObject({ ticketNo: ticket, status: 'completed', payment: 'cash' });
  expect(order.items.map(i => i.name).sort()).toEqual(['Full Latte', 'Full Scone'].sort());
});
