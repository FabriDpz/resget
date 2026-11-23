// ---------------------------------------------------------------------------
// Ledger temporale unificato — memoria del radar tra un run e l'altro.
// Chiave: il CLUSTER dedup (non il singolo annuncio): lo stesso immobile visto
// su più portali/più run resta una sola voce, anche se cambia la fonte vincente
// o l'ID viene ripubblicato. Persistenza: ledger.json in root (atomic write).
//
// Cosa registra per ogni immobile:
//   firstSeen/lastSeen (giorni OSSERVATI, non dichiarati dal portale),
//   serie prezzi per fonte (una voce per giorno, solo sui cambi),
//   ribassi reali per fonte (un cambio fonte NON è un ribasso),
//   sparizioni (probabile vendita/rimozione) e riapparizioni,
//   ripubblicazioni con ID nuovo (conservative: solo su match univoco).
//
// Idempotente: più build nello stesso giorno aggiornano la voce di giornata
// senza duplicare punti né diff. Nessun dato viene inventato: prezzo null non
// entra nelle serie, la sparizione è "non più visibile", non "venduto".
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_PRIORITY, originKeysOf } from './dedup.mjs';

const DAY_MS = 86400000;
const isoDay = (d) => d.toISOString().slice(0, 10);
const days = (a, b) => Math.max(0, Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / DAY_MS));
const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(via|viale|piazza|piazzale|vicolo|largo|strada|corso)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export function emptyLedger() {
  return { version: 1, nextId: 1, entries: {}, runs: [] };
}

export function loadLedger(file) {
  try {
    const l = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (l && l.version === 1 && l.entries) return l;
  } catch { /* primo run o file corrotto: si riparte vuoti */ }
  return emptyLedger();
}

export function saveLedger(ledger, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger));
  fs.renameSync(tmp, file);
}

// Chiavi di identità di un annuncio: membro (portale:id) + ID d'origine
// dichiarati dagli aggregatori (namespace orig: per non collidere).
export function adKeys(ad) {
  const keys = [];
  if (ad.id) {
    keys.push(`${ad.portale}:${ad.id}`);
    // Alias orig: della chiave membro, così un aggregatore che dichiara
    // questo annuncio come origine lo aggancia (e viceversa).
    keys.push(`orig:${ad.portale}:${ad.id}`);
  }
  for (const k of originKeysOf(ad)) keys.push(`orig:${k}`);
  return keys;
}

function clusterKeys(cluster) {
  const set = new Set();
  for (const a of cluster.annunci) for (const k of adKeys(a)) set.add(k);
  return [...set];
}

// Indice chiave → id voce, per il matching O(1) tra run.
export function buildKeyIndex(ledger) {
  const idx = new Map();
  for (const [id, e] of Object.entries(ledger.entries)) {
    for (const k of e.chiavi) idx.set(k, id);
  }
  return idx;
}

function priority(portale) {
  const i = SOURCE_PRIORITY.indexOf(portale);
  return i < 0 ? 99 : i;
}

// Fonte (portale:id) che determina il prezzo corrente, o null.
function priceSource(entry, presentKeys) {
  const sources = Object.keys(entry.serie)
    .filter((k) => !presentKeys || presentKeys.has(k))
    .sort((a, b) => priority(a.split(':')[0]) - priority(b.split(':')[0]));
  for (const k of sources) {
    if (entry.serie[k].length) return k;
  }
  return null;
}

// Prezzo corrente: ultimo punto della fonte a priorità più alta tra quelle
// ancora presenti nel cluster (stessa logica del vincitore GLOBAL).
function currentPrice(entry, presentKeys) {
  const k = priceSource(entry, presentKeys);
  if (!k) return null;
  const s = entry.serie[k];
  return s[s.length - 1].prezzo;
}

