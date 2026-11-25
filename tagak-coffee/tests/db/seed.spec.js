const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const DATABASE_URL = require('../test-database');
const ROOT = path.join(__dirname, '..', '..');
const SEED_ENV = {
  ...process.env,
  DATABASE_URL,
  SUPER_ADMIN_EMAIL: 'seed-super@tagak.test',
  SUPER_ADMIN_PASSWORD: 'Seed-pass-123',
};

async function withClient(fn) {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

function run(script) {
  execFileSync(process.execPath, [script], { cwd: ROOT, env: SEED_ENV, stdio: 'pipe' });
}

test('seed creates only the Super Admin and permissions, and can run twice', async () => {
  await withClient(c => c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'));
  run('db/migrate.js');
  run('db/seed.js');
  run('db/seed.js');

  const result = await withClient(async c => {
    const admins = await c.query("SELECT email, role FROM accounts WHERE role = 'Super Admin'");
    const perms = await c.query('SELECT count(*)::int AS n FROM role_permissions');
    const menu = await c.query('SELECT count(*)::int AS n FROM menu_items');
    const addOns = await c.query('SELECT count(*)::int AS n FROM add_ons');
    const orders = await c.query('SELECT count(*)::int AS n FROM orders');
    const branches = await c.query('SELECT count(*)::int AS n FROM branches');
    return {
      admins: admins.rows,
      permissionRows: perms.rows[0].n,
      menu: menu.rows[0].n,
      addOns: addOns.rows[0].n,
      orders: orders.rows[0].n,
      branches: branches.rows[0].n,
    };
  });

  expect(result.admins).toEqual([{ email: 'seed-super@tagak.test', role: 'Super Admin' }]);
  expect(result.permissionRows).toBe(5);
  expect(result.menu).toBe(0);
  expect(result.addOns).toBe(0);
  expect(result.orders).toBe(0);
  expect(result.branches).toBe(0);
});

test('seed refuses to run without a Super Admin password', async () => {
  const env = { ...SEED_ENV, SUPER_ADMIN_PASSWORD: '' };
  expect(() => execFileSync(process.execPath, ['db/seed.js'], { cwd: ROOT, env, stdio: 'pipe' })).toThrow();
});
