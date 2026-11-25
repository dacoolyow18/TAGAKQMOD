const { query } = require('../db/pool');
const { COOKIE, findSession, readCookie } = require('./auth/sessions');
const { text } = require('./validate');

/**
 * Resolve the effective branch for an authenticated request.
 * Branch-assigned accounts are strictly locked to their own branch (`req.account.branchId`)
 * and cannot read or mutate another branch even if they pass a different `branchId`.
 * Unassigned Admin / Super Admin accounts may optionally pass `branchId` in query, body, or header.
 */
function resolveSessionBranch(req) {
  const requested = text(req.query?.branchId)
    || text(req.body?.branchId)
    || text(req.headers?.['x-branch-id'])
    || null;

  const accountBranch = req.account?.branchId || null;
  if (accountBranch) {
    if (requested && requested !== accountBranch) {
      return { error: 'Forbidden', status: 403, branchId: accountBranch };
    }
    return { branchId: accountBranch };
  }

  return { branchId: requested };
}

/**
 * Resolve the branch for a public/customer endpoint:
 * 1. Explicit `?branchId=...` or `X-Branch-Id` header.
 * 2. Active authenticated session's `branchId` (if called from POS without query param).
 * 3. When only a single branch exists in the database, default to that branch;
 *    when multiple branches exist and none was specified, return `null` so no branch data leaks.
 */
async function resolvePublicBranchId(req) {
  const explicit = text(req.query?.branchId) || text(req.headers?.['x-branch-id']) || null;
  if (explicit) return explicit;

  const token = readCookie(req, COOKIE);
  if (token) {
    const account = await findSession(token).catch(() => null);
    if (account?.branchId) return account.branchId;
  }

  const { rows } = await query('SELECT id FROM branches ORDER BY code LIMIT 2');
  if (rows.length === 1) return rows[0].id;
  return null;
}

/** Safe filesystem path segment for a branch ID. */
function safeBranchDir(branchId) {
  if (!branchId) return null;
  const cleaned = String(branchId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || null;
}

/**
 * SQL ownership test for branch-owned rows (menu items, supplies, add-ons).
 * A row belongs to exactly one branch. Legacy rows with no branch_id belong to the
 * primary (oldest) branch only, so they never appear in any other branch.
 */
function ownedBy(param, column = 'branch_id') {
  // Always yields true/false (never NULL), so `NOT ownedBy(...)` is safe.
  // With no branch given, only unowned rows match, and only while no branch exists.
  return `(CASE WHEN ${param}::text IS NULL
      THEN (${column} IS NULL AND primary_branch_id() IS NULL)
      ELSE (${column} IS NOT DISTINCT FROM ${param}::text
            OR (${column} IS NULL AND ${param}::text IS NOT DISTINCT FROM primary_branch_id()))
    END)`;
}

/** Session scope: unassigned Super Admin (NULL) sees every branch; staff see only their own. */
function sessionOwned(param, column = 'branch_id') {
  return `(${param}::text IS NULL OR ${ownedBy(param, column)})`;
}

/**
 * Public/customer scope: a resolved branch sees only its own rows. With no branch
 * resolved, only unowned rows are shown, and only while no branch exists at all.
 */
function publicOwned(param, column = 'branch_id') {
  return ownedBy(param, column);
}

module.exports = {
  ownedBy,
  sessionOwned,
  publicOwned,
  resolveSessionBranch,
  resolvePublicBranchId,
  safeBranchDir,
};