// Ribassi per fonte: un ribasso è un calo prezzo SULLO STESSO portale.
// Il numero mostrato è il massimo tra le fonti (il calo reale si propaga sui
// portali con tempi diversi; contarli tutti lo conterebbe N volte).
function deriveRibassi(entry) {
  let best = { ribassi: 0, ribassoTot: 0, ribassoPct: 0, fonte: null };
  for (const [k, serie] of Object.entries(entry.serie)) {
    let n = 0, tot = 0;
    for (let i = 1; i < serie.length; i++) {
      if (serie[i].prezzo < serie[i - 1].prezzo) { n++; tot += serie[i - 1].prezzo - serie[i].prezzo; }
    }
    if (n > best.ribassi || (n === best.ribassi && tot > best.ribassoTot)) {
      const pct = serie[0].prezzo > 0 ? Math.round((tot / serie[0].prezzo) * 1000) / 10 : 0;
      best = { ribassi: n, ribassoTot: tot, ribassoPct: pct, fonte: k };
    }
  }
  return best;
}

function refreshDerived(entry, presentKeys) {
  entry.fonteCorrente = priceSource(entry, presentKeys);
  entry.prezzoCorrente = currentPrice(entry, presentKeys);
  const r = deriveRibassi(entry);
  entry.ribassiOsservati = r.ribassi;
  entry.ribassoTotEuro = r.ribassoTot;
  entry.ribassoPct = r.ribassoPct;
  entry.giorniOsservati = days(entry.firstSeen, entry.lastSeen);
}

// Timeline piatta per la UI: tutti i cambi prezzo con la fonte che li espone.
export function entryTimeline(entry, cap = 12) {
  const points = [];
  for (const [k, serie] of Object.entries(entry.serie)) {
    for (const p of serie) points.push({ data: p.data, prezzo: p.prezzo, fonte: k.split(':')[0] });
  }
  points.sort((a, b) => a.data.localeCompare(b.data) || priority(a.fonte) - priority(b.fonte));
  return cap ? points.slice(-cap) : points;
}

function newEntry(ledger, keys, today) {
  const id = `L${String(ledger.nextId++).padStart(6, '0')}`;
  const e = {
    chiavi: keys, firstSeen: today, lastSeen: today,
    stato: 'attivo', sparitoIl: null,
    serie: {}, ripubblicazioni: [],
    ultimaIstantanea: null,
  };
  ledger.entries[id] = e;
  return { id, entry: e };
}

// Fonde due voci che il dedup ha scoperto essere lo stesso immobile:
// vince la più vecchia (firstSeen minore), le serie si uniscono per fonte.
function mergeEntries(ledger, primaryId, otherId, today) {
  const p = ledger.entries[primaryId];
  const o = ledger.entries[otherId];
  if (o.firstSeen < p.firstSeen) {
    // la voce assorbita era più vecchia: adotta la sua anzianità
    p.firstSeen = o.firstSeen;
  }
  p.chiavi = [...new Set([...p.chiavi, ...o.chiavi])];
  for (const [k, serie] of Object.entries(o.serie)) {
    const byDate = new Map((p.serie[k] || []).map((x) => [x.data, x.prezzo]));
    for (const x of serie) byDate.set(x.data, x.prezzo);
    p.serie[k] = [...byDate].map(([data, prezzo]) => ({ data, prezzo }))
      .sort((a, b) => a.data.localeCompare(b.data));
  }
  p.ripubblicazioni = [...(p.ripubblicazioni || []), ...(o.ripubblicazioni || [])];
  delete ledger.entries[otherId];
  return today;
}

// Ripubblicazione con ID nuovo: SOLO su voce sparita, stesso comune +
// indirizzo normalizzato + mq ±2 e prezzo entro ±10%, candidato UNIVOCO.
// Due candidati = ambiguità (palazzo con più unità uguali) → nessun merge.
function findRepost(ledger, cluster, today) {
  const w = cluster.winner;
  const addr = norm(w.indirizzo);
  if (addr.length < 5 || w.prezzo == null || w.superficieMq == null) return null;
  const candidates = [];
  for (const [id, e] of Object.entries(ledger.entries)) {
    if (e.stato !== 'sparito' || e.prezzoCorrente == null) continue;
    const snap = e.ultimaIstantanea || {};
    if (norm(snap.comune) !== norm(w.comune)) continue;
    if (norm(snap.indirizzo) !== addr) continue;
    if (snap.superficieMq == null || Math.abs(snap.superficieMq - w.superficieMq) > 2) continue;
    if (Math.abs(e.prezzoCorrente - w.prezzo) / Math.max(e.prezzoCorrente, w.prezzo) > 0.10) continue;
    candidates.push(id);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

// ---------------------------------------------------------------------------
// Aggiornamento principale. clusters = output di deduplicate().
// Ritorna il diff del run: {nuovi, ribassati, spariti, riapparsi, ripubblicati,
// fusi, guardAttivo}. Muta ledger; il chiamante salva con saveLedger.
// ---------------------------------------------------------------------------
export function updateLedger(ledger, clusters, { now = new Date(), guard = true } = {}) {
  const today = isoDay(now);
  const idx = buildKeyIndex(ledger);
  const diff = { data: today, nuovi: [], ribassati: [], spariti: [], riapparsi: [], ripubblicati: [], fusi: [], guardAttivo: false };
  const seen = new Set();

  for (const cluster of clusters) {
    const keys = clusterKeys(cluster);
    if (!keys.length) continue;

    // Voci esistenti toccate da questo cluster (possono essere più di una:
    // il dedup ha unito immobili che prima erano separati → fusione).
    const hitIds = [...new Set(keys.map((k) => idx.get(k)).filter(Boolean))];
    let id;
    if (hitIds.length) {
      hitIds.sort((a, b) => ledger.entries[a].firstSeen.localeCompare(ledger.entries[b].firstSeen) || a.localeCompare(b));
      id = hitIds[0];
      for (const other of hitIds.slice(1)) {
        mergeEntries(ledger, id, other, today);
        diff.fusi.push({ da: other, in: id });
        for (const k of ledger.entries[id].chiavi) idx.set(k, id);
      }
    } else {
      const repostId = findRepost(ledger, cluster, today);
      if (repostId) {
        id = repostId;
        const e = ledger.entries[id];
        e.ripubblicazioni.push({ data: today, prezzoPrima: e.prezzoCorrente, prezzoDopo: cluster.winner.prezzo ?? null });
        diff.ripubblicati.push(id);
      } else {
        ({ id } = newEntry(ledger, keys, today));
        diff.nuovi.push(id);
      }
    }

    const entry = ledger.entries[id];
    const wasGone = entry.stato === 'sparito';
    const isRepost = diff.ripubblicati.includes(id);
    const priceBefore = entry.prezzoCorrente ?? null;
    // Fonte del prezzo corrente PRIMA dell'update: un ribasso nel diff è un
    // calo sulla stessa fonte (cambiare fonte vincente non è un ribasso).
    // fonteCorrente è persistita perché le serie delle fonti assenti restano.
    const beforePriceSource = entry.fonteCorrente ?? priceSource(entry);
    const beforeLastSeen = entry.lastSeen;

    for (const k of keys) {
      if (!idx.has(k)) { entry.chiavi.push(k); idx.set(k, id); }
    }
    entry.lastSeen = today;
    entry.stato = 'attivo';
    entry.sparitoIl = null;
    if (wasGone && !isRepost && beforeLastSeen !== today) diff.riapparsi.push(id);

    // Serie per fonte: una voce per giorno, solo sui cambi prezzo.
    const present = new Set();
    for (const a of cluster.annunci) {
      const mk = a.id ? `${a.portale}:${a.id}` : null;
      if (!mk) continue;
      present.add(mk);
      if (a.prezzo == null || a.prezzo <= 0) continue;
      const serie = (entry.serie[mk] = entry.serie[mk] || []);
      const last = serie[serie.length - 1];
      if (last && last.data === today) {
        if (last.prezzo !== a.prezzo) last.prezzo = a.prezzo;
      } else if (!last || last.prezzo !== a.prezzo) {
        serie.push({ data: today, prezzo: a.prezzo });
      }
    }

    const w = cluster.winner;
    entry.ultimaIstantanea = {
      titolo: w.titolo || '', zona: w.zona || '', comune: w.comune || '',
      indirizzo: w.indirizzo || '', superficieMq: w.superficieMq ?? null,
      camere: w.camere ?? null, prezzo: w.prezzo ?? null,
      url: w.url || '', portale: w.portale, agenzia: w.agenzia || '',
    };
    refreshDerived(entry, present);
    // Ribasso del run: calo prezzo SULLA STESSA fonte (se la fonte vincente è
    // cambiata non è un ribasso). Stesso giorno: priceBefore è già il valore
    // odierno → nessun falso diff.
    const afterPriceSource = priceSource(entry, present);
    if (priceBefore != null && entry.prezzoCorrente != null
        && beforePriceSource === afterPriceSource && entry.prezzoCorrente < priceBefore) {
      diff.ribassati.push({ id, da: priceBefore, a: entry.prezzoCorrente });
    }
    seen.add(id);
  }

  // Sparizioni: solo voci attive non viste oggi. Guard anti-run-rotto: se la
  // copertura crolla (>50% delle voci attive assenti, su >20 voci), NON marcare
  // sparito nessuno — più probabile un portale rotto che 100 vendite insieme.
  const activeBefore = Object.entries(ledger.entries).filter(([id, e]) => e.stato === 'attivo' && !seen.has(id));
  const activeTotal = seen.size + activeBefore.length;
  if (guard && activeTotal > 20 && activeBefore.length > activeTotal * 0.5) {
    diff.guardAttivo = true;
  } else {
    for (const [id, e] of activeBefore) {
      if (e.lastSeen === today) continue; // già aggiornata oggi da un altro cluster: non toccare
      e.stato = 'sparito';
      e.sparitoIl = today;
      diff.spariti.push(id);
    }
  }

  // Registro dei run (una voce per giorno; re-run nello stesso giorno sostituisce).
  const run = {
    data: today, unici: seen.size,
    nuovi: diff.nuovi.length, ribassati: diff.ribassati.length,
    spariti: diff.spariti.length, guardAttivo: diff.guardAttivo,
  };
  const lastRun = ledger.runs[ledger.runs.length - 1];
  if (lastRun && lastRun.data === today) ledger.runs[ledger.runs.length - 1] = run;
  else ledger.runs.push(run);
  if (ledger.runs.length > 400) ledger.runs = ledger.runs.slice(-400);

  return diff;
}

// ---------------------------------------------------------------------------
// Osservazioni per analyzeFlip: { 'portale:id': {firstSeen, serie} }.
// firstSeen è quello della VOCE (sopravvive alle ripubblicazioni con ID nuovo).
// ---------------------------------------------------------------------------
export function ledgerObservations(ledger) {
  const out = {};
  for (const e of Object.values(ledger.entries)) {
    for (const [k, serie] of Object.entries(e.serie)) {
      out[k] = { firstSeen: e.firstSeen, serie };
    }
  }
  return out;
}

// Blocco compatto da allegare agli annunci del sito (per badge e dettaglio).
export function adLedgerInfo(ledger, idx, ad, diff) {
  const id = adKeys(ad).map((k) => idx.get(k)).find(Boolean);
  if (!id) return null;
  const e = ledger.entries[id];
  return {
    key: id,
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
    giorniOsservati: e.giorniOsservati ?? days(e.firstSeen, e.lastSeen),
    stato: e.stato,
    ribassiOsservati: e.ribassiOsservati ?? 0,
    nuovo: diff?.nuovi.includes(id) || false,
    ribassatoOggi: diff?.ribassati.some((r) => r.id === id) || false,
    ripubblicazioni: e.ripubblicazioni || [],
    timeline: entryTimeline(e, 12),
  };
}
