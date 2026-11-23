// ---------------------------------------------------------------------------
// Generatore del sito statico UNIFICATO multi-portale (punto sintetico GLOBAL).
// Uso: node build-site.mjs [--out <dir>] [--no-ledger]
// Aggrega l'ultimo JSON di ogni portale attivo, deduplica cross-portale e
// produce la sezione GLOBAL con statistiche flip. Il sito si apre con doppio
// clic su site/index.html (nessun server): dati embeddati in data.js (no CORS).
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deduplicate } from './core/dedup.mjs';
import { sanitizeZona, zonaFromDescrizione } from './core/schema.mjs';
import { analyzeFlip, loadPriceHistory } from './core/flip.mjs';
import { detectNonResidential, applyProfiles, detectAuction, detectAffitto, leadAffittoPrivato } from './core/filters.mjs';
import {
  loadLedger, saveLedger, updateLedger, buildKeyIndex,
  ledgerObservations, adLedgerInfo, entryTimeline,
} from './core/ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const getOpt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const OUT_DIR = path.resolve(getOpt('--out', path.join(__dirname, 'site')));
// Soglie geografiche: stessi default del runner (requisiti §2).
const MAX_KM = parseFloat(getOpt('--max-km', '3'));
const MIN_POI = parseFloat(getOpt('--min-poi', '35'));
// Ledger temporale unificato: memoria tra run (firstSeen, prezzi, sparizioni).
// --no-ledger: build effimera (test/preview) senza leggere né scrivere memoria.
const NO_LEDGER = args.includes('--no-ledger');
const LEDGER_FILE = path.join(__dirname, 'ledger.json');
const ledger = NO_LEDGER ? null : loadLedger(LEDGER_FILE);
const osservazioni = ledger ? ledgerObservations(ledger) : null;

// Verifiche manuali "privato" dei lead da affitto (caso per caso, regola utente
// 23/11): {"<portale>:<id>": {privato: true|false, data, nota}}. La verifica
// umana vince sul flag dell'adapter (conferma o smentita).
const VERIFICHE_FILE = path.join(__dirname, 'lead-verifiche.json');
let verificheLead = {};
try { verificheLead = JSON.parse(fs.readFileSync(VERIFICHE_FILE, 'utf8')); } catch { /* registro assente = nessuna verifica */ }

// Registro residui AI (Fase 2 imbuto, ai-residui.mjs): campi letto dal testo
// con confidence ≥ soglia. Solo gli "accettato" entrano nei filtri; i rifiuti
// restano esclusi (D2). La fonte resta tracciata sull'annuncio per il sito.
const RESIDUI_FILE = path.join(__dirname, 'ai-residui.json');
let residuiAI = {};
try { residuiAI = JSON.parse(fs.readFileSync(RESIDUI_FILE, 'utf8')); } catch { /* registro assente */ }
function applicaResiduiAI(ad, key) {
  const r = residuiAI[key];
  if (!r || r.esito !== 'accettato') return;
  if (r.camereAI != null && ad.camere == null && ad.camerePlanimetria == null) {
    ad.camereAI = r.camereAI;
    ad.camereAIConfidenza = r.confidence;
  }
  if (r.convertibileAI != null) {
    ad.convertibileAI = r.convertibileAI;
    ad.convertibileAIEvidenza = r.evidenza || '';
  }
  if (r.statoAI && !String(ad.stato || '').trim()) {
    ad.stato = r.statoAI;
    ad.fonteStato = r.fonte;
  }
  if (r.indirizzoAI && !ad.indirizzo) {
    ad.indirizzoAI = r.indirizzoAI; // per geocode-deep, non entra nei filtri da solo
  }
}

