// ---------------------------------------------------------------------------
// Server locale della chat del sito ("stile Rufus"). Serve site/ e fa da proxy
// verso l'LLM già configurato (ai-config.json → core/ai-config.mjs): le API key
// restano QUI, mai nel browser. Nessuna dipendenza npm: solo moduli Node.
//
// Uso:
//   npm run chat                          http://localhost:8787
//   node chat-server.mjs --port 9000
//   node chat-server.mjs --provider ollama --model qwen3.5:4b
//
// Il sito resta statico: senza questo server la chat si disattiva da sola.
// Budget fail-closed: max chiamate/ora (default 60, ai-config.maxCallsPerRun).
// ---------------------------------------------------------------------------

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAiConfig } from './core/ai-config.mjs';
import { aiChat } from './core/ai.mjs';
import {
  normalizeAction, executeAction, datasetSummary, compactRow, detailCard,
  RANK_CRITERI,
} from './core/chat-actions.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const getOpt = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const PORT = parseInt(getOpt('--port', '8787'), 10);
const SITE_DIR = path.resolve(getOpt('--site', path.join(ROOT, 'site')));

const cfg = loadAiConfig({ provider: getOpt('--provider', null), model: getOpt('--model', null) });
const MAX_CALLS_PER_HOUR = cfg.maxCallsPerRun ?? 60;
const callTimes = [];

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('it-IT')}]`, ...a);

// ---------------------------------------------------------------- dati sito
// data.js è generato dal build: window.RADAR_DATA = {...}; — si ricarica a ogni
// richiesta se il file è cambiato (rigeneri il sito senza riavviare il server).
let dataCache = { mtime: 0, data: null };
function loadData() {
  const file = path.join(SITE_DIR, 'data.js');
  const st = fs.statSync(file);
  if (dataCache.data && st.mtimeMs === dataCache.mtime) return dataCache.data;
  const txt = fs.readFileSync(file, 'utf8');
  const i = txt.indexOf('{');
  const j = txt.lastIndexOf('}');
  const data = JSON.parse(txt.slice(i, j + 1));
  dataCache = { mtime: st.mtimeMs, data };
  return data;
}

// ---------------------------------------------------------------- prompt
function systemPrompt(summary) {
  return `Sei l'assistente del Radar Immobiliare (flip su Bologna, Pianoro, San Lazzaro di Savena).
Traduci la richiesta dell'utente in UNA azione JSON. Non inventare mai annunci, prezzi o ID: i dati veri li esegue il server.

Dataset (lista operativa flip, già deduplicata, esclusi affitti e stati senza margine):
${JSON.stringify(summary)}

Azioni possibili (rispondi SOLO con un oggetto JSON {"action": ..., ...}):
1. {"action":"filter","comune"?,"zona"?,"prezzoMax"?,"prezzoMin"?,"mqMin"?,"mqMax"?,"camereMin"?,"stato"?,"ascensore"?,"distanzaMaxKm"?,"poiMin"?,"profilo"?,"testo"?}
   Ricerca annunci. comune: uno di ${summary.comuni.join('/')}. zona: sottozona (es. "Centro", "Rastignano"). stato: testo contenuto nello stato (es. "ristrutturare"). profilo: "BIG"|"SMA"|"RENO"|"STALE". testo: parole da cercare in titolo/descrizione (es. "ascensore giardino").
2. {"action":"rank","criterio":"${RANK_CRITERI.join('|')}","n":5,"filtro":{...come filter}}
   Classifica: roi/margine/stale/poi = più alto meglio, pmq/prezzo = più basso meglio. n max 10.
3. {"action":"compare","ids":["id1","id2"]}
   Confronto tra 2-4 annunci. Usa gli id REALI: quelli citati dall'utente (anche abbreviati: completali con l'id intero dei risultati) o quelli dei risultati precedenti. Il server verifica che esistano.
4. {"action":"answer","ids":["id1"],"domanda":"la domanda dell'utente"}
   Domanda su annunci specifici (anche 1, id come sopra). Senza ids se la domanda è generale sul dataset/metodo.
5. {"action":"clarify","domanda":"..."}
   Richiesta ambigua o fuori tema (cerca immobili, non altro): chiedi un chiarimento breve.

