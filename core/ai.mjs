// Motore AI per l'interpretazione dei RESIDUI ambigui (pipeline a imbuto).
// Principi (decisione utente 23/11/2026):
//   1. i filtri nativi dei portali e le regole core vengono PRIMA: l'AI vede
//      solo gli annunci il cui esito dipende da un campo che le regole non
//      sanno determinare (effetto leva: meno candidati = meno token);
//   2. prompt minimale: solo le frasi pertinenti al campo, non tutto il testo;
//   3. cache persistente per (portale:id + hash descrizione + modello + task):
//      un annuncio invariato non si ripaga mai;
//   4. output JSON con confidence: sotto soglia = "da verificare" (D2 fail-closed);
//   5. modello parametrico (ai-config.mjs), budget chiamate per run.
// API OpenAI-compatibile del Token Plan; nessun segreto nel codice.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadAiConfig } from './ai-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', 'ai-cache.json');

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}
// Il prompt entra nella chiave: un SYSTEM diverso è una domanda diversa e non
// deve riusare la risposta vecchia (l'annuncio invariato invece sì). Provider
// incluso: una risposta Ollama locale non si mescola con una cloud.
function cacheKey(ad, task, model, system = '', provider = '') {
  const sh = crypto.createHash('sha1').update(system).digest('hex').slice(0, 8);
  const h = crypto.createHash('sha1').update(`${ad.titolo || ''}\n${ad.descrizione || ''}`).digest('hex').slice(0, 16);
  return `${ad.portale || '?'}:${ad.id}|${task}|${provider}|${model}|${sh}|${h}`;
}

// Estrae le frasi pertinenti a un campo: prompt minimale, non la descrizione
// intera. Fallback: prime 400 caratteri (mai l'intero testo).
export function frasiPertinenti(ad, patterns, maxChars = 700) {
  const text = `${ad.titolo || ''}. ${ad.descrizione || ''}`;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const hits = sentences.filter((s) => patterns.some((re) => re.test(s)));
  const picked = (hits.length ? hits : [text.slice(0, 400)]).join(' ').replace(/\s+/g, ' ').trim();
  return picked.slice(0, maxChars);
}

// Endpoint chat per provider: token-plan usa il path compatible-mode,
// Ollama (e ogni endpoint OpenAI-compatibile con /v1) usa /chat/completions.
export function chatUrl(cfg) {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return cfg.provider === 'token-plan' && !/\/v1$/.test(base)
    ? `${base}/compatible-mode/v1/chat/completions`
    : `${base}/chat/completions`;
}

