// ---------------------------------------------------------------------------
// Analisi FLIP (RENO + STALE) — modulo puro, indipendente dal portale.
// Requisiti: requisiti-immobilare.md §2quinquies. Parametri: flip-config.mjs.
// Usato da scrape.mjs (JSON) e build-site.mjs (sito statico).
// Tutti i margini sono STIME INDICATIVE, non perizie.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { FLIP_CONFIG } from './flip-config.mjs';
import { detectAuction, detectAffitto, detectDemolizione, detectNoResidenza, detectIpoteticoResidenziale } from './filters.mjs';
import { ALLOWED_COMUNI, comuneContraddetto } from './geo.mjs';

const CFG = FLIP_CONFIG;

// "2.129 €/m²" / 2129 -> 2129 (numero) o null
export function parsePrezzoMq(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v || '').replace(/[^\d]/g, '');
  return m ? parseInt(m, 10) : null;
}

function median(values) {
  const s = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2);
}

const norm = (s) => String(s || '').trim().toLowerCase();

// Sottozona: parte dopo " / " nel campo zona ("Bolognina, … / Corticella" → "corticella").
// Senza " / " la zona stessa è la sottozona (es. "Tazzola").
export function subzonaKey(zona) {
  const z = String(zona || '').trim();
  const i = z.lastIndexOf('/');
  return norm(i >= 0 ? z.slice(i + 1) : z);
}

const isRistrutturare = (stato) => /da ristrutturare/i.test(stato || '');
const isBuonoStato = (stato) =>
  /buono|abitabile|ottimo|ristrutturat[oa]|nuovo/i.test(stato || '') && !isRistrutturare(stato);

// ---------------------------------------------------------------------------
// Mediane €/m² per zona e per comune (comparabili = buono stato/ristrutturato).
// Con meno di minComparabiliZona comparabili si usa la mediana comunale.
// Gli override manuali in flip-config vincono sempre.
// Le aste giudiziarie NON entrano nei comparabili: il loro prezzo è una base
// d'asta (spesso <50% del valore) e abbasserebbe l'ARV di tutta la zona,
// deprimendo il ROI degli annunci di vendita libera.
// ---------------------------------------------------------------------------
export function computeMedians(ads) {
  const zoneGood = new Map(); // subzona -> {vals, comune}
  const zoneAll = new Map();
  const comuneGood = new Map();
  const comuneAll = new Map();
  const push = (map, key, val, extra) => {
    if (!key || val == null) return;
    if (!map.has(key)) map.set(key, { vals: [], ...extra });
    map.get(key).vals.push(val);
  };
  for (const ad of ads) {
    if (detectAuction(ad)) continue;
    // Affitti (lead privati): il prezzo è un CANONE mensile, non un €/m² di
    // vendita — come le aste, non deve inquinare le mediane di zona.
    if (detectAffitto(ad)) continue;
    const pmq = parsePrezzoMq(ad.prezzoMq);
    const zk = subzonaKey(ad.zona);
    const ck = norm(ad.comune);
    push(zoneAll, zk, pmq, { comune: ck });
    push(comuneAll, ck, pmq);
    if (isBuonoStato(ad.stato)) {
      push(zoneGood, zk, pmq, { comune: ck });
      push(comuneGood, ck, pmq);
    }
  }
  const med = (map, key) => (map.has(key) ? median(map.get(key).vals) : null);
  const n = (map, key) => (map.has(key) ? map.get(key).vals.length : 0);

  // ARV €/m² per sottozona, con fonte e numero comparabili.
  const arvByZona = new Map();
  for (const zk of new Set([...zoneAll.keys(), ...zoneGood.keys()])) {
    const comune = (zoneGood.get(zk) || zoneAll.get(zk) || {}).comune || '';
    const override = CFG.arvOverrideMq[zk] ?? CFG.arvOverrideMq[`comune:${comune}`] ?? null;
    let arvMq, fonte, comparabili;
    if (override != null) {
      arvMq = override;
      fonte = CFG.arvOverrideMq[zk] != null ? 'override zona' : 'override comune';
      comparabili = n(zoneGood, zk);
    } else if (n(zoneGood, zk) >= CFG.reno.minComparabiliZona) {
      arvMq = med(zoneGood, zk);
      fonte = 'mediana zona (buono stato)';
      comparabili = n(zoneGood, zk);
    } else if (n(comuneGood, comune) >= CFG.reno.minComparabiliZona) {
      arvMq = med(comuneGood, comune);
      fonte = 'mediana comunale (buono stato)';
      comparabili = n(comuneGood, comune);
    } else if (n(zoneAll, zk) > 0) {
      arvMq = med(zoneAll, zk);
      fonte = 'mediana zona (tutti gli stati)';
      comparabili = n(zoneAll, zk);
    } else {
      arvMq = med(comuneAll, comune);
      fonte = arvMq != null ? 'mediana comunale (tutti gli stati)' : 'non stimabile';
      comparabili = n(comuneAll, comune);
    }
    arvByZona.set(zk, { arvMq, fonte, comparabili, comune });
  }
  return {
    arvByZona,
    medianaZona: (zk) => med(zoneAll, zk),
    medianaComune: (ck) => med(comuneAll, ck),
  };
}

