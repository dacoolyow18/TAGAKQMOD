const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('pg');
const { connectionOptions } = require('./connection');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

// Run on a direct or session connection. This check never changes database state.
async function check(url) {
  const db = new Client(connectionOptions(url));
  await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const migrations = await db.query('SELECT name FROM public.schema_migrations');
    const applied = new Set(migrations.rows.map(row => row.name));
    const missing = fs.readdirSync(path.join(__dirname, 'migrations'))
      .filter(name => name.endsWith('.sql') && !applied.has(name));
    if (missing.length) throw new Error('Missing migrations: ' + missing.join(', '));
    const { rows } = await db.query(`
      SELECT c.relname, c.relrowsecurity,
             ARRAY(SELECT r.rolname::text FROM pg_roles r
                   WHERE r.rolname IN ('anon', 'authenticated')
                     AND (has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
                          OR has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,TRIGGER')))
               AS client_roles
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')`);
    const findings = rows.filter(row => !row.relrowsecurity || row.client_roles.length);
    if (findings.length) throw new Error('Review RLS or browser grants: ' + findings.map(r => r.relname).join(', '));
    console.log('All local migration filenames are recorded. Checked RLS and browser grants on ' + rows.length + ' public relations.');
  } finally {
    await db.end();
  }
}

if (require.main === module) check(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL)
  .catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { check };

