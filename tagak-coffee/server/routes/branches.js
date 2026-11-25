const { accountLocks } = require('../middleware/rateLimit');
const express = require('express');
const { randomUUID } = require('crypto');
const { query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { mapBranch, mapAccount } = require('../mappers');
const { ADMIN_ROLES, EMPLOYEE_ROLES, text } = require('../validate');
const { sendDbError } = require('../errors');
const { validCode, branchError } = require('../../form-validation');

function branchInput(body) {
  const code = body.code;
  const name = text(body.name);
  const location = text(body.location);
  const managerId = text(body.managerId) || null;
  if (!validCode(code)) return { error: branchError };
  if (name.length > 120 || location.length > 250) return { error: 'Branch details are too long' };
  if (!name) return { error: 'Please enter the exact branch name' };
  return { value: { code, name, location, managerId } };
}

function branchRoutes() {
  const router = express.Router();
  router.get('/', requireSession(), async (req, res, next) => {
    try {
      const { rows: branches } = await query(
        'SELECT * FROM branches WHERE ($1::text IS NULL OR id = $1) ORDER BY code',
        [req.account.branchId || null],
      );
      if (req.query.include !== 'employees') return res.json(branches.map(mapBranch));

      if (!ADMIN_ROLES.includes(req.account.role) || req.account.permissions.manage_users !== true) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { rows: employees } = await query(
        `SELECT accounts.*, ${accountLocks} FROM accounts WHERE role = ANY($1) ORDER BY name`,
        [EMPLOYEE_ROLES],
      );
      res.json(branches.map(branch => ({
        ...mapBranch(branch),
        employees: employees.filter(e => e.branch_id === branch.id).map(mapAccount),
      })));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireSession({ roles: ADMIN_ROLES, permission: 'manage_users' }), async (req, res, next) => {
    const input = branchInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });
    try {
      const { rows } = await query(
        `INSERT INTO branches (id, code, name, location, manager_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [randomUUID(), input.value.code, input.value.name, input.value.location, input.value.managerId],
      );
      res.status(201).json(mapBranch(rows[0]));
    } catch (err) {
      sendDbError(res, err, next);
    }
  });

  router.put('/:id', requireSession({ roles: ADMIN_ROLES, permission: 'manage_users' }), async (req, res, next) => {
    const input = branchInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });
    try {
      const { rows } = await query(
        `UPDATE branches SET code = $2, name = $3, location = $4, manager_id = $5
          WHERE id = $1 RETURNING *`,
        [req.params.id, input.value.code, input.value.name, input.value.location, input.value.managerId],
      );
      if (!rows[0]) return res.status(404).json({ error: 'Branch not found' });
      res.json(mapBranch(rows[0]));
    } catch (err) {
      sendDbError(res, err, next);
    }
  });

  router.delete('/:id', requireSession({ roles: ADMIN_ROLES, permission: 'manage_users' }), async (req, res, next) => {
    try {
      const { rows: employees } = await query(
        'SELECT count(*)::int AS n FROM accounts WHERE branch_id = $1',
        [req.params.id],
      );
      if (employees[0].n > 0) {
        return res.status(409).json({ error: 'Move or remove this branch’s employees first' });
      }
      const { rowCount } = await query('DELETE FROM branches WHERE id = $1', [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: 'Branch not found' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function publicBranchRoutes() {
  const router = express.Router();
  router.get('/', async (req, res, next) => {
    try {
      if (req.query.code !== undefined) {
        if (!validCode(req.query.code)) return res.status(400).json({ error: branchError });
        const { rows } = await query('SELECT * FROM branches WHERE code=$1', [req.query.code]);
        return res.json(rows.map(mapBranch));
      }
      const { rows } = await query('SELECT * FROM branches ORDER BY code');
      res.json(rows.map(mapBranch));
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = { branchRoutes, publicBranchRoutes };
