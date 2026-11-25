const TZ = 'Asia/Manila';
const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Business date (Asia/Manila) as YYYY-MM-DD. */
function manilaDate(now = new Date()) {
  const parts = Object.fromEntries(DATE_FMT.formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Increment the global daily counter and return the next ticket number.
 * Must be called inside a transaction so two orders cannot share a number.
 */
async function nextTicketNo(client, now = new Date()) {
  const day = manilaDate(now);
  const { rows } = await client.query(
    `INSERT INTO ticket_counters (day, last_value) VALUES ($1, 1)
     ON CONFLICT (day) DO UPDATE SET last_value = ticket_counters.last_value + 1
     RETURNING last_value`,
    [day],
  );
  const value = rows[0].last_value;
  return `TK-${day.replace(/-/g, '')}-${String(value).padStart(4, '0')}`;
}

module.exports = { manilaDate, nextTicketNo };