// Una chiamata AI con output JSON vincolato. Ritorna {ok, data, error, usage}.
// Mai throw verso il chiamante: un errore AI non deve fermare la raccolta.
export async function aiJson(cfg, system, user, { log = () => {}, timeoutMs = 90000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const body = {
      model: cfg.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0,
      max_tokens: 220,
      response_format: { type: 'json_object' },
    };
    // Modelli locali "thinking" (qwen3.5): senza questo il budget token finisce
    // nel reasoning e il content resta vuoto. L'estrazione non richiede pensiero.
    if (cfg.provider === 'ollama') body.reasoning_effort = 'none';
    const resp = await fetch(chatUrl(cfg), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 200);
      return { ok: false, error: `HTTP ${resp.status}: ${body}` };
    }
    const j = await resp.json();
    const content = j.choices?.[0]?.message?.content || '';
    let data;
    try { data = JSON.parse(content); } catch {
      // Modelli locali che ignorano response_format: estrai il primo blocco JSON.
      const m = content.match(/\{[\s\S]*\}/);
      try { data = m ? JSON.parse(m[0]) : null; } catch { data = null; }
      if (!data) return { ok: false, error: `JSON non valido: ${content.slice(0, 120)}` };
    }
    return { ok: true, data, usage: j.usage || null };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Chiamata multi-turno per la chat del sito (chat-server.mjs). Stesso contratto
// di aiJson: ritorna {ok, data, usage} oppure {ok:false, error}, mai throw.
// messages: [{role:'system'|'user'|'assistant', content}] — la history è del
// chiamante. Output JSON vincolato (azione), niente cache: ogni turno è nuovo.
export async function aiChat(cfg, messages, { timeoutMs = 60000, maxTokens = 700 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const body = {
      model: cfg.model,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    };
    if (cfg.provider === 'ollama') body.reasoning_effort = 'none';
    const resp = await fetch(chatUrl(cfg), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const errBody = (await resp.text()).slice(0, 200);
      return { ok: false, error: `HTTP ${resp.status}: ${errBody}` };
    }
    const j = await resp.json();
    const content = j.choices?.[0]?.message?.content || '';
    let data;
    try { data = JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/);
      try { data = m ? JSON.parse(m[0]) : null; } catch { data = null; }
      if (!data) return { ok: false, error: `JSON non valido: ${content.slice(0, 120)}` };
    }
    return { ok: true, data, usage: j.usage || null };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Coda con cache e budget. items: [{ad, task, system, user}].
// Ritorna Map chiave-annuncio → {data, confidence, cached, model, data_ai}.
// Gli errori restano per-item (fail-closed a valle), il run prosegue.
export async function aiBatch(items, { model = null, provider = null, log = console.log, maxCalls = null } = {}) {
  const cfg = loadAiConfig({ model, provider });
  const results = new Map();
  if (!cfg.enabled) {
    log('[ai] configurata male (API key/base URL assenti): salto, nessun costo.');
    return { results, cfg, calls: 0, tokens: { input: 0, output: 0 }, errors: items.length };
  }
  const budget = maxCalls ?? cfg.maxCallsPerRun;
  const cache = loadCache();
  let calls = 0, hits = 0, errors = 0;
  const tokens = { input: 0, output: 0 };
  for (const it of items) {
    const key = cacheKey(it.ad, it.task, cfg.model, it.system, cfg.provider);
    const itemKey = `${it.ad.portale || '?'}:${it.ad.id}|${it.task}`;
    if (cache[key]) {
      hits++;
      results.set(itemKey, { ...cache[key], cached: true });
      continue;
    }
    if (calls >= budget) {
      log(`[ai] budget ${budget} chiamate raggiunto: ${items.length - hits - calls - errors} item restano non valutati (da verificare).`);
      break;
    }
    const r = await aiJson(cfg, it.system, it.user, { log });
    calls++;
    if (r.usage) { tokens.input += r.usage.prompt_tokens || 0; tokens.output += r.usage.completion_tokens || 0; }
    if (!r.ok) {
      errors++;
      log(`[ai] ${itemKey}: ${r.error}`);
      // 401/403: credenziali errate, inutile continuare a pagare chiamate fallite.
      if (/HTTP 40[13]/.test(r.error)) { log('[ai] credenziali rifiutate: STOP coda.'); break; }
      continue;
    }
    const entry = {
      data: r.data,
      confidence: typeof r.data.confidence === 'number' ? r.data.confidence : null,
      model: cfg.model,
      provider: cfg.provider,
      data_ai: new Date().toISOString().slice(0, 10),
    };
    cache[key] = entry;
    results.set(itemKey, { ...entry, cached: false });
    // Pausa gentile tra chiamate (stesso spirito D4, lato API).
    await new Promise((r2) => setTimeout(r2, 400));
  }
  saveCache(cache);
  log(`[ai] ${calls} chiamate (${hits} cache hit, ${errors} errori), token in/out: ${tokens.input}/${tokens.output}, provider: ${cfg.provider}, modello: ${cfg.model}`);
  return { results, cfg, calls, tokens, errors };
}

// Applica un risultato AI a un campo solo se la confidence è sufficiente.
// Sotto soglia il campo NON si tocca: resta "da verificare" (D2).
export function aiFieldOk(result, cfg) {
  return Boolean(result && result.confidence != null && result.confidence >= (cfg?.minConfidence ?? 0.8));
}