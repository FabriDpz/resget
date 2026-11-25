// ---------------------------------------------------------------------------
// Azioni della chat del sito ("stile Rufus") — modulo PURO, senza LLM né HTTP.
// Il modello traduce la richiesta in un'azione JSON; qui l'azione viene
// VALIDATA ed ESEGUITA sui dati reali (site/data.js). Il modello non inventa
// mai prezzi/ID: vede solo il riepilogo del dataset e le righe risultato.
// Azioni: filter | rank | compare | answer | clarify.
// ---------------------------------------------------------------------------

export const CHAT_ACTIONS = ['filter', 'rank', 'compare', 'answer', 'clarify'];
export const RANK_CRITERI = ['roi', 'stale', 'pmq', 'prezzo', 'poi', 'margine'];
const ALLOWED_COMUNI = ['bologna', 'pianoro', 'san lazzaro di savena'];

// Stessi predicati della UI (site-src/app.js): il perimetro della chat è la
// lista operativa del flip (comuni ammessi, no affitti, no stati senza margine).
const isAffitto = (a) => /affitto, non vendita/i.test(`${a.motivazione || ''} ${a.motivazioneSma || ''}`);
const statoFlipInutile = (a) => {
  const s = String(a.stato || '').trim().toLowerCase();
  if (!s) return false;
  if (/demolire|ristrutturare|pessimo|cattivo|da sistemare|renovat|restaur|fixer/.test(s)) return false;
  return /^nuovo|in costruzione|\bnew\b|ottimo|ristrutturat[oa]|pari al nuovo|perfetto|excelente|chiavi in mano|recentemente ristruttur|appena ristruttur|completamente ristruttur|totalmente ristruttur|già ristruttur/i.test(s);
};
const inTarget = (a) => ALLOWED_COMUNI.includes(String(a.comune || '').trim().toLowerCase());

export function chatPool(data) {
  return (data?.global?.ads || []).filter((a) => inTarget(a) && !isAffitto(a) && !statoFlipInutile(a));
}

const pmqNum = (a) => {
  if (typeof a.prezzoMq === 'number') return a.prezzoMq;
  const m = String(a.prezzoMq || '').replace(/\./g, '').match(/(\d+)/);
  if (m) return Number(m[1]);
  return a.prezzo != null && a.superficieMq ? Math.round(a.prezzo / a.superficieMq) : null;
};
const subzona = (z) => String(z || '').split('/').pop().trim();

// Riga compatta per LLM e UI: solo campi reali, mai testo libero inventato.
export function compactRow(a) {
  return {
    id: a.id,
    portale: a.portale,
    titolo: a.titolo || '',
    comune: a.comune || '',
    zona: subzona(a.zona) || a.zona || '',
    prezzo: a.prezzo ?? null,
    mq: a.superficieMq ?? null,
    pmq: pmqNum(a),
    camere: a.camere ?? a.camereAI ?? null,
    stato: a.stato || '',
    piano: a.pianoSolo ?? a.piano ?? '',
    ascensore: a.ascensore || '',
    esitoBig: a.esito || '',
    esitoSma: a.esitoSma || '',
    roi: a.flip?.reno?.candidato ? a.flip.reno.roi : null,
    margineNetto: a.flip?.reno?.candidato ? a.flip.reno.margineNetto : null,
    maxOffer: a.flip?.reno?.candidato ? a.flip.reno.maxOffer : null,
    semaforo: a.flip?.reno?.candidato ? a.flip.reno.semaforo : null,
    staleScore: a.flip?.stale?.score ?? null,
    staleFascia: a.flip?.stale?.fascia ?? null,
    prezzoTarget: a.flip?.stale?.prezzoTarget ?? null,
    giorniOnline: a.flip?.stale?.giorniOnline ?? null,
    ribassi: a.flip?.stale?.ribassi ?? 0,
    poi: a.poi?.rank ?? null,
    distanzaKm: a.distanzaKm ?? null,
    nuovo: Boolean(a.ledger?.nuovo),
    ribassatoOggi: Boolean(a.ledger?.ribassatoOggi),
    url: a.url || '',
    agenzia: a.agenzia || '',
  };
}

