const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('The selected migration connection is not configured');

  // Check before applying any part of the upgrade to a database with existing staff.
  if (!/^[0-9a-f]{64}$/i.test(process.env.PIN_HMAC_KEY || '')) {
    throw new Error('Configure a persistent 32-byte hex PIN_HMAC_KEY before migrating');
  }

  const client = new Client(require('./connection').connectionOptions(url));
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('tagak-schema-migrations', 0))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort();
    for (const file of files) {
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (rowCount) continue;

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        if (file === '018_staff_pin_verifiers.sql') {
          const { pinDigest } = require('../server/auth/pin');
          const { rows } = await client.query('SELECT id, pin_digest FROM accounts WHERE pin_digest IS NOT NULL');
          for (const row of rows) {
            await client.query('UPDATE accounts SET pin_digest=$1 WHERE id=$2', [pinDigest(row.pin_digest), row.id]);
          }
          await client.query('ALTER TABLE accounts VALIDATE CONSTRAINT accounts_pin_digest_check');
        }
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  migrate(process.argv.includes('--direct') ? process.env.MIGRATION_DATABASE_URL || null : process.env.DATABASE_URL).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { migrate };
