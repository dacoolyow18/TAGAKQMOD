// Response headers applied by the Express server.
//
// These used to be read from vercel.json at runtime. Keeping them in code
// means the application boots without any hosting-provider configuration.
// The Content-Security-Policy still allows the optional Supabase Storage
// origin; remove those entries only after Supabase Storage is retired.
const DEPLOYMENT_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self'; script-src-attr 'none'; "
      + "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
      + "font-src 'self' https://fonts.gstatic.com; "
      + "img-src 'self' data: blob: https://*.supabase.co; "
      + "connect-src 'self' https://*.supabase.co; "
      + "media-src 'self' https://d8j0ntlcm91z4.cloudfront.net; "
      + "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  },
];

module.exports = { DEPLOYMENT_HEADERS };
