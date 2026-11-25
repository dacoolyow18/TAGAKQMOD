const express = require('express');
const { pool, query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { text } = require('../validate');
const { sendDbError } = require('../errors');
const { resolveSessionBranch, resolvePublicBranchId, sessionOwned, publicOwned, ownedBy } = require('../branchScope');

const SCOPES = ['drink', 'pastry'];

function mapAddOn(row) {
  return {
    id: row.id,
    name: row.name,
    appliesTo: row.applies_to,
    price: Number(row.price),
    active: row.active,
    supplies: row.supplies || [],
    branchId: row.branch_id || null,
  };
}

function suppliesInput(body) {
  if (body.supplies === undefined) return { value: undefined };
  if (!Array.isArray(body.supplies)) return { error: 'Send the add-on supplies as a list' };
  for (const line of body.supplies) {
    if (!line || typeof line.supplyId !== 'string' || !line.supplyId
      || typeof line.qty !== 'number' || !(line.qty > 0)) {
      return { error: 'Each add-on supply needs a supply and a quantity above zero' };
    }
  }
  return { value: body.supplies.map(line => ({ supplyId: line.supplyId, qty: line.qty })) };
}

function addOnInput(body) {
  const name = text(body.name);
  const appliesTo = text(body.appliesTo);
  const price = body.price;
  if (!name) return { error: 'Please enter an add-on name' };
  if (!SCOPES.includes(appliesTo)) return { error: 'Add-on must apply to drink or pastry' };
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return { error: 'Price must be zero or more' };
  const supplies = suppliesInput(body);
  if (supplies.error) return supplies;
  return { value: { name, appliesTo, price, active: body.active !== false, supplies: supplies.value } };
}

const SELECT_WITH_SUPPLIES = `
  SELECT a.*, COALESCE(
    json_agg(json_build_object('supplyId', s.supply_id, 'qty', s.qty::float8)) FILTER (WHERE s.supply_id IS NOT NULL),
    '[]'
  ) AS supplies
    FROM add_ons a
    LEFT JOIN add_on_supplies s ON s.add_on_id = a.id`;

async function loadAddOns(where = '', params = []) {
  const { rows } = await query(`${SELECT_WITH_SUPPLIES} ${where} GROUP BY a.id ORDER BY a.applies_to, a.name`, params);
  return rows.map(mapAddOn);
}

async function replaceSupplies(client, addOnId, supplies, branchId = null) {
  if (branchId && supplies.length > 0) {
    const supplyIds = supplies.map(l => l.supplyId);
    const { rows: foreign } = await client.query(
      `SELECT id FROM supplies WHERE id = ANY($1) AND NOT ${ownedBy('$2')}`,
      [supplyIds, branchId],
    );
    if (foreign.length > 0) {
      const err = new Error('Referenced record was not found');
      err.code = '23503';
      throw err;
    }
  }
  await client.query('DELETE FROM add_on_supplies WHERE add_on_id = $1', [addOnId]);
  for (const line of supplies) {
    await client.query(
      'INSERT INTO add_on_supplies (add_on_id, supply_id, qty) VALUES ($1, $2, $3)',
      [addOnId, line.supplyId, line.qty],
    );
  }
}

function addOnRoutes() {
  const router = express.Router();

  router.get('/', requireSession({ permission: ['view_addons', 'access_terminal'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const addons = await loadAddOns(`WHERE ${sessionOwned('$1', 'a.branch_id')}`, [scope.branchId]);
      res.json(req.account.permissions.view_addons ? addons : addons.filter(item => item.active).map(({ supplies, ...item }) => item));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireSession({ allPermissions: ['view_addons', 'edit_addons'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const input = addOnInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });
    if (!input.value.supplies || input.value.supplies.length === 0) {
      return res.status(400).json({ error: 'Connect at least one supply before creating an add-on' });
    }
    const client = await pool.connect();
    try {
      const v = input.value;
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO add_ons (name, applies_to, price, active, branch_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [v.name, v.appliesTo, v.price, v.active, scope.branchId],
      );
      await replaceSupplies(client, rows[0].id, v.supplies, scope.branchId);
      await client.query('COMMIT');
      const [created] = await loadAddOns('WHERE a.id = $1', [rows[0].id]);
      res.status(201).json(created);
    } catch (err) {
      await client.query('ROLLBACK');
      sendDbError(res, err, next);
    } finally {
      client.release();
    }
  });

  router.put('/:id', requireSession({ allPermissions: ['view_addons', 'edit_addons'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const input = addOnInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });
    const client = await pool.connect();
    try {
      const v = input.value;
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE add_ons
            SET name = $2, applies_to = $3, price = $4, active = $5,
                branch_id = COALESCE(branch_id, $6)
          WHERE id = $1 AND ${sessionOwned('$6')}
          RETURNING id`,
        [req.params.id, v.name, v.appliesTo, v.price, v.active, scope.branchId],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Add-on not found' });
      }
      if (v.supplies !== undefined) await replaceSupplies(client, req.params.id, v.supplies, scope.branchId);
      const { rows: linked } = await client.query(
        'SELECT 1 FROM add_on_supplies WHERE add_on_id = $1 LIMIT 1',
        [req.params.id],
      );
      if (v.active && linked.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Connect at least one supply before publishing this add-on' });
      }
      await client.query('COMMIT');
      const [updated] = await loadAddOns('WHERE a.id = $1', [req.params.id]);
      res.json(updated);
    } catch (err) {
      await client.query('ROLLBACK');
      sendDbError(res, err, next);
    } finally {
      client.release();
    }
  });

  router.delete('/:id', requireSession({ allPermissions: ['view_addons', 'edit_addons'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const { rows: used } = await query(
        'SELECT 1 FROM orders, jsonb_array_elements(items) AS line WHERE line->\'addOnIds\' ? $1::text LIMIT 1',
        [req.params.id],
      );
      if (used.length) {
        const { rowCount } = await query(
          `UPDATE add_ons
              SET active = false, branch_id = COALESCE(branch_id, $2)
            WHERE id = $1 AND ${sessionOwned('$2')}`,
          [req.params.id, scope.branchId],
        );
        if (!rowCount) return res.status(404).json({ error: 'Add-on not found' });
        return res.json({ ok: true, deactivated: true });
      }
      const { rowCount } = await query(
        `DELETE FROM add_ons WHERE id = $1 AND ${sessionOwned('$2')}`,
        [req.params.id, scope.branchId],
      );
      if (!rowCount) return res.status(404).json({ error: 'Add-on not found' });
      res.json({ ok: true, deactivated: false });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function publicAddOnRoutes() {
  const router = express.Router();
  router.get('/', async (req, res, next) => {
    try {
      const scope = typeof req.query.appliesTo === 'string' ? req.query.appliesTo : null;
      const branchId = await resolvePublicBranchId(req);
      const { rows } = await query(
        `SELECT * FROM add_ons
          WHERE active
            AND ($1::text IS NULL OR applies_to = $1)
            AND ${publicOwned('$2')}
          ORDER BY applies_to, name`,
        [scope, branchId],
      );
      res.json(rows.map(row => mapAddOn({ ...row, supplies: [] })));
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = { addOnRoutes, publicAddOnRoutes, loadAddOns };
