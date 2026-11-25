// ---------------------------------------------------------------------------
// Gate dell'INTERO sito in produzione (decisione utente 25/11 sera).
// DEVE essere un _middleware.js radice, non index.js: in Pages i middleware
// matchano ogni path (anche /data.js, /app.js, …), i moduli solo il loro path
// esatto. Con _routes.json include ["/*"] ogni richiesta passa di qui.
//   - POST /__login  → verifica password, set-cookie firmato, redirect /
//   - cookie valido (o X-Chat-Auth sulle API, client legacy) → next()
//   - /api/* non autenticato → 401 JSON (il client sa che deve ricaricare)
//   - tutto il resto → pagina login HTML (401)
// Fail-closed (D2): CHAT_PASSWORD non configurato = sito chiuso (503).
// ---------------------------------------------------------------------------

import {
  passwordMatches, makeSiteCookie, clearSiteCookie,
  hasValidSiteCookie, loginPageResponse, jsonError,
} from '../core/site-auth.mjs';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const secret = env.CHAT_PASSWORD;
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

  if (!secret) {
    return isApi
      ? jsonError('Sito non configurato (secret CHAT_PASSWORD mancante).', 503)
      : loginPageResponse('Sito non configurato: secret CHAT_PASSWORD mancante.', 503);
  }

  if (url.pathname === '/__login' && request.method === 'POST') {
    let pw = '';
    let next = '';
    try {
      const form = await request.formData();
      pw = String(form.get('password') || '');
      next = String(form.get('next') || '');
    } catch { /* body non form: trattato come password errata */ }
    if (!passwordMatches(pw, secret)) {
      return loginPageResponse('Password errata. Riprova.', 401, { 'Set-Cookie': clearSiteCookie() });
    }
    // Ritorno alla vista del preferito: solo hash routing interno, mai URL esterne.
    const dest = /^#\/[^\\/]/.test(next) ? '/' + next : '/';
    return new Response(null, {
      status: 303,
      headers: { Location: dest, 'Set-Cookie': await makeSiteCookie(secret), 'Cache-Control': 'no-store' },
    });
  }

  if (await hasValidSiteCookie(request, secret)) return next();
  // Client legacy della chat (header invece del cookie): solo sulle API.
  if (isApi && passwordMatches(request.headers.get('X-Chat-Auth') || '', secret)) return next();

  return isApi
    ? jsonError('Accesso al sito richiesto: ricarica la pagina e inserisci la password.', 401)
    : loginPageResponse();
}