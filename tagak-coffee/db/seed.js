const path = require('path');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ADMIN_PERMISSIONS = {
  view_orders: true, manage_orders: true, void_orders: true,
  view_analytics: true, export_reports: true,
  view_menu: true, edit_menu: true,
  view_supplies: true, edit_supplies: true,
  view_tools: true, edit_tools: true,
  access_cash_drawer: true,
  view_addons: true, edit_addons: true,
  access_terminal: true,
  manage_users: true, manage_roles: true,
};

const PERMISSION_MATRIX = {
  'Super Admin': ADMIN_PERMISSIONS,
  Admin: ADMIN_PERMISSIONS,
  Manager: {
    ...ADMIN_PERMISSIONS, manage_users: false, manage_roles: false,
  },
  Barista: {
    view_orders: true, manage_orders: false, void_orders: false,
    view_analytics: false, export_reports: false,
    view_menu: false, edit_menu: false,
    view_supplies: false, edit_supplies: false,
    view_tools: false, edit_tools: false,
    access_cash_drawer: false,
    view_addons: false, edit_addons: false,
    access_terminal: true,
    manage_users: false, manage_roles: false,
  },
  Cashier: {
    fulfill_own_offline_orders: true,
    view_orders: true, manage_orders: false, void_orders: false,
    view_analytics: false, export_reports: false,
    view_menu: false, edit_menu: false,
    view_supplies: false, edit_supplies: false,
    view_tools: false, edit_tools: false,
    access_cash_drawer: false,
    view_addons: false, edit_addons: false,
    access_terminal: true,
    manage_users: false, manage_roles: false,
  },
};

async function main() {
  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || '';
  if (!email) throw new Error('SUPER_ADMIN_EMAIL is not set');
  const managed = require('../server/auth/provider').provider() === 'supabase';
  if (!managed && !password) throw new Error('SUPER_ADMIN_PASSWORD is not set');

  const client = new Client(require('./connection').connectionOptions(process.env.DATABASE_URL));
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const [role, permissions] of Object.entries(PERMISSION_MATRIX)) {
      await client.query(
        `INSERT INTO role_permissions (role, permissions) VALUES ($1, $2)
         ON CONFLICT (role) DO NOTHING`,
        [role, JSON.stringify(permissions)],
      );
    }
    const existing = await client.query("SELECT 1 FROM accounts WHERE id = 'super-admin'");
    if (!existing.rowCount) {
      if (!managed) {
        const error = require('../form-validation').passwordError(password);
        if (error) throw new Error('SUPER_ADMIN_PASSWORD: ' + error);
      }
      const passwordHash = managed ? null : await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO accounts (id, name, first_name, middle_initial, last_name, role, email, phone, birthdate, password_hash)
         VALUES ('super-admin', 'Tagak S. Admin', 'Tagak', 'S', 'Admin', 'Super Admin', $1, '09170000000', '1990-01-01', $2)
         ON CONFLICT (id) DO NOTHING`,
        [email, passwordHash],
      );
    }
    await client.query('COMMIT');
    console.log('seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
