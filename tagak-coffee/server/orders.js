const { nextTicketNo, manilaDate } = require('./tickets');
const { notifyOrder } = require('./orderEvents');
const { text } = require('./validate');
const { validate,calculate,round2,orderError,ORDER_MODES,MAX_NICKNAME } = require('../pos-app/quote');
const { ownedBy } = require('./branchScope');

const STATUSES = ['held', 'refunded', 'queued', 'brewing', 'ready', 'completed', 'cancelled'];

function mapOrder(row) {
  const subtotal = Number(row.subtotal);
  const vat = Number(row.vat);
  const total = Number(row.total);
  const discount = round2(subtotal - (total - vat));
  return {
    ticketNo: row.ticket_no,
    orderDate: row.order_date,
    branchId: row.branch_id,
    ...(row.channel ? { channel: row.channel } : {}),
    customerName: row.customer_name || '',
    orderMode: row.order_mode || 'dine-in',
    ...(row.approved_by ? { approvedBy: row.approved_by } : {}),
    status: row.status,
    payment: row.payment,
    paymentStatus: row.payment_status,
    cashDueAt: row.cash_due_at,
    serverNow: row.server_now?.getTime(),
    cashExpired: row.cash_expired,
    items: row.items,
    subtotal,
    vat,
    discount: discount > 0 ? discount : 0,
    total,
    timeIn: row.time_in,
    timeOut: row.time_out,
  };
}

async function loadSettings(client, branchId = '') {
  const cleanBranch = typeof branchId === 'string' ? branchId.trim() : '';
  const { rows } = await client.query(
    "SELECT branch_id, key, value FROM settings WHERE key IN ('vat_rate', 'large_upcharge') AND branch_id IN ('', $1)",
    [cleanBranch],
  );
  const settings = {};
  for (const row of rows) {
    if (row.branch_id === '') settings[row.key] = row.value;
  }
  if (cleanBranch) {
    for (const row of rows) {
      if (row.branch_id === cleanBranch) settings[row.key] = row.value;
    }
  }
  const vatRate = Number(settings.vat_rate);
  const upcharge = Number(settings.large_upcharge);
  return {
    vatRate: Number.isFinite(vatRate) ? Math.min(Math.max(vatRate, 0), 1) : 0,
    largeUpcharge: Number.isFinite(upcharge) && upcharge > 0 ? upcharge : 0,
  };
}

async function quoteOrder(client,options,snapshot) {
  const validated=validate(options);
  const catalog=snapshot || await liveCatalog(client,validated.branchId,validated.lines);
  return {
    ...calculate(options, validated, catalog),
    channel: options.isPublic ? 'mobile' : 'pos',
    actorId: options.actorId || null,
  };
}

async function liveCatalog(client, branchId, lines) {
  const { rows: branchRows } = await client.query('SELECT id FROM branches WHERE id = $1', [branchId]);
  if (!branchRows[0]) throw orderError('That branch does not exist');

  const itemIds = [...new Set(lines.map(line => line.menuItemId))];
  const addOnIds = [...new Set(lines.flatMap(line => line.addOnIds || []))];
  const [{ rows: itemRows }, { rows: addOnRows }] = await Promise.all([
    client.query(`SELECT * FROM menu_items WHERE id = ANY($1) AND ${ownedBy('$2')}`, [itemIds, branchId]),
    client.query(`SELECT * FROM add_ons WHERE id = ANY($1) AND ${ownedBy('$2')}`, [addOnIds, branchId]),
  ]);
  return { items: itemRows, addOns: addOnRows, settings: await loadSettings(client, branchId) };
}

async function createOrder(client, options) {
  if (text(options.body?.payment) === 'qr') throw orderError('QR payment requires confirmation from Xendit.');
  const quote = await quoteOrder(client, options);
  quote.held = !options.isPublic && options.body?.status === 'held';
  return insertQuotedOrder(client, quote, options.now, quote.held ? null : options.actorId);
}

