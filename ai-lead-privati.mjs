// Verifica "privato caso per caso" dei lead da affitto via AI (Fase 1).
// Uso: node ai-lead-privati.mjs [--provider token-plan|deepseek|ollama]
//      [--model qwen3.8-flash|deepseek-chat|qwen3.5:4b|...]
//      [--dry-run] [--id <portale:id>] [--list-models]
// Legge gli ultimi annunci di ogni portale (come build-site), seleziona SOLO
// gli affitti in scope (leadAffittoPrivato con esito fisico OK), chiede all'AI
// chi pubblica (privato/agenzia) dalle frasi pertinenti, e registra l'esito in
// lead-verifiche.json SOLO se confidence >= soglia. Sotto soglia: nessuna
// scrittura, il lead resta "da verificare" (D2 fail-closed).
// Poi: node build-site.mjs per propagare lo stato al sito.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leadAffittoPrivato, detectAffitto } from './core/filters.mjs';
import { aiBatch, frasiPertinenti } from './core/ai.mjs';
import { loadAiConfig, listOllamaModels, AI_MODELS, DEEPSEEK_MODELS } from './core/ai-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const getOpt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MODEL = getOpt('--model', null);
const PROVIDER = getOpt('--provider', null);
const DRY = args.includes('--dry-run');
const ONLY_ID = getOpt('--id', null);

if (args.includes('--list-models')) {
  console.log('Token Plan (Alibaba):', AI_MODELS.join(', '));
  console.log('Deepseek diretto:', DEEPSEEK_MODELS.join(', '));
  const local = await listOllamaModels();
  console.log('Ollama locale:', local.length ? local.join(', ') : '(non raggiungibile su localhost:11434)');
  process.exit(0);
}
const VERIFICHE_FILE = path.join(__dirname, 'lead-verifiche.json');

function latestJson(dir) {
  const out = path.join(__dirname, dir, 'output');
  if (!fs.existsSync(out)) return null;
  const files = fs.readdirSync(out).filter((f) => /^annunci-.*\.json$/i.test(f)).sort();
  return files.length ? path.join(out, files[files.length - 1]) : null;
}

// Stessi portali attivi di build-site (cartella = id salvo immobiliare.it).
const DIRS = fs.readdirSync(__dirname).filter((d) => {
  try { return fs.statSync(path.join(__dirname, d)).isDirectory() && fs.existsSync(path.join(__dirname, d, 'adapter.mjs')); } catch { return false; }
});

let verifiche = {};
try { verifiche = JSON.parse(fs.readFileSync(VERIFICHE_FILE, 'utf8')); } catch { /* registro nuovo */ }

// 1. Seleziona i candidati: SOLO affitti già in scope fisico (imbuto).
const candidates = [];
for (const dir of DIRS) {
  const f = latestJson(dir);
  if (!f) continue;
  const id = dir === 'immobiliare.it' ? 'immobiliare' : dir;
  const ads = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const a of ads) {
    if (!detectAffitto(a)) continue;
    const ad = { ...a, portale: id };
    const key = `${id}:${a.id}`;
    if (ONLY_ID && key !== ONLY_ID) continue;
    // Già verificato a mano o da AI con confidence alta? Non ripagare.
    if (verifiche[key]) continue;
    const lead = leadAffittoPrivato(ad, {}, null);
    if (!lead) continue;
    candidates.push({ ad, lead, key });
  }
}

console.log(`Candidati (affitti in scope, non ancora verificati): ${candidates.length}`);
if (!candidates.length) { console.log('Niente da fare.'); process.exit(0); }

const PATTERNS = [/privat/i, /agenz/i, /immobiliare/i, /no\s+agenz/i, /intermediar/i, /propriet/i, /affitt(?:a|asi|iamo|ano)/i, /cerch(?:iamo|asi|o)/i, /referenziat/i, /student/i];
const SYSTEM = 'Sei un analista immobiliare. Dall\'annuncio di affitto capisci CHI pubblica: un privato (proprietario) o un\'agenzia/intermediario. Rispondi SOLO JSON: {"privato": true|false|null, "confidence": 0.0-1.0, "evidenza": "<max 15 parole citate dal testo>"}. privato=null se il testo non permette di decidere. Indizi privato: "privato affitta", "no agenzie", "sono il proprietario", contatto diretto con numero di cellulare senza nome società. Indizi agenzia: nome società/franchising, "AFFITTO TRAMITE AGENZIA", riferimenti protocollo, telefono fisso con nome agenzia, "i nostri uffici". "Proponiamo" da solo NON prova un\'agenzia (lo usano anche privati): pesa gli indizi nel complesso. NON dedurre dal solo prezzo.';

const items = candidates.map(({ ad, lead }) => ({
  ad,
  task: 'privato',
  system: SYSTEM,
  user: `Annuncio (${lead.profilo}, ${ad.superficieMq ?? '?'} m², ${ad.comune}): ${frasiPertinenti(ad, PATTERNS)}`,
}));

if (DRY) {
  console.log('--dry-run: prompt che verrebbero inviati (nessuna chiamata):');
  for (const it of items) console.log(`\n[${it.ad.portale}:${it.ad.id}] ~${Math.ceil((it.system.length + it.user.length) / 3.5)} token\nUSER: ${it.user}`);
  const cfg = loadAiConfig({ model: MODEL, provider: PROVIDER });
  console.log(`\nProvider: ${cfg.provider}; modello: ${cfg.model}; API configurata: ${cfg.enabled}`);
  process.exit(0);
}

const { results, cfg, calls } = await aiBatch(items, { model: MODEL, provider: PROVIDER, log: console.log });
let scritte = 0, incerte = 0;
for (const { ad, key } of candidates) {
  const r = results.get(`${key}|privato`);
  if (!r) continue;
  const conf = r.confidence ?? 0;
  const val = r.data?.privato;
  if (conf >= cfg.minConfidence && (val === true || val === false)) {
    verifiche[key] = {
      privato: val,
      data: new Date().toISOString().slice(0, 10),
      nota: `AI ${r.model} (conf ${conf}): ${String(r.data.evidenza || '').slice(0, 120)}`,
    };
    scritte++;
    console.log(`[ok] ${key}: privato=${val} (conf ${conf}) — ${r.data.evidenza || ''}`);
  } else {
    incerte++;
    console.log(`[??] ${key}: confidence ${conf} < ${cfg.minConfidence} o esito nullo → resta DA VERIFICARE a mano`);
  }
}
fs.writeFileSync(VERIFICHE_FILE, JSON.stringify(verifiche, null, 2));
console.log(`\nRegistro lead-verifiche.json: +${scritte} verifiche, ${incerte} incerte (nessuna scrittura), ${calls} chiamate AI.`);
console.log('Ora: node build-site.mjs per propagare al sito.');