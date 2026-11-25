const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const QRCode = require('qrcode');
const { setTrackingCookie } = require('./orderTracking');
const { pool, withTransaction } = require('../db/pool');
const { quoteOrder, insertQuotedOrder } = require('./orders');

function enabled() {
  return Boolean(process.env.XENDIT_QR_ENABLED === 'true' &&
    process.env.XENDIT_SECRET_KEY?.startsWith('xnd_development_') &&
    process.env.XENDIT_WEBHOOK_TOKEN);
}

async function reserveCheckout(client, options) {
  if (!enabled()) throw Object.assign(new Error('Xendit test checkout is unavailable.'), { status: 400 });
  const quote = await quoteOrder(client, options);
  if (quote.total < 1 || quote.total > 50000) {
    throw Object.assign(new Error('QR Ph accepts amounts from PHP 1 to PHP 50,000.'), { status: 400 });
  }
  const id = randomUUID();
  const retryKey = options.retryKey ?? randomUUID(); // Older clients still receive a bounded checkout.
  if (typeof retryKey !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(retryKey)) {
    throw Object.assign(new Error('Invalid checkout retry key.'), { status: 400 });
  }
  const dailyLimit = Number(process.env.XENDIT_DAILY_CHECKOUT_LIMIT ?? 500);
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1) throw new Error('Invalid daily checkout limit');
  const fingerprint = createHash('sha256').update(JSON.stringify([options.actorId || null, options.body])).digest('hex');
  // Reserve before sending. A timeout may have created a payment at Xendit.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('xendit-daily-attempts',0))");
  const { rows: [existing] } = await client.query(
    'SELECT fingerprint,checkout_id,qr_image FROM xendit_checkout_attempts WHERE retry_key=$1', [retryKey]);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw Object.assign(new Error('Checkout contents changed.'), { status: 409 });
    if (!existing.qr_image) throw Object.assign(new Error('Checkout confirmation is pending. Retry this order or contact staff.'), { status: 409 });
    return { checkoutId: existing.checkout_id, qrImage: existing.qr_image };
  }
  const { rows: [usage] } = await client.query(
    "SELECT count(*)::int AS attempts FROM xendit_checkout_attempts WHERE created_at >= date_trunc('day', clock_timestamp(), 'Asia/Manila')");
  if (usage.attempts >= dailyLimit) throw Object.assign(new Error('QR checkout has reached its daily limit. Please use Cash.'), { status: 429 });
  await client.query('INSERT INTO xendit_checkout_attempts(retry_key,checkout_id,fingerprint) VALUES ($1,$2,$3)',
    [retryKey, id, fingerprint]);
  return { quote, id, retryKey };
}

async function startCheckout(options) {
  const reservation = await withTransaction(client => reserveCheckout(client, options));
  if (reservation.qrImage) return reservation;
  const { quote, id, retryKey } = reservation;
  const response = await fetch('https://api.xendit.co/v3/payment_requests', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: {
      Authorization: 'Basic ' + Buffer.from(process.env.XENDIT_SECRET_KEY + ':').toString('base64'),
      'api-version': '2024-11-11',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({reference_id: id, type: 'PAY', country: 'PH', currency: 'PHP',
      request_amount: quote.total, channel_code: 'QRPH', capture_method: 'AUTOMATIC'})
  });
  if (!response.ok) {
    console.error('Xendit payment request rejected', { status: response.status, body: (await response.text()).slice(0, 500) });
    await pool.query('DELETE FROM xendit_checkout_attempts WHERE retry_key=$1 AND qr_image IS NULL', [retryKey]);
    throw new Error('Xendit test payment request failed (HTTP ' + response.status + ')');
  }
  const payment = await response.json();
  const action = payment.actions?.find(a => a.type === 'PRESENT_TO_CUSTOMER' && a.descriptor === 'QR_STRING');
  if (payment.reference_id !== id || payment.request_amount !== quote.total || payment.currency !== 'PHP' ||
      payment.channel_code !== 'QRPH' || payment.status !== 'REQUIRES_ACTION' || !payment.payment_request_id ||
      !payment.business_id || !action?.value) throw new Error('Invalid Xendit QR Ph response');
  const qrImage = await QRCode.toDataURL(action.value, { width: 320 });
  await withTransaction(async client => {
    await client.query(
      'INSERT INTO xendit_checkouts (id, request_id, business_id, quote, expires_at) VALUES ($1,$2,$3,$4,$5)',
      [id, payment.payment_request_id, payment.business_id, quote, payment.channel_properties?.expires_at || null]);
    await client.query('UPDATE xendit_checkout_attempts SET qr_image=$2 WHERE retry_key=$1', [retryKey, qrImage]);
  });
  return { checkoutId: id, qrImage };
}

