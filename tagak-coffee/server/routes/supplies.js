const express = require('express');
const { randomUUID } = require('crypto');
const { pool, query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { priceAt } = require('../costing');
const { text } = require('../validate');
const { sendDbError } = require('../errors');
const { resolveSessionBranch, sessionOwned } = require('../branchScope');

const ALLOWED_UNITS = ['g', 'kg', 'ml', 'L', 'pcs', 'oz', 'pack', 'btl', 'box'];

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function supplyInput(body) {
  const name = text(body.name);
  const requestedUnit = text(body.unit);
  const unit = requestedUnit === 'pc' ? 'pcs' : requestedUnit;
  const stock = body.stock === undefined ? 0 : body.stock;
  if (!name) return { error: 'Please enter a supply name' };
  if (!unit || !ALLOWED_UNITS.includes(unit)) return { error: 'Please choose a valid unit' };
  if (!isNonNegativeNumber(stock)) return { error: 'Stock must be zero or more' };
  return { value: { name, unit, stock } };
}

async function loadSupplies(where = '', params = []) {
  const { rows: supplies } = await query(
    `SELECT id, name, unit, stock::float8 AS stock, branch_id FROM supplies ${where} ORDER BY name`,
    params,
  );
  const { rows: logs } = await query(
    `SELECT supply_id, price::float8 AS price, effective_at
       FROM supply_price_logs
      WHERE supply_id = ANY($1)
      ORDER BY effective_at`,
    [supplies.map(s => s.id)],
  );
  return supplies.map(supply => {
    const priceLogs = logs
      .filter(l => l.supply_id === supply.id)
      .map(l => ({ price: l.price, effectiveAt: l.effective_at }));
    return {
      id: supply.id,
      name: supply.name,
      unit: supply.unit,
      stock: supply.stock,
      branchId: supply.branch_id || null,
      priceLogs,
      currentPrice: priceLogs.length ? priceLogs[priceLogs.length - 1].price : null,
    };
  });
}

function supplyRoutes() {
  const router = express.Router();

  router.get('/', requireSession({ permission: 'view_supplies' }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      res.json(await loadSupplies(`WHERE ${sessionOwned('$1')}`, [scope.branchId]));
    } catch (err) {
      next(err);
    }
  });

  router.get('/ingredients', requireSession({ permission: ['view_menu', 'view_addons'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const supplies = await loadSupplies(`WHERE ${sessionOwned('$1')}`, [scope.branchId]);
      res.json(supplies.map(({ id, name, unit, currentPrice }) => ({ id, name, unit, currentPrice })));
    } catch (error) { next(error); }
  });

  router.get('/:id', requireSession({ permission: 'view_supplies' }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const [supply] = await loadSupplies(
        `WHERE id = $1 AND ${sessionOwned('$2')}`,
        [req.params.id, scope.branchId],
      );
      if (!supply) return res.status(404).json({ error: 'Supply not found' });
      const at = typeof req.query.at === 'string' ? isoDate(req.query.at) : null;
      if (at) supply.priceAt = priceAt(supply.priceLogs, at);
      res.json(supply);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireSession({ allPermissions: ['view_supplies', 'edit_supplies'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const input = supplyInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });
    const price = req.body.price;
    const effectiveAt = req.body.effectiveAt ? isoDate(req.body.effectiveAt) : new Date().toISOString();
    if (price !== undefined && !isNonNegativeNumber(price)) return res.status(400).json({ error: 'Price must be zero or more' });
    if (!effectiveAt) return res.status(400).json({ error: 'Effective date is not valid' });

    const client = await pool.connect();
    try {
      const id = randomUUID();
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO supplies (id, name, unit, stock, branch_id) VALUES ($1, $2, $3, $4, $5)',
        [id, input.value.name, input.value.unit, input.value.stock, scope.branchId],
      );
      if (price !== undefined) {
        await client.query(
          'INSERT INTO supply_price_logs (supply_id, price, effective_at) VALUES ($1, $2, $3)',
          [id, price, effectiveAt],
        );
      }
      await client.query('COMMIT');
      const [created] = await loadSupplies('WHERE id = $1', [id]);
      res.status(201).json(created);
    } catch (err) {
      await client.query('ROLLBACK');
      sendDbError(res, err, next);
    } finally {
      client.release();
    }
  });

  router.put('/:id', requireSession({ allPermissions: ['view_supplies', 'edit_supplies'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const input = supplyInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });
    try {
      const { rowCount } = await query(
        `UPDATE supplies
            SET name = $2, unit = $3, stock = $4, branch_id = COALESCE(branch_id, $5)
          WHERE id = $1 AND ${sessionOwned('$5')}`,
        [req.params.id, input.value.name, input.value.unit, input.value.stock, scope.branchId],
      );
      if (!rowCount) return res.status(404).json({ error: 'Supply not found' });
      const [updated] = await loadSupplies('WHERE id = $1', [req.params.id]);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requireSession({ allPermissions: ['view_supplies', 'edit_supplies'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const { rowCount } = await query(
        `DELETE FROM supplies WHERE id = $1 AND ${sessionOwned('$2')}`,
        [req.params.id, scope.branchId],
      );
      if (!rowCount) return res.status(404).json({ error: 'Supply not found' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/price-logs', requireSession({ allPermissions: ['view_supplies', 'edit_supplies'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const price = req.body?.price;
    const effectiveAt = isoDate(req.body?.effectiveAt);
    if (!isNonNegativeNumber(price)) return res.status(400).json({ error: 'Price must be zero or more' });
    if (!effectiveAt) return res.status(400).json({ error: 'Effective date is not valid' });
    try {
      const { rows: supCheck } = await query(
        `SELECT 1 FROM supplies WHERE id = $1 AND ${sessionOwned('$2')}`,
        [req.params.id, scope.branchId],
      );
      if (!supCheck[0]) {
        return res.status(404).json({ error: 'Supply not found' });
      }
      const { rows } = await query(
        `INSERT INTO supply_price_logs (supply_id, price, effective_at) VALUES ($1, $2, $3)
         RETURNING price::float8 AS price, effective_at`,
        [req.params.id, price, effectiveAt],
      );
      res.status(201).json({ price: rows[0].price, effectiveAt: rows[0].effective_at });
    } catch (err) {
      sendDbError(res, err, next);
    }
  });

  return router;
}

module.exports = { supplyRoutes, loadSupplies };
