const { pool } = require('../db/pool');

async function expireCash(client = pool, ticket = null) {
  // Lock and notify only tickets this invocation actually transitions.
  return client.query(`
    WITH due AS (
      SELECT ticket_no FROM orders
       WHERE status='queued' AND payment_status='unpaid' AND cash_due_at <= clock_timestamp()
         AND ($1::text IS NULL OR ticket_no=$1)
       ORDER BY cash_due_at LIMIT 200 FOR UPDATE SKIP LOCKED
    ), expired AS (
      UPDATE orders o SET status='cancelled', cash_expired=true, time_out=clock_timestamp()
       FROM due WHERE o.ticket_no=due.ticket_no RETURNING o.ticket_no, o.branch_id
    ), transitions AS (
      INSERT INTO order_state_transitions (ticket_no, branch_id, from_state, to_state, reason)
      SELECT ticket_no, branch_id, 'queued', 'cancelled', 'Cash payment expired' FROM expired
    )
    SELECT pg_notify('tagak_order_changes', json_build_object('ticket',ticket_no,'branch',branch_id)::text)
      FROM expired`, [ticket]);
}

function startCashExpiryWorker() {
  let timer;
  let stopped = false;
  async function sweep() {
    let delay = 1000;
    try {
      if ((await expireCash()).rowCount === 200) delay = 0;
    } catch (error) {
      console.error('Cash expiration sweep failed', error.code);
      delay = 5000;
    }
    if (!stopped) timer = setTimeout(sweep, delay).unref();
  }
  sweep();
  return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { expireCash, startCashExpiryWorker };
