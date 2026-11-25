const { createClient } = require('@supabase/supabase-js');

function provider() {
  const name = process.env.AUTH_PROVIDER || 'local';
  if (!['local', 'supabase'].includes(name)) throw new Error('Unknown AUTH_PROVIDER');
  return name;
}

function authClient() {
  const url = new URL(process.env.SUPABASE_URL);
  if (url.protocol !== 'https:' || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Configure an HTTPS SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
  }
  return createClient(url.origin, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000), redirect: 'error' }) },
  }).auth;
}

module.exports = { provider, authClient };
