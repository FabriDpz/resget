// ---------------------------------------------------------------------------
// Difesa in profondità per le sole /api/* (il gate dell'INTERO sito è
// functions/_middleware.js radice, che gira prima di questo). Stesso contratto:
// cookie di sito valido OPPURE header X-Chat-Auth (client legacy) → next().
// Fail-closed (D2): segreto non configurato = chiuso, non aperto.
// ---------------------------------------------------------------------------

import { passwordMatches, hasValidSiteCookie } from '../../core/site-auth.mjs';

export async function onRequest(context) {
  const { request, env, next } = context;
  const expected = env.CHAT_PASSWORD;
  if (!expected) {
    return Response.json({ error: 'Sito non configurato (secret CHAT_PASSWORD mancante).' }, { status: 503 });
  }
  if (await hasValidSiteCookie(request, expected)) return next();
  if (passwordMatches(request.headers.get('X-Chat-Auth') || '', expected)) return next();
  return Response.json({ error: 'Accesso al sito richiesto: ricarica la pagina e inserisci la password.', auth: 'required' }, { status: 401 });
}