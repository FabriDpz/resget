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
import { handleChatCore } from './core/chat-core.mjs';

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

// ---------------------------------------------------------------- API chat
// Prompt, validazione azione ed esecuzione vivono in core/chat-core.mjs,
// condiviso col Worker Cloudflare (functions/api/chat.js): un solo contratto.
function budgetOk(now = Date.now()) {
  while (callTimes.length && now - callTimes[0] > 3600000) callTimes.shift();
  return callTimes.length < MAX_CALLS_PER_HOUR;
}

async function handleChat(body) {
  let data;
  try { data = loadData(); } catch (e) {
    return { status: 500, json: { error: `Dati sito non leggibili (${e.message}): esegui node build-site.mjs.` } };
  }
  return handleChatCore({
    cfg, data, body, aiChat,
    budgetOk,
    pushCall: () => callTimes.push(Date.now()),
    log,
  });
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