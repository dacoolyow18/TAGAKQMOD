const express = require('express');
const { query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { text } = require('../validate');
const { resolveSessionBranch } = require('../branchScope');

const TYPES = ['payIn', 'payOut'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function round2(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

function cashLogRoutes() {
  const router = express.Router();

  router.get(
    '/',
    requireSession({ permission: ['access_cash_drawer', 'view_analytics'] }),
    async (req, res, next) => {
      const scope = resolveSessionBranch(req);
      if (scope.error) return res.status(scope.status).json({ error: scope.error });
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      const ranged = DATE_PATTERN.test(from) && DATE_PATTERN.test(to);
      try {
        const conditions = ['($1::text IS NULL OR branch_id = $1)'];
        const params = [scope.branchId];
        if (ranged) {
          params.push(from, to);
          conditions.push(
            `(created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`,
          );
        }
        const { rows } = await query(
          `SELECT id, type, amount::float8 AS amount, reason, branch_id, created_at
             FROM cash_logs
            WHERE ${conditions.join(' AND ')}
            ORDER BY created_at DESC, id DESC`,
          params,
        );
        res.json(rows.map(row => ({
          id: row.id,
          type: row.type,
          amount: row.amount,
          reason: row.reason,
          branchId: row.branch_id || null,
          createdAt: row.created_at,
        })));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/', requireSession({ permission: 'access_cash_drawer' }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const body = req.body || {};
    const type = text(body.type);
    const amount = body.amount;
    const reason = text(body.reason);
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'Type must be payIn or payOut' });
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      return res.status(400).json({ error: 'Amount must be greater than zero and at most 1,000,000' });
    }
    if (reason.length > 200) {
      return res.status(400).json({ error: 'Reason must be 200 characters or fewer' });
    }
    try {
      const { rows } = await query(
        `INSERT INTO cash_logs (type, amount, reason, branch_id, account_id) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, type, amount::float8 AS amount, reason, branch_id, created_at`,
        [type, amount, reason, scope.branchId, req.account.id],
      );
      const row = rows[0];
      res.status(201).json({
        id: row.id,
        type: row.type,
        amount: row.amount,
        reason: row.reason,
        branchId: row.branch_id || null,
        createdAt: row.created_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // QMODSIM Module 4: Blind Shift Drawer Reconciliation (Cash Shrinkage & Discrepancy Tracking)
  router.get(
    '/reconciliations',
    requireSession({ permission: ['access_cash_drawer', 'view_analytics', 'export_reports'] }),
    async (req, res, next) => {
      const scope = resolveSessionBranch(req);
      if (scope.error) return res.status(scope.status).json({ error: scope.error });
      try {
        const { rows } = await query(
          `SELECT id, branch_id, cashier_id, cashier_name,
                  counted_cash::float8 AS counted_cash,
                  expected_cash::float8 AS expected_cash,
                  discrepancy::float8 AS discrepancy,
                  cash_sales_total::float8 AS cash_sales_total,
                  pay_in_total::float8 AS pay_in_total,
                  pay_out_total::float8 AS pay_out_total,
                  notes, created_at
             FROM shift_reconciliations
            WHERE ($1::text IS NULL OR branch_id = $1)
            ORDER BY created_at DESC
            LIMIT 50`,
          [scope.branchId],
        );
        res.json(rows.map(r => ({
          id: r.id,
          branchId: r.branch_id || null,
          cashierId: r.cashier_id || null,
          cashierName: r.cashier_name || '',
          countedCash: r.counted_cash,
          expectedCash: r.expected_cash,
          discrepancy: r.discrepancy,
          cashSalesTotal: r.cash_sales_total,
          payInTotal: r.pay_in_total,
          payOutTotal: r.pay_out_total,
          notes: r.notes || '',
          createdAt: r.created_at,
        })));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/blind-close',
    requireSession({ permission: ['access_cash_drawer', 'access_terminal'] }),
    async (req, res, next) => {
      const scope = resolveSessionBranch(req);
      if (scope.error) return res.status(scope.status).json({ error: scope.error });
      const countedCash = Number(req.body?.countedCash);
      const notes = text(req.body?.notes);
      if (!Number.isFinite(countedCash) || countedCash < 0) {
        return res.status(400).json({ error: 'Counted physical cash must be zero or more' });
      }

      try {
        const [salesRes, logsRes] = await Promise.all([
          query(
            `SELECT COALESCE(SUM(total), 0)::float8 AS cash_sales
               FROM orders
              WHERE status = 'completed'
                AND payment = 'cash'
                AND ($1::text IS NULL OR branch_id = $1)
                AND (COALESCE(time_out, time_in) AT TIME ZONE 'Asia/Manila')::date = (now() AT TIME ZONE 'Asia/Manila')::date`,
            [scope.branchId],
          ),
          query(
            `SELECT
                COALESCE(SUM(CASE WHEN type = 'payIn' THEN amount ELSE 0 END), 0)::float8 AS pay_in,
                COALESCE(SUM(CASE WHEN type = 'payOut' THEN amount ELSE 0 END), 0)::float8 AS pay_out
               FROM cash_logs
              WHERE ($1::text IS NULL OR branch_id = $1)
                AND (created_at AT TIME ZONE 'Asia/Manila')::date = (now() AT TIME ZONE 'Asia/Manila')::date`,
            [scope.branchId],
          ),
        ]);

        const cashSalesTotal = round2(salesRes.rows[0]?.cash_sales || 0);
        const payInTotal = round2(logsRes.rows[0]?.pay_in || 0);
        const payOutTotal = round2(logsRes.rows[0]?.pay_out || 0);
        const expectedCash = round2(cashSalesTotal + payInTotal - payOutTotal);
        const discrepancy = round2(countedCash - expectedCash);

        const { rows } = await query(
          `INSERT INTO shift_reconciliations (
             branch_id, cashier_id, cashier_name, counted_cash, expected_cash,
             discrepancy, cash_sales_total, pay_in_total, pay_out_total, notes
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, branch_id, cashier_id, cashier_name,
                     counted_cash::float8 AS counted_cash,
                     expected_cash::float8 AS expected_cash,
                     discrepancy::float8 AS discrepancy,
                     cash_sales_total::float8 AS cash_sales_total,
                     pay_in_total::float8 AS pay_in_total,
                     pay_out_total::float8 AS pay_out_total,
                     notes, created_at`,
          [
            scope.branchId,
            req.account.id,
            req.account.name || '',
            countedCash,
            expectedCash,
            discrepancy,
            cashSalesTotal,
            payInTotal,
            payOutTotal,
            notes,
          ],
        );

        const r = rows[0];
        res.status(201).json({
          id: r.id,
          branchId: r.branch_id || null,
          cashierId: r.cashier_id || null,
          cashierName: r.cashier_name || '',
          countedCash: r.counted_cash,
          expectedCash: r.expected_cash,
          discrepancy: r.discrepancy,
          cashSalesTotal: r.cash_sales_total,
          payInTotal: r.pay_in_total,
          payOutTotal: r.pay_out_total,
          notes: r.notes || '',
          createdAt: r.created_at,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

module.exports = { cashLogRoutes };
