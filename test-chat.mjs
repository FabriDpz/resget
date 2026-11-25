// Test delle azioni chat (core/chat-actions.mjs) e di aiChat (core/ai.mjs).
// Modulo puro: dati fixture, nessun LLM reale né server.
// Uso: node test-chat.mjs

import assert from 'node:assert';
import {
  normalizeAction, executeAction, chatPool, datasetSummary, matchFilter, compactRow,
} from './core/chat-actions.mjs';
import { aiChat, chatUrl } from './core/ai.mjs';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`✅ ${name}`); };

const ad = (over = {}) => ({
  id: 'x1', portale: 'subito', titolo: 'Bilocale da ristrutturare',
  descrizione: 'Appartamento con ascensore, libero subito. Trattabile.',
  comune: 'Bologna', zona: 'Bologna / Centro', prezzo: 120000, superficieMq: 60,
  prezzoMq: 2000, camere: 1, stato: 'da ristrutturare', ascensore: 'sì',
  esito: 'Escluso', esitoSma: 'Selezionato', url: 'https://example/x1',
  distanzaKm: 1.2, poi: { rank: 55 },
  flip: {
    reno: { candidato: true, roi: 24.5, margineNetto: 28000, maxOffer: 105000, semaforo: 'verde', tipoLavori: 'ristrutturazione', costoLavori: 36000, arvTot: 190000 },
    stale: { score: 70, fascia: 'Alto', prezzoTarget: 98000, giorniOnline: 200, ribassi: 1, keyword: ['trattabil'] },
  },
  ledger: { nuovo: false, ribassatoOggi: true, firstSeen: '2026-05-01' },
  ...over,
});

const data = {
  generatedAt: '2026-11-24T00:00:00Z',
  global: {
    ads: [
      ad(),
      ad({ id: 'x2', comune: 'San Lazzaro di Savena', zona: 'San Lazzaro di Savena / Borgatella', prezzo: 129000, superficieMq: 75, prezzoMq: 1720, camere: 2, flip: { reno: { candidato: true, roi: 31, margineNetto: 40000, maxOffer: 118000, semaforo: 'verde' }, stale: { score: 40, fascia: 'Medio', prezzoTarget: 116000, giorniOnline: 90, ribassi: 0 } } }),
      ad({ id: 'x3', prezzo: 160000, stato: 'ottimo / ristrutturato', esito: 'Selezionato', flip: { reno: { candidato: false, motivoPool: 'stato senza margine' }, stale: { score: 10, fascia: 'Basso' } } }),
      ad({ id: 'x4', motivazione: 'Affitto, non vendita', prezzo: 600 }),
      ad({ id: 'x5', comune: 'Imola', zona: 'Imola / Centro' }),
      ad({ id: 'x6', prezzo: 99000, superficieMq: 45, prezzoMq: 2200, camere: null, camereAI: 1, ascensore: '', flip: { reno: { candidato: true, roi: 12, margineNetto: 9000, maxOffer: 90000, semaforo: 'giallo' }, stale: { score: 62, fascia: 'Alto', prezzoTarget: 81000, giorniOnline: 300, ribassi: 2 } } }),
    ],
  },
};

await ok('chatPool: esclude affitti, fuori comune e stati senza margine', () => {
  const ids = chatPool(data).map((a) => a.id).sort();
  assert.deepEqual(ids, ['x1', 'x2', 'x6']);
});

await ok('normalizeAction: azione sconosciuta → clarify (fail-closed)', () => {
  assert.equal(normalizeAction(null).action, 'clarify');
  assert.equal(normalizeAction({ action: 'drop-table' }).action, 'clarify');
  assert.equal(normalizeAction({ action: 'compare', ids: ['solo-uno'] }).action, 'clarify');
});

await ok('normalizeAction: filter pulisce numeri e stringhe', () => {
  const a = normalizeAction({ action: 'filter', prezzoMax: '130000', camereMin: 2, comune: ' San Lazzaro di Savena ', mqMin: 'abc', testo: 'x'.repeat(200) });
  assert.equal(a.prezzoMax, 130000);
  assert.equal(a.camereMin, 2);
  assert.equal(a.comune, 'San Lazzaro di Savena');
  assert.equal(a.mqMin, undefined);
  assert.equal(a.testo.length, 80);
});

await ok('normalizeAction: rank criterio ignoto → roi, n clampato', () => {
  const a = normalizeAction({ action: 'rank', criterio: 'inventato', n: 99 });
  assert.equal(a.criterio, 'roi');
  assert.equal(a.n, 10);
});

await ok('filter: prezzoMax + camereMin (camereAI come fallback)', () => {
  const res = executeAction(normalizeAction({ action: 'filter', prezzoMax: 130000, camereMin: 2 }), data);
  assert.equal(res.totale, 1);
  assert.equal(res.rows[0].id, 'x2');
  const res2 = executeAction(normalizeAction({ action: 'filter', prezzoMax: 100000 }), data);
  assert.deepEqual(res2.rows.map((r) => r.id), ['x6']); // camereAI=1 non blocca senza camereMin
});

await ok('filter: profilo SMA e testo ascensore', () => {
  const sma = executeAction(normalizeAction({ action: 'filter', profilo: 'SMA' }), data);
  assert.deepEqual(sma.rows.map((r) => r.id).sort(), ['x1', 'x2', 'x6']);
  // x6 ha ascensore: '' → il filtro lo esclude (campo mancante non passa).
  const asc = executeAction(normalizeAction({ action: 'filter', ascensore: 'sì' }), data);
  assert.deepEqual(asc.rows.map((r) => r.id).sort(), ['x1', 'x2']);
});

