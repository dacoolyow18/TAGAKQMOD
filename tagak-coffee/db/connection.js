// Apply one TLS policy to queries, migrations, seeds and LISTEN connections.
function connectionOptions(connectionString) {
  if (!connectionString) throw new Error('Database connection is not configured');
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // Local development must never write to a hosted database by accident.
  // Production (NODE_ENV=production) and an explicit opt-in are allowed.
  if (!local && process.env.NODE_ENV !== 'production' && process.env.ALLOW_REMOTE_DB !== 'true') {
    throw new Error('Refusing a remote database outside production; set ALLOW_REMOTE_DB=true only for an intentional remote connection');
  }
  const ca = process.env.DATABASE_CA_CERT;
  if (!ca && local) return { connectionString };
  // pg connection-string SSL options can otherwise override the supplied CA.
  for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) {
    url.searchParams.delete(key);
  }
  return { connectionString: url.href, ssl: { rejectUnauthorized: true, ...(ca && { ca }) } };
}

module.exports = { connectionOptions };