// Portali con adattatore validato (cartella = id salvo immobiliare.it).
const ACTIVE = [
  { dir: 'immobiliare.it', id: 'immobiliare', name: 'Immobiliare.it' },
  { dir: 'tempocasa', id: 'tempocasa', name: 'Tempocasa' },
  { dir: 'remax', id: 'remax', name: 'RE/MAX' },
  { dir: 'tecnocasa', id: 'tecnocasa', name: 'Tecnocasa' },
  { dir: 'tecnorete', id: 'tecnorete', name: 'Tecnorete' },
  { dir: 'wikicasa', id: 'wikicasa', name: 'Wikicasa' },
  { dir: 'bakeca', id: 'bakeca', name: 'Bakeca' },
  { dir: 'mitula', id: 'mitula', name: 'Mitula' },
  { dir: 'trovit', id: 'trovit', name: 'Trovit' },
  { dir: 'caasa', id: 'caasa', name: 'Caasa' },
  { dir: 'idealista', id: 'idealista', name: 'Idealista' },
  { dir: 'casait', id: 'casait', name: 'Casa.it' },
  { dir: 'subito', id: 'subito', name: 'Subito.it' },
  { dir: 'attico', id: 'attico', name: 'Attico.it' },
  { dir: 'trovacasa', id: 'trovacasa', name: 'Trovacasa' },
  { dir: 'casadaprivato', id: 'casadaprivato', name: 'CasaDaPrivato' },
  { dir: 'flatsearch', id: 'flatsearch', name: 'FlatSearch' },
  // Siti proprietari di agenzie locali/affiliate (censimento 22/11/2026).
  { dir: 'gabetti', id: 'gabetti', name: 'Gabetti' },
  { dir: 'toscano', id: 'toscano', name: 'Toscano' },
  { dir: 'professionecasa', id: 'professionecasa', name: 'Professionecasa' },
  { dir: 'grimaldi', id: 'grimaldi', name: 'Grimaldi' },
  { dir: 'livingin', id: 'livingin', name: 'Living In' },
  { dir: 'mondore', id: 'mondore', name: 'Mondore' },
  { dir: 'immobiliaresanlazzaro', id: 'immobiliaresanlazzaro', name: 'Immobiliare San Lazzaro' },
  { dir: 'grandicase', id: 'grandicase', name: 'Grandi Case' },
  { dir: 'vivacasa', id: 'vivacasa', name: 'Viva Casa' },
  { dir: 'reportimmobiliare', id: 'reportimmobiliare', name: 'Report Immobiliare' },
  { dir: 'ars', id: 'ars', name: 'ARS Immobiliare' },
  { dir: 'kapitalre', id: 'kapitalre', name: 'KapitalRE' },
  { dir: 'limmobiliare', id: 'limmobiliare', name: "L'Immobiliare" },
  { dir: 'giacopini', id: 'giacopini', name: 'Paolo Giacopini' },
  { dir: 'abitarebologna', id: 'abitarebologna', name: 'Abitare Bologna' },
  { dir: 'millecase', id: 'millecase', name: '1000CASE' },
  { dir: 'cavallo', id: 'cavallo', name: 'Immobiliare Cavallo' },
  { dir: 'alfaeomega', id: 'alfaeomega', name: 'Alfa & Omega' },
];

// Portali differiti: sezione informativa con motivazione (correggibili in DECISIONI.md).
const DEFERRED = [
  { id: 'casaclick', name: 'CasaClick', motivo: 'Alias Wikicasa (redirect): stessi annunci, già coperti.' },
  { id: 'facebook', name: 'Facebook Marketplace', motivo: 'Login fatto (+2FA). Bologna·20km impostato: 589 card esaminate, 0 BIG/SMA. Card inaffidabili (affitti e auto nel mix, città = sede venditore) → verifica del dettaglio obbligatoria. Fonte P2P complementare.' },
  { id: 'nextdoor', name: 'Nextdoor', motivo: 'Login wall, ma la fonte non è immobiliare: "For Sale & Free" è la bacheca dell\'usato (mobili, auto). 107 quartieri coperti su 6 comuni, 0 immobili in vendita → login non richiesto.' },
  { id: 'dovalue', name: 'doValue', motivo: 'Corporate NPL/credit servicing: nessuna ricerca annunci residenziali pubblica.' },
  { id: 'intesasanpaolo', name: 'Intesa Sanpaolo Proprietà', motivo: 'Vendita diretta di patrimonio dismesso (non aste giudiziarie), tecnicamente scrapeable e adapter pronto: ma in provincia di Bologna gli 8 annunci sono solo filiali bancarie, uffici e depositi. Nei 6 comuni target 5 annunci, 0 residenziali → 0 BIG/SMA. Limite di contenuto, non di accesso.' },
  { id: 'prelios', name: 'Prelios', motivo: 'Blinks RE (piattaforma Wikicasa): 0 annunci living vendita a Bologna, copertura bassa.' },
  { id: 'agenziademanio', name: 'Agenzia Demanio', motivo: 'Bandi pubblici (gare locazione/vendita), non annunci residenziali standard: sezione Aste.' },
  { id: 'invimit', name: 'Invimit', motivo: 'Vetrina aste RAN/confronto competitivo (schede PDF): sezione Aste dedicata.' },
];

function latestJson(dir) {
  const out = path.join(__dirname, dir, 'output');
  if (!fs.existsSync(out)) return null;
  const files = fs.readdirSync(out).filter((f) => /^annunci-.*\.json$/i.test(f)).sort();
  return files.length ? path.join(out, files[files.length - 1]) : null;
}

const portals = [];
const allAds = [];
for (const p of ACTIVE) {
  const f = latestJson(p.dir);
  if (!f) {
    console.warn(`[skip] ${p.id}: nessun output`);
    portals.push({ id: p.id, name: p.name, active: false, ads: [] });
    continue;
  }
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  let cleanedZones = 0, recoveredZones = 0;
  const ads = raw.map((a) => {
    let z = sanitizeZona(a.zona);
    // Recupero per i dati cached: se la zona era testo spurio, prova la descrizione.
    if (!z) {
      const fromDesc = zonaFromDescrizione(a.descrizione);
      if (fromDesc) { z = fromDesc; recoveredZones++; }
    }
    if (z !== (a.zona || '')) cleanedZones++;
    return { ...a, zona: z, portale: p.id };
  });
  if (cleanedZones) console.log(`[zona] ${p.id}: ${cleanedZones} zone corrette (${recoveredZones} recuperate dalla descrizione)`);
  // Riapplica i criteri BIG/SMA sui dati cached: se le regole in core/filters.mjs
  // cambiano, il sito deve riflettere le regole correnti senza un re-scrape.
  let changed = 0;
  for (const a of ads) {
    applicaResiduiAI(a, `${p.id}:${a.id}`);
    const next = applyProfiles(a, { maxKm: MAX_KM, minPoi: MIN_POI });
    if (next.esito !== a.esito || next.esitoSma !== a.esitoSma) changed++;
    Object.assign(a, next);
    // Lead privati da affitto (regola utente 23/11): esclusi da BIG/SMA ma
    // contattabili manualmente se il privato fosse interessato a vendere.
    // Il "privato" è caso per caso: registro verifiche manuali > flag adapter.
    const lead = leadAffittoPrivato(a, { maxKm: MAX_KM, minPoi: MIN_POI }, verificheLead[`${p.id}:${a.id}`] || null);
    if (lead) a.leadAffitto = lead;
    else delete a.leadAffitto;
  }
  if (changed) console.log(`[filtri] ${p.id}: ${changed} esiti aggiornati alle regole correnti`);
  // Ricalcola il flip con le zone corrette (le mediane per zona cambiano).
  const storico = loadPriceHistory(path.join(p.dir, 'output', 'prezzi-storico.json'));
  analyzeFlip(ads, { detectNonResidential, storico, osservazioni });
  const missingFlip = ads.filter((a) => !a.flip).length;
  if (missingFlip) console.warn(`[warn] ${p.id}: ${missingFlip} annunci senza flip`);
  portals.push({ id: p.id, name: p.name, active: true, source: path.basename(f), ads });
  allAds.push(...ads);
  console.log(`[ok] ${p.id}: ${ads.length} annunci`);
}

