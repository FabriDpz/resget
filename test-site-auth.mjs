// Test del gate dell'intero sito (core/site-auth.mjs + functions/_middleware.js):
// nessun browser, nessuna rete — Request/Response e WebCrypto sono globali
// in Node ≥18, gli stessi del runtime Worker. Uso: node test-site-auth.mjs

import assert from 'node:assert';
import {
  SITE_COOKIE, passwordMatches, makeSiteCookie, readSiteCookie,
  hasValidSiteCookie, loginPageHtml,
} from './core/site-auth.mjs';
import { onRequest as gate } from './functions/_middleware.js';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`✅ ${name}`); };

const SECRET = 'pw-di-test';
const req = (path, opts = {}) => new Request(`https://radar.example${path}`, opts);
const ctx = (request, env = { CHAT_PASSWORD: SECRET }) => ({
  request, env, next: async () => new Response('ASSET', { status: 200 }),
});
const cookieValue = (setCookie) => setCookie.split(';')[0];

await ok('password: giusta ok, errata/vuota no, secret assente fail-closed', () => {
  assert.equal(passwordMatches(SECRET, SECRET), true);
  assert.equal(passwordMatches('altra', SECRET), false);
  assert.equal(passwordMatches(SECRET + 'x', SECRET), false);
  assert.equal(passwordMatches('', SECRET), false);
  assert.equal(passwordMatches('', ''), false);
});

await ok('cookie firmato valido; manomissione/scadenza/secret diversi → no', async () => {
  const set = await makeSiteCookie(SECRET);
  assert.match(set, /HttpOnly/); assert.match(set, /Secure/); assert.match(set, /SameSite=Lax/);
  const r = req('/', { headers: { Cookie: cookieValue(set) } });
  assert.equal(readSiteCookie(r), cookieValue(set).slice(SITE_COOKIE.length + 1));
  assert.equal(await hasValidSiteCookie(r, SECRET), true);
  assert.equal(await hasValidSiteCookie(r, 'altro-secret'), false);
  const [exp, sig] = readSiteCookie(r).split('.');
  const tampered = req('/', { headers: { Cookie: `${SITE_COOKIE}=${Number(exp) + 1000}.${sig}` } });
  assert.equal(await hasValidSiteCookie(tampered, SECRET), false);
  const expired = await makeSiteCookie(SECRET, Date.now() - 31 * 24 * 3600 * 1000);
  assert.equal(await hasValidSiteCookie(req('/', { headers: { Cookie: cookieValue(expired) } }), SECRET), false);
  assert.equal(await hasValidSiteCookie(req('/'), SECRET), false);
  assert.equal(await hasValidSiteCookie(req('/', { headers: { Cookie: `${SITE_COOKIE}=spazzatura` } }), SECRET), false);
});

await ok('GET / senza cookie → 401 pagina login HTML, non l\'asset', async () => {
  const resp = await gate(ctx(req('/')));
  assert.equal(resp.status, 401);
  assert.match(resp.headers.get('Content-Type'), /text\/html/);
  const html = await resp.text();
  assert.match(html, /action="\/__login"/);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /ASSET/);
});

await ok('GET /data.js senza cookie → login anche per gli asset dati', async () => {
  const resp = await gate(ctx(req('/data.js')));
  assert.equal(resp.status, 401);
  assert.match(await resp.text(), /__login/);
});

await ok('GET / con cookie valido → next() (asset servito)', async () => {
  const set = await makeSiteCookie(SECRET);
  const resp = await gate(ctx(req('/', { headers: { Cookie: cookieValue(set) } })));
  assert.equal(resp.status, 200);
  assert.equal(await resp.text(), 'ASSET');
});

await ok('/api/* senza cookie → 401 JSON, mai HTML', async () => {
  const resp = await gate(ctx(req('/api/chat/status')));
  assert.equal(resp.status, 401);
  assert.match(resp.headers.get('Content-Type'), /application\/json/);
  assert.match((await resp.json()).error, /ricarica/i);
});

await ok('POST /__login giusta → 303 + Set-Cookie firmato; errata → 401 login', async () => {
  const form = (pw) => ({ method: 'POST', body: new URLSearchParams({ password: pw }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const good = await gate(ctx(req('/__login', form(SECRET))));
  assert.equal(good.status, 303);
  assert.equal(good.headers.get('Location'), '/');
  const set = good.headers.get('Set-Cookie');
  assert.ok(set.startsWith(`${SITE_COOKIE}=`));
  // Il cookie emesso dal login deve davvero aprire il gate.
  const after = await gate(ctx(req('/', { headers: { Cookie: cookieValue(set) } })));
  assert.equal(await after.text(), 'ASSET');

  const bad = await gate(ctx(req('/__login', form('sbagliata'))));
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /Password errata/);
  assert.match(bad.headers.get('Set-Cookie'), /Max-Age=0/);
});

await ok('POST /__login con next=#/vista → redirect al preferito; next esterno → /', async () => {
  const form = (extra) => ({ method: 'POST', body: new URLSearchParams({ password: SECRET, ...extra }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const good = await gate(ctx(req('/__login', form({ next: '#/global/big?extra=Selezionato' }))));
  assert.equal(good.status, 303);
  assert.equal(good.headers.get('Location'), '/#/global/big?extra=Selezionato');
  for (const evil of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/api/chat']) {
    const r = await gate(ctx(req('/__login', form({ next: evil }))));
    assert.equal(r.headers.get('Location'), '/', `next=${evil} non deve uscire dal sito`);
  }
});

await ok('secret mancante → 503 fail-closed (HTML e API), mai next()', async () => {
  const html = await gate(ctx(req('/'), {}));
  assert.equal(html.status, 503);
  const api = await gate(ctx(req('/api/chat'), {}));
  assert.equal(api.status, 503);
});

await ok('pagina login: errore escapato, niente XSS', () => {
  // La pagina contiene script legittimi (tema): il payload non deve passare.
  const html = loginPageHtml('<script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

await ok('pagina login: 5 temi dal chiaro allo scuro, default notte', () => {
  const html = loginPageHtml();
  for (const id of ['chiaro', 'nebbia', 'seppia', 'ardesia', 'notte']) {
    assert.ok(html.includes(`data-theme="${id}"`), `palette ${id} presente`);
    assert.ok(html.includes(`<option value="${id}">`), `opzione ${id} presente`);
  }
  assert.match(html, /<html lang="it" data-theme="notte">/);
  assert.match(html, /localStorage\.getItem\('radar-theme'\)/);
});

console.log(`\n${n} test passati.`);