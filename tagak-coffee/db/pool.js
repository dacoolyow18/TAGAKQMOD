const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectionOptions } = require('./connection');
const configuredMax = Number(process.env.DB_POOL_MAX);
const max = Number.isSafeInteger(configuredMax) && configuredMax > 0 ? configuredMax : 10;
const pool = new Pool({
  ...connectionOptions(process.env.DATABASE_URL),
  max,
});

function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(run) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
