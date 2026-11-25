const express = require('express');
const { pinDigest } = require('../auth/pin');
const { provider } = require('../auth/provider');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { unlockEmail, accountLocks } = require('../middleware/rateLimit');
const { mapAccount } = require('../mappers');
const { ADMIN_ROLES, ALL_ROLES, text, isPin } = require('../validate');
const { sendDbError } = require('../errors');
const { validName, nameError, validCode, branchError, validPhone, phoneError, passwordError } = require('../../form-validation');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidBirthdate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  return dt.getTime() <= Date.now();
}

function accountInput(body, { requirePassword }) {
  const firstName = text(body.firstName);
  const middleName = text(body.middleName);
  const middleInitialRaw = text(body.middleInitial).replace(/\.+$/, '');
  const lastName = text(body.lastName);
  const role = text(body.role);
  const email = text(body.email).toLowerCase();
  const phone = body.phone;
  const birthdate = text(body.birthdate);
  const pin = text(body.pin);
  const password = typeof body.password === 'string' ? body.password : '';
  const branchId = text(body.branchId) || null;
  const active = body.active !== false;
  const managed = provider() === 'supabase';
  if (managed && (body.pin || body.password)) return { error: 'Manage credentials in Supabase Auth' };

  if (email.length > 254 || firstName.length > 120 || middleName.length > 120 || lastName.length > 120) {
    return { error: 'Name or email exceeds the allowed length' };
  }

  if (!ALL_ROLES.includes(role)) return { error: 'Choose a valid role' };
  if (!firstName) return { error: 'Please enter a first name' };
  if (![firstName, middleName, lastName, middleInitialRaw].every(validName)) return { error: nameError };

  if (ADMIN_ROLES.includes(role)) {
    if (middleInitialRaw.length > 2) return { error: 'Middle initial must be 1 or 2 characters' };
    if (!lastName) return { error: 'Please enter a last name' };
    if (!email || !EMAIL_RE.test(email)) return { error: 'Please enter a valid email address' };
    if (!validPhone(phone)) return { error: phoneError };
    if (!isValidBirthdate(birthdate)) return { error: 'Please enter a valid birthdate' };
    if (pin || branchId) return { error: 'Admin accounts cannot have a PIN or a branch' };
    if (!managed && (requirePassword || password)) {
      const error = passwordError(password);
      if (error) return { error };
    }
    const name = middleInitialRaw
      ? `${firstName} ${middleInitialRaw}. ${lastName}`
      : `${firstName} ${lastName}`;
    return {
      value: {
        name,
        firstName,
        middleName: '',
        middleInitial: middleInitialRaw,
        lastName,
        role,
        email,
        phone,
        birthdate,
        pin: null,
        branchId: null,
        password: password || null,
        active,
      },
    };
  }

  if (middleInitialRaw.length > 2) return { error: 'Middle initial must be 1 or 2 characters' };
  if (!lastName) return { error: 'Please enter a last name' };
  if (!email || !EMAIL_RE.test(email)) return { error: 'Please enter a valid email address' };
  if (!validPhone(phone)) return { error: phoneError };
  if (!isValidBirthdate(birthdate)) return { error: 'Please enter a valid birthdate' };
  if (!managed && (requirePassword || body.pin !== undefined) && !isPin(pin)) return { error: 'PIN must be exactly 4 digits' };
  if (!branchId) return { error: 'Please choose a branch' };
  if (![body.firstName, body.middleName ?? '', body.lastName, body.middleInitial ?? ''].every(validName)) {
    return { error: nameError };
  }
  if (body.branchCode !== undefined && !validCode(body.branchCode)) return { error: branchError };
  const empMiddle = middleName || (middleInitialRaw ? `${middleInitialRaw}.` : '');
  const name = empMiddle ? `${firstName} ${empMiddle} ${lastName}` : `${firstName} ${lastName}`;
  return {
    value: {
      name,
      firstName,
      middleName,
      middleInitial: middleInitialRaw,
      lastName,
      role,
      email,
      phone,
      birthdate,
      pin,
      branchId,
      password: null,
      active,
    },
  };
}

function requesterMayManage(requester, targetRole) {
  if (!ADMIN_ROLES.includes(targetRole)) return true;
  return requester.role === 'Super Admin';
}

async function branchAssignmentError(account, suppliedCode) {
  if (!account.branchId) return null;
  const { rows } = await query('SELECT code FROM branches WHERE id=$1', [account.branchId]);
  if (!rows.length) return 'Please choose an existing branch';
  if (!validCode(rows[0].code)) return branchError;
  if (suppliedCode !== undefined && suppliedCode !== rows[0].code) return 'Branch code does not match the selected branch.';
  return null;
}

