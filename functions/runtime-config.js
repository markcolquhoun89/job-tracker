/**
 * Cloudflare Pages Function
 * Exposes runtime env vars to the client as a JS payload.
 */
export function onRequest(context) {
  const env = context.env || {};

  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';

  const payload = `window.RUNTIME_ENV = Object.assign({}, window.RUNTIME_ENV || {}, { VITE_SUPABASE_URL: ${JSON.stringify(url)}, VITE_SUPABASE_ANON_KEY: ${JSON.stringify(key)} });`;

  return new Response(payload, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  });
}
