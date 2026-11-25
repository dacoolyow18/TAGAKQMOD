const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';
const CAROUSEL_DIR = path.join(__dirname, '..', '..', 'server', 'uploads', 'carousel');
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let server;
let superCookie;
let cashierCookie;

async function cookieFrom(res) {
  const header = res.headers()['set-cookie'] || '';
  return `tagak_session=${header.match(/tagak_session=([^;]+)/)[1]}`;
}

function upload(request, cookie, name, mimeType, buffer) {
  return request.post(`${server.baseURL}/api/uploads/carousel`, {
    headers: cookie ? { Cookie: cookie } : {},
    multipart: { file: { name, mimeType, buffer } },
  });
}

async function clearCarousel(request) {
  const list = await (await request.get(`${server.baseURL}/api/public/carousel`)).json();
  for (const item of list) {
    await request.fetch(`${server.baseURL}/api/carousel/${item.id}`, { method: 'DELETE', headers: { Cookie: superCookie } });
  }
}

function filesOnDisk() {
  return fs.existsSync(CAROUSEL_DIR) ? fs.readdirSync(CAROUSEL_DIR) : [];
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
  if (fs.existsSync(CAROUSEL_DIR)) fs.rmSync(CAROUSEL_DIR, { recursive: true, force: true });
});

test.afterAll(async () => {
  await server?.close();
});

test('a Cashier cannot upload carousel images (403)', async ({ request }) => {
  const res = await upload(request, cashierCookie, 'a.png', 'image/png', PNG_1PX);
  expect(res.status()).toBe(403);
});

test('a text file is rejected with 415 and nothing is left on disk', async ({ request }) => {
  const before = filesOnDisk().length;
  const res = await upload(request, superCookie, 'notes.txt', 'text/plain', Buffer.from('hello'));
  expect(res.status()).toBe(415);
  expect(filesOnDisk().length).toBe(before);
});

test('a file over 5 MB is rejected with 413', async ({ request }) => {
  const big = Buffer.alloc(6 * 1024 * 1024, 1);
  const res = await upload(request, superCookie, 'big.png', 'image/png', big);
  expect(res.status()).toBe(413);
});

test('declaring a text file as PNG does not publish it', async ({ request }) => {
  const res = await upload(request, superCookie, 'latte.png', 'image/png', Buffer.from('plain text'));
  expect(res.status()).toBe(415);
});

test('a real PNG is saved, listed for customers, and served at its public URL', async ({ request }) => {
  const res = await upload(request, superCookie, 'latte.png', 'image/png', PNG_1PX);
  expect(res.status()).toBe(201);
  const created = await res.json();
  expect(created.publicUrl).toMatch(/^\/uploads\/carousel\/[0-9a-f-]+\.png$/);
  expect(created.position).toBe(1);

  const list = await (await request.get(`${server.baseURL}/api/public/carousel`)).json();
  expect(list.map(i => i.id)).toContain(created.id);

  const file = await request.get(`${server.baseURL}${created.publicUrl}`);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toContain('image/png');
});

test('at most five images are allowed, and a sixth is rejected with 409', async ({ request }) => {
  await clearCarousel(request);
  for (let i = 0; i < 5; i++) {
    const res = await upload(request, superCookie, `item${i}.png`, 'image/png', PNG_1PX);
    expect(res.status()).toBe(201);
  }
  const before = filesOnDisk().length;
  const sixth = await upload(request, superCookie, 'sixth.png', 'image/png', PNG_1PX);
  expect(sixth.status()).toBe(409);
  expect(filesOnDisk().length).toBe(before);
});

test('an image can move to an unused position and the public list follows the order', async ({ request }) => {
  await clearCarousel(request);
  const first = await (await upload(request, superCookie, 'first.png', 'image/png', PNG_1PX)).json();
  const second = await (await upload(request, superCookie, 'second.png', 'image/png', PNG_1PX)).json();

  const moved = await request.fetch(`${server.baseURL}/api/carousel/${first.id}/position`, {
    method: 'PUT',
    headers: { Cookie: superCookie, 'Content-Type': 'application/json' },
    data: { position: 4 },
  });
  expect(moved.status()).toBe(200);

  const list = await (await request.get(`${server.baseURL}/api/public/carousel`)).json();
  expect(list.map(i => i.id)).toEqual([second.id, first.id]);

  const clash = await request.fetch(`${server.baseURL}/api/carousel/${second.id}/position`, {
    method: 'PUT',
    headers: { Cookie: superCookie, 'Content-Type': 'application/json' },
    data: { position: 4 },
  });
  expect(clash.status()).toBe(409);
});

test('a deleted image is removed from the list and from disk', async ({ request }) => {
  await clearCarousel(request);
  const created = await (await upload(request, superCookie, 'gone.png', 'image/png', PNG_1PX)).json();
  const target = { id: created.id, publicUrl: created.publicUrl };
  const res = await request.fetch(`${server.baseURL}/api/carousel/${target.id}`, {
    method: 'DELETE', headers: { Cookie: superCookie },
  });
  expect(res.status()).toBe(200);
  const after = await (await request.get(`${server.baseURL}/api/public/carousel`)).json();
  expect(after.map(i => i.id)).not.toContain(target.id);
  expect(filesOnDisk()).not.toContain(path.basename(target.publicUrl));
});