function accountRoutes() {
  const router = express.Router();

  router.get('/', requireSession({ roles: ADMIN_ROLES, permission: 'manage_users' }), async (req, res, next) => {
    try {
      const { rows } = await query(`SELECT accounts.*, ${accountLocks} FROM accounts ORDER BY name`);
      res.json(rows.map(mapAccount));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireSession({ roles: ADMIN_ROLES, permission: 'manage_users' }), async (req, res, next) => {
    const input = accountInput(req.body || {}, { requirePassword: true });
    if (input.error) return res.status(400).json({ error: input.error });
    if (!requesterMayManage(req.account, input.value.role)) return res.status(403).json({ error: 'Forbidden' });
    try {
      const v = input.value;
      const branchProblem = await branchAssignmentError(v, req.body.branchCode);
      if (branchProblem) return res.status(400).json({ error: branchProblem });
      const passwordHash = v.password ? await bcrypt.hash(v.password, 12) : null;
      const { rows } = await query(
        `INSERT INTO accounts (
           id, name, first_name, middle_name, middle_initial, last_name,
           role, email, phone, birthdate, password_hash, pin_digest, branch_id, active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [
          randomUUID(), v.name, v.firstName, v.middleName, v.middleInitial, v.lastName,
          v.role, v.email, v.phone, v.birthdate, passwordHash, v.pin ? pinDigest(v.pin) : null, v.branchId, v.active,
        ],
      );
      res.status(201).json(mapAccount(rows[0]));
    } catch (err) {
      sendDbError(res, err, next);
    }
  });

  router.put('/:id', requireSession({ roles: ADMIN_ROLES, permission: 'manage_users' }), async (req, res, next) => {
    const input = accountInput(req.body || {}, { requirePassword: false });
    if (input.error) return res.status(400).json({ error: input.error });
    try {
      const { rows: existingRows } = await query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Account not found' });
      if (!requesterMayManage(req.account, existing.role) || !requesterMayManage(req.account, input.value.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const v = input.value;
      const branchProblem = await branchAssignmentError(v, req.body.branchCode);
      if (branchProblem) return res.status(400).json({ error: branchProblem });
      if (existing.role === 'Super Admin' && existing.active && (v.role !== 'Super Admin' || !v.active)) {
        const { rows: countRows } = await query(
          "SELECT count(*)::int AS n FROM accounts WHERE role = 'Super Admin' AND active = true AND id <> $1",
          [req.params.id],
        );
        if (countRows[0].n === 0) {
          return res.status(409).json({ error: 'The last active Super Admin cannot be deactivated or demoted' });
        }
      }
      if (provider() === 'local' && !ADMIN_ROLES.includes(v.role) && !v.pin && !existing.pin_digest) return res.status(400).json({ error: 'Set a PIN for this employee' });
      if (provider() === 'local' && ADMIN_ROLES.includes(v.role) && !v.password && !existing.password_hash) return res.status(400).json({ error: 'Set a password for this administrator' });
      const passwordHash = v.password
        ? await bcrypt.hash(v.password, 12)
        : null;
      const { rows } = await query(
        `UPDATE accounts
            SET name = $2, first_name = $3, middle_name = $4, middle_initial = $5, last_name = $6,
                role = $7, email = $8, phone = $9, birthdate = $10,
                pin_digest = CASE WHEN $7 IN ('Admin','Super Admin') THEN NULL ELSE coalesce($11,pin_digest) END,
                branch_id = $12, password_hash = CASE WHEN $7 IN ('Admin','Super Admin') THEN coalesce($13,password_hash) ELSE NULL END, active = $14
          WHERE id = $1 RETURNING *`,
        [
          req.params.id, v.name, v.firstName, v.middleName, v.middleInitial, v.lastName,
          v.role, v.email, v.phone, v.birthdate,
          v.pin ? pinDigest(v.pin) : null, v.branchId, passwordHash, v.active,
        ],
      );
      if (v.active) {
        await unlockEmail(existing.email);
        await unlockEmail(v.email);
      }
      res.json(mapAccount(rows[0]));
    } catch (err) {
      sendDbError(res, err, next);
    }
  });

  router.post('/:id/unlock', requireSession({ roles: ADMIN_ROLES, permission: 'manage_users' }), async (req, res, next) => {
    try {
      const { rows: existingRows } = await query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Account not found' });
      if (!requesterMayManage(req.account, existing.role)) return res.status(403).json({ error: 'Forbidden' });

      await unlockEmail(existing.email);
      let row = existing;
      if (!existing.active) {
        const { rows } = await query('UPDATE accounts SET active = true WHERE id = $1 RETURNING *', [req.params.id]);
        row = rows[0] || existing;
      }
      res.json(mapAccount(row));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requireSession({ roles: ADMIN_ROLES, permission: 'manage_users' }), async (req, res, next) => {
    try {
      const { rows: existingRows } = await query('SELECT * FROM accounts WHERE id = $1', [req.params.id]);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Account not found' });
      if (!requesterMayManage(req.account, existing.role)) return res.status(403).json({ error: 'Forbidden' });

      if (existing.role === 'Super Admin') {
        const { rows } = await query("SELECT count(*)::int AS n FROM accounts WHERE role = 'Super Admin'");
        if (rows[0].n <= 1) return res.status(409).json({ error: 'The last Super Admin cannot be deleted' });
      }
      await query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { accountRoutes };