// Deduplicazione cross-portale → sezione GLOBAL. Gli affitti restano FUORI
// dai cluster: il loro prezzo è un canone e potrebbe fondersi con una vendita
// economica dello stesso stabile. Entrano in GLOBAL come singleton (i lead
// privati hanno la loro sezione dedicata nel sito).
const affittoAds = allAds.filter((a) => detectAffitto(a));
const clusters = deduplicate(allAds.filter((a) => !detectAffitto(a)));
const globalAds = clusters.map((c) => ({
  ...c.winner,
  fonti: c.fonti,
  duplicati: c.duplicati,
  multiPortale: c.annunci.length > 1,
}));
for (const a of affittoAds) {
  globalAds.push({ ...a, fonti: [{ portale: a.portale, id: a.id, url: a.url, prezzo: a.prezzo, agenzia: a.agenzia || '' }], duplicati: 0, multiPortale: false });
}
const removed = allAds.length - globalAds.length;
const multi = globalAds.filter((a) => a.multiPortale).length;
console.log(`[GLOBAL] ${allAds.length} annunci → ${globalAds.length} unici (${removed} duplicati, ${multi} multi-portale, ${affittoAds.length} affitti fuori dedup)`);
const leadAds = affittoAds.filter((a) => a.leadAffitto);
if (leadAds.length) console.log(`[lead] ${leadAds.length} affitti da privato in scope BIG/SMA: ${leadAds.map((a) => `${a.portale}:${a.id} (${a.leadAffitto.profilo}, ${a.leadAffitto.statoPrivato})`).join(', ')}`);

// Ledger temporale: aggiorna la memoria con i cluster di QUESTO run e produce
// il diff (nuovi/ribassati/spariti/ripubblicati). Le aste restano fuori dalla
// memoria standard come dal dedup standard (D7): cluster con winner ad asta.
let diff = null;
let gone = [];
if (ledger) {
  const standardClusters = clusters.filter((c) => !detectAuction(c.winner));
  diff = updateLedger(ledger, standardClusters);
  saveLedger(ledger, LEDGER_FILE);
  const idx = buildKeyIndex(ledger);
  for (const a of allAds) {
    const info = adLedgerInfo(ledger, idx, a, diff);
    if (info) a.ledger = info;
  }
  for (const a of globalAds) {
    const info = adLedgerInfo(ledger, idx, a, diff);
    if (info) a.ledger = info;
  }
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const goneIds = Object.entries(ledger.entries)
    .filter(([, e]) => e.stato === 'sparito' && (e.sparitoIl || '') >= cutoff)
    .map(([id]) => id);
  gone = [...goneIds].map((id) => {
    const e = ledger.entries[id];
    return {
      key: id, lastSeen: e.lastSeen, prezzo: e.prezzoCorrente,
      timeline: entryTimeline(e, 6), ...(e.ultimaIstantanea || {}),
    };
  });
  const guardMsg = diff.guardAttivo ? ' — GUARD: copertura crollata, sparizioni NON marcate' : '';
  console.log(`[ledger] ${Object.keys(ledger.entries).length} voci in memoria: +${diff.nuovi.length} nuovi, ${diff.ribassati.length} ribassati, ${diff.spariti.length} spariti, ${diff.ripubblicati.length} ripubblicati, ${diff.fusi.length} fusi${guardMsg}`);
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'multi-portale',
  portals,
  global: { ads: globalAds, totaleLordo: allAds.length, duplicatiRimossi: removed, multiPortale: multi },
  // Lead privati da affitto: sezione dedicata (contatto manuale off-market).
  leadAffitti: leadAds,
  deferred: DEFERRED,
  novita: diff ? {
    data: diff.data,
    nuovi: diff.nuovi.length,
    ribassati: diff.ribassati,
    spariti: gone,
    riapparsi: diff.riapparsi.length,
    ripubblicati: diff.ripubblicati.length,
    fusi: diff.fusi.length,
    guardAttivo: diff.guardAttivo,
    storicoRun: ledger.runs.slice(-30),
    vociTotali: Object.keys(ledger.entries).length,
  } : null,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const dataJs = `// Generato da build-site.mjs — non modificare a mano.\nwindow.RADAR_DATA = ${JSON.stringify(payload).replace(/</g, '\\u003c')};\n`;
fs.writeFileSync(path.join(OUT_DIR, 'data.js'), dataJs);

const SRC_DIR = path.join(__dirname, 'site-src');
for (const f of ['index.html', 'app.js', 'style.css']) {
  fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT_DIR, f));
}

console.log(`Sito generato: ${path.join(OUT_DIR, 'index.html')}`);
console.log('Apri index.html con doppio clic (nessun server necessario).');