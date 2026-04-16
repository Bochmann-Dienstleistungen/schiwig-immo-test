/**
 * Schiwig Immobilien — Cloudflare Worker
 * Zentraler API-Proxy: Anthropic + Propstack
 * Alle Keys liegen serverseitig — kein Key im Browser.
 *
 * Endpoints:
 *   POST /scan                          → Anthropic Vision API
 *   GET  /propstack/units               → Propstack Units lesen
 *   POST /propstack/contacts            → Propstack Kontakt anlegen
 *   POST /propstack/contacts/:id/notes  → Propstack Notiz hinzufügen
 *
 * Secrets (via: wrangler secret put <NAME>):
 *   ANTHROPIC_KEY
 *   PROPSTACK_KEY        (Kontakte schreiben)
 *   PROPSTACK_UNITS_KEY  (Einheiten lesen)
 */

const ALLOWED_ORIGINS = [
  'https://bochmann-dienstleistungen.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'file://',
];

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.some(o => (origin || '').startsWith(o));
  return {
    'Access-Control-Allow-Origin':  ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url    = new URL(request.url);
    const path   = url.pathname;

    // ── Preflight ──────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ── POST /scan → Anthropic Vision ──────────────────────────
    if (path === '/scan' && request.method === 'POST') {
      if (!env.ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_KEY not set' }, 500, origin);

      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, origin); }

      body.model      = body.model || 'claude-opus-4-6';
      body.max_tokens = Math.min(body.max_tokens || 1024, 2048);

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      return json(await res.json(), res.status, origin);
    }

    // ── Propstack proxy ────────────────────────────────────────
    // Routes: /propstack/*  →  https://api.propstack.de/v1/*
    if (path.startsWith('/propstack/')) {
      const psPath = path.replace('/propstack', '');
      const psUrl  = 'https://api.propstack.de/v1' + psPath + url.search;

      // GET requests use the read-only units key, POST use the contacts key
      const apiKey = request.method === 'GET'
        ? env.PROPSTACK_UNITS_KEY
        : env.PROPSTACK_KEY;

      if (!apiKey) return json({ error: 'Propstack key not configured' }, 500, origin);

      const headers = {
        'Content-Type': 'application/json',
        'X-API-KEY':    apiKey,
      };

      let body;
      if (request.method === 'POST') {
        try { body = JSON.stringify(await request.json()); } catch { body = '{}'; }
      }

      const res = await fetch(psUrl, { method: request.method, headers, body });
      return json(await res.json(), res.status, origin);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  }
};
