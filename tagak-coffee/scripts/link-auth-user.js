const path = require('node:path');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const [accountId, userId] = process.argv.slice(2);
  if (!accountId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId || '')) {
    throw new Error('Usage: node scripts/link-auth-user.js <Tagak account ID> <Supabase Auth user UUID>');
  }
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('Set MIGRATION_DATABASE_URL to the staff database');
  const client = new Client(require('../db/connection').connectionOptions(process.env.MIGRATION_DATABASE_URL));
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE public.accounts a SET auth_user_id = u.id
       FROM auth.users u WHERE a.id = $1 AND u.id = $2::uuid AND a.active
       AND (a.auth_user_id IS NULL OR a.auth_user_id = u.id)
       AND lower(a.email) = lower(u.email) AND u.email_confirmed_at IS NOT NULL
       AND u.deleted_at IS NULL`,
      [accountId, userId],
    );
    if (result.rowCount !== 1) throw new Error('Check the selected IDs, confirmed email, active profile, and existing link');
    console.log('Linked the confirmed identity to the staff profile.');
  } finally {
    await client.end();
  }
}
main().catch(err => { console.error(err.code || err.message); process.exitCode = 1; });
