const express = require('express');
const { PERMISSION_DEFS } = require('../../admin-app/js/permissions');
const toggleKeys = new Set(PERMISSION_DEFS.map(permission => permission.key));
const { pool, query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { ADMIN_ROLES, ALL_ROLES } = require('../validate');

function validMatrix(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Send a permission matrix object';
  for (const [role, perms] of Object.entries(body)) {
    if (!ALL_ROLES.includes(role)) return `Unknown role: ${role}`;
    if (!perms || typeof perms !== 'object' || Array.isArray(perms)) return `Permissions for ${role} must be an object`;
    if (Object.keys(perms).some(key => !toggleKeys.has(key) && key !== 'fulfill_own_offline_orders')) return 'Unknown permission';
    if (!ADMIN_ROLES.includes(role) && (perms.manage_users || perms.manage_roles)) return 'Admin permissions require an Admin role';
    if (Object.values(perms).some(value => typeof value !== 'boolean')) return `Permissions for ${role} must be true or false`;
  }
  if (body['Super Admin'] && Object.values(body['Super Admin']).some(value => value !== true)) {
    return 'The Super Admin must keep every permission enabled';
  }
  return null;
}

function sameRow(sent, stored) {
  const keys = new Set([...Object.keys(sent), ...Object.keys(stored)]);
  return [...keys].every(key => Boolean(sent[key]) === Boolean(stored[key]));
}

async function protectedRoleChanged(body) {
  const { rows } = await query('SELECT role, permissions FROM role_permissions WHERE role = ANY($1)', [ADMIN_ROLES]);
  return rows.some(row => body[row.role] !== undefined && !sameRow(body[row.role], row.permissions));
}

function permissionsRoutes() {
  const router = express.Router();

  router.get('/', requireSession({ roles: ADMIN_ROLES, permission: 'manage_roles' }), async (req, res, next) => {
    try {
      const { rows } = await query('SELECT role, permissions FROM role_permissions');
      res.json(Object.fromEntries(rows.map(row => [row.role, row.permissions])));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/', requireSession({ roles: ADMIN_ROLES, permission: 'manage_roles' }), async (req, res, next) => {
    const { role, key, enabled } = req.body || {};
    if (!ALL_ROLES.includes(role) || !toggleKeys.has(key) || typeof enabled !== 'boolean') return res.sendStatus(400);
    if (role === 'Super Admin' || (role === 'Admin' && req.account.role !== 'Super Admin')) return res.sendStatus(403);
    if (enabled && ['manage_users', 'manage_roles'].includes(key) && !ADMIN_ROLES.includes(role)) return res.sendStatus(403);
    try {
      const result = await query(
        'UPDATE role_permissions SET permissions = jsonb_set(permissions, ARRAY[$2], to_jsonb($3::boolean)) WHERE role = $1',
        [role, key, enabled],
      );
      res.sendStatus(result.rowCount ? 204 : 400);
    } catch (err) { next(err); }
  });

  router.put('/', requireSession({ roles: ADMIN_ROLES, permission: 'manage_roles' }), async (req, res, next) => {
    const error = validMatrix(req.body);
    if (error) return res.status(400).json({ error });
    try {
      if (req.account.role !== 'Super Admin' && await protectedRoleChanged(req.body)) {
        return res.status(403).json({ error: 'Only Super Admins can change Admin or Super Admin permissions' });
      }
    } catch (err) {
      return next(err);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [role, permissions] of Object.entries(req.body)) {
        if (role === 'Super Admin' || (role === 'Admin' && req.account.role !== 'Super Admin')) continue;
        await client.query(
          `INSERT INTO role_permissions (role, permissions) VALUES ($1, $2)
           ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions`,
          [role, JSON.stringify(permissions)],
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = { permissionsRoutes };