// ---------------------------------------------------------------------------
// FLIP RENO — margine stimato: ARV − (acquisto + lavori + costi accessori).
// Pool: "da ristrutturare" oppure buono stato con sconto ≥ soglia vs mediana.
// ---------------------------------------------------------------------------
function analyzeReno(ad, medians) {
  const r = CFG.reno;
  const prezzo = ad.prezzo ?? null;
  const mq = ad.superficieMq ?? null;
  const pmq = parsePrezzoMq(ad.prezzoMq) ?? (prezzo != null && mq ? Math.round(prezzo / mq) : null);
  const zk = subzonaKey(ad.zona);
  const arv = medians.arvByZona.get(zk) || {};
  const mediana = medians.medianaZona(zk) ?? medians.medianaComune(norm(ad.comune));

  const base = {
    candidato: false,
    motivoPool: '',
    pmq,
    medianaMq: mediana,
    scontoVsZona: pmq != null && mediana ? Math.round((1 - pmq / mediana) * 1000) / 10 : null,
    arvMq: arv.arvMq ?? null,
    arvFonte: arv.fonte ?? 'non stimabile',
    comparabili: arv.comparabili ?? 0,
  };

  // Ammissibilità di base (gli stessi "no" duri dei profili, senza i criteri
  // da residenza: camere/bilocali/budget/POI/distanza non si applicano al flip).
  // Le aste e il geocoding omonimo sono "no" duri ANCHE qui: senza, un immobile
  // di Cento geocodificato a Bologna restava il miglior ROI del progetto (61,5%)
  // pur essendo escluso dai profili BIG/SMA.
  const hard = [];
  if (/seminterr|sotterr|interrato/.test(`${ad.piano} ${ad.pianoSolo}`.toLowerCase())) hard.push('Seminterrato');
  if (/nuda\s+propriet/i.test(`${ad.tipologia} ${ad.descrizione}`)) hard.push('Nuda proprietà');
  if (/demolire|cattivo stato/i.test(ad.stato || '')) hard.push(`Stato: ${ad.stato}`);
  if (ad._nonResidenziale) hard.push('Uso non residenziale');
  // Stessi "no" duri della lettura annuncio (applyProfiles): il campo stato
  // strutturato può dire "Da ristrutturare" mentre il testo rivela demolizione
  // (attico 52223207: ROI 103% fittizio, ricostruzione fuori scala) o un uso
  // non abitabile. Senza questi controlli i falsi positivi dominavano la
  // classifica RENO (segnalazione utente 24/11/2026).
  const demol = detectDemolizione(ad);
  if (demol) hard.push(demol);
  const noRes = detectNoResidenza(ad);
  if (noRes) hard.push(noRes);
  const ipo = detectIpoteticoResidenziale(ad);
  if (ipo) hard.push(ipo);
  const asta = detectAuction(ad);
  if (asta) hard.push(asta);
  const affitto = detectAffitto(ad);
  if (affitto) hard.push(affitto);
  const fuori = comuneContraddetto(ad);
  if (fuori) hard.push(`Comune reale ${fuori}: la descrizione contraddice "${ad.comune}"`);
  const ck = norm(ad.comune);
  if (ck && !ALLOWED_COMUNI.includes(ck)) hard.push(`Comune non ammesso: ${ad.comune}`);
  if (hard.length) return { ...base, motivoPool: hard.join('; ') };

  const ristr = isRistrutturare(ad.stato);
  const buono = isBuonoStato(ad.stato);
  const sconto = pmq != null && mediana ? 1 - pmq / mediana : null;
  if (!ristr && !(buono && sconto != null && sconto >= r.scontoMinimoBuonoStato)) {
    const why = !ristr && !buono
      ? `Stato non valutabile ("${ad.stato || 'n/d'}")`
      : `Buono stato ma sconto vs zona ${sconto != null ? Math.round(sconto * 100) : '?'}% < ${Math.round(r.scontoMinimoBuonoStato * 100)}%`;
    return { ...base, motivoPool: why };
  }
  if (prezzo == null || !mq) return { ...base, motivoPool: 'Prezzo o superficie mancanti' };
  if (base.arvMq == null) return { ...base, motivoPool: 'ARV non stimabile (zona senza comparabili né override)' };

  const costoLavoriMq = ristr ? r.costoLavoriMqRistrutturare : r.costoLavoriMqRestyling;
  const costoLavori = Math.round(mq * costoLavoriMq);
  const registro = Math.round(mq * r.valoreCatastaleMq * r.aliquotaRegistro);
  const agenzia = Math.round(prezzo * r.aliquotaAgenzia);
  const costiAccessori = registro + r.notaio + agenzia + r.holdingEVendita;
  const arvTot = Math.round(mq * base.arvMq);
  const capitale = prezzo + costoLavori + costiAccessori;
  const margineLordo = arvTot - capitale;
  const plusvalenza = margineLordo > 0 ? Math.round(margineLordo * r.aliquotaPlusvalenza) : 0;
  const margineNetto = margineLordo - plusvalenza;
  const roi = capitale > 0 ? Math.round((margineNetto / capitale) * 1000) / 10 : null;
  const semaforo = roi == null ? 'rosso' : roi >= r.roiVerde * 100 ? 'verde' : roi >= r.roiGiallo * 100 ? 'giallo' : 'rosso';

  // Prezzo massimo d'offerta per ROI netto ≥ target.
  // netto = (arv − C) × (1 − t) ≥ roiTarget × C  →  C ≤ arv(1−t)/(roiTarget+1−t)
  // C = P(1+agenzia) + lavori + costiFissi  →  P = (Cmax − lavori − costiFissi)/(1+agenzia)
  const t = r.aliquotaPlusvalenza;
  const cMax = (arvTot * (1 - t)) / (r.roiTargetOfferta + 1 - t);
  const costiFissi = registro + r.notaio + r.holdingEVendita;
  const maxOffer = Math.max(0, Math.round((cMax - costoLavori - costiFissi) / (1 + r.aliquotaAgenzia) / 1000) * 1000);

  return {
    ...base,
    candidato: true,
    motivoPool: ristr ? 'Da ristrutturare' : `Buono stato scontato ${Math.round(sconto * 100)}% vs zona`,
    tipoLavori: ristr ? 'Ristrutturazione' : 'Restyling',
    costoLavoriMq,
    costoLavori,
    registro,
    agenzia,
    costiAccessori,
    arvTot,
    capitale,
    margineLordo,
    plusvalenza,
    margineNetto,
    roi,
    semaforo,
    maxOffer,
  };
}

