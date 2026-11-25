const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount } = require('../api/helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let superCookie;

test.beforeAll(async ({ request, baseURL }) => {
  await resetDatabase();
  await insertAccount({ id: 'e2e-rbac-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678' });
  for (const [role, pin] of [['Cashier','6789'], ['Barista','7890']]) {
    await insertAccount({ id: 'rbac-' + role, name: role + ' Test', role, pin });
  }
  await insertAccount({ id: 'rbac-admin', name: 'Test Admin', role: 'Admin', branchId: null, password: 'admin-test-123' });
  const login = await request.post(`${baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  });
  superCookie = login.headers()['set-cookie'].match(/tagak_session=[^;]+/)[0];
  const matrix = await (await request.get(`${baseURL}/api/permissions`, { headers: { Cookie: superCookie } })).json();
  const res = await request.put(`${baseURL}/api/permissions`, {
    headers: { Cookie: superCookie },
    data: {
      Manager: {
        ...matrix.Manager,
        view_menu: false, view_supplies: false, view_addons: false, view_tools: false,
      },
    },
  });
  expect(res.status()).toBe(200);
});

test('a Manager without View permission does not see the module in the POS', async ({ page, viewport }) => {
  test.skip(viewport.width < 800, 'Sidebar layout is checked on desktop');
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-rbac-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await page.waitForURL(/\/pos-app\//);

  await expect(page.locator('[data-view="register"]')).toBeVisible();
  await expect(page.locator('[data-view="orders"]')).toBeVisible();
  await expect(page.locator('[data-view="menu-recipes"]')).toBeHidden();
  await expect(page.locator('[data-view="supplies"]')).toBeHidden();
  await expect(page.locator('[data-view="add-ons"]')).toBeHidden();
  await expect(page.locator('[data-view="tools"]')).toBeHidden();

  await page.evaluate(() => switchView('supplies'));
  await expect(page.locator('#view-supplies')).toBeHidden();
  await expect(page.locator('#view-title')).toHaveText('Register');
});

for (const [role, pin] of [['Cashier', '6789'], ['Barista', '7890'], ['Manager', '5678']]) {
  test(role + ' loses and regains Orders in the same session', async ({ page, request, viewport }) => {
    const email = role === 'Manager' ? 'e2e-rbac-mgr@tagak.test' : 'rbac-' + role.toLowerCase() + '@tagak.test';
    await page.goto('/unified-login/index.html');
    await page.fill('#pos-email', email);
    await page.fill('#pos-pin', pin);
    await page.click('#pos-form button[type="submit"]');
    await expect(page.locator('#offline-status')).toContainText('Register online');
    const orders = page.locator('[data-view="orders"]');
    if (viewport.width < 800) await page.click('#btn-hamburger');
    await orders.click();
    for (const enabled of [false, true]) {
      const update = await request.patch('/api/permissions', {
        headers: { Cookie: superCookie }, data: { role, key: 'view_orders', enabled },
      });
      expect(update.status()).toBe(204);
      expect((await page.request.get('/api/orders')).status()).toBe(enabled ? 200 : 403);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      if (enabled) {
        await expect(orders).not.toHaveClass(/hidden/);
        if (viewport.width < 800) await page.click('#btn-hamburger');
        await orders.click();
        await expect(page.locator('#view-orders')).toBeVisible();
      } else {
        await expect(orders).toBeHidden();
        await page.evaluate(() => switchView('orders'));
        await expect(page.locator('#view-orders')).toBeHidden();
        await expect(page.locator('#view-register')).toBeVisible();
      }
    }
  });
}

test('Admin keeps Roles access while account management is revoked and restored', async ({ request, page, viewport }) => {
  test.skip(viewport.width < 800, 'Admin sidebar on desktop');
  await page.goto('/unified-login/index.html?app=admin');
  await page.fill('#admin-email', 'rbac-admin@tagak.test');
  await page.fill('#admin-password', 'admin-test-123');
  await page.click('#admin-form button[type="submit"]');
  await expect(page.getByTestId('nav-employees')).toBeVisible();
  for (const enabled of [false, true]) {
    const res = await request.patch('/api/permissions', {
      headers: { Cookie: superCookie }, data: { role: 'Admin', key: 'manage_users', enabled },
    });
    expect(res.status()).toBe(204);
    expect((await page.request.get('/api/accounts')).status()).toBe(enabled ? 200 : 403);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    if (enabled) await expect(page.getByTestId('nav-employees')).toBeVisible();
    else {
      await expect(page.getByTestId('nav-employees')).toBeHidden();
      await page.getByTestId('nav-roles').click();
      const toggle = page.locator('[data-role="Cashier"][data-perm="view_orders"]');
      await expect(toggle).toHaveClass(/on/);
      await toggle.click();
      await expect(toggle).toHaveClass(/off/);
      await toggle.click();
      await expect(toggle).toHaveClass(/on/);
    }
  }
});

test('Manager edit controls follow live toggles while their views remain available', async ({ page, request, viewport }) => {
  test.skip(viewport.width < 800, 'Desktop module controls');
  const headers = { Cookie: superCookie };
  const matrix = await (await request.get('/api/permissions', { headers })).json();
  const features = [
    ['menu-recipes', 'view_menu', 'edit_menu', '#btn-add-menu-item'],
    ['supplies', 'view_supplies', 'edit_supplies', '#btn-add-supply'],
    ['add-ons', 'view_addons', 'edit_addons', '#btn-add-addon'],
    ['tools', 'view_tools', 'edit_tools', '#tools-carousel-url'],
    ['analytics', 'view_analytics', 'export_reports', '#btn-report-print'],
  ];
  const permissions = { ...matrix.Manager };
  for (const [, viewKey] of features) permissions[viewKey] = true;
  async function configure(enabled) {
    for (const [, , editKey] of features) permissions[editKey] = enabled;
    permissions.access_cash_drawer = enabled;
    const res = await request.put('/api/permissions', { headers, data: { Manager: permissions } });
    expect(res.status()).toBe(200);
  }
  await configure(true);
  await page.goto('/unified-login/index.html');
  await page.fill('#pos-email', 'e2e-rbac-mgr@tagak.test');
  await page.fill('#pos-pin', '5678');
  await page.click('#pos-form button[type="submit"]');
  await expect(page.locator('#offline-status')).toContainText('Register online');
  for (const enabled of [false, true]) {
    await configure(enabled);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const drawer = page.locator('#btn-cash-drawer');
    if (enabled) await expect(drawer).toBeVisible();
    else await expect(drawer).toBeHidden();
    for (const [view, , , selector] of features) {
      await page.locator('[data-view="' + view + '"]').click();
      await expect(page.locator('#view-' + view)).toBeVisible();
      if (enabled) await expect(page.locator(selector)).toBeVisible();
      else await expect(page.locator(selector)).toBeHidden();
    }
  }
});
