/**
 * Schiwig Immobilien — Cloudflare Worker
 * Anthropic API Proxy (hält den Key serverseitig)
 *
 * Setup:
 *   1. npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler secret put ANTHROPIC_KEY   ← gibt deinen sk-ant-... Key ein
 *   4. wrangler deploy
 *
 * Endpoint: POST https://schiwig-scanner.<dein-subdomain>.workers.dev/scan
 */

const ALLOWED_ORIGINS = [
  'https://bochmann-dienstleistungen.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.some(o => origin?.startsWith(o)) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const { pathname } = new URL(request.url);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // POST /scan → Anthropic Vision proxy
    if (pathname === '/scan' && request.method === 'POST') {
      if (!env.ANTHROPIC_KEY) {
        return new Response(JSON.stringify({ error: 'ANTHROPIC_KEY not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      let body;
      try { body = await request.json(); }
      catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: corsHeaders(origin) }); }

      // Enforce model + reasonable limits
      body.model = body.model || 'claude-opus-4-6';
      body.max_tokens = Math.min(body.max_tokens || 1024, 2048);

      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await upstream.json();
      return new Response(JSON.stringify(data), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  }
};
