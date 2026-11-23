// Fase 2 dell'imbuto AI: recupera i residui "scartato SOLO per un campo
// che l'AI può leggere" (camere/convertibilità, stato immobile, indirizzo
// per il geocoding). Gli annunci già decisi non entrano MAI nel prompt.
// Uso: node ai-residui.mjs [--provider token-plan|deepseek|ollama] [--model <id>]
//      [--dry-run] [--id <portale:id>] [--max <n>] [--list-models]
// Output: ai-residui.json — campi verificati con fonte+confidence.
// Fail-closed (D2): confidence < 0.8 → nessun campo accettato, annuncio escluso.
// Le coordinate NON si chiedono all'AI: si estrae solo l'indirizzo testuale,
// il geocoding resta Nominatim (geocode-deep.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProfiles } from './core/filters.mjs';
import { aiBatch, frasiPertinenti } from './core/ai.mjs';
import { loadAiConfig, listOllamaModels, AI_MODELS, DEEPSEEK_MODELS } from './core/ai-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const getOpt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MODEL = getOpt('--model', null);
const PROVIDER = getOpt('--provider', null);
const DRY = args.includes('--dry-run');
const ONLY_ID = getOpt('--id', null);
const MAX = Number(getOpt('--max', '40'));

if (args.includes('--list-models')) {
  console.log('Token Plan (Alibaba):', AI_MODELS.join(', '));
  console.log('Deepseek diretto:', DEEPSEEK_MODELS.join(', '));
  const local = await listOllamaModels();
  console.log('Ollama locale:', local.length ? local.join(', ') : '(non raggiungibile su localhost:11434)');
  process.exit(0);
}

const SYSTEM = `Sei un analista immobiliare italiano. Leggi SOLO il testo dell'annuncio e rispondi SOLO con JSON valido. Non inventare: se il testo non contiene l'informazione usa null e confidence bassa.
- "camere": numero di camere da letto se esplicito ("due camere", "2 letto"); bilocale con camera unica = 1; monolocale = 0. NON dedurre dai metri quadri.
- "convertibile": true SOLO con una frase esplicita sulla ricavabilità di una seconda camera ("possibilità di ricavare la seconda camera", "divisibile in due camere", "si può creare un'altra stanza"). "Da personalizzare", "da reinventare", "su misura", "da valorizzare" NON sono prove di convertibilità: usa null. false se dice non convertibile/spazi non modificabili; null se tace.
- "stato": una tra "da ristrutturare", "abitabile", "ristrutturato", "nuovo" in base al testo; null se ambiguo.
- "indirizzo": via/piazza e civico se presenti nel testo, altrimenti null. MAI coordinate.
Formato: {"camere": <int|null>, "convertibile": <bool|null>, "stato": <string|null>, "indirizzo": <string|null>, "confidence": <0..1>, "evidenza": "<max 15 parole citate dal testo>"}`;

const PATTERNS = [/camer/i, /letto/i, /van[io]/i, /monolocale|bilocale|trilocale/i, /divis|ricav|ripart|convert|trasform/i, /ristruttur|rimodern|stato|abitabil|nuovo|ottimo/i, /\bvia\b|\bviale\b|\bpiazza\b|\bvicolo\b|\bcivico\b/i];

function latestJson(dir) {
  const out = path.join(__dirname, dir, 'output');
  if (!fs.existsSync(out)) return null;
  const files = fs.readdirSync(out).filter((f) => /^annunci-.*\.json$/i.test(f)).sort();
  return files.length ? path.join(out, files[files.length - 1]) : null;
}

const DIRS = fs.readdirSync(__dirname).filter((d) => {
  try { return fs.statSync(path.join(__dirname, d)).isDirectory() && fs.existsSync(path.join(__dirname, d, 'adapter.mjs')); } catch { return false; }
});

const registroPath = path.join(__dirname, 'ai-residui.json');
let registro = {};
try { registro = JSON.parse(fs.readFileSync(registroPath, 'utf8')); } catch { /* nuovo */ }

// Ragioni che l'AI può risolvere. Un annuncio entra SOLO se tutte le ragioni
// di entrambi i profili sono di questo tipo (altrimenti l'AI non cambierebbe esito).
const CAMERE_RE = /Camere da letto|Monolocale|Bilocale non convertibile|Planimetria/;
const STATO_RE = /Stato "|Stato:|nessun margine per ristrutturare/;
const COORD_RE = /Coordinate non disponibili/;

