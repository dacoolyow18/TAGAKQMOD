const { Client } = require('pg');
const { findSession } = require('./auth/sessions');

const subscribers = new Set();
let listener;

// LISTEN needs a session connection. Regular queries can keep using transaction pooling.
function startListening() {
  const url = new URL(process.env.ORDER_LISTEN_DATABASE_URL || process.env.DATABASE_URL);
  if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '6543') url.port = '5432';
  const client = new Client({
    ...require('../db/connection').connectionOptions(url.href),
    connectionTimeoutMillis: 8000,
    keepAlive: true,
  });
  const current = { client, ready: false };
  listener = current;
  function disconnected() {
    if (listener !== current) return;
    listener = null;
    for (const sub of [...subscribers]) sub.end();
    client.end().catch(() => {});
  }
  client.on('error', disconnected);
  client.on('end', disconnected);
  client.on('notification', ({ payload }) => {
    if (listener !== current) return;
    const change = JSON.parse(payload);
    for (const sub of subscribers) if (sub.matches(change)) sub.send(change.ticket);
  });
  client.connect().then(() => client.query('LISTEN tagak_order_changes')).then(() => {
    if (listener !== current) return;
    current.ready = true;
    for (const sub of subscribers) sub.send(null);
  }).catch(disconnected);
}

function streamOrders(req, res) {
  const tickets = req.trackedOrderTickets;
  if (!req.account && !tickets?.size) return res.sendStatus(400);
  const clientKey = req.account?.id || req.ip;
  const sameClient = [...subscribers].filter(sub => sub.clientKey === clientKey);
  if (sameClient.length >= 8 || subscribers.size >= 200) {
    res.set('Retry-After', '30');
    return res.sendStatus(429);
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'private, no-cache, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  const sub = {
    clientKey,
    matches: ({ ticket, branch }) => req.account
      ? !req.account.branchId || req.account.branchId === branch
      : tickets.has(ticket),
    async send(ticket) {
      if (req.account && ticket) {
        try {
          const account = await findSession(req.sessionToken);
          if (!account || account.branchId !== req.account.branchId ||
              account.permissions.view_orders !== true) return res.end();
        } catch { return res.end(); }
      }
      if (!res.destroyed && !res.writableEnded) res.write('data: ' + JSON.stringify(ticket) + '\n\n');
    },
    end: () => res.end(),
  };
  subscribers.add(sub);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  // A hosting platform may cap request lifetime (SSE_LIFETIME_MS). Zero keeps
  // the stream open until the client disconnects, which suits a Node server.
  const configuredLifetime = Number(process.env.SSE_LIFETIME_MS);
  const lifetimeMs = Number.isFinite(configuredLifetime) && configuredLifetime > 0 ? configuredLifetime : 0;
  const lifetime = lifetimeMs ? setTimeout(sub.end, lifetimeMs) : null;
  res.once('close', () => {
    clearInterval(heartbeat);
    if (lifetime) clearTimeout(lifetime);
    subscribers.delete(sub);
    if (!subscribers.size && listener) {
      const { client } = listener;
      listener = null;
      client.end().catch(() => {});
    }
  });
  if (!listener) startListening();
  else if (listener.ready) sub.send(null);
}

function notifyOrder(client, ticket, branch) {
  return client.query("SELECT pg_notify('tagak_order_changes', $1)", [JSON.stringify({ ticket, branch })]);
}

module.exports = { streamOrders, notifyOrder };