function verifyToken(req, res, next) {
  if (!enabled()) return res.sendStatus(404);
  const expected = Buffer.from(process.env.XENDIT_WEBHOOK_TOKEN || '');
  const actual = Buffer.from(req.get('x-callback-token') || '');
  if (!expected.length || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return res.sendStatus(401);
  next();
}

async function webhook(req, res, next) {
  const { event, data, business_id: businessId } = req.body || {};
  if (!['payment.capture', 'payment.failure', 'payment_request.expiry'].includes(event)) return res.sendStatus(204);
  if (!data?.payment_request_id || !businessId || !data.reference_id) return res.sendStatus(400);
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: [checkout] } = await client.query(
      'SELECT * FROM xendit_checkouts WHERE request_id=$1 FOR UPDATE', [data.payment_request_id]);
    if (!checkout) {
      // Delivery can precede the commit of the provider response.
      const { rowCount } = await client.query(
        'SELECT 1 FROM xendit_checkout_attempts WHERE checkout_id::text=$1', [data.reference_id]);
      if (rowCount) {
        await client.query('ROLLBACK');
        return res.sendStatus(503);
      }
    }
    if (checkout && (checkout.id !== data.reference_id || checkout.business_id !== businessId)) {
      await client.query('ROLLBACK');
      return res.sendStatus(400);
    }
    if (checkout) {
      if (event === 'payment.capture') {
        const captures = data.captures;
        const capture = Array.isArray(captures) && captures.length === 1 && captures[0];
        const paidAt = Date.parse(capture?.capture_timestamp);
        if (data.status !== 'SUCCEEDED' || data.country !== 'PH' || data.currency !== 'PHP' ||
            data.channel_code !== 'QRPH' || !data.payment_id || data.request_amount !== checkout.quote.total ||
            !Number.isFinite(paidAt) || capture.capture_amount !== checkout.quote.total) {
          await client.query('ROLLBACK');
          return res.sendStatus(400);
        }
        if (!checkout.ticket_no && (!checkout.expires_at || paidAt < checkout.expires_at.getTime())) {
          const order = await insertQuotedOrder(client, checkout.quote);
          await client.query('UPDATE xendit_checkouts SET ticket_no=$1, payment_id=$2, failed=false WHERE id=$3',
            [order.ticketNo, data.payment_id, checkout.id]);
        }
      } else if (!checkout.ticket_no && event === 'payment.failure' && data.status === 'FAILED') {
        await client.query('UPDATE xendit_checkouts SET failed=true WHERE id=$1', [checkout.id]);
      } else if (!checkout.ticket_no && event === 'payment_request.expiry' && data.status === 'EXPIRED') {
        const expiredAt = Date.parse(req.body.created);
        if (!Number.isFinite(expiredAt)) {
          await client.query('ROLLBACK');
          return res.sendStatus(400);
        }
        await client.query('UPDATE xendit_checkouts SET expires_at=LEAST(expires_at,$2) WHERE id=$1',
          [checkout.id, new Date(expiredAt)]);
      }
    }
    await client.query('COMMIT');
    return res.sendStatus(204);
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    return next(new Error('Xendit event could not be recorded'));
  } finally { client?.release(); }
}

const checkoutIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function simulationEnabled() {
  return process.env.ALLOW_PAYMENT_SIMULATION === 'true' && enabled();
}

async function simulateCheckout(req, res, next) {
  const orderToken = req.get('X-Checkout-Token') || '';
  if (!simulationEnabled() || !checkoutIdPattern.test(orderToken) || !checkoutIdPattern.test(req.params.id)) return res.sendStatus(404);
  try {
    const { rows: [checkout] } = await pool.query(
      `SELECT c.request_id, c.quote, c.ticket_no, c.failed, c.expires_at <= now() AS expired
         FROM xendit_checkouts c JOIN xendit_checkout_attempts a ON a.checkout_id=c.id
        WHERE c.id=$1 AND a.retry_key=$2`,
      [req.params.id, orderToken]);
    if (!checkout) return res.sendStatus(404);
    if (checkout.ticket_no) return res.sendStatus(204);
    if (checkout.failed || checkout.expired) return res.status(409).json({ error: 'This checkout has ended.' });
    const url = 'https://api.xendit.co/v3/payment_requests/' + encodeURIComponent(checkout.request_id) + '/simulate';
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: {
        Authorization: 'Basic ' + Buffer.from(process.env.XENDIT_SECRET_KEY + ':').toString('base64'),
        'api-version': '2024-11-11',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: checkout.quote.total }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Xendit could not simulate this payment. Try again.' });
    return res.sendStatus(202);
  } catch (err) { return next(err); }
}

async function checkoutStatus(req, res, next) {
  if (!checkoutIdPattern.test(req.params.id)) return res.sendStatus(404);
  try {
    const { rows: [checkout] } = await pool.query(
      `SELECT c.ticket_no, o.tracking_token, c.failed, c.expires_at <= now() AS expired
         FROM xendit_checkouts c LEFT JOIN orders o ON o.ticket_no=c.ticket_no WHERE c.id=$1`, [req.params.id]);
    if (!checkout) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store');
    if (checkout.tracking_token) setTrackingCookie(res, checkout.ticket_no, checkout.tracking_token);
    return res.json({ ...(checkout.tracking_token && { trackingToken: checkout.tracking_token }), ticketNo: checkout.ticket_no, failed: checkout.failed, expired: Boolean(checkout.expired && !checkout.ticket_no) });
  } catch (err) { return next(err); }
}

module.exports = { enabled, startCheckout, verifyToken, webhook, checkoutStatus, simulateCheckout, simulationEnabled };