// Scheda estesa per l'azione answer: campi + descrizione TRONCATA (costo token).
export function detailCard(a, maxDesc = 900) {
  return {
    ...compactRow(a),
    indirizzo: a.indirizzo || '',
    locali: a.locali ?? null,
    bagni: a.bagni ?? null,
    balcone: a.balcone || '',
    terrazzo: a.terrazzo || '',
    cantina: a.cantina || '',
    riscaldamento: a.riscaldamento || '',
    ape: a.ape || '',
    speseCondominio: a.speseCondominio || '',
    convertibile: a.convertibile || a.convertibileAI || '',
    motivazioneBig: a.motivazione || '',
    motivazioneSma: a.motivazioneSma || '',
    tipoLavori: a.flip?.reno?.tipoLavori || '',
    costoLavori: a.flip?.reno?.costoLavori ?? null,
    arvTot: a.flip?.reno?.arvTot ?? null,
    motivoPoolReno: a.flip?.reno?.motivoPool || '',
    keywordStale: a.flip?.stale?.keyword || [],
    firstSeen: a.ledger?.firstSeen || a.pubblicatoIl || '',
    descrizione: String(a.descrizione || '').slice(0, maxDesc),
  };
}

const numOrNull = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
};

// Normalizza/valida l'azione del modello. Ritorna {action, ...} pulita oppure
// un'azione clarify di ripiego (fail-closed: niente esecuzioni su JSON marcio).
export function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object') return { action: 'clarify', domanda: 'Non ho capito la richiesta: puoi riformularla?' };
  const act = String(raw.action || '').toLowerCase();
  if (!CHAT_ACTIONS.includes(act)) return { action: 'clarify', domanda: 'Richiesta non riconosciuta: prova con una ricerca, una classifica o un confronto tra annunci.' };
  if (act === 'clarify') return { action: 'clarify', domanda: String(raw.domanda || 'Puoi essere più specifico?').slice(0, 300) };
  if (act === 'compare' || act === 'answer') {
    const ids = Array.isArray(raw.ids) ? raw.ids.map(String).slice(0, 4) : [];
    if (act === 'compare' && ids.length < 2) return { action: 'clarify', domanda: 'Quali annunci vuoi confrontare? Indicami almeno due ID (o chiedimi prima una ricerca).' };
    return { action: act, ids, domanda: String(raw.domanda || '').slice(0, 400) };
  }
  const pickFilter = (src) => {
    const f = {};
    if (!src || typeof src !== 'object') return f;
    for (const k of ['prezzoMax', 'prezzoMin', 'mqMin', 'mqMax', 'camereMin', 'distanzaMaxKm', 'poiMin']) {
      const n = numOrNull(src[k]);
      if (n != null && n >= 0) f[k] = n;
    }
    for (const k of ['comune', 'zona', 'stato', 'testo', 'ascensore', 'profilo']) {
      const s = String(src[k] ?? '').trim();
      if (s) f[k] = s.slice(0, 80);
    }
    return f;
  };
  if (act === 'rank') {
    const criterio = RANK_CRITERI.includes(raw.criterio) ? raw.criterio : 'roi';
    const n = numOrNull(raw.n);
    return { action: 'rank', criterio, n: n != null ? Math.min(10, Math.max(1, Math.round(n))) : 5, filtro: pickFilter(raw.filtro) };
  }
  return { action: 'filter', ...pickFilter(raw) };
}

