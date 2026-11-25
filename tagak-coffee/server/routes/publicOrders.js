const express = require('express');
const { createHash } = require('node:crypto');
const { validTicket, validToken, setTrackingCookie, trackingKeys } = require('../orderTracking');
const { streamOrders } = require('../orderEvents');
const { startCheckout } = require('../xendit');
const { pool, withTransaction } = require('../../db/pool');
const { createOrder, mapOrder } = require('../orders');
const { rateLimit } = require('../middleware/rateLimit');
const { isStoreOpen } = require('./settings');

const ORDER_COLUMNS = `ticket_no, to_char(order_date, 'YYYY-MM-DD') AS order_date, branch_id, customer_name, order_mode,
  status, payment, payment_status, cash_due_at, cash_expired, clock_timestamp() AS server_now, items, subtotal, vat, total, time_in, time_out`;

function customerOrder(row) {
  if (row.cash_due_at && row.payment_status === 'unpaid') {
    return { ticketNo: row.ticket_no, payment: 'cash', paymentStatus: 'unpaid', total: Number(row.total),
      serverNow: row.server_now.getTime(), cashDueAt: row.cash_due_at, cashExpired: row.cash_expired,
      status: row.status === 'cancelled' ? 'cancelled' : 'pending_payment' };
  }
  return mapOrder(row);
}

function sendOrderError(res, err, next) {
  if ([400, 409, 429].includes(err.status)) return res.status(err.status).json({ error: err.message });
  return next(err);
}

async function loadOrder(ticketNo, client = pool) {
  const { rows } = await client.query(`SELECT approved_by, ${ORDER_COLUMNS} FROM orders WHERE ticket_no = $1`, [ticketNo]);
  return rows[0] ? mapOrder(rows[0]) : null;
}

function publicOrderRoutes({ windowMs = 60_000, max = 60 } = {}) {
  const router = express.Router();
  const limit = routeKey => rateLimit({ windowMs, max, countAll: true, routeKey });
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  function readTrackedOrders(events) {
    return async (req, res, next) => {
      const tickets = typeof req.query.tickets === 'string' ? req.query.tickets.split(',') : [];
      if (!tickets.length || tickets.length > 100 || !tickets.every(t => validTicket.test(t))) return res.sendStatus(400);
      try {
        const tokens = trackingKeys(req, tickets);
        if (!tokens.length) return events ? res.sendStatus(404) : res.json([]);
        const columns = events ? 'ticket_no' : ORDER_COLUMNS;
        const { rows } = await pool.query(
          `SELECT ${columns} FROM orders WHERE ticket_no = ANY($1::text[]) AND tracking_token = ANY($2::uuid[])`, [tickets, tokens]);
        if (!events) return res.json(rows.map(customerOrder));
        if (!rows.length) return res.sendStatus(404);
        req.trackedOrderTickets = new Set(rows.map(row => row.ticket_no));
        return streamOrders(req, res);
      } catch (err) { next(err); }
    };
  }
  router.get('/events', limit('order-events'), readTrackedOrders(true));
  router.get('/', limit('order-batch'), readTrackedOrders(false));

  router.post('/claim', limit('order-claim'), async (req, res, next) => {
    const { token } = req.body || {};
    if (typeof token !== 'string' || !validToken.test(token)) return res.sendStatus(404);
    try {
      const { rows: [row] } = await pool.query('SELECT ticket_no FROM orders WHERE tracking_token=$1', [token]);
      if (!row) return res.sendStatus(404);
      setTrackingCookie(res, row.ticket_no, token);
      res.json({ ticketNo: row.ticket_no });
    } catch (err) { next(err); }
  });

  async function createGuestCash(client, options) {
    const key = options.retryKey;
    if (!key) return createOrder(client, options);
    if (!validToken.test(key)) throw Object.assign(new Error('Invalid order retry key'), { status: 400 });
    const hash = createHash('sha256').update(JSON.stringify(options.body)).digest('hex');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key.toLowerCase()]);
    const { rows: [existing] } = await client.query(
      `SELECT ${ORDER_COLUMNS}, tracking_token, cash_request_hash FROM orders WHERE cash_retry_key=$1`, [key]);
    if (existing) {
      if (existing.cash_request_hash !== hash) throw Object.assign(new Error('Order details changed'), { status: 409 });
      return { ...mapOrder(existing), trackingToken: existing.tracking_token };
    }
    const order = await createOrder(client, options);
    await client.query('UPDATE orders SET cash_retry_key=$2, cash_request_hash=$3 WHERE ticket_no=$1', [order.ticketNo, key, hash]);
    return order;
  }

  router.post('/', limit('order-create'), async (req, res, next) => {
    let open;
    try {
      open = await isStoreOpen(req.body?.branchId);
    } catch (err) {
      return next(err);
    }
    if (!open) {
      return res.status(409).json({ error: 'The store is closed right now. Please come back when we reopen.' });
    }
    try {
      const options = { body: req.body || {}, retryKey: req.get('Idempotency-Key'), requireNickname: true, isPublic: true };
      const qr = options.body.payment === 'qr';
      const order = qr ? await startCheckout(options) : await withTransaction(client => createGuestCash(client, options));
      if (!qr) setTrackingCookie(res, order.ticketNo, order.trackingToken);
      res.status(qr ? 202 : 201).json(order);
    } catch (err) {
      sendOrderError(res, err, next);
    }
  });

  router.get('/:ticketNo', limit('order-read'), async (req, res, next) => {
    try {
      const ticket = req.params.ticketNo;
      if (!validTicket.test(ticket)) return res.sendStatus(404);
      const [token] = trackingKeys(req, [ticket]);
      if (!token) return res.sendStatus(404);
      const { rows: [row] } = await pool.query(
        `SELECT ${ORDER_COLUMNS} FROM orders WHERE ticket_no=$1 AND tracking_token=$2`, [ticket, token]);
      const order = row && customerOrder(row);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { publicOrderRoutes, ORDER_COLUMNS, loadOrder, sendOrderError };
