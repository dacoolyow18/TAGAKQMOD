const { COOKIE, findSession, readCookie } = require('../auth/sessions');

function requireSession({ roles, permission, allPermissions } = {}) {
  return async function requireSessionMiddleware(req, res, next) {
    try {
      res.set('Cache-Control', 'private, no-store');
      const token = readCookie(req, COOKIE);
      const account = token ? await findSession(token) : null;
      if (!account) return res.status(401).json({ error: 'Not signed in' });

      if (!account.branchId && !['Admin', 'Super Admin'].includes(account.role)) return res.sendStatus(403);
      if (roles && !roles.includes(account.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const granted = key => account.permissions[key] === true;
      const any = Array.isArray(permission) ? permission : [permission];
      if ((permission && !any.some(granted)) || (allPermissions && !allPermissions.every(granted))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.account = account;
      req.sessionToken = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireSession };
