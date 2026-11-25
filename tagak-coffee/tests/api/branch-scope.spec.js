const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, withClient, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let superCookie;
let mainCookie;
let southCookie;
let southManagerCookie;
let mainTicket;
let southTicket;

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
  await withClient(async c => {
    await c.query(`INSERT INTO branches (id, code, name) VALUES
      ('brn-main', '1001', 'Main'), ('brn-south', '1002', 'South')`);
    await c.query(`INSERT INTO menu_items (id, name, category, price) VALUES ('menu-scone', 'Scone', 'Pastries', 70)`);
    await c.query(`INSERT INTO menu_items (id, name, category, price, branch_id) VALUES ('menu-scone-south', 'South Scone', 'Pastries', 75, 'brn-south')`);
  });
  await insertAccount({ id: 'emp-main', name: 'Main Manager', role: 'Manager', pin: '1111', branchId: 'brn-main' });
  await insertAccount({ id: 'emp-south', name: 'South Cashier', role: 'Cashier', pin: '2222', branchId: 'brn-south' });
  await insertAccount({ id: 'emp-south-mgr', name: 'South Manager', role: 'Manager', pin: '3333', branchId: 'brn-south' });

  server = await startServer();
  superCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  }));
  mainCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-main@tagak.test', pin: '1111' },
  }));
  southCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-south@tagak.test', pin: '2222' },
  }));
  southManagerCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-south-mgr@tagak.test', pin: '3333' },
  }));

  const sconeFor = (branchId) => (branchId === 'brn-south' ? 'menu-scone-south' : 'menu-scone');
  const placed = (branchId) => ({ branchId, customerName: 'Sam', payment: 'cash', lines: [{ menuItemId: sconeFor(branchId), qty: 1 }] });
  mainTicket = (await (await call(request, 'POST', '/api/orders', mainCookie, placed('brn-main'))).json()).ticketNo;
  southTicket = (await (await call(request, 'POST', '/api/orders', southCookie, placed('brn-south'))).json()).ticketNo;
});

test.afterAll(async () => {
  await server?.close();
});

test('a branch user only lists orders from their own branch', async ({ request }) => {
  const mine = await (await call(request, 'GET', '/api/orders', mainCookie)).json();
  expect(mine.map(o => o.ticketNo)).toEqual([mainTicket]);

  const theirs = await (await call(request, 'GET', '/api/orders', southCookie)).json();
  expect(theirs.map(o => o.ticketNo)).toEqual([southTicket]);
});

test('a Super Admin without a branch still sees every branch', async ({ request }) => {
  const all = await (await call(request, 'GET', '/api/orders', superCookie)).json();
  expect(all.map(o => o.ticketNo).sort()).toEqual([mainTicket, southTicket].sort());
});

test('a branch user cannot move another branch\'s order', async ({ request }) => {
  expect((await call(request, 'POST', `/api/orders/${southTicket}/collect-cash`, mainCookie)).status()).toBe(404);
  const denied = await call(request, 'PATCH', `/api/orders/${southTicket}`, mainCookie, { status: 'brewing' });
  expect(denied.status()).toBe(404);

  const allowed = await call(request, 'PATCH', `/api/orders/${mainTicket}`, mainCookie, { status: 'brewing' });
  expect(allowed.status()).toBe(200);
});

test('void history pages stay branch-scoped and exclude rejected voids', async ({ request }) => {
  const denied = await call(request, 'PATCH', '/api/orders/' + southTicket, southCookie, { status: 'cancelled' });
  expect(denied.status()).toBe(403);
  await withClient(c => c.query(`
    INSERT INTO orders(ticket_no, order_date, branch_id, status, payment, items, subtotal, vat, total, time_in, time_out)
    SELECT 'TK-20200101-' || n, current_date, 'brn-main', 'cancelled', 'cash', '[]', 0, 0, 0, now(), now()
    FROM generate_series(1000,1200) n`));
  const path = '/api/orders?status=cancelled';
  const firstPage = await (await call(request, 'GET', path, mainCookie)).json();
  expect(firstPage).toHaveLength(200);
  const next = path + '&before=' + firstPage.at(-1).ticketNo;
  const secondPage = await (await call(request, 'GET', next, mainCookie)).json();
  expect(secondPage.map(order => order.ticketNo)).toEqual(['TK-20200101-1000']);
  expect(await (await call(request, 'GET', path, southCookie)).json()).toEqual([]);
  expect(await (await call(request, 'GET', next, southCookie)).json()).toEqual([]);
});

