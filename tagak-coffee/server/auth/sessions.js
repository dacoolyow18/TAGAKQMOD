const identity = require('./provider');
const crypto = require('crypto');
const { query } = require('../../db/pool');
const { publicBaseUrl } = require('../publicUrl');

const COOKIE = 'tagak_session';
const SESSION_MS = 8 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSession(accountId) {
  if (identity.provider() !== 'local') throw new Error('Local sign-in is disabled');
  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    'INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), accountId, new Date(Date.now() + SESSION_MS)],
  );
  return token;
}

async function registerManagedSession(user, session, roles) {
  if (!user?.email_confirmed_at || !user.email || !session?.access_token) return null;
  const expires = Math.min(session.expires_at * 1000, Date.now() + SESSION_MS);
  if (!Number.isFinite(expires) || expires <= Date.now()) return null;
  const { rows } = await query(
    `WITH eligible AS (
       SELECT id, name, role FROM accounts
       WHERE auth_user_id=$1 AND lower(email)=lower($2) AND active AND role=ANY($3)
         AND (branch_id IS NOT NULL OR role IN ('Super Admin','Admin'))
       FOR SHARE
     ), added AS (
       INSERT INTO sessions(token_hash, account_id, expires_at, auth_provider)
       SELECT $4, id, $5, 'supabase' FROM eligible
       ON CONFLICT (token_hash) DO NOTHING
     ) SELECT name,role FROM eligible`,
    [user.id, user.email, roles, hashToken(session.access_token), new Date(expires)],
  );
  return rows[0] ? { account: rows[0], ttl: Math.floor((expires - Date.now()) / 1000) } : null;
}

async function findSession(token) {
  const provider = identity.provider();
  const { rows } = await query(
    `SELECT a.id, a.name, a.role, a.branch_id, a.auth_user_id, a.email, s.expires_at, rp.permissions
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       LEFT JOIN role_permissions rp ON rp.role = a.role
      WHERE s.token_hash = $1 AND s.auth_provider=$2 AND s.expires_at > now() AND a.active`,
    [hashToken(token), provider],
  );
  if (!rows[0]) return null;
  if (provider === 'supabase') {
    const { data, error } = await identity.authClient().getUser(token);
    const user = data?.user;
    if (error || !user?.email_confirmed_at || user.id !== rows[0].auth_user_id ||
        user.email?.toLowerCase() !== rows[0].email?.toLowerCase() ||
        Date.parse(user.banned_until) > Date.now()) return null;
  }
  return { id: rows[0].id, name: rows[0].name, role: rows[0].role, branchId: rows[0].branch_id, expiresAt: rows[0].expires_at, permissions: rows[0].permissions || {} };
}

async function deleteSession(token) {
  const { rows } = await query('DELETE FROM sessions WHERE token_hash = $1 RETURNING auth_provider', [hashToken(token)]);
  if (rows[0]?.auth_provider === 'supabase' && identity.provider() === 'supabase') {
    const { error } = await identity.authClient().admin.signOut(token, 'local');
    if (error && ![401, 403, 404].includes(error.status)) throw new Error('Provider sign-out unavailable');
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(rest.join('=')); } catch (_) { return null; }
    }
  }
  return null;
}

function cookieFlags() {
  const secure = publicBaseUrl().startsWith('https://') ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function setSessionCookie(res, token, ttl = SESSION_MS / 1000) {
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; ${cookieFlags()}; Max-Age=${ttl}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; ${cookieFlags()}; Max-Age=0`);
}

module.exports = {
  COOKIE,
  createSession,
  registerManagedSession,
  findSession,
  deleteSession,
  readCookie,
  setSessionCookie,
  clearSessionCookie,
};