await ok('rank roi: ordinato desc, null esclusi', () => {
  const res = executeAction(normalizeAction({ action: 'rank', criterio: 'roi', n: 5 }), data);
  assert.deepEqual(res.rows.map((r) => r.id), ['x2', 'x1', 'x6']);
  assert.equal(res.rows[0].roi, 31);
});

await ok('rank pmq: crescente (più basso meglio)', () => {
  const res = executeAction(normalizeAction({ action: 'rank', criterio: 'pmq', n: 2 }), data);
  assert.deepEqual(res.rows.map((r) => r.id), ['x2', 'x1']);
});

await ok('rank con filtro: ROI solo sotto 100k', () => {
  const res = executeAction(normalizeAction({ action: 'rank', criterio: 'roi', n: 5, filtro: { prezzoMax: 100000 } }), data);
  assert.deepEqual(res.rows.map((r) => r.id), ['x6']);
});

await ok('compare: ids reali, missing segnalati, cards con descrizione troncata', () => {
  const res = executeAction(normalizeAction({ action: 'compare', ids: ['x1', 'x2', 'nope'] }), data);
  assert.equal(res.action, 'compare');
  assert.deepEqual(res.ids, ['x1', 'x2']);
  assert.deepEqual(res.missing, ['nope']);
  assert.equal(res.cards.length, 2);
  assert.ok(res.cards[0].descrizione.length <= 900);
});

await ok('compare senza id validi → clarify, nessuna esecuzione', () => {
  const res = executeAction(normalizeAction({ action: 'compare', ids: ['a', 'b'] }), data);
  assert.equal(res.action, 'clarify');
});

await ok('answer: scheda singola con motivazioni BIG/SMA', () => {
  const res = executeAction(normalizeAction({ action: 'answer', ids: ['x1'], domanda: 'perché escluso da BIG?' }), data);
  assert.equal(res.action, 'answer');
  assert.equal(res.cards.length, 1);
  assert.ok('motivazioneBig' in res.cards[0]);
});

await ok('compactRow: solo campi reali, niente descrizione', () => {
  const r = compactRow(chatPool(data)[0]);
  assert.equal(r.prezzo, 120000);
  assert.equal(r.roi, 24.5);
  assert.equal(r.staleScore, 70);
  assert.ok(!('descrizione' in r));
});

await ok('datasetSummary: conteggi e zone deterministiche', () => {
  const s = datasetSummary(data);
  assert.equal(s.annunci, 3);
  assert.equal(s.prezzoMin, 99000);
  assert.equal(s.prezzoMax, 129000);
  assert.ok(s.zone.includes('Borgatella'));
  assert.equal(s.candidatiReno, 3);
});

await ok('matchFilter: AND tra criteri, campo mancante non passa il filtro', () => {
  const a = ad({ distanzaKm: null });
  assert.equal(matchFilter(a, { distanzaMaxKm: 3 }), false);
  assert.equal(matchFilter(ad(), { zona: 'centro', prezzoMax: 120000 }), true);
});

// ------------------------------------------------ aiChat (fetch mockato)
await ok('chatUrl: token-plan compatible-mode, ollama /chat/completions', () => {
  assert.equal(chatUrl({ provider: 'token-plan', baseUrl: 'https://x.example' }), 'https://x.example/compatible-mode/v1/chat/completions');
  assert.equal(chatUrl({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1' }), 'http://localhost:11434/v1/chat/completions');
});

await ok('aiChat: JSON valido, history inoltrata, usage ritornata', async () => {
  const orig = globalThis.fetch;
  let seenBody = null;
  globalThis.fetch = async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"action":"filter","prezzoMax":130000}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
  try {
    const cfg = { provider: 'token-plan', baseUrl: 'https://x.example', model: 'm', apiKey: 'k' };
    const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
    const r = await aiChat(cfg, msgs);
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, { action: 'filter', prezzoMax: 130000 });
    assert.deepEqual(seenBody.messages, msgs);
    assert.equal(r.usage.prompt_tokens, 10);
  } finally { globalThis.fetch = orig; }
});

await ok('aiChat: HTTP 401 → errore, mai throw', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'denied' });
  try {
    const r = await aiChat({ provider: 'deepseek', baseUrl: 'https://x', model: 'm', apiKey: 'k' }, [{ role: 'user', content: 'u' }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /HTTP 401/);
  } finally { globalThis.fetch = orig; }
});

await ok('aiChat: content non-JSON con blocco JSON embedded → estratto', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Ecco: {"action":"clarify","domanda":"cosa?"} fine' } }] }) });
  try {
    const r = await aiChat({ provider: 'ollama', baseUrl: 'http://x/v1', model: 'm' }, [{ role: 'user', content: 'u' }]);
    assert.equal(r.ok, true);
    assert.equal(r.data.action, 'clarify');
  } finally { globalThis.fetch = orig; }
});

await ok('aiChat: risposta senza JSON → ok:false', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'non ho capito' } }] }) });
  try {
    const r = await aiChat({ provider: 'ollama', baseUrl: 'http://x/v1', model: 'm' }, [{ role: 'user', content: 'u' }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /JSON non valido/);
  } finally { globalThis.fetch = orig; }
});

console.log(`\n${n} test passati.`);