// Predicate dal filtro normalizzato. AND tra tutti i criteri presenti.
export function matchFilter(a, f) {
  if (f.comune && String(a.comune || '').toLowerCase() !== f.comune.toLowerCase()) return false;
  if (f.zona && !String(a.zona || '').toLowerCase().includes(f.zona.toLowerCase())) return false;
  if (f.prezzoMax != null && !(a.prezzo != null && a.prezzo <= f.prezzoMax)) return false;
  if (f.prezzoMin != null && !(a.prezzo != null && a.prezzo >= f.prezzoMin)) return false;
  if (f.mqMin != null && !(a.superficieMq != null && a.superficieMq >= f.mqMin)) return false;
  if (f.mqMax != null && !(a.superficieMq != null && a.superficieMq <= f.mqMax)) return false;
  if (f.camereMin != null) {
    const c = a.camere ?? a.camereAI;
    if (!(c != null && c >= f.camereMin)) return false;
  }
  if (f.stato && !String(a.stato || '').toLowerCase().includes(f.stato.toLowerCase())) return false;
  if (f.ascensore && !String(a.ascensore || '').toLowerCase().includes(f.ascensore.toLowerCase())) return false;
  if (f.distanzaMaxKm != null && !(a.distanzaKm != null && a.distanzaKm <= f.distanzaMaxKm)) return false;
  if (f.poiMin != null && !(a.poi?.rank != null && a.poi.rank >= f.poiMin)) return false;
  if (f.profilo === 'BIG' && a.esito !== 'Selezionato') return false;
  if (f.profilo === 'SMA' && !(a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato')) return false;
  if (f.profilo === 'RENO' && !a.flip?.reno?.candidato) return false;
  if (f.profilo === 'STALE' && !(a.flip?.stale && a.flip.stale.fascia !== 'Basso')) return false;
  if (f.testo) {
    const hay = `${a.titolo || ''} ${a.descrizione || ''} ${a.zona || ''} ${a.indirizzo || ''} ${a.agenzia || ''}`.toLowerCase();
    if (!f.testo.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const RANK_VAL = {
  roi: (a) => a.flip?.reno?.candidato ? a.flip.reno.roi : null,
  margine: (a) => a.flip?.reno?.candidato ? a.flip.reno.margineNetto : null,
  stale: (a) => a.flip?.stale?.score ?? null,
  pmq: (a) => pmqNum(a),
  prezzo: (a) => a.prezzo ?? null,
  poi: (a) => a.poi?.rank ?? null,
};
// Direzione: roi/margine/stale/poi = più alto meglio; pmq/prezzo = più basso meglio.
const RANK_DIR = { roi: -1, margine: -1, stale: -1, poi: -1, pmq: 1, prezzo: 1 };

// Esegue l'azione normalizzata sul pool. Ritorna il payload per la UI;
// `rows` sono righe compatte REALI (max 20). Nessun LLM qui.
export function executeAction(action, data, { maxRows = 20 } = {}) {
  const pool = chatPool(data);
  if (action.action === 'clarify') return { action: 'clarify', domanda: action.domanda, rows: [], totale: 0 };

  if (action.action === 'compare' || action.action === 'answer') {
    const byId = new Map(pool.map((a) => [String(a.id), a]));
    const found = action.ids.map((id) => byId.get(id)).filter(Boolean);
    const missing = action.ids.filter((id) => !byId.has(id));
    if (!found.length) {
      return { action: 'clarify', domanda: 'Non trovo quegli annunci tra i candidati: chiedimi una ricerca per individuarli.', rows: [], totale: 0 };
    }
    const cards = found.map((a) => detailCard(a));
    return { action: action.action, ids: found.map((a) => String(a.id)), missing, cards, rows: found.map(compactRow), totale: found.length, domanda: action.domanda || '' };
  }

  const f = action.action === 'rank' ? (action.filtro || {}) : action;
  let rows = pool.filter((a) => matchFilter(a, f));
  const totale = rows.length;
  if (action.action === 'rank') {
    const val = RANK_VAL[action.criterio];
    const dir = RANK_DIR[action.criterio];
    rows = rows.filter((a) => val(a) != null).sort((a, b) => (val(a) - val(b)) * dir).slice(0, action.n);
  } else {
    rows = rows.slice(0, maxRows);
  }
  return {
    action: action.action,
    filtro: f,
    ...(action.action === 'rank' ? { criterio: action.criterio, n: action.n } : {}),
    totale,
    rows: rows.map(compactRow),
  };
}

// Riepilogo dataset per il system prompt: piccolo e deterministico.
export function datasetSummary(data) {
  const pool = chatPool(data);
  const prezzi = pool.map((a) => a.prezzo).filter((x) => x != null).sort((a, b) => a - b);
  const zone = [...new Set(pool.map((a) => subzona(a.zona)).filter(Boolean))].sort();
  const stati = [...new Set(pool.map((a) => a.stato).filter(Boolean))].sort();
  return {
    annunci: pool.length,
    comuni: ALLOWED_COMUNI,
    prezzoMin: prezzi[0] ?? null,
    prezzoMax: prezzi[prezzi.length - 1] ?? null,
    zone,
    stati,
    selezionatiBig: pool.filter((a) => a.esito === 'Selezionato').length,
    selezionatiSma: pool.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato').length,
    candidatiReno: pool.filter((a) => a.flip?.reno?.candidato).length,
    generatedAt: data?.generatedAt || null,
  };
}