test('a branch user cannot place a register order for another branch', async ({ request }) => {
  const res = await call(request, 'POST', '/api/orders', mainCookie, {
    branchId: 'brn-south', payment: 'cash', lines: [{ menuItemId: 'menu-scone', qty: 1 }],
  });
  expect(res.status()).toBe(403);
});

test('cash log entries are only listed for the branch that recorded them', async ({ request }) => {
  await call(request, 'POST', '/api/cash-logs', mainCookie, { type: 'payOut', amount: 100, reason: 'Ice' });
  await call(request, 'POST', '/api/cash-logs', southManagerCookie, { type: 'payOut', amount: 40, reason: 'Milk' });

  const main = await (await call(request, 'GET', '/api/cash-logs', mainCookie)).json();
  expect(main.map(l => l.reason)).toEqual(['Ice']);

  const south = await (await call(request, 'GET', '/api/cash-logs', southManagerCookie)).json();
  expect(south.map(l => l.reason)).toEqual(['Milk']);

  const all = await (await call(request, 'GET', '/api/cash-logs', superCookie)).json();
  expect(all.map(l => l.reason).sort()).toEqual(['Ice', 'Milk']);
});

test('branch-assigned staff only see their own branch in GET /api/branches', async ({ request }) => {
  const mainBranches = await (await call(request, 'GET', '/api/branches', mainCookie)).json();
  expect(mainBranches.map(b => b.id)).toEqual(['brn-main']);

  const southBranches = await (await call(request, 'GET', '/api/branches', southManagerCookie)).json();
  expect(southBranches.map(b => b.id)).toEqual(['brn-south']);

  const superBranches = await (await call(request, 'GET', '/api/branches', superCookie)).json();
  expect(superBranches.map(b => b.id).sort()).toEqual(['brn-main', 'brn-south']);
});

test('supplies, menu items, and add-ons created in one branch are strictly isolated from other branches', async ({ request }) => {
  // 1. Branch 1 (Main) creates a supply
  const supRes = await call(request, 'POST', '/api/supplies', mainCookie, {
    name: 'Main Matcha Powder', unit: 'g', stock: 500, price: 2.5,
  });
  expect(supRes.status()).toBe(201);
  const mainSupply = await supRes.json();
  expect(mainSupply.branchId).toBe('brn-main');

  // Branch 2 (South) cannot see, edit, delete, or add price logs to Branch 1's supply
  const southSupplies = await (await call(request, 'GET', '/api/supplies', southManagerCookie)).json();
  expect(southSupplies.some(s => s.id === mainSupply.id)).toBe(false);
  expect((await call(request, 'PUT', `/api/supplies/${mainSupply.id}`, southManagerCookie, {
    name: 'Hijacked', unit: 'g', stock: 0,
  })).status()).toBe(404);
  expect((await call(request, 'DELETE', `/api/supplies/${mainSupply.id}`, southManagerCookie)).status()).toBe(404);
  expect((await call(request, 'POST', `/api/supplies/${mainSupply.id}/price-logs`, southManagerCookie, {
    price: 99, effectiveAt: new Date().toISOString(),
  })).status()).toBe(404);

  // 2. Branch 1 creates a menu item, links recipe, and publishes it
  const itemRes = await call(request, 'POST', '/api/menu-items', mainCookie, {
    name: 'Main Exclusive Matcha', category: 'Drinks', price: 165, hasTemperature: true,
  });
  expect(itemRes.status()).toBe(201);
  const mainItem = await itemRes.json();
  expect(mainItem.branchId).toBe('brn-main');

  // Branch 2 cannot attach recipe or edit or archive Branch 1's item
  expect((await call(request, 'PUT', `/api/menu-items/${mainItem.id}/recipe`, southManagerCookie, [
    { supplyId: mainSupply.id, qty: 15 },
  ])).status()).toBe(404);

  // Branch 1 saves recipe and publishes item
  expect((await call(request, 'PUT', `/api/menu-items/${mainItem.id}/recipe`, mainCookie, [
    { supplyId: mainSupply.id, qty: 15 },
  ])).status()).toBe(200);
  expect((await call(request, 'PUT', `/api/menu-items/${mainItem.id}`, mainCookie, {
    name: 'Main Exclusive Matcha', category: 'Drinks', price: 165, hasTemperature: true, active: true,
  })).status()).toBe(200);

  // Branch 2 POS and Customer catalog for Branch 2 do not see Branch 1's item
  const southPosMenu = await (await call(request, 'GET', '/api/menu-items', southManagerCookie)).json();
  expect(southPosMenu.some(i => i.id === mainItem.id)).toBe(false);

  const mainPublicMenu = await (await call(request, 'GET', '/api/public/menu?branchId=brn-main')).json();
  expect(mainPublicMenu.some(i => i.id === mainItem.id)).toBe(true);

  const southPublicMenu = await (await call(request, 'GET', '/api/public/menu?branchId=brn-south')).json();
  expect(southPublicMenu.some(i => i.id === mainItem.id)).toBe(false);

  // Customer/POS in Branch 2 cannot order Branch 1's exclusive item
  const crossOrder = await call(request, 'POST', '/api/public/orders', null, {
    branchId: 'brn-south',
    customerName: 'Sam',
    payment: 'cash',
    lines: [{ menuItemId: mainItem.id, temperature: 'iced', qty: 1 }],
  });
  expect(crossOrder.status()).toBe(400);

  // 3. Branch 1 creates an add-on
  const addOnRes = await call(request, 'POST', '/api/add-ons', mainCookie, {
    name: 'Main Oat Float',
    appliesTo: 'drink',
    price: 35,
    active: true,
    supplies: [{ supplyId: mainSupply.id, qty: 5 }],
  });
  expect(addOnRes.status()).toBe(201);
  const mainAddOn = await addOnRes.json();
  expect(mainAddOn.branchId).toBe('brn-main');

  const southPosAddOns = await (await call(request, 'GET', '/api/add-ons', southManagerCookie)).json();
  expect(southPosAddOns.some(a => a.id === mainAddOn.id)).toBe(false);

  const mainPublicAddOns = await (await call(request, 'GET', '/api/public/add-ons?branchId=brn-main')).json();
  expect(mainPublicAddOns.some(a => a.id === mainAddOn.id)).toBe(true);

  const southPublicAddOns = await (await call(request, 'GET', '/api/public/add-ons?branchId=brn-south')).json();
  expect(southPublicAddOns.some(a => a.id === mainAddOn.id)).toBe(false);

  expect((await call(request, 'DELETE', `/api/add-ons/${mainAddOn.id}`, southManagerCookie)).status()).toBe(404);
});