// ---------------------------------------------------------------------------
// FLIP STALE — negoziabilità: giorni online + ribassi (storico) + keyword.
// ---------------------------------------------------------------------------
function daysBetween(isoDate, now) {
  if (!isoDate) return null;
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86400000));
}

function analyzeStale(ad, storico, now, osservazione = null) {
  const s = CFG.stale;
  const giorniDichiarati = daysBetween(ad.pubblicatoIl, now);
  const giorniDaAggiornamento = daysBetween(ad.aggiornatoIl, now);

  // Giorni online: max tra dichiarato dal portale e OSSERVATO dal radar
  // (ledger: firstSeen della voce sopravvive alle ripubblicazioni con ID nuovo).
  const giorniOsservati = osservazione ? daysBetween(osservazione.firstSeen, now) : null;
  const giorniOnline = giorniOsservati != null
    ? Math.max(giorniDichiarati ?? 0, giorniOsservati)
    : giorniDichiarati;

  // Ribassi: serie del ledger se disponibile (cross-run, stessa fonte),
  // altrimenti lo storico per-portale dello scraper.
  const history = (osservazione?.serie || storico?.[ad.id] || []).slice().sort((a, b) => a.data.localeCompare(b.data));
  let ribassi = 0;
  let ribassoTot = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i].prezzo < history[i - 1].prezzo) {
      ribassi++;
      ribassoTot += history[i - 1].prezzo - history[i].prezzo;
    }
  }
  const ribassoPct = history.length > 1 && history[0].prezzo > 0
    ? Math.round((ribassoTot / history[0].prezzo) * 1000) / 10
    : 0;

  const text = `${ad.titolo || ''} ${ad.descrizione || ''}`.toLowerCase();
  const keyword = s.keyword.filter((k) => new RegExp(k, 'i').test(text));

  const pGiorni = giorniOnline == null ? 0
    : Math.min(s.puntiGiorni, Math.round((giorniOnline / s.giorniPienoPunteggio) * s.puntiGiorni));
  const pRibassi = Math.min(s.puntiRibassoMax, ribassi * s.puntiRibassoSingolo);
  const pKeyword = Math.min(s.puntiKeywordMax, keyword.length * s.puntiKeywordSingola);
  const score = pGiorni + pRibassi + pKeyword;
  const fascia = score >= s.sogliaAlto ? 'Alto' : score >= s.sogliaMedio ? 'Medio' : 'Basso';
  const scontoSuggerito = fascia === 'Alto' ? s.scontoAlto : fascia === 'Medio' ? s.scontoMedio : s.scontoBasso;
  const prezzoTarget = ad.prezzo != null ? Math.round((ad.prezzo * (1 - scontoSuggerito)) / 1000) * 1000 : null;

  return {
    giorniOnline,
    giorniDichiarati,
    giorniOsservati,
    giorniDaAggiornamento,
    ribassi,
    ribassoTot,
    ribassoPct,
    storicoPunti: history.length,
    keyword,
    puntiGiorni: pGiorni,
    puntiRibassi: pRibassi,
    puntiKeyword: pKeyword,
    score,
    fascia,
    scontoSuggerito,
    prezzoTarget,
  };
}

