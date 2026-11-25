const identity = require('./provider');
const express = require('express');
const { pinDigest } = require('./pin');
const bcrypt = require('bcryptjs');
const { query } = require('../../db/pool');
const { COOKIE, createSession, registerManagedSession, deleteSession, readCookie, setSessionCookie, clearSessionCookie } = require('./sessions');
const { requireSession } = require('../middleware/requireSession');
const { rateLimit } = require('../middleware/rateLimit');

const ADMIN_ROLES = ['Super Admin', 'Admin'];
const POS_ROLES = ['Manager', 'Barista', 'Cashier'];
const INVALID = { error: 'Invalid credentials' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 12);

const DEFAULT_PIN_MAX_ATTEMPTS = 3;
const DEFAULT_PIN_WINDOW_MS = 300000;

function authRoutes({ windowMs, maxAttempts }) {
  const router = express.Router();
  const limit = rateLimit({ windowMs, max: maxAttempts });

  const managed = identity.provider() === 'supabase';
  if (managed) identity.authClient();
  router.get('/provider', (req, res) => res.set('Cache-Control', 'no-store').json({ provider: identity.provider() }));
  router.post('/managed-login', limit, async (req, res, next) => {
    if (!managed) return res.sendStatus(404);
    try {
      const { email, password, app } = req.body || {};
      if (!['admin', 'pos'].includes(app) || typeof email !== 'string' || email.length > 254 ||
          !EMAIL_RE.test(email) || typeof password !== 'string' || !password.length || password.length > 1024) {
        return res.status(401).json(INVALID);
      }
      const { data, error } = await identity.authClient().signInWithPassword({ email, password });
      if (error || !data?.session) return res.status(401).json(INVALID);
      const granted = await registerManagedSession(data.user, data.session, app === 'admin' ? ADMIN_ROLES : POS_ROLES);
      if (!granted) return res.status(401).json(INVALID);
      await req.clearSuccessfulLogin();
      setSessionCookie(res, data.session.access_token, granted.ttl);
      res.set('Cache-Control', 'no-store').json(granted.account);
    } catch (err) { next(err); }
  });
  router.use(['/admin-login', '/pin'], (req, res, next) => managed ? res.sendStatus(404) : next());

  router.post('/admin-login', limit, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = req.body?.password;
      if (!EMAIL_RE.test(email) || email.length > 254 || typeof password !== 'string' || password.length > 1024) return res.status(401).json(INVALID);
      const { rows } = await query(
        'SELECT id, name, role, password_hash FROM accounts WHERE email = $1 AND role = ANY($2) AND active',
        [email, ADMIN_ROLES],
      );
      const account = rows[0];
      const ok = await bcrypt.compare(password, account?.password_hash || DUMMY_HASH);
      if (!account || !account.password_hash || !ok) return res.status(401).json(INVALID);

      await req.clearSuccessfulLogin();
      setSessionCookie(res, await createSession(account.id));
      res.json({ name: account.name, role: account.role });
    } catch (err) {
      next(err);
    }
  });

  router.get('/pin-security', (req, res) => {
    const searchSpace = 10000;
    const shannonEntropyBits = Math.log2(searchSpace);
    res.json({
      pinLength: 4,
      searchSpace,
      shannonEntropyBits: Number(shannonEntropyBits.toFixed(4)),
      lockoutRule: {
        maxAttempts: DEFAULT_PIN_MAX_ATTEMPTS,
        lockoutWindowMs: DEFAULT_PIN_WINDOW_MS,
        lockoutMinutes: DEFAULT_PIN_WINDOW_MS / 60000,
      },
    });
  });

  const pinLimit = rateLimit({
    windowMs: DEFAULT_PIN_WINDOW_MS,
    max: Math.min(maxAttempts, DEFAULT_PIN_MAX_ATTEMPTS),
    ipMax: Math.min(maxAttempts, DEFAULT_PIN_MAX_ATTEMPTS) * 5,
  });
  router.post('/pin', pinLimit, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
      if (email.length > 254 || !EMAIL_RE.test(email) || !/^\d{4}$/.test(pin)) return res.status(401).json(INVALID);

      const { rows } = await query(
        `SELECT id, name, role
           FROM accounts
          WHERE lower(trim(email)) = $1
            AND trim(email) <> ''
            AND branch_id IS NOT NULL
            AND pin_digest = $2
            AND role = ANY($3)
            AND active`,
        [email, pinDigest(pin), POS_ROLES],
      );
      const account = rows[0];
      if (!account) return res.status(401).json(INVALID);

      await req.clearSuccessfulLogin();
      setSessionCookie(res, await createSession(account.id));
      res.json({ name: account.name, role: account.role });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = readCookie(req, COOKIE);
      clearSessionCookie(res);
      if (token) await deleteSession(token);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireSession(), async (req, res, next) => {
    try {
      res.json({
        provider: identity.provider(),
        id: req.account.id,
        name: req.account.name,
        role: req.account.role,
        branchId: req.account.branchId,
        permissions: req.account.permissions,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { authRoutes };