const candidates = [];
for (const dir of DIRS) {
  const f = latestJson(dir);
  if (!f) continue;
  const id = dir === 'immobiliare.it' ? 'immobiliare' : dir;
  if (id === 'subito') continue; // i privati affitto hanno la Fase 1 dedicata
  let ads = [];
  try { ads = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  for (const a of ads) {
    const ad = { ...a, portale: id };
    const pf = applyProfiles(ad);
    const reasons = [];
    if (pf.esito === 'Escluso') reasons.push(...String(pf.motivazione || '').split('; '));
    if (pf.esitoSma === 'Escluso') reasons.push(...String(pf.motivazioneSma || '').split('; '));
    const uniq = [...new Set(reasons.filter(Boolean))];
    if (!uniq.length) continue; // già selezionato: l'AI non serve
    const soloCamere = uniq.every((r) => CAMERE_RE.test(r));
    const soloStato = uniq.every((r) => STATO_RE.test(r));
    const soloCoord = uniq.every((r) => COORD_RE.test(r));
    if (!(soloCamere || soloStato || soloCoord)) continue;
    const key = `${id}:${a.id}`;
    if (registro[key]) continue; // già analizzato (anche rifiutato: non si ripaga)
    if (ONLY_ID && key !== ONLY_ID) continue;
    const task = soloCamere ? 'camere' : soloStato ? 'stato' : 'indirizzo';
    const user = `Titolo: ${a.titolo || ''}\nLocali: ${a.locali ?? '?'}; camere dichiarate: ${a.camere ?? '?'}; mq: ${a.superficieMq ?? '?'}; stato dichiarato: "${a.stato || ''}"\nTesto: ${frasiPertinenti(ad, PATTERNS)}`;
    candidates.push({ key, ad, task, user, reasons: uniq });
  }
}
candidates.sort((a, b) => a.key.localeCompare(b.key));
const items = candidates.slice(0, MAX).map((c) => ({ key: c.key, ad: c.ad, task: c.task, system: SYSTEM, user: c.user }));

console.log(`Residui AI-risolvibili: ${candidates.length} (max ${MAX} per run). Registro esistente: ${Object.keys(registro).length}.`);
if (DRY) {
  for (const it of items) {
    console.log(`\n=== ${it.key} [${it.task}] ~${Math.ceil((it.system.length + it.user.length) / 3.5)} token ===`);
    console.log(it.user);
  }
  const cfg = loadAiConfig({ model: MODEL, provider: PROVIDER });
  console.log(`\nProvider: ${cfg.provider}; modello: ${cfg.model}; API configurata: ${cfg.enabled}`);
  process.exit(0);
}
if (!items.length) { console.log('Nessun residuo da analizzare.'); process.exit(0); }

const { results, cfg, calls } = await aiBatch(items, { model: MODEL, provider: PROVIDER, log: console.log });
let accepted = 0, rejected = 0;
for (const it of items) {
  const r = results.get(`${it.key}|${it.task}`);
  if (!r) { rejected++; continue; }
  const d = r.data;
  const confOk = typeof d.confidence === 'number' && d.confidence >= cfg.minConfidence;
  const campo = it.task === 'camere'
    ? (Number.isInteger(d.camere) && d.camere >= 0 ? { camereAI: d.camere, convertibileAI: d.convertibile === true ? true : d.convertibile === false ? false : null } : null)
    : it.task === 'stato'
      ? (['da ristrutturare', 'abitabile', 'ristrutturato', 'nuovo'].includes(d.stato) ? { statoAI: d.stato } : null)
      : (typeof d.indirizzo === 'string' && d.indirizzo.trim().length >= 5 ? { indirizzoAI: d.indirizzo.trim() } : null);
  if (!confOk || !campo) {
    console.log(`  ${it.key}: RIFIUTATO (conf=${d.confidence ?? '—'}, campo ${campo ? 'ok' : 'nullo'}) — resta escluso (fail-closed).`);
    rejected++;
    // Registra anche il rifiuto: testo immutato = stessa domanda, non si ripaga.
    registro[it.key] = { esito: 'rifiutato', task: it.task, confidence: d.confidence ?? null, modello: r.model, provider: r.provider, data: r.data_ai, evidenza: String(d.evidenza || '').slice(0, 200) };
    continue;
  }
  registro[it.key] = {
    esito: 'accettato', task: it.task, ...campo,
    fonte: `AI ${r.provider || cfg.provider}/${r.model} (conf ${d.confidence})`,
    confidence: d.confidence, modello: r.model, provider: r.provider || cfg.provider,
    data: r.data_ai, evidenza: String(d.evidenza || '').slice(0, 200),
  };
  accepted++;
  console.log(`  ${it.key}: ${JSON.stringify(campo)} (conf ${d.confidence}) — "${registro[it.key].evidenza}"`);
}
fs.writeFileSync(registroPath, JSON.stringify(registro, null, 2) + '\n');
console.log(`\nRegistro ai-residui.json: ${accepted} accettati, ${rejected} rifiutati/non risolti (${calls} chiamate, ${cfg.provider}/${cfg.model}).`);
console.log('I campi accettati entrano nei filtri al prossimo build-site; i rifiuti restano esclusi (D2).');