// ---------------------------------------------------------------------------
// API principale
// ---------------------------------------------------------------------------

// Calcola ad.flip = {reno, stale} per ogni annuncio (muta gli annunci).
// detectNonResidential: funzione del portale per il filtro "solo residenziale".
// storico: oggetto {id: [{data, prezzo}]} già caricato (loadPriceHistory).
// osservazioni: {'portale:id': {firstSeen, serie}} dal ledger unificato —
// giorni online OSSERVATI e ribassi cross-run prevalgono sui dati dichiarati.
export function analyzeFlip(ads, { detectNonResidential, storico = {}, osservazioni = null, now = new Date() } = {}) {
  const medians = computeMedians(ads);
  for (const ad of ads) {
    ad._nonResidenziale = detectNonResidential ? Boolean(detectNonResidential(ad)) : false;
    ad.flip = {
      reno: analyzeReno(ad, medians),
      stale: analyzeStale(ad, storico, now, osservazioni?.[`${ad.portale}:${ad.id}`] || null),
    };
    delete ad._nonResidenziale;
  }
  return medians;
}

// Storico prezzi: {id: [{data: 'YYYY-MM-DD', prezzo}]}. Una voce per giorno:
// run multiple nello stesso giorno aggiornano la voce (non duplicano).
export function loadPriceHistory(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function updatePriceHistory(ads, file, now = new Date()) {
  const hist = loadPriceHistory(file);
  const today = now.toISOString().slice(0, 10);
  let changed = 0;
  for (const ad of ads) {
    if (!ad.id || ad.prezzo == null) continue;
    const series = (hist[ad.id] = hist[ad.id] || []);
    const last = series[series.length - 1];
    // Lo storico registra solo i cambi prezzo (baseline compresa): una voce
    // per giorno, run multiple nello stesso giorno aggiornano senza duplicare.
    if (last && last.data === today) {
      if (last.prezzo !== ad.prezzo) { last.prezzo = ad.prezzo; changed++; }
    } else if (!last || last.prezzo !== ad.prezzo) {
      series.push({ data: today, prezzo: ad.prezzo });
      changed++;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(hist, null, 2));
  return changed;
}