// ---------------------------------------------------------------------------
// Gate dell'INTERO sito in produzione (Cloudflare Pages, functions/index.js).
// Decisione utente 25/11 sera: senza password giusta non si vede nulla.
// Riusa il secret CHAT_PASSWORD già configurato (nessun secret nuovo).
//
// Flusso: richiesta senza cookie valido → pagina login HTML (401).
// POST /__login con la password giusta → cookie HttpOnly firmato HMAC-SHA256
// (scadenza 30 giorni) → reload. Le /api/* rispondono 401 JSON, mai HTML.
// Fail-closed (D2): secret mancante = sito chiuso (503), non aperto.
// WebCrypto only: gira nel runtime Worker, nessuna dipendenza Node.
// ---------------------------------------------------------------------------

export const SITE_COOKIE = 'radar_site';
const MAX_AGE_S = 30 * 24 * 3600; // 30 giorni
const encoder = new TextEncoder();

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Confronto a tempo costante (niente timing attack su password o firma).
function timingSafeEqual(a, b) {
  const x = encoder.encode(String(a));
  const y = encoder.encode(String(b));
  let diff = x.length === y.length ? 0 : 1;
  const n = Math.max(x.length, y.length);
  for (let k = 0; k < n; k++) diff |= (x[k] || 0) ^ (y[k] || 0);
  return diff === 0;
}

export function passwordMatches(given, expected) {
  return Boolean(expected) && timingSafeEqual(given || '', expected);
}

export async function makeSiteCookie(secret, now = Date.now()) {
  const exp = now + MAX_AGE_S * 1000;
  const sig = toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(String(exp))));
  return `${SITE_COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_S}`;
}

export function clearSiteCookie() {
  return `${SITE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSiteCookie(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === SITE_COOKIE) return part.slice(eq + 1).trim();
  }
  return '';
}

export async function hasValidSiteCookie(request, secret, now = Date.now()) {
  if (!secret) return false;
  const raw = readSiteCookie(request);
  const dot = raw.indexOf('.');
  if (dot <= 0) return false;
  const exp = Number(raw.slice(0, dot));
  if (!Number.isFinite(exp) || exp <= now) return false;
  const sig = toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(String(exp))));
  return timingSafeEqual(raw.slice(dot + 1), sig);
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loginPageHtml(error = '') {
  // Stesse 5 palette del sito (site-src/theme.js), in versione ridotta: la
  // scelta radar-theme in localStorage vale anche qui (stessa origine).
  return `<!doctype html>
<html lang="it" data-theme="notte">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Radar Flip — accesso</title>
<style>
  :root, :root[data-theme="notte"] { color-scheme: dark;
    --bg: #0f1420; --panel: #1a2233; --line: #2c3a55; --ink: #e8ecf4;
    --muted: #9fb0cc; --input-line: #3a4a6b; --accent: #4a7dff;
    --accent-hover: #3a6af0; --on-accent: #fff; --err: #ff8a8a; }
  :root[data-theme="ardesia"] { color-scheme: dark;
    --bg: #1e242e; --panel: #262e3a; --line: #3a4553; --ink: #e6eaf1;
    --muted: #9aa7b8; --input-line: #4a5a6e; --accent: #60a5fa;
    --accent-hover: #4b93ef; --on-accent: #0b1220; --err: #f87171; }
  :root[data-theme="seppia"] { color-scheme: light;
    --bg: #eee5d3; --panel: #f8f2e5; --line: #d8cbb2; --ink: #40372a;
    --muted: #857761; --input-line: #c3b394; --accent: #a16207;
    --accent-hover: #8a5406; --on-accent: #fff; --err: #b02a37; }
  :root[data-theme="nebbia"] { color-scheme: light;
    --bg: #e8ecf1; --panel: #f6f8fa; --line: #d3dae3; --ink: #26313f;
    --muted: #64748b; --input-line: #b3bfcd; --accent: #2563eb;
    --accent-hover: #1d4ed8; --on-accent: #fff; --err: #b91c1c; }
  :root[data-theme="chiaro"] { color-scheme: light;
    --bg: #f3f5f8; --panel: #ffffff; --line: #dde3ea; --ink: #1c2430;
    --muted: #5b6b7f; --input-line: #c0cad6; --accent: #2563eb;
    --accent-hover: #1d4ed8; --on-accent: #fff; --err: #b91c1c; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: var(--bg); color: var(--ink);
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  form { width: min(92vw, 360px); padding: 28px 24px; border-radius: 14px;
         background: var(--panel); border: 1px solid var(--line);
         box-shadow: 0 12px 40px rgba(0,0,0,.25); }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p.sub { margin: 0 0 18px; font-size: 13px; color: var(--muted); }
  label { display: block; font-size: 13px; margin-bottom: 6px; color: var(--muted); }
  input, select { width: 100%; padding: 10px 12px; border-radius: 8px; font-size: 16px;
          border: 1px solid var(--input-line); background: var(--bg); color: var(--ink); }
  input:focus, select:focus { outline: 2px solid var(--accent); border-color: transparent; }
  button { width: 100%; margin-top: 14px; padding: 10px 12px; border: 0;
           border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;
           background: var(--accent); color: var(--on-accent); }
  button:hover { background: var(--accent-hover); }
  .err { margin: 12px 0 0; font-size: 13px; color: var(--err); }
  .theme-row { margin-top: 16px; }
  .theme-row select { font-size: 13px; padding: 6px 10px; }
</style>
<script>
  (function () {
    var ids = ['chiaro', 'nebbia', 'seppia', 'ardesia', 'notte'];
    var saved = 'notte';
    try { var s = localStorage.getItem('radar-theme'); if (ids.indexOf(s) >= 0) saved = s; } catch (e) {}
    document.documentElement.setAttribute('data-theme', saved);
  })();
</script>
</head>
<body>
<form method="POST" action="/__login">
  <h1>🔒 Radar Flip</h1>
  <p class="sub">Sito privato: inserisci la password per accedere.</p>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
  <input type="hidden" id="next" name="next" value="">
  <button type="submit">Entra</button>
  ${error ? `<p class="err">${escHtml(error)}</p>` : ''}
  <div class="theme-row">
    <label for="tema">Tema</label>
    <select id="tema">
      <option value="chiaro">☀️ Chiaro</option>
      <option value="nebbia">🌤️ Nebbia</option>
      <option value="seppia">📜 Seppia</option>
      <option value="ardesia">🌆 Ardesia</option>
      <option value="notte">🌙 Notte</option>
    </select>
  </div>
</form>
<script>
  (function () {
    var sel = document.getElementById('tema');
    sel.value = document.documentElement.getAttribute('data-theme') || 'notte';
    sel.addEventListener('change', function () {
      document.documentElement.setAttribute('data-theme', sel.value);
      try { localStorage.setItem('radar-theme', sel.value); } catch (e) {}
    });
    // Preferito con vista (#/portale/vista?...): dopo il login si torna lì.
    document.getElementById('next').value = location.hash || '';
  })();
</script>
</body>
</html>`;
}

export function loginPageResponse(error = '', status = 401, extraHeaders = {}) {
  return new Response(loginPageHtml(error), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      ...extraHeaders,
    },
  });
}

export function jsonError(error, status, extraHeaders = {}) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...extraHeaders } });
}