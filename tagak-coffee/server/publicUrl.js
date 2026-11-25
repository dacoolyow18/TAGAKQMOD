/**
 * Resolve the public origin of the deployed app.
 * Explicit PUBLIC_BASE_URL wins; otherwise use the hosting platform's URL.
 */
function publicBaseUrl() {
  const port = Number(process.env.PORT) || 3000;
  const explicit = (process.env.PUBLIC_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const renderUrl = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (renderUrl) return renderUrl.replace(/\/$/, '');

  const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railwayDomain) return `https://${railwayDomain.replace(/\/$/, '')}`;

  return `http://localhost:${port}`;
}

module.exports = { publicBaseUrl };