Regole:
- Follow-up ("e solo con ascensore?", "escludi quelli oltre 2 km"): riparti dal filtro dell'ultima azione e modifica solo ciò che l'utente cambia.
- Richiesta nuova e autonoma (es. "i 5 migliori per ROI" senza riferimenti alla ricerca prima): NON trascinare i vecchi filtri, parti da zero.
- Prezzi in euro interi (130k = 130000). "Trilocale" ≈ 2 camere da letto: usa camereMin:2. "Bilocale" ≈ 1 camera.
- Se l'utente chiede "i migliori", "più conveniente", "da trattare": rank con criterio adatto (roi, pmq, stale).
- Non eseguire azioni se mancano gli id per compare/answer: usa clarify o prima un filter.`;
}

// Messaggio di contesto coi risultati dell'ultima azione: consente i follow-up
// senza rimandare tutto lo storico dati al modello.
function resultContext(result) {
  if (!result) return '';
  if (result.action === 'clarify') return '';
  const rows = (result.rows || []).slice(0, 12).map((r) => ({ id: r.id, zona: r.zona, prezzo: r.prezzo, mq: r.mq, camere: r.camere, stato: r.stato, roi: r.roi, staleScore: r.staleScore }));
  return `Ultima azione eseguita: ${JSON.stringify({ action: result.action, filtro: result.filtro, criterio: result.criterio, totale: result.totale })}\nRighe risultato (id REALI da usare per compare/answer): ${JSON.stringify(rows)}`;
}

// Commento del modello sui soli risultati (seconda chiamata, breve).
async function commentOnResult(userText, action, result) {
  const dataLite = result.cards
    ? result.cards
    : (result.rows || []).slice(0, 10);
  const sys = `Sei l'assistente del Radar Immobiliare. Commenta in italiano, 2-4 frasi, i risultati REALI qui sotto rispetto alla richiesta dell'utente. Non inventare dati non presenti. Margini e punteggi sono stime indicative. Rispondi con JSON {"commento":"..."}${action.action === 'answer' ? '. Se la domanda richiede dati assenti, dillo chiaramente' : ''}.`;
  const user = `Richiesta: ${userText}\nAzione: ${JSON.stringify({ action: action.action, filtro: action.filtro, criterio: action.criterio, totale: result.totale })}\nDati: ${JSON.stringify(dataLite)}`;
  const r = await aiChat(cfg, [{ role: 'system', content: sys }, { role: 'user', content: user }], { maxTokens: 350, timeoutMs: 45000 });
  return r.ok ? String(r.data.commento || '').slice(0, 800) : '';
}

function budgetOk(now = Date.now()) {
  while (callTimes.length && now - callTimes[0] > 3600000) callTimes.shift();
  return callTimes.length < MAX_CALLS_PER_HOUR;
}

// ---------------------------------------------------------------- API chat
async function handleChat(body) {
  if (!cfg.enabled) return { status: 503, json: { error: 'AI non configurata: imposta ai-config.json / credenziali (vedi core/ai-config.mjs).' } };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || !String(last.content || '').trim()) {
    return { status: 400, json: { error: 'messages: ultimo messaggio user mancante.' } };
  }
  if (!budgetOk()) return { status: 429, json: { error: `Budget chat esaurito (${MAX_CALLS_PER_HOUR} chiamate/ora). Riprova più tardi.` } };

  let data;
  try { data = loadData(); } catch (e) {
    return { status: 500, json: { error: `Dati sito non leggibili (${e.message}): esegui node build-site.mjs.` } };
  }
  const summary = datasetSummary(data);

  // History client: max 12 turni, solo user/assistant testuali (niente system
  // iniettati dal client). Il contesto risultati dell'ultimo turno arriva dal
  // client come campo lastResult (riassunto, non dati fidati per l'esecuzione).
  const history = messages.slice(-12)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  const ctx = body.lastResult ? resultContext(body.lastResult) : '';
  const llmMessages = [
    { role: 'system', content: systemPrompt(summary) },
    ...(ctx ? [{ role: 'user', content: `[contesto risultati precedenti]\n${ctx}` }, { role: 'assistant', content: 'Ricevuto: uso questi id e questo filtro per i follow-up.' }] : []),
    ...history,
  ];

  callTimes.push(Date.now());
  const r1 = await aiChat(cfg, llmMessages, { maxTokens: 400 });
  if (!r1.ok) {
    log(`chat: LLM errore: ${r1.error}`);
    return { status: 502, json: { error: `LLM: ${r1.error}` } };
  }
  const action = normalizeAction(r1.data);
  const result = executeAction(action, data);

  let commento = '';
  if (result.action !== 'clarify' && (result.rows || []).length && budgetOk()) {
    callTimes.push(Date.now());
    commento = await commentOnResult(String(last.content).slice(0, 500), action, result);
  }
  if (result.action === 'clarify') commento = result.domanda;
  if (!commento && result.action !== 'clarify') {
    commento = result.totale
      ? `${result.totale} annunci trovati${result.rows.length < result.totale ? `, mostro i primi ${result.rows.length}` : ''}.`
      : 'Nessun annuncio corrisponde ai criteri: prova ad allargare la ricerca.';
  }

  log(`chat: ${action.action}${action.criterio ? '/' + action.criterio : ''} → ${result.totale ?? 0} risultati`);
  return {
    status: 200,
    json: {
      action: result.action,
      filtro: result.filtro || null,
      criterio: result.criterio || null,
      totale: result.totale ?? 0,
      rows: result.rows || [],
      missing: result.missing || [],
      commento,
      provider: cfg.provider,
      model: cfg.model,
    },
  };
}

// ---------------------------------------------------------------- static
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(SITE_DIR, '.' + rel);
  if (!file.startsWith(SITE_DIR + path.sep) && file !== SITE_DIR) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api/chat/status')) {
    let datiOk = true;
    try { loadData(); } catch { datiOk = false; }
    sendJson(res, 200, { enabled: cfg.enabled && datiOk, provider: cfg.provider, model: cfg.model, datiOk, budgetOrario: MAX_CALLS_PER_HOUR });
    return;
  }
  if (url.startsWith('/api/chat') && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 100000) req.destroy(); });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'JSON non valido' }); return; }
      try {
        const r = await handleChat(body);
        sendJson(res, r.status, r.json);
      } catch (e) {
        log(`chat: errore interno: ${e.stack || e}`);
        sendJson(res, 500, { error: 'Errore interno del server chat' });
      }
    });
    return;
  }
  if (url.startsWith('/api/')) { sendJson(res, 404, { error: 'not found' }); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, url);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Radar chat su http://localhost:${PORT} (sito: ${SITE_DIR})`);
  log(`LLM: ${cfg.enabled ? `${cfg.provider} / ${cfg.model}` : 'NON CONFIGURATO — chat disattivata (il sito resta navigabile)'}`);
  log(`Budget: ${MAX_CALLS_PER_HOUR} chiamate/ora. Ctrl+C per fermare.`);
});