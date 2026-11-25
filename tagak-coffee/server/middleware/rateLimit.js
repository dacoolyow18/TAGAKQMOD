const { pool, query } = require('../../db/pool');

const accountLocks = `EXISTS (SELECT 1 FROM request_attempts a
  WHERE a.email=accounts.email AND a.email<>'' AND a.expires_at>now()
  GROUP BY a.route HAVING count(*) >= min(a.threshold)) AS locked`;

async function unlockEmail(email) {
  if (email) await query('DELETE FROM request_attempts WHERE email=$1', [email.trim().toLowerCase()]);
}

function rateLimit({ windowMs = 60000, max = 10, countAll = false, ipMax, routeKey } = {}) {
  return async function reserveAttempt(req, res, next) {
    const route = routeKey || (req.baseUrl + req.path).toLowerCase().replace(/\/+$/, '');
    // req.ip honours X-Forwarded-For only when Express trust proxy is enabled
    // (TRUST_PROXY). Without it, direct connections still work as before.
    const ip = req.ip || 'local';
    const email = !countAll && typeof req.body?.email === 'string' && req.body.email.length <= 254 ? req.body.email.trim().toLowerCase() : '';
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Serialize short reservations sharing an IP or email across function instances.
      for (const key of [route + '|ip|' + ip, ...(email ? [route + '|email|' + email] : [])]) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      }
      await client.query('DELETE FROM request_attempts WHERE expires_at<=now()');
      const { rows: [counts] } = await client.query(
        `SELECT count(*) FILTER (WHERE ip=$2)::int AS ips,
           count(*) FILTER (WHERE email=$3 AND email<>'')::int AS emails
         FROM request_attempts WHERE route=$1 AND (ip=$2 OR (email=$3 AND email<>''))`, [route, ip, email]);
      if (counts.ips >= (ipMax ?? (email ? max * 5 : max)) || counts.emails >= max) {
        await client.query('COMMIT');
        res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
        const minutes = Math.ceil(windowMs / 60000);
        return res.status(429).json({ error: `Too many attempts. Wait ${minutes} minute${minutes === 1 ? '' : 's'} to try again or contact admin support.` });
      }
      const { rows: [attempt] } = await client.query(
        `INSERT INTO request_attempts(route,ip,email,threshold,expires_at)
         VALUES($1,$2,$3,$4,now()+$5*interval '1 millisecond') RETURNING id`,
        [route, ip, email, max, windowMs]);
      await client.query('COMMIT');
      if (!countAll) req.clearSuccessfulLogin = async () => {
        await query('DELETE FROM request_attempts WHERE id=$1', [attempt.id]);
        if (email) await query("UPDATE request_attempts SET email='' WHERE route=$1 AND email=$2 AND id<$3", [route,email,attempt.id]);
      };
    } catch (err) {
      if (client) await client.query('ROLLBACK');
      return next(err);
    } finally { client?.release(); }
    next();
  };
}

module.exports = { rateLimit, unlockEmail, accountLocks };
