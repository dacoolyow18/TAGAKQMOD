const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let superCookie;
let cashierCookie;

async function cookieFrom(res) {
  const header = res.headers()['set-cookie'] || '';
  return `tagak_session=${header.match(/tagak_session=([^;]+)/)[1]}`;
}

function call(request, method, path, cookie, data) {
  return request.fetch(`${server.baseURL}${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
    data,
  });
}

test.beforeAll(async ({ request }) => {
  await resetDatabase();
  await insertAccount({ id: 'emp-cashier', name: 'Maria Santos', role: 'Cashier', pin: '2468' });
  server = await startServer();
  superCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  }));
  cashierCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-cashier@tagak.test', pin: '2468' },
  }));
});

test.afterAll(async () => {
  await server?.close();
});

test('a Cashier cannot create menu items (403)', async ({ request }) => {
  const res = await call(request, 'POST', '/api/menu-items', cashierCookie, {
    name: 'Sneaky', category: 'Drinks', price: 10,
  });
  expect(res.status()).toBe(403);
});

test('a drink can turn Hot / Iced on, and a pastry cannot', async ({ request }) => {
  const drink = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Test Latte', category: 'Drinks', price: 100, hasTemperature: true,
  })).json();
  expect(drink.hasTemperature).toBe(true);

  const pastry = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Test Croissant', category: 'Pastries', price: 75, hasTemperature: true,
  })).json();
  expect(pastry.hasTemperature).toBe(false);
});

test('a negative price and an unknown category are rejected with 400', async ({ request }) => {
  const badPrice = await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Bad', category: 'Drinks', price: -5,
  });
  expect(badPrice.status()).toBe(400);
  const badCategory = await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Bad', category: 'Coffee', price: 5,
  });
  expect(badCategory.status()).toBe(400);
});

test('turning Hot / Iced off on an existing drink is saved', async ({ request }) => {
  const created = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Toggle Drink', category: 'Drinks', price: 90, hasTemperature: true,
  })).json();
  const updated = await (await call(request, 'PUT', `/api/menu-items/${created.id}`, superCookie, {
    name: 'Toggle Drink', category: 'Drinks', price: 90, hasTemperature: false, active: false,
  })).json();
  expect(updated.hasTemperature).toBe(false);
});

test('deleting an item archives it: the row stays, it leaves the active menu, and it can be restored', async ({ request }) => {
  const supply = await (await call(request, 'POST', '/api/supplies', superCookie, {
    name: 'Archive Milk', unit: 'ml', stock: 500,
  })).json();
  const item = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Archived Latte', category: 'Drinks', price: 65,
  })).json();
  await call(request, 'PUT', `/api/menu-items/${item.id}/recipe`, superCookie, [{ supplyId: supply.id, qty: 200, largeQty: 300 }]);
  await call(request, 'PUT', `/api/menu-items/${item.id}`, superCookie, {
    name: 'Archived Latte', category: 'Drinks', price: 65, active: true,
  });
  await withClient(c => c.query(
    `INSERT INTO orders (ticket_no, order_date, status, payment, items, subtotal, vat, total, time_in)
     VALUES ('TK-20261109-0001', '2026-11-09', 'completed', 'cash', $1, 65, 0, 65, now())`,
    [JSON.stringify([{ menuItemId: item.id, name: 'Archived Latte', qty: 1, unitPrice: 65 }])],
  ));

  const res = await call(request, 'DELETE', `/api/menu-items/${item.id}`, superCookie);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.archived).toBe(true);
  expect(body.item.archived).toBe(true);
  expect(body.item.active).toBe(false);

  // Still in the database with its recipe and archive timestamp.
  const { rows } = await withClient(c => c.query('SELECT is_archived, archived_at FROM menu_items WHERE id = $1', [item.id]));
  expect(rows[0].is_archived).toBe(true);
  expect(rows[0].archived_at).not.toBeNull();
  const recipe = await (await call(request, 'GET', `/api/menu-items/${item.id}/recipe`, superCookie)).json();
  expect(recipe).toEqual([{ supplyId: supply.id, qty: 200, largeQty: 300 }]);

  // Gone from the active menus, present when history is asked for.
  const active = await (await call(request, 'GET', '/api/menu-items', superCookie)).json();
  expect(active.some(i => i.id === item.id)).toBe(false);
  const all = await (await call(request, 'GET', '/api/menu-items?includeArchived=true', superCookie)).json();
  expect(all.find(i => i.id === item.id).archived).toBe(true);
  const publicMenu = await (await request.get(`${server.baseURL}/api/public/menu`)).json();
  expect(publicMenu.some(i => i.id === item.id)).toBe(false);

  // Archived items cannot be edited until restored.
  const edit = await call(request, 'PUT', `/api/menu-items/${item.id}`, superCookie, {
    name: 'Archived Latte', category: 'Drinks', price: 70, active: false,
  });
  expect(edit.status()).toBe(409);

  const restored = await (await call(request, 'POST', `/api/menu-items/${item.id}/restore`, superCookie)).json();
  expect(restored.archived).toBe(false);
  expect(restored.active).toBe(false);
  const back = await (await call(request, 'GET', '/api/menu-items', superCookie)).json();
  expect(back.some(i => i.id === item.id)).toBe(true);
});

test('an unused item is archived too, never hard-deleted', async ({ request }) => {
  const unused = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Unused', category: 'Pastries', price: 60,
  })).json();
  const gone = await (await call(request, 'DELETE', `/api/menu-items/${unused.id}`, superCookie)).json();
  expect(gone.archived).toBe(true);
  const { rows } = await withClient(c => c.query('SELECT is_archived FROM menu_items WHERE id = $1', [unused.id]));
  expect(rows).toHaveLength(1);

  const missing = await call(request, 'DELETE', '/api/menu-items/does-not-exist', superCookie);
  expect(missing.status()).toBe(404);
});

test('new items are drafts and the public menu lists only published items', async ({ request }) => {
  const supply = await (await call(request, 'POST', '/api/supplies', superCookie, {
    name: 'Public Milk', unit: 'ml', stock: 500,
  })).json();
  const draft = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Draft Item', category: 'Drinks', price: 50,
  })).json();
  expect(draft.active).toBe(false);
  await call(request, 'PUT', `/api/menu-items/${draft.id}/recipe`, superCookie, [{ supplyId: supply.id, qty: 100 }]);
  const published = await (await call(request, 'PUT', `/api/menu-items/${draft.id}`, superCookie, {
    name: 'Draft Item', category: 'Drinks', price: 50, active: true,
  })).json();
  expect(published.active).toBe(true);

  const items = await (await request.get(`${server.baseURL}/api/public/menu`)).json();
  expect(items.find(i => i.id === draft.id)).toBeDefined();
  expect(items.some(i => i.name === 'Test Latte')).toBe(false);
});

test('an item cannot be published or saved with an empty recipe', async ({ request }) => {
  const draft = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'No Supplies', category: 'Pastries', price: 40,
  })).json();

  const emptyRecipe = await call(request, 'PUT', `/api/menu-items/${draft.id}/recipe`, superCookie, []);
  expect(emptyRecipe.status()).toBe(400);

  const publish = await call(request, 'PUT', `/api/menu-items/${draft.id}`, superCookie, {
    name: 'No Supplies', category: 'Pastries', price: 40, active: true,
  });
  expect(publish.status()).toBe(400);
  expect((await publish.json()).error).toMatch(/at least one supply/);

  const create = await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Born Live', category: 'Pastries', price: 40, active: true,
  });
  expect(create.status()).toBe(400);
});

test('a recipe is saved as a list of supply quantities and read back', async ({ request }) => {
  const supply = await (await call(request, 'POST', '/api/supplies', superCookie, {
    name: 'Espresso Beans', unit: 'g', stock: 1000, price: 1.2,
  })).json();
  const item = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Recipe Espresso', category: 'Drinks', price: 85,
  })).json();

  const saved = await call(request, 'PUT', `/api/menu-items/${item.id}/recipe`, superCookie, [
    { supplyId: supply.id, qty: 18 },
  ]);
  expect(saved.status()).toBe(200);
  const read = await (await call(request, 'GET', `/api/menu-items/${item.id}/recipe`, superCookie)).json();
  expect(read).toEqual([{ supplyId: supply.id, qty: 18, largeQty: null }]);
});

test('a menu image upload is saved, served at its URL, and limited to Menu editors', async ({ request }) => {
  const { solidPng } = require('./helpers');
  const image = { name: 'latte.png', mimeType: 'image/png', buffer: solidPng(8, 8) };

  const denied = await request.post(`${server.baseURL}/api/menu-items/image`, {
    headers: { Cookie: cashierCookie },
    multipart: { file: image },
  });
  expect(denied.status()).toBe(403);

  const wrongType = await request.post(`${server.baseURL}/api/menu-items/image`, {
    headers: { Cookie: superCookie },
    multipart: { file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') } },
  });
  expect(wrongType.status()).toBe(415);

  const saved = await request.post(`${server.baseURL}/api/menu-items/image`, {
    headers: { Cookie: superCookie },
    multipart: { file: image },
  });
  expect(saved.status()).toBe(201);
  const { publicUrl } = await saved.json();
  expect(publicUrl).toMatch(/^\/uploads\/menu\/[0-9a-f-]+\.png$/);

  const served = await request.get(`${server.baseURL}${publicUrl}`);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toMatch(/image\/png/);
});

test('a recipe line can carry a Large quantity, and a bad one is rejected', async ({ request }) => {
  const supply = await (await call(request, 'POST', '/api/supplies', superCookie, {
    name: 'Brown Sugar', unit: 'g', stock: 500,
  })).json();
  const item = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Sweet Latte', category: 'Drinks', price: 90, hasTemperature: true,
  })).json();

  const saved = await call(request, 'PUT', `/api/menu-items/${item.id}/recipe`, superCookie, [
    { supplyId: supply.id, qty: 1, largeQty: 2 },
  ]);
  expect(saved.status()).toBe(200);
  const read = await (await call(request, 'GET', `/api/menu-items/${item.id}/recipe`, superCookie)).json();
  expect(read).toEqual([{ supplyId: supply.id, qty: 1, largeQty: 2 }]);

  const bad = await call(request, 'PUT', `/api/menu-items/${item.id}/recipe`, superCookie, [
    { supplyId: supply.id, qty: 1, largeQty: 0 },
  ]);
  expect(bad.status()).toBe(400);
});
