// Deduplicazione cross-portale per la sezione GLOBAL.
// Stesso immobile su più portali = (comune, prezzo ±1%, mq ±2) o
// (indirizzo normalizzato + prezzo ±2%), con conferme da agenzia/camere/locali/titolo.
// Match automatico con punteggio ≥ 0.75. Il cluster conserva TUTTE le fonti.

const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(via|viale|piazza|piazzale|vicolo|largo|strada|corso)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const STOPWORDS = new Set(['in', 'vendita', 'appartamento', 'bilocale', 'trilocale', 'quadrilocale',
  'monolocale', 'casa', 'di', 'a', 'da', 'con', 'il', 'la', 'lo', 'le', 'i', 'gli', 'un', 'una',
  'mq', 'm2', 'bologna', 'pianoro', 'san', 'lazzaro', 'savena', 'zona', 'centro']);

function titleTokens(t) {
  return new Set(norm(t).split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

function tokenOverlap(a, b) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

// Portali che condividono lo stesso database annunci: un ID numerico identico
// è lo stesso immobile a prescindere dall'agenzia (Tecnocasa/Tecnorete = gruppo).
const SHARED_DB_GROUPS = [['tecnocasa', 'tecnorete']];
function sameSharedDbId(a, b) {
  if (!a.id || !b.id || String(a.id) !== String(b.id)) return false;
  if (!/^\d+$/.test(String(a.id))) return false;
  return SHARED_DB_GROUPS.some((g) => g.includes(a.portale) && g.includes(b.portale) && a.portale !== b.portale);
}

// Gli aggregatori (flatsearch) dichiarano su quali portali è pubblicato l'annuncio
// e con quale ID d'origine: match DEFINITIVO con l'annuncio raccolto direttamente,
// senza euristiche su prezzo/mq. `idsOrigine` = [{portale: nome display, id}].
const ORIGIN_ALIASES = {
  'immobiliare.it': 'immobiliare', immobiliare: 'immobiliare',
  'idealista.it': 'idealista', idealista: 'idealista',
  'casa.it': 'casait', casait: 'casait',
  'subito.it': 'subito', subito: 'subito',
  'attico.it': 'attico', attico: 'attico',
  'wikicasa.it': 'wikicasa', wikicasa: 'wikicasa',
  'bakeca.it': 'bakeca', bakeca: 'bakeca',
  'tecnocasa.it': 'tecnocasa', tecnocasa: 'tecnocasa',
  'tecnorete.it': 'tecnorete', tecnorete: 'tecnorete',
  'tempocasa.it': 'tempocasa', tempocasa: 'tempocasa',
  'remax.it': 'remax', 're/max': 'remax', remax: 'remax',
  caasa: 'caasa', 'caasa.it': 'caasa',
  trovacasa: 'trovacasa', 'trovacasa.it': 'trovacasa',
  casadaprivato: 'casadaprivato', 'casadaprivato.it': 'casadaprivato',
  // Siti proprietari di agenzie (censimento 22/11/2026).
  'gabetti.it': 'gabetti', gabetti: 'gabetti',
  'toscano.it': 'toscano', toscano: 'toscano',
  'professionecasa.it': 'professionecasa', professionecasa: 'professionecasa',
  'grimaldifranchising.it': 'grimaldi', grimaldi: 'grimaldi',
  'living-in.it': 'livingin', livingin: 'livingin',
  'mondore.it': 'mondore', mondore: 'mondore',
  'immobiliaresanlazzaro.it': 'immobiliaresanlazzaro',
  'grandicasebologna.it': 'grandicase',
  'vivacasaimmobiliare.it': 'vivacasa',
  'reportimmobiliare.it': 'reportimmobiliare',
  'arsimmobiliare.com': 'ars',
  'immobiliarekapitalre.it': 'kapitalre', kapitalre: 'kapitalre',
  'limmobiliarebologna.it': 'limmobiliare',
  'paologiacopini.it': 'giacopini',
  'abitarebologna.it': 'abitarebologna',
  '1000case.it': 'millecase', millecase: 'millecase',
  'immobiliarecavallo.it': 'cavallo',
  'progettocasadialfaeomega.it': 'alfaeomega',
};

// Chiavi "<portale>:<id>" dichiarate da un aggregatore (vuote se non è un aggregatore).
export function originKeysOf(ad) { return originKeys(ad); }
function originKeys(ad) {
  if (!Array.isArray(ad.idsOrigine)) return [];
  const out = [];
  for (const o of ad.idsOrigine) {
    const pid = ORIGIN_ALIASES[String(o?.portale || '').toLowerCase().trim()];
    const oid = String(o?.id || '').trim();
    if (pid && oid) out.push(`${pid}:${oid}`);
  }
  return out;
}

function sameOriginId(a, b) {
  if (!a.id || !b.id) return false;
  const ka = originKeys(a);
  const kb = originKeys(b);
  if (!ka.length && !kb.length) return false;
  const selfA = `${a.portale}:${a.id}`;
  const selfB = `${b.portale}:${b.id}`;
  // l'aggregatore punta all'annuncio diretto, o due aggregatori puntano allo stesso annuncio
  return ka.includes(selfB) || kb.includes(selfA) || ka.some((k) => kb.includes(k));
}

// Punteggio di similarità 0..1 tra due annunci di portali diversi.
export function similarity(a, b) {
  if (a.portale === b.portale && a.id === b.id) return 1;
  // Stesso ID su DB condiviso: match definitivo (prezzo/mq possono differire di poco).
  if (sameSharedDbId(a, b)) return 1;
  // ID d'origine dichiarato dall'aggregatore: match definitivo.
  if (sameOriginId(a, b)) return 1;
  const ca = norm(a.comune);
  const cb = norm(b.comune);
  if (ca && cb && ca !== cb) return 0; // comuni diversi: mai lo stesso immobile

  const pa = a.prezzo;
  const pb = b.prezzo;
  if (pa == null || pb == null || pa <= 0 || pb <= 0) return 0;
  const priceDiff = Math.abs(pa - pb) / Math.max(pa, pb);

  const ma = a.superficieMq;
  const mb = b.superficieMq;
  const mqClose = ma != null && mb != null && Math.abs(ma - mb) <= 2;
  const mqDiff = ma != null && mb != null && ma > 0 && mb > 0
    ? Math.abs(ma - mb) / Math.max(ma, mb) : null;

  const ia = norm(a.indirizzo);
  const ib = norm(b.indirizzo);
  const sameAddress = ia.length >= 5 && ia === ib;

  // Gate d'ingresso: serve una base forte (prezzo+mq oppure indirizzo+prezzo).
  const gateMq = priceDiff <= 0.01 && mqClose;
  const gateAddr = sameAddress && priceDiff <= 0.02;
  // Prezzo identico + mq molto vicini (±5%) anche senza indirizzo: candidati da confermare.
  const gatePrice = priceDiff === 0 && mqDiff != null && mqDiff <= 0.05;
  if (!gateMq && !gateAddr && !gatePrice) return 0;

  let score = 0.5; // base forte superata
  if (priceDiff === 0) score += 0.15;
  else if (priceDiff <= 0.01) score += 0.1;
  if (mqClose) score += 0.1;
  if (sameAddress) score += 0.15;

  const aa = norm(a.agenzia);
  const ab = norm(b.agenzia);
  if (aa && ab) {
    if (aa === ab || aa.includes(ab) || ab.includes(aa)) score += 0.15;
    else score -= 0.2; // agenzie diverse sullo stesso prezzo/mq: probabili case diverse
  }
  if (a.camere != null && b.camere != null) {
    score += a.camere === b.camere ? 0.05 : -0.15;
  }
  if (a.locali != null && b.locali != null) {
    score += a.locali === b.locali ? 0.05 : -0.1;
  }
  const overlap = tokenOverlap(a.titolo, b.titolo);
  score += overlap >= 0.6 ? 0.1 : overlap >= 0.3 ? 0.05 : -0.05;

  return Math.max(0, Math.min(1, score));
}

// Preferenza fonte: portale primario > agenzia > aggregatore > P2P minore.
export const SOURCE_PRIORITY = [
  'immobiliare', 'idealista', 'casait', 'wikicasa', 'subito', 'attico',
  'tecnocasa', 'tecnorete', 'tempocasa', 'remax',
  // Siti proprietari di agenzie (fonte diretta dell'annuncio, dopo le reti).
  'gabetti', 'toscano', 'professionecasa', 'grimaldi', 'kapitalre',
  'immobiliaresanlazzaro', 'mondore', 'vivacasa', 'ars', 'limmobiliare',
  'giacopini', 'abitarebologna', 'millecase', 'cavallo', 'alfaeomega',
  'grandicase', 'reportimmobiliare', 'livingin',
  'casadaprivato', 'bakeca',
  'trovacasa', 'trovit', 'mitula', 'casaclick', 'flatsearch',
];

function richness(ad) {
  let n = 0;
  if (ad.planimetrie?.length) n += 3;
  if (ad.lat != null) n += 2;
  if (ad.pubblicatoIl) n += 1;
  if (ad.descrizione?.length > 200) n += 1;
  if (ad.foto) n += 1;
  return n;
}

function pickWinner(cluster) {
  return cluster.slice().sort((x, y) => {
    const px = SOURCE_PRIORITY.indexOf(x.portale);
    const py = SOURCE_PRIORITY.indexOf(y.portale);
    const rx = px < 0 ? 99 : px;
    const ry = py < 0 ? 99 : py;
    if (rx !== ry) return rx - ry;
    return richness(y) - richness(x);
  })[0];
}

// Raggruppa gli annunci in cluster (union-find sul punteggio di similarità).
// Ritorna [{winner, fonti: [{portale, id, url, prezzo}], annunci: [...], duplicati: n}].
export function deduplicate(ads, { threshold = 0.75 } = {}) {
  // Doppioni DELLO STESSO portale: alcuni aggregatori (flatsearch) pubblicano lo
  // stesso immobile con UUID diversi. Si collassano su indirizzo+prezzo+mq prima
  // del clustering cross-portale, che per costruzione confronta solo portali diversi.
  const bySelf = new Map();
  const uniq = [];
  for (const ad of ads) {
    const ind = norm(ad.indirizzo);
    const k = ind && ad.prezzo != null && ad.superficieMq != null
      ? `${ad.portale}|${norm(ad.comune)}|${ind}|${ad.prezzo}|${ad.superficieMq}`
      : null;
    if (k && bySelf.has(k)) {
      const at = bySelf.get(k);
      // tiene la versione più ricca; unisce gli ID d'origine dichiarati dai doppioni.
      // Copia difensiva: il JSON in ingresso non deve essere mutato.
      const merged = richness(ad) > richness(uniq[at]) ? { ...ad } : { ...uniq[at] };
      if (Array.isArray(ad.idsOrigine) && ad.idsOrigine.length) {
        const base = Array.isArray(merged.idsOrigine) ? merged.idsOrigine : [];
        const seen = new Set(base.map((o) => `${o.portale}:${o.id}`));
        merged.idsOrigine = [...base, ...ad.idsOrigine.filter((o) => !seen.has(`${o.portale}:${o.id}`))];
      }
      uniq[at] = merged;
      continue;
    }
    if (k) bySelf.set(k, uniq.length);
    uniq.push(ad);
  }
  ads = uniq;

  const parent = ads.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (i, j) => { parent[find(i)] = find(j); };

  // Blocking per comune+prezzo arrotondato (bucket da 2k) per evitare O(n²) pieno.
  const buckets = new Map();
  ads.forEach((ad, i) => {
    if (ad.prezzo == null) return;
    const ck = norm(ad.comune);
    const base = Math.round(ad.prezzo / 2000);
    for (const off of [-1, 0, 1]) {
      const key = `${ck}|${base + off}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    }
  });
  // Secondo blocking sugli ID d'origine: un match esatto va trovato anche se
  // l'aggregatore espone un prezzo diverso/obsoleto rispetto al portale diretto.
  const byOrigin = new Map();
  ads.forEach((ad, i) => {
    const keys = new Set(originKeys(ad));
    if (ad.id) keys.add(`${ad.portale}:${ad.id}`);
    for (const k of keys) {
      if (!byOrigin.has(k)) byOrigin.set(k, []);
      byOrigin.get(k).push(i);
    }
  });
  for (const idxs of byOrigin.values()) {
    if (idxs.length > 1) buckets.set(`origin|${idxs[0]}`, idxs);
  }

  const compared = new Set();
  for (const idxs of buckets.values()) {
    for (let x = 0; x < idxs.length; x++) {
      for (let y = x + 1; y < idxs.length; y++) {
        const i = idxs[x]; const j = idxs[y];
        const pk = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (compared.has(pk)) continue;
        compared.add(pk);
        // Gli ID sono la stessa chiave solo entro un portale: tra portali diversi
        // un ID numerico uguale è una coincidenza, non un match.
        if (sameOriginId(ads[i], ads[j]) || similarity(ads[i], ads[j]) >= threshold) union(i, j);
      }
    }
  }

  const groups = new Map();
  ads.forEach((ad, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(ad);
  });

  return [...groups.values()].map((cluster) => {
    const winner = pickWinner(cluster);
    return {
      winner,
      annunci: cluster,
      duplicati: cluster.length - 1,
      fonti: cluster.map((a) => ({
        portale: a.portale, id: a.id, url: a.url, prezzo: a.prezzo, agenzia: a.agenzia || '',
      })),
    };
  });
}