test('drinks and pastries belong to exactly one branch, including legacy unassigned items', async ({ request }) => {
  // South creates a drink and a pastry; Main never sees them.
  const drink = await (await call(request, 'POST', '/api/menu-items', southManagerCookie, {
    name: 'South Cold Brew', category: 'Drinks', price: 140, hasTemperature: true,
  })).json();
  const pastry = await (await call(request, 'POST', '/api/menu-items', southManagerCookie, {
    name: 'South Ensaymada', category: 'Pastries', price: 60,
  })).json();
  expect(drink.branchId).toBe('brn-south');
  expect(pastry.branchId).toBe('brn-south');

  const mainMenu = await (await call(request, 'GET', '/api/menu-items?includeArchived=true', mainCookie)).json();
  expect(mainMenu.some(i => i.id === drink.id || i.id === pastry.id)).toBe(false);
  expect((await call(request, 'GET', `/api/menu-items/${pastry.id}/recipe`, mainCookie)).status()).toBe(404);
  expect((await call(request, 'POST', `/api/menu-items/${pastry.id}/restore`, mainCookie)).status()).toBe(404);

  // The legacy item with no branch belongs to the primary branch (Main) only.
  const southMenu = await (await call(request, 'GET', '/api/menu-items', southManagerCookie)).json();
  expect(southMenu.some(i => i.id === 'menu-scone')).toBe(false);
  expect(mainMenu.some(i => i.id === 'menu-scone')).toBe(true);
  expect((await call(request, 'PUT', '/api/menu-items/menu-scone', southManagerCookie, {
    name: 'Claimed', category: 'Pastries', price: 1,
  })).status()).toBe(404);
  const southPublic = await (await call(request, 'GET', '/api/public/menu?branchId=brn-south')).json();
  expect(southPublic.some(i => i.id === 'menu-scone')).toBe(false);

  // With several branches and none chosen, the public menu shows nothing.
  expect(await (await call(request, 'GET', '/api/public/menu')).json()).toEqual([]);

  // A Super Admin creates for a chosen branch.
  const adminItem = await (await call(request, 'POST', '/api/menu-items', superCookie, {
    name: 'Admin Pandesal', category: 'Pastries', price: 15, branchId: 'brn-south',
  })).json();
  expect(adminItem.branchId).toBe('brn-south');
  const mainAfter = await (await call(request, 'GET', '/api/menu-items', mainCookie)).json();
  expect(mainAfter.some(i => i.id === adminItem.id)).toBe(false);
});

test('store settings, store open/close toggle, and uploaded assets are isolated per branch', async ({ request }) => {
  // 1. Branch 1 updates store settings
  const saveMainSettings = await call(request, 'PUT', '/api/settings', mainCookie, {
    vat_rate: 0.12,
    large_upcharge: 30,
    estimated_minutes: 15,
  });
  expect(saveMainSettings.status()).toBe(200);

  // Branch 2 still has its own independent settings (defaults to 0)
  const southSettings = await (await call(request, 'GET', '/api/settings', southManagerCookie)).json();
  expect(Number(southSettings.vat_rate || 0)).toBe(0);
  expect(Number(southSettings.large_upcharge || 0)).toBe(0);

  const pubMainSettings = await (await call(request, 'GET', '/api/public/settings?branchId=brn-main')).json();
  expect(pubMainSettings.vatRate).toBeCloseTo(0.12, 4);
  expect(pubMainSettings.largeUpcharge).toBe(30);

  const pubSouthSettings = await (await call(request, 'GET', '/api/public/settings?branchId=brn-south')).json();
  expect(pubSouthSettings.vatRate).toBe(0);
  expect(pubSouthSettings.largeUpcharge).toBe(0);

  // 2. Branch 1 closes its store; Branch 2 remains open
  const closeMain = await call(request, 'PUT', '/api/store', mainCookie, { open: false });
  expect(closeMain.status()).toBe(200);
  expect((await closeMain.json()).open).toBe(false);

  expect((await (await call(request, 'GET', '/api/store', southManagerCookie)).json()).open).toBe(true);
  expect((await (await call(request, 'GET', '/api/public/settings?branchId=brn-main')).json()).storeOpen).toBe(false);
  expect((await (await call(request, 'GET', '/api/public/settings?branchId=brn-south')).json()).storeOpen).toBe(true);

  // Customer order to closed Branch 1 is blocked (409), while Branch 2 accepts orders (201)
  const blockedMainOrder = await call(request, 'POST', '/api/public/orders', null, {
    branchId: 'brn-main', customerName: 'Sam', payment: 'cash', lines: [{ menuItemId: 'menu-scone', qty: 1 }],
  });
  expect(blockedMainOrder.status()).toBe(409);

  const allowedSouthOrder = await call(request, 'POST', '/api/public/orders', null, {
    branchId: 'brn-south', customerName: 'Sam', payment: 'cash', lines: [{ menuItemId: 'menu-scone-south', qty: 1 }],
  });
  expect(allowedSouthOrder.status()).toBe(201);

  // Reopen Branch 1
  await call(request, 'PUT', '/api/store', mainCookie, { open: true });

  // 3. Branch 1 uploads a carousel image and a menu image — stored in branch-scoped paths
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const carouselUpload = await request.post(`${server.baseURL}/api/uploads/carousel`, {
    headers: { Cookie: mainCookie },
    multipart: {
      file: { name: 'promo.png', mimeType: 'image/png', buffer: pngBytes },
    },
  });
  expect(carouselUpload.status()).toBe(201);
  const slide = await carouselUpload.json();
  expect(slide.branchId).toBe('brn-main');
  expect(slide.publicUrl).toMatch(/^\/uploads\/carousel\/brn-main\/.+\.png$/);

  // Public carousel for Branch 1 shows the slide; Branch 2 does not
  const mainCarousel = await (await call(request, 'GET', '/api/public/carousel?branchId=brn-main')).json();
  expect(mainCarousel.map(s => s.id)).toEqual([slide.id]);

  const southCarousel = await (await call(request, 'GET', '/api/public/carousel?branchId=brn-south')).json();
  expect(southCarousel).toEqual([]);

  // Branch 2 cannot delete or reposition Branch 1's carousel image
  expect((await call(request, 'DELETE', `/api/carousel/${slide.id}`, southManagerCookie)).status()).toBe(404);
  expect((await call(request, 'PUT', `/api/carousel/${slide.id}/position`, southManagerCookie, { position: 2 })).status()).toBe(404);

  // Branch 1 uploads a menu image — stored under /uploads/menu/brn-main/
  const menuImgUpload = await request.post(`${server.baseURL}/api/menu-items/image`, {
    headers: { Cookie: mainCookie },
    multipart: {
      file: { name: 'drink.png', mimeType: 'image/png', buffer: pngBytes },
    },
  });
  expect(menuImgUpload.status()).toBe(201);
  const menuImg = await menuImgUpload.json();
  expect(menuImg.branchId).toBe('brn-main');
  expect(menuImg.publicUrl).toMatch(/^\/uploads\/menu\/brn-main\/.+\.png$/);
});
