const path = require('path');
const express = require('express');
const { authRoutes } = require('./auth/routes');
const { googleRoutes } = require('./auth/google');
const { branchRoutes, publicBranchRoutes } = require('./routes/branches');
const { accountRoutes } = require('./routes/accounts');
const { permissionsRoutes } = require('./routes/permissions');
const { settingsRoutes, publicSettingsRoutes, storeRoutes } = require('./routes/settings');
const { supplyRoutes } = require('./routes/supplies');
const { cashLogRoutes } = require('./routes/cashLogs');
const { menuItemRoutes, publicMenuRoutes } = require('./routes/menuItems');
const { addOnRoutes, publicAddOnRoutes } = require('./routes/addOns');
const { carouselRoutes, publicCarouselRoutes, UPLOAD_ROOT } = require('./routes/carousel');
const { orderRoutes } = require('./routes/orders');
const { publicOrderRoutes } = require('./routes/publicOrders');

const ROOT = path.join(__dirname, '..');
const { publicBaseUrl } = require('./publicUrl');
const { COOKIE, findSession, readCookie } = require('./auth/sessions');
const { rateLimit } = require('./middleware/rateLimit');
const HIDDEN_ENTRIES = new Set([
  'server', 'server.js', 'db', 'docs', 'tests', 'test-results', 'playwright-report',
  'node_modules', 'package.json', 'package-lock.json', 'playwright.config.js', '.superpowers',
  'scripts', 'public', 'vercel.json', 'readme.md', 'google_sso_setup.md',
]);

const { DEPLOYMENT_HEADERS } = require('./securityHeaders');

function securityHeaders(req, res, next) {
  const https = publicBaseUrl().startsWith('https://');
  for (const { key, value } of DEPLOYMENT_HEADERS) {
    if (key !== 'Strict-Transport-Security' || https) res.setHeader(key, value);
  }
  next();
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  const origin = req.get('origin');
  if (!origin && process.env.NODE_ENV === 'production' && req.get('cookie')) return res.sendStatus(403);
  if (!origin && fetchSite && fetchSite !== 'same-origin') return res.sendStatus(403);
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(publicBaseUrl()).origin) {
        return res.status(403).json({ error: 'Cross-origin request blocked' });
      }
    } catch (_) {
      return res.status(403).json({ error: 'Invalid request origin' });
    }
  }
  return next();
}

function hideInternalFiles(req, res, next) {
  let parts;
  try {
    parts = decodeURIComponent(req.path).replace(/\\/g, '/').split('/').filter(Boolean);
  } catch (_) {
    return res.status(400).type('text/plain').send('Bad request');
  }
  const first = (parts[0] || '').toLowerCase();
  if (parts.some(part => part.startsWith('.')) || HIDDEN_ENTRIES.has(first)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  next();
}

function createApp({ windowMs = 15 * 60 * 1000, maxAttempts = 10, app = express() } = {}) {
  if (process.env.NODE_ENV === 'production' && new URL(publicBaseUrl()).protocol !== 'https:') throw new Error('Production requires an HTTPS public origin');
  const trustProxy = (process.env.TRUST_PROXY || '').trim();
  if (trustProxy === 'true') app.set('trust proxy', 1);
  else if (/^\d+$/.test(trustProxy)) app.set('trust proxy', Number(trustProxy));
  else if (trustProxy) app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  const xendit = require('./xendit');
  app.post('/api/webhooks/xendit', xendit.verifyToken, express.json({ limit: '100kb' }), xendit.webhook);
  const simulation = xendit.simulationEnabled();
  app.get('/api/xendit/enabled', (req, res) => res.json({ enabled: xendit.enabled(), simulation: xendit.simulationEnabled() }));
  app.get('/api/xendit/status/:id', rateLimit({ routeKey: 'checkout-status', max: 240, countAll: true }), xendit.checkoutStatus);
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  }, csrfProtection);
  if (simulation) app.post('/api/xendit/simulate/:id', rateLimit({ routeKey: 'checkout-simulation', countAll: true }), xendit.simulateCheckout);

  app.use('/api/auth', authRoutes({ windowMs, maxAttempts }));
  app.use('/api/branches', branchRoutes());
  app.use('/api/accounts', accountRoutes());
  app.use('/api/permissions', permissionsRoutes());
  app.use('/api/settings', settingsRoutes());
  app.use('/api/store', storeRoutes());
  app.use('/api/supplies', supplyRoutes());
  app.use('/api/cash-logs', cashLogRoutes());
  app.use('/api/menu-items', menuItemRoutes());
  app.use(['/api/public/menu', '/api/public/branches', '/api/public/settings', '/api/public/add-ons', '/api/public/carousel'],
    rateLimit({ routeKey: 'public-catalog', windowMs: 60000, max: 600, countAll: true }));
  app.use('/api/public/menu', publicMenuRoutes());
  app.use('/api/add-ons', addOnRoutes());
  app.use('/api/public/add-ons', publicAddOnRoutes());
  app.use('/api', carouselRoutes());
  app.use('/api/public/carousel', publicCarouselRoutes());
  app.use('/api/public/branches', publicBranchRoutes());
  app.use('/api/public/settings', publicSettingsRoutes());
  app.use('/api/pos/offline', require('./routes/offlinePos'));
  // Serverless hosts suspend timers between requests. Refresh due cash tickets
  // when an order or telemetry read arrives, at most once per second per instance.
  let lastExpiry = 0;
  let expirySweep;
  app.use(['/api/orders', '/api/public/orders', '/api/qmodsim'], async (req, res, next) => {
    if (!app.locals.serverless || req.method !== 'GET') return next();
    try {
      if (Date.now() - lastExpiry >= 1000) {
        expirySweep ||= require('./cashExpiry').expireCash().then(() => { lastExpiry = Date.now(); })
          .finally(() => { expirySweep = null; });
        await expirySweep;
      }
      next();
    } catch (err) { next(err); }
  });
  app.use('/api/qmodsim', require('./routes/qmodsim').qmodsimRoutes());
  app.use('/api/orders', orderRoutes());
  app.use('/api/public/orders', publicOrderRoutes());
  app.use('/uploads', require('./media').serve, express.static(UPLOAD_ROOT, { dotfiles: 'deny', index: false }));
  app.use(googleRoutes());

  app.use(hideInternalFiles);
  const entryLinks = [
    [['/', '/customer'], '/customer-app/index.html'],
    [['/unified-login', '/login'], '/unified-login/index.html'],
    ['/pos', '/pos-app/index.html'],
    ['/admin', '/admin-app/index.html'],
  ];
  for (const [paths, destination] of entryLinks) {
    app.get(paths, (req, res) => res.redirect(302, destination + req.url.slice(req.path.length)));
  }
  app.get(['/admin-app', '/admin-app/', '/admin-app/index.html'], async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const token = readCookie(req, COOKIE);
      const account = token && await findSession(token);
      if (!account) return res.redirect('/unified-login/index.html?app=admin');
      if (!['Admin', 'Super Admin'].includes(account.role)) return res.sendStatus(403);
      return res.sendFile(path.join(ROOT, 'admin-app', 'index.html'));
    } catch (err) { return next(err); }
  });
  app.use(express.static(path.join(ROOT, 'public'), { dotfiles: 'deny', index: false }));

  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    console.error('Request failed', { method: req.method, code: err.code, status: err.status, message: err.message });
    if ([400, 409, 429].includes(err.status) && err.message) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

module.exports = { createApp };

