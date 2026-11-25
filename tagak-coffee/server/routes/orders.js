const crypto = require('node:crypto');
const { text } = require('../validate');
const { recordStateTransition } = require('../orders');
const express = require('express');
const { streamOrders, notifyOrder } = require('../orderEvents');
const { expireCash } = require('../cashExpiry');
const { startCheckout } = require('../xendit');
const { pool, query, withTransaction } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { createOrder, mapOrder, STATUSES, recipeUsage, moveStock } = require('../orders');
const { ORDER_COLUMNS, loadOrder, sendOrderError } = require('./publicOrders');

const { loadSupplies } = require('./supplies');
const { loadAddOns } = require('./addOns');
const { sessionOwned, resolveSessionBranch } = require('../branchScope');
const { calculateItemSales, summarizeSales } = require('../../pos-app/js/data');

const OPEN_STATUSES = ['held', 'queued', 'brewing', 'ready'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function computeOfflineOrderDigest(payload) {
  const canonical = JSON.stringify({
    idempotencyKey: payload.idempotencyKey || '',
    branchId: payload.branchId || '',
    payment: payload.payment || '',
    orderMode: payload.orderMode || 'dine-in',
    pwdDiscount: Boolean(payload.pwdDiscount),
    lines: (payload.lines || []).map(l => ({
      menuItemId: l.menuItemId,
      qty: l.qty,
      size: l.size || null,
      temperature: l.temperature || null,
      addOnIds: (l.addOnIds || []).slice().sort(),
    })),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function orderRoutes() {
  const router = express.Router();
  async function analytics(req, res, next) {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const { from, to } = req.query;
    if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return res.sendStatus(400);
    try {
      const { rows } = await query(
        `SELECT subtotal, vat, total, items, time_in, time_out FROM orders
          WHERE status = 'completed' AND ($1::text IS NULL OR branch_id = $1)
            AND (COALESCE(time_out, time_in) AT TIME ZONE 'Asia/Manila')::date BETWEEN $2::date AND $3::date`,
        [scope.branchId, from, to],
      );
      const params = [scope.branchId];
      const [menu, lines, supplies, addons] = await Promise.all([
        query(`SELECT id,name,category,price::float8 FROM menu_items WHERE ${sessionOwned('$1')} ORDER BY category,name`, params),
        query(`SELECT r.menu_item_id, r.supply_id, r.qty::float8, r.large_qty::float8 FROM menu_item_recipes r
          JOIN menu_items m ON m.id=r.menu_item_id WHERE ${sessionOwned('$1', 'm.branch_id')}`, params),
        loadSupplies(`WHERE ${sessionOwned('$1')}`, params),
        loadAddOns(`WHERE ${sessionOwned('$1', 'a.branch_id')}`, params),
      ]);
      const recipes = Object.create(null);
      for (const line of lines.rows) {
        (recipes[line.menu_item_id] ||= []).push({ supplyId: line.supply_id, qty: line.qty, largeQty: line.large_qty });
      }
      const costs = supplies.map(item => ({ ...item, priceLogs: item.priceLogs.map(log => ({ price: log.price, date: log.effectiveAt })) }));
      const orders = rows.map(mapOrder);
      const items = calculateItemSales(orders, menu.rows, recipes, costs, addons);
      res.set('Cache-Control', 'private, no-store');
      if (req.path === '/report-export') {
        const { rows: cashLogs } = await query(
          `SELECT type, amount::float8, reason, created_at AS timestamp FROM cash_logs
            WHERE ($1::text IS NULL OR branch_id=$1) AND
              (created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $2::date AND $3::date ORDER BY created_at DESC,id DESC`,
          [scope.branchId, from, to],
        );
        const branch = scope.branchId && (await query('SELECT name FROM branches WHERE id=$1', params)).rows[0];
        const report = { rows: items, summary: summarizeSales(items, orders.length, cashLogs), cashLogs,
          branchName: branch?.name || 'All Branches', preparedBy: req.account.name, reportStartISO: from, reportEndISO: to };
        const { renderPdf, renderPrintable } = require('../salesReport');
        let pdf;
        try { pdf = renderPdf(report); }
        catch { return res.type('html').send(renderPrintable(report)); }
        return res.attachment('Tagak_Sales_Report_' + from + '_to_' + to + '.pdf').send(pdf);
      }
      res.json({
        items: items.filter(item => item.sold > 0),
        sales: orders.map(({ total, timeOut, timeIn }) => ({ total, timeOut, timeIn })),
      });
    } catch (error) { next(error); }
  }
  router.get('/analytics', requireSession({ permission: 'view_analytics' }), analytics);
  router.get('/report-export', requireSession({ allPermissions: ['view_analytics', 'export_reports'] }), analytics);

  router.get('/events', requireSession({ permission: 'view_orders' }), streamOrders);

  router.get('/', requireSession({ permission: 'view_orders' }), async (req, res, next) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    const ranged = DATE_PATTERN.test(from) && DATE_PATTERN.test(to);
    try {
      const conditions = [];
      const params = [];
      if (status === 'open') {
        params.push(OPEN_STATUSES);
        conditions.push(`status = ANY($${params.length})`);
      } else if (status) {
        if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown order status' });
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }
      if (req.account.branchId) {
        params.push(req.account.branchId);
        conditions.push(`branch_id = $${params.length}`);
      }
      if (ranged) {
        params.push(from, to);
        conditions.push(`(COALESCE(time_out, time_in) AT TIME ZONE 'Asia/Manila')::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
      }
      const voidHistory = status === 'cancelled' && !ranged;
      if (voidHistory && req.query.before) {
        if (typeof req.query.before !== 'string' || req.query.before.length > 64) return res.sendStatus(400);
        params.push(req.query.before, req.account.branchId || null);
        conditions.push(`(COALESCE(time_out,time_in),ticket_no) < (
          SELECT COALESCE(time_out,time_in),ticket_no FROM orders WHERE ticket_no=$${params.length - 1}
          AND status='cancelled' AND ($${params.length}::text IS NULL OR branch_id=$${params.length}))`);
      }
      const sort = voidHistory ? 'COALESCE(time_out,time_in) DESC, ticket_no DESC' : 'time_in DESC';
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = ranged ? '' : voidHistory ? 'LIMIT 201' : 'LIMIT 200';
      const { rows } = await query(
        `SELECT ${ORDER_COLUMNS}, channel, cash_collected_at,
           (SELECT name FROM accounts WHERE id=orders.cash_collected_by) AS collector_name
           FROM orders ${where} ORDER BY ${sort} ${limit}`,
        params,
      );
      if (voidHistory && rows.length > 200) {
        rows.pop();
        res.set('X-Next-Void-Cursor', rows.at(-1).ticket_no);
      }
      res.json(rows.map(row => ({
        ...mapOrder(row),
        cashCollectedAt: row.cash_collected_at,
        cashCollectorName: row.collector_name,
      })));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireSession({ permission: 'access_terminal' }), async (req, res, next) => {
    if (req.body?.posCash) {
      try {
        const ack = await withTransaction(client => require('../offlinePos').sale(client,req.account,req.body.posCash,true));
        return res.status(201).json(ack);
      } catch (error) {
        if (error.status === 403) return res.status(403).json({ error:error.message });
        return sendOrderError(res,error,next);
      }
    }
    if (req.account.branchId && req.body?.branchId !== req.account.branchId) {
      return res.status(403).json({ error: 'You can only place orders for your branch' });
    }
    try {
      const options = { body: req.body || {}, retryKey: req.get('Idempotency-Key'), actorId: req.account.id };
      const qr = options.body.payment === 'qr';
      const order = qr ? await startCheckout(options) : await withTransaction(client => createOrder(client, options));
      res.status(qr ? 202 : 201).json(order);
    } catch (err) {
      sendOrderError(res, err, next);
    }
  });

  router.post('/sync', requireSession({ permission: 'access_terminal' }), async (req, res, next) => {
    const queuedOrders = Array.isArray(req.body?.orders) ? req.body.orders : [];
    if (queuedOrders.length === 0) {
      return res.json({ synced: [], rejected: [] });
    }
    // Older clients discard rejected entries on a 200 response. Preserve the whole batch for review.
    if (queuedOrders.some(item => !Array.isArray(item?.lines) || item.lines.some(line => !line || (line.addOnIds && !Array.isArray(line.addOnIds))) || !item || item.payment !== 'cash' || !item.idempotencyKey || !item.offlineSignature ||
        !item.branchId || (req.account.branchId && item.branchId !== req.account.branchId))) {
      return res.status(409).json({error: 'Legacy receipts require register reconciliation'});
    }
    const synced = [];
    const rejected = [];

    for (const item of queuedOrders) {
      if (req.account.branchId && item?.branchId && item.branchId !== req.account.branchId) {
        rejected.push({ idempotencyKey: item?.idempotencyKey, error: 'Branch mismatch' });
        continue;
      }
      // Verify cryptographic digest if provided by the POS offline queue
      if (item?.offlineSignature) {
        const expectedDigest = computeOfflineOrderDigest(item);
        if (item.offlineSignature !== expectedDigest) {
          try {
            await query(
              `INSERT INTO audit_events (branch_id, event_type, cashier_id, amount, details)
               VALUES ($1, 'offline_tamper_rejected', $2, $3, $4)`,
              [item.branchId || req.account.branchId || null, req.account.id, Number(item.clientTotal) || 0, `Signature mismatch for offline order ${item.idempotencyKey || 'unknown'}`],
            );
          } catch (_) { /* ignore */ }
          rejected.push({ idempotencyKey: item?.idempotencyKey, error: 'Cryptographic signature verification failed (tampered payload)' });
          continue;
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [item.idempotencyKey]);
        const existing = await client.query(`SELECT ${ORDER_COLUMNS}, offline_signature FROM orders WHERE idempotency_key=$1`, [item.idempotencyKey]);
        if (existing.rows.length) {
          const row = existing.rows[0];
          if (row.branch_id !== item.branchId || row.offline_signature !== item.offlineSignature) throw Error('Receipt does not match stored sale');
          await client.query('COMMIT');
          synced.push({idempotencyKey:item.idempotencyKey, order:mapOrder(row)});
          continue;
        }
        const created = await createOrder(client, {
          body: item,
          channel: 'pos',
          actorId: req.account.id,
        });
        if (item.clientTotal != null && Number(item.clientTotal) !== created.total) throw Error('Legacy receipt total differs from current catalog');
        await client.query('UPDATE orders SET idempotency_key=$1, offline_signature=$2 WHERE ticket_no=$3', [item.idempotencyKey,item.offlineSignature,created.ticketNo]);
        await client.query(
          `INSERT INTO audit_events (branch_id, ticket_no, event_type, cashier_id, amount, details)
           VALUES ($1, $2, 'offline_sync_verified', $3, $4, $5)`,
          [created.branchId, created.ticketNo, req.account.id, created.total, `Synced idempotent offline order (${item.idempotencyKey || created.ticketNo})`],
        );
        await client.query('COMMIT');
        synced.push({ idempotencyKey: item.idempotencyKey || null, order: created });
      } catch (err) {
        await client.query('ROLLBACK');
        rejected.push({ idempotencyKey: item?.idempotencyKey || null, error: err.message });
      } finally {
        client.release();
      }
    }

    res.status(rejected.length ? 409 : 200).json({ synced, rejected });
  });

  router.post('/:ticketNo/collect-cash', requireSession({
    roles: ['Cashier', 'Manager'], allPermissions: ['access_terminal', 'view_orders'],
  }), async (req, res, next) => {
    try {
      const result = await withTransaction(async client => {
        const { rows: [order] } = await client.query(
          `SELECT ${ORDER_COLUMNS} FROM orders WHERE ticket_no=$1 AND branch_id=$2 FOR UPDATE`,
          [req.params.ticketNo, req.account.branchId]);
        if (!order) return { status: 404, error: 'Order not found' };
        if (order.payment !== 'cash' || order.status === 'cancelled') return { status: 409, error: 'Cash cannot be collected for this ticket' };
        if (order.payment_status === 'paid') return { order: mapOrder(order) };
        if (order.status === 'completed') return { status: 409, error: 'Ticket already closed' };
        const collected = await client.query(
          "UPDATE orders SET payment_status='paid', cash_collected_by=$2, cash_collected_at=clock_timestamp() WHERE ticket_no=$1 AND (cash_due_at IS NULL OR cash_due_at > clock_timestamp())",
          [order.ticket_no, req.account.id]);
        if (!collected.rowCount) {
          await expireCash(client, order.ticket_no);
          return { status: 409, error: 'Cash payment time expired. Order voided.' };
        }
        await notifyOrder(client, order.ticket_no, order.branch_id);
        return { order: mapOrder({ ...order, payment_status: 'paid' }) };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.json(result.order);
    } catch (err) { next(err); }
  });

  router.patch('/:ticketNo', requireSession({ allPermissions: ['view_orders', 'manage_orders'] }), async (req, res, next) => {
    const status = req.body?.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown order status' });
    if (['cancelled','refunded'].includes(status) && req.account.permissions.void_orders !== true) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const voidReason = text(req.body?.voidReason || req.body?.reason);
    const managerPin = text(req.body?.managerPin);
    const spotAuditTriggered = Boolean(req.body?.spotAuditTriggered);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT total, status, payment, payment_status, items, supply_usage, branch_id FROM orders
          WHERE ticket_no = $1 AND ($2::text IS NULL OR branch_id = $2) FOR UPDATE`,
        [req.params.ticketNo, req.account.branchId || null],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found' });
      }
      const current = rows[0];
      if ((status === 'refunded' && (current.status !== 'completed' || current.payment !== 'cash')) || (current.status === 'refunded' && status !== 'refunded')) {
        await client.query('ROLLBACK'); return res.status(409).json({error:'Invalid refund transition'});
      }
      if (current.payment_status === 'unpaid' && current.status === 'queued' && status === 'cancelled') {
        if ((await expireCash(client, req.params.ticketNo)).rowCount) current.status = 'cancelled';
      }
      if (current.status === 'cancelled' && status === 'cancelled') {
        const order = await loadOrder(req.params.ticketNo, client);
        await client.query('COMMIT');
        return res.json(order);
      }
      if (current.payment === 'cash' && current.payment_status !== 'paid' && ['brewing','ready','completed'].includes(status) && current.status !== status) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Confirm cash collection before advancing this ticket' });
      }
      if (current.status === 'cancelled' && status !== 'cancelled') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Cancelled orders cannot be reopened' });
      }
      if (current.status === 'completed' && status !== 'completed' && status !== 'cancelled' && status !== 'refunded') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Completed orders can only be voided' });
      }
      let approvedBy = req.account.id;
      if (managerPin) {
        const mgrRes = await client.query(
          `SELECT id, name FROM accounts WHERE pin_digest = $1 AND branch_id=$2 AND role IN ('Super Admin', 'Admin', 'Manager') AND active`,
          [require('../auth/pin').pinDigest(managerPin), current.branch_id],
        );
        if (!mgrRes.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Invalid Manager Override PIN for void/refund authorization' });
        }
        approvedBy = mgrRes.rows[0].id;
      }

      let usage = current.supply_usage || {};
      if (current.status === 'completed' && status !== 'completed') {
        await moveStock(client, usage, 1);
        usage = {};
      } else if (current.status !== 'completed' && status === 'completed') {
        usage = await require('../offlinePos').importedUsage(client, req.params.ticketNo, current.branch_id, current.items);
        if (usage === undefined) {
          usage = await recipeUsage(client, current.items);
          await moveStock(client, usage, -1);
        }
      }

      const terminal = status === 'completed' || status === 'cancelled' || status === 'refunded';
      const isBrewing = status === 'brewing';
      const isReady = status === 'ready';

      await client.query(
        `UPDATE orders
            SET status = $2,
                time_out = CASE WHEN $2='cancelled' THEN clock_timestamp() WHEN $3 THEN COALESCE(time_out, now()) ELSE NULL END,
                brewing_at = CASE WHEN $4 THEN COALESCE(brewing_at, now()) ELSE brewing_at END,
                ready_at = CASE WHEN $5 THEN COALESCE(ready_at, now()) ELSE ready_at END,
                supply_usage = $6,
                void_reason = CASE WHEN $7 <> '' THEN $7 ELSE void_reason END,
                approved_by = COALESCE($8, approved_by)
          WHERE ticket_no = $1`,
        [
          req.params.ticketNo,
          status,
          terminal,
          isBrewing,
          isReady,
          JSON.stringify(usage),
          voidReason,
          status === 'cancelled' || status === 'refunded' ? approvedBy : null,
        ],
      );

      // Record DTMC state transition (Module 5)
      if (current.status !== status) {
        await recordStateTransition(client, {
          ticketNo: req.params.ticketNo,
          branchId: current.branch_id,
          fromState: current.status,
          toState: status,
          actorId: req.account.id,
          approvedBy: status === 'cancelled' || status === 'refunded' ? approvedBy : null,
          reason: voidReason,
        });
      }

      // Record Game Theory audit event if voided or refunded (Module 7)
      if (status === 'cancelled' || status === 'refunded') {
        const eventType = status === 'refunded' ? 'refund_override' : (spotAuditTriggered ? 'spot_audit' : 'void_override');
        await client.query(
          `INSERT INTO audit_events (branch_id, ticket_no, event_type, cashier_id, manager_id, amount, spot_audit_triggered, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            current.branch_id,
            req.params.ticketNo,
            eventType,
            req.account.id,
            approvedBy,
            Number(current.total) || 0,
            spotAuditTriggered,
            voidReason || `${status === 'refunded' ? 'Order refunded' : 'Order voided'}`,
          ],
        );
      }

      await notifyOrder(client, req.params.ticketNo, current.branch_id);
      const order = await loadOrder(req.params.ticketNo, client);
      await client.query('COMMIT');
      res.json(order);
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = { orderRoutes, computeOfflineOrderDigest };
