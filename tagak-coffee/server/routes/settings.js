const express = require('express');
const { pool, query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { resolveSessionBranch, resolvePublicBranchId } = require('../branchScope');

const KEYS = ['large_upcharge', 'vat_rate', 'estimated_minutes'];

function validValue(key, value) {
  const number = Number(value);
  if (value === '' || !Number.isFinite(number)) return false;
  if (key === 'vat_rate') return number >= 0 && number <= 1;
  if (key === 'estimated_minutes') return Number.isInteger(number) && number >= 0;
  return number >= 0;
}

async function readSettings(branchId = null, db = { query }) {
  const scope = branchId || '';
  const { rows } = await db.query(
    `SELECT branch_id, key, value
       FROM settings
      WHERE branch_id = '' OR branch_id = $1`,
    [scope],
  );
  const globalValues = {};
  const branchValues = {};
  for (const row of rows) {
    if (row.branch_id === '') globalValues[row.key] = row.value;
    if (row.branch_id === scope) branchValues[row.key] = row.value;
  }
  return Object.fromEntries(KEYS.map(key => [key, branchValues[key] ?? globalValues[key] ?? '']));
}

function settingsRoutes() {
  const router = express.Router();

  router.get('/', requireSession(), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      res.json(await readSettings(scope.branchId));
    } catch (err) {
      next(err);
    }
  });

  router.put('/', requireSession({ allPermissions: ['view_tools', 'edit_tools', 'edit_menu'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const body = req.body || {};
    const entries = Object.entries(body).filter(([key]) => KEYS.includes(key));
    if (entries.some(([key, value]) => !validValue(key, value))) {
      return res.status(400).json({ error: 'One or more settings values are not valid' });
    }

    const branchKey = scope.branchId || '';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of entries) {
        await client.query(
          `INSERT INTO settings (branch_id, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [branchKey, key, String(value)],
        );
      }
      await client.query('COMMIT');
      res.json(await readSettings(scope.branchId));
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  });

  return router;
}

/** The register's open/closed state for a branch (or global fallback). A missing row means open. */
async function isStoreOpen(branchId = null, db = { query }) {
  const scope = branchId || '';
  if (scope) {
    const { rows } = await db.query(
      "SELECT value FROM settings WHERE branch_id = $1 AND key = 'store_open'",
      [scope],
    );
    if (rows[0]) return rows[0].value !== '0';
  }
  const { rows: globalRows } = await db.query(
    "SELECT value FROM settings WHERE branch_id = '' AND key = 'store_open'",
  );
  return !globalRows[0] || globalRows[0].value !== '0';
}

function storeRoutes() {
  const router = express.Router();

  router.get('/', requireSession({ permission: 'access_terminal' }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      res.json({ open: await isStoreOpen(scope.branchId) });
    } catch (err) {
      next(err);
    }
  });

  router.put('/', requireSession({ permission: 'access_terminal' }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    if (typeof req.body?.open !== 'boolean') return res.status(400).json({ error: 'Send open as true or false' });
    const branchKey = scope.branchId || '';
    try {
      await query(
        `INSERT INTO settings (branch_id, key, value) VALUES ($1, 'store_open', $2)
         ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [branchKey, req.body.open ? '1' : '0'],
      );
      res.json({ open: req.body.open });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function publicSettingsRoutes() {
  const router = express.Router();
  router.get('/', async (req, res, next) => {
    try {
      const branchId = await resolvePublicBranchId(req);
      const values = await readSettings(branchId);
      res.json({
        vatRate: Number(values.vat_rate) || 0,
        largeUpcharge: Number(values.large_upcharge) || 0,
        estimatedMinutes: Number(values.estimated_minutes) || 0,
        storeOpen: await isStoreOpen(branchId),
      });
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = { settingsRoutes, publicSettingsRoutes, storeRoutes, isStoreOpen, readSettings };
