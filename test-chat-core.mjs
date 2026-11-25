// Test del nucleo chat condiviso locale/cloud (core/chat-core.mjs):
// contratto handleChatCore con LLM mockato — nessun costo, nessuna rete.
// Uso: node test-chat-core.mjs

import assert from 'node:assert';
import { handleChatCore, resultContext } from './core/chat-core.mjs';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`✅ ${name}`); };

const ads = [1, 2, 3].map((i) => ({
  id: `a${i}`, portale: 'test', titolo: `Bilocale ${i}`, comune: 'Bologna', zona: 'Bologna / Centro',
  prezzo: 80000 + i * 1000, superficieMq: 55, prezzoMq: '1500 €/m²', stato: 'Da ristrutturare',
  descrizione: 'Da ristrutturare.', flip: { reno: { candidato: true, roi: 20 + i, margineNetto: 20000, semaforo: 'verde' } },
}));
const data = { global: { ads } };
const cfg = { enabled: true, provider: 'mock', model: 'mock-1', apiKey: 'x', baseUrl: 'http://mock' };
const okChat = (action) => async () => ({ ok: true, data: action });
const gate = (allow = true) => ({ budgetOk: () => allow, pushCall: () => {} });

await ok('LLM non configurato → 503', async () => {
  const r = await handleChatCore({ cfg: { ...cfg, enabled: false }, data, body: { messages: [{ role: 'user', content: 'ciao' }] }, aiChat: okChat({}), ...gate() });
  assert.equal(r.status, 503);
});

await ok('messaggio user mancante → 400', async () => {
  const r = await handleChatCore({ cfg, data, body: { messages: [] }, aiChat: okChat({}), ...gate() });
  assert.equal(r.status, 400);
});

await ok('dati mancanti → 500', async () => {
  const r = await handleChatCore({ cfg, data: {}, body: { messages: [{ role: 'user', content: 'ciao' }] }, aiChat: okChat({}), ...gate() });
  assert.equal(r.status, 500);
});

await ok('budget esaurito → 429 fail-closed', async () => {
  const r = await handleChatCore({ cfg, data, body: { messages: [{ role: 'user', content: 'ciao' }] }, aiChat: okChat({}), ...gate(false) });
  assert.equal(r.status, 429);
});

await ok('errore LLM → 502 senza throw', async () => {
  const r = await handleChatCore({ cfg, data, body: { messages: [{ role: 'user', content: 'ciao' }] }, aiChat: async () => ({ ok: false, error: 'boom' }), ...gate() });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /boom/);
});

await ok('azione filter valida → 200 con rows reali', async () => {
  const r = await handleChatCore({
    cfg, data,
    body: { messages: [{ role: 'user', content: 'bilocali sotto 90k' }] },
    aiChat: async (c, msgs) => msgs.some((m) => m.content.includes('Commenta'))
      ? { ok: true, data: { commento: 'Ecco i risultati.' } }
      : { ok: true, data: { action: 'filter', prezzoMax: 90000 } },
    ...gate(),
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.action, 'filter');
  assert.equal(r.json.totale, 3);
  assert.ok(r.json.rows.every((row) => ads.some((a) => a.id === row.id)));
});

await ok('azione sconosciuta dal modello → clarify (fail-closed)', async () => {
  const r = await handleChatCore({
    cfg, data,
    body: { messages: [{ role: 'user', content: 'compra tutto' }] },
    aiChat: okChat({ action: 'compra', id: 'inventato' }),
    ...gate(),
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.action, 'clarify');
});

await ok('resultContext: solo campi reali, max 12 righe', () => {
  const ctx = resultContext({ action: 'filter', filtro: { prezzoMax: 90000 }, totale: 30, rows: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, prezzo: 1 })) });
  assert.match(ctx, /prezzoMax/);
  const ids = ctx.match(/"id":"x\d+"/g);
  assert.equal(ids.length, 12);
  assert.equal(resultContext({ action: 'clarify' }), '');
});

console.log(`\n${n} test passati.`);