const crypto = require('crypto');
const express = require('express');
const { query } = require('../../db/pool');
const { createSession, setSessionCookie, readCookie } = require('./sessions');
const { publicBaseUrl } = require('../publicUrl');

const { rateLimit } = require('../middleware/rateLimit');
const ADMIN_ROLES = ['Admin', 'Super Admin'];
const STATE_MS = 10 * 60 * 1000;
const LOGIN_PATH = '/unified-login/index.html';
const DEFAULT_RETURN_PATH = '/admin-app/index.html';



function config() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    baseUrl: publicBaseUrl(),
  };
}

function allowedReturnUrl(raw, baseUrl) {
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    if (url.origin !== new URL(baseUrl).origin) return null;
    if (!url.pathname.startsWith('/admin-app/') && !url.pathname.startsWith('/pos-app/')) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

function redirectToLogin(res, baseUrl, errorCode, returnUrl) {
  const target = new URL(LOGIN_PATH, baseUrl);
  target.searchParams.set('app', 'admin');
  target.searchParams.set('google_error', errorCode);
  if (returnUrl) target.searchParams.set('return_url', returnUrl);
  res.redirect(302, target.href);
}

async function fetchGoogleProfile(code, cfg) {
  const redirectUri = `${cfg.baseUrl}/auth/google/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status})`);
  const { access_token: accessToken } = await tokenRes.json();

  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!infoRes.ok) throw new Error(`Google userinfo failed (${infoRes.status})`);
  return infoRes.json();
}

async function findAdminByEmail(email) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return null;
  const { rows } = await query(
    `SELECT id, name, role FROM accounts
      WHERE email = $1 AND role = ANY($2) AND active
      LIMIT 1`,
    [needle, ADMIN_ROLES],
  );
  return rows[0] || null;
}

function googleRoutes() {
  const router = express.Router();
  if (require('./provider').provider() === 'supabase') return router;

  router.get('/auth/google', rateLimit({ routeKey: 'google-start', windowMs: STATE_MS, max: 30, countAll: true }), async (req, res, next) => {
    const cfg = config();
    const returnUrl = allowedReturnUrl(req.query.return_url, cfg.baseUrl);
    if (!cfg.clientId || !cfg.clientSecret) {
      console.error('Google sign-in is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
      return redirectToLogin(res, cfg.baseUrl, 'not_configured', returnUrl);
    }

    const state = crypto.randomBytes(24).toString('base64url');
    try {
      await query('DELETE FROM oauth_states WHERE expires_at<=now()');
      await query('INSERT INTO oauth_states(state,return_url,expires_at) VALUES ($1,$2,$3)', [state,returnUrl,new Date(Date.now()+STATE_MS)]);
    } catch (err) { return next(err); }

    const secure = cfg.baseUrl.startsWith('https://');
    res.cookie(secure ? '__Host-tagak_oauth' : 'tagak_oauth_dev', state, {
      secure, httpOnly: true, sameSite: 'lax', path: '/', maxAge: STATE_MS,
    });
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.search = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: `${cfg.baseUrl}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    }).toString();
    res.redirect(302, authUrl.href);
  });

  router.get('/auth/google/callback', async (req, res, next) => {
    try {
      const cfg = config();
      const state = typeof req.query.state === 'string' ? req.query.state : null;
      const secure = cfg.baseUrl.startsWith('https://');
      const cookie = secure ? '__Host-tagak_oauth' : 'tagak_oauth_dev';
      if (!state || readCookie(req, cookie) !== state) return redirectToLogin(res, cfg.baseUrl, 'cancelled');
      res.clearCookie(cookie, { secure, httpOnly: true, sameSite: 'lax', path: '/' });
      const { rows: [pending] } = await query(
        'DELETE FROM oauth_states WHERE state=$1 AND expires_at>now() RETURNING return_url AS "returnUrl"', [state]);

      const code = typeof req.query.code === 'string' ? req.query.code : null;
      if (!pending || !code || req.query.error) {
        return redirectToLogin(res, cfg.baseUrl, 'cancelled', pending?.returnUrl);
      }

      let profile;
      try {
        profile = await fetchGoogleProfile(code, cfg);
      } catch (err) {
        console.error(err.message);
        return redirectToLogin(res, cfg.baseUrl, 'failed', pending.returnUrl);
      }

      if (!profile.email || profile.email_verified !== true) {
        return redirectToLogin(res, cfg.baseUrl, 'unverified', pending.returnUrl);
      }

      const admin = await findAdminByEmail(profile.email);
      if (!admin) return redirectToLogin(res, cfg.baseUrl, 'not_admin', pending.returnUrl);

      setSessionCookie(res, await createSession(admin.id));
      res.redirect(302, new URL(pending.returnUrl || DEFAULT_RETURN_PATH, cfg.baseUrl).href);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { googleRoutes, config, findAdminByEmail };