async function insertQuotedOrder(client, quote, now = new Date(), cashierId = null) {
  const { branchId, customerName, orderMode, payment, storedLines, subtotal, vat, total } = quote;
  const orderDate = manilaDate(now);
  const ticketNo = await nextTicketNo(client, now);
  const status = quote.held ? 'held' : payment === 'qr' ? 'brewing' : 'queued';

  const { rows } = await client.query(
    `INSERT INTO orders (ticket_no, order_date, branch_id, status, payment, items, subtotal, vat, total, time_in, customer_name, order_mode, payment_status, cash_collected_by, cash_collected_at, cash_due_at, channel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CASE WHEN $13='unpaid' AND $16='mobile' THEN clock_timestamp()+interval '5 minutes' END, $16)
     RETURNING tracking_token, ticket_no, to_char(order_date, 'YYYY-MM-DD') AS order_date, branch_id, customer_name, order_mode,
               status, payment, payment_status, cash_due_at, cash_expired, clock_timestamp() AS server_now, items, subtotal, vat, total, time_in, time_out`,
    [ticketNo, orderDate, branchId, status, payment, JSON.stringify(storedLines), subtotal, vat, total, now, customerName, orderMode,
      payment === 'qr' || cashierId ? 'paid' : 'unpaid', cashierId, cashierId ? now : null, quote.channel || 'pos'],
  );
  await recordStateTransition(client, {ticketNo, branchId, fromState: 'held', toState: status, actorId: quote.actorId});
  await notifyOrder(client, ticketNo, branchId);
  return { ...mapOrder(rows[0]), trackingToken: rows[0].tracking_token };
}

/** Supply quantities a set of order lines uses: menu recipes plus add-ons, at today's links. */
async function recipeUsage(client, lines) {
  const { rows } = await client.query(
    'SELECT menu_item_id, supply_id, qty::float8 AS qty, large_qty::float8 AS large_qty FROM menu_item_recipes WHERE menu_item_id = ANY($1)',
    [[...new Set(lines.map(line => line.menuItemId))]],
  );
  const addOnIds = [...new Set(lines.flatMap(line => line.addOnIds || []))];
  const { rows: addOnRows } = addOnIds.length
    ? await client.query(
      'SELECT add_on_id, supply_id, qty::float8 AS qty FROM add_on_supplies WHERE add_on_id = ANY($1::uuid[])',
      [addOnIds],
    )
    : { rows: [] };
  return recipeQuantities(lines, rows, addOnRows);
}

function recipeQuantities(lines, rows, addOnRows) {
  const usage = Object.create(null);
  for (const line of lines) {
    for (const row of rows) {
      if (row.menu_item_id !== line.menuItemId) continue;
      const perServing = line.size === 'Large' && row.large_qty != null ? row.large_qty : row.qty;
      usage[row.supply_id] = round3((usage[row.supply_id] || 0) + perServing * line.qty);
    }
    for (const row of addOnRows) {
      if (!(line.addOnIds || []).includes(row.add_on_id)) continue;
      usage[row.supply_id] = round3((usage[row.supply_id] || 0) + row.qty * line.qty);
    }
  }
  return usage;
}

/** Deduct (direction -1) or restore (direction +1) supply stock for a usage map. */
async function moveStock(client, usage, direction) {
  for (const [supplyId, qty] of Object.entries(usage)) {
    await client.query('UPDATE supplies SET stock = stock + $2 WHERE id = $1', [supplyId, direction * qty]);
  }
}

function round3(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

async function recordStateTransition(client, { ticketNo, branchId, fromState, toState, actorId = null, approvedBy = null, reason = '' }) {
  await client.query(
    `INSERT INTO order_state_transitions (ticket_no, branch_id, from_state, to_state, actor_id, approved_by, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ticketNo, branchId || null, fromState, toState, actorId, approvedBy, text(reason)],
  );
}

module.exports = { recordStateTransition, loadSettings, recipeQuantities, quoteOrder, insertQuotedOrder, createOrder, mapOrder, round2, STATUSES, ORDER_MODES, recipeUsage, moveStock, MAX_NICKNAME };
