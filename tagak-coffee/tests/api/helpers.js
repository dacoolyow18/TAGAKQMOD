const TEST_DATABASE_URL = require('../test-database');
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const { pinDigest } = require('../../server/auth/pin');
const ROOT = path.join(__dirname, '..', '..');

async function withClient(fn) {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

function runScript(script) {
  execFileSync(process.execPath, [script], { cwd: ROOT, env: process.env, stdio: 'pipe' });
}

async function resetDatabase() {
  await withClient(c => c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'));
  runScript('db/migrate.js');
  runScript('db/seed.js');
}

let fixturePhone = 0;

async function insertAccount({ id, name, role, email = null, password = null, pin = null, branchId }) {
  const resolvedEmail = email ? email.trim().toLowerCase() : `${String(id).toLowerCase()}@tagak.test`;
  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  await withClient(async c => {
    if (branchId === undefined && ['Manager', 'Barista', 'Cashier'].includes(role)) {
      const { rows } = await c.query('SELECT id FROM branches ORDER BY id LIMIT 2');
      if (rows.length > 1) throw new Error('Specify a branch for the staff test fixture');
      if (!rows.length) await c.query("INSERT INTO branches (id, code, name) VALUES ('fixture-branch', '993001', 'Fixture Branch')");
      branchId = rows[0]?.id || 'fixture-branch';
    }
    await c.query(
      `INSERT INTO accounts (id, name, role, email, password_hash, pin_digest, branch_id, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, role, resolvedEmail, passwordHash, pin ? pinDigest(pin) : null, branchId, '0999' + String(++fixturePhone).padStart(7, '0')],
    );
  });
}

async function startServer({ windowMs = 60_000, maxAttempts = 10 } = {}) {
  const { createApp } = require('../../server/app');
  const app = createApp({ windowMs, maxAttempts });
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    baseURL: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

/** A solid-colour PNG big enough for the cropper to produce a real canvas (a 1px image crops to nothing). */
function solidPng(width, height) {
  const zlib = require('node:zlib');
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 0x80);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { TEST_DATABASE_URL, withClient, resetDatabase, insertAccount, startServer, solidPng };
