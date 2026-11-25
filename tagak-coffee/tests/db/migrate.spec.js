const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const DATABASE_URL = require('../test-database');
const ROOT = path.join(__dirname, '..', '..');
const TABLES = [
  'branches', 'accounts', 'role_permissions', 'sessions', 'menu_items', 'menu_item_recipes',
  'supplies', 'supply_price_logs', 'add_ons', 'cash_logs', 'carousel_images', 'settings',
  'ticket_counters', 'orders', 'schema_migrations',
];

async function withClient(fn) {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

function migrate() {
  execFileSync(process.execPath, ['db/migrate.js'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  });
}

test('migrations create every table and can run twice', async () => {
  await withClient(c => c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'));
  migrate();
  migrate();

  const tables = await withClient(async c => {
    const { rows } = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    return rows.map(r => r.table_name);
  });
  for (const table of TABLES) expect(tables).toContain(table);

  const applied = await withClient(async c => {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM schema_migrations');
    return rows[0].n;
  });
  const files = require('node:fs').readdirSync(path.join(ROOT, 'db', 'migrations')).filter(f => f.endsWith('.sql'));
  expect(applied).toBe(files.length);
  await require('../../db/check-security').check(DATABASE_URL);
});

test('phone migration preserves conflicting records and can be retried after verified corrections', async () => {
  await withClient(c => c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'));
  migrate();
  await withClient(async c => {
    await c.query('BEGIN');
    try {
      await c.query('ALTER TABLE accounts DROP CONSTRAINT accounts_phone_key, DROP CONSTRAINT accounts_phone_format');
      await c.query(`INSERT INTO accounts (id,name,role,phone) VALUES
        ('old-one','One','Admin','09170000001'), ('old-two','Two','Cashier','09170000001'), ('old-three','Three','Manager','123')`);
      const migration = require('fs').readFileSync(path.join(ROOT, 'db/migrations/023_unique_account_phones.sql'), 'utf8');
      await c.query('SAVEPOINT audit');
      await expect(c.query(migration)).rejects.toThrow('1 duplicate phone groups, 1 invalid numbers');
      await c.query('ROLLBACK TO audit');
      expect((await c.query('SELECT phone FROM accounts ORDER BY id')).rows.map(row => row.phone))
        .toEqual(['09170000001','123','09170000001']);
      await c.query("UPDATE accounts SET phone='09170000002' WHERE id='old-two'");
      await c.query("UPDATE accounts SET phone='09170000003' WHERE id='old-three'");
      await c.query(migration);
      await expect(c.query("UPDATE accounts SET phone='09170000001' WHERE id='old-two'")).rejects.toMatchObject({ code: '23505' });
      await c.query('ROLLBACK TO audit');
      await c.query("DELETE FROM accounts WHERE id IN ('old-two','old-three')");
      await c.query(migration);
      await expect(c.query("UPDATE accounts SET phone='123' WHERE id='old-one'")).rejects.toMatchObject({ code: '23514' });
    } finally { await c.query('ROLLBACK'); }
  });
});
