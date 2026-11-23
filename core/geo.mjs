// Geografia condivisa: whitelist comuni, centri abitati di riferimento,
// distanza haversine. Fonte di verità: requisiti-immobilare.md §2 (valida per tutti i portali).

export const ALLOWED_COMUNI = ['bologna', 'pianoro', 'san lazzaro di savena'];

// Centri abitati di riferimento (coordinate verificate su OpenStreetMap/Nominatim).
export const CENTRI_ABITATI = [
  { name: 'Bologna centro', lat: 44.4938203, lon: 11.3426327 },
  { name: 'Borgo Panigale', lat: 44.5194898, lon: 11.2761784 },
  { name: 'Santa Viola', lat: 44.5075279, lon: 11.3035231 },
  { name: 'Corticella', lat: 44.5461652, lon: 11.3564921 },
  { name: 'San Lazzaro di Savena', lat: 44.4715668, lon: 11.4048591 },
  { name: 'Idice', lat: 44.4568907, lon: 11.4426928 },
  { name: 'Cicogna', lat: 44.4610325, lon: 11.4191043 },
  { name: 'Pianoro', lat: 44.3856330, lon: 11.3435428 },
  { name: 'Pianoro Vecchio', lat: 44.3707577, lon: 11.3408417 },
  { name: 'Rastignano', lat: 44.4429957, lon: 11.3561198 },
  { name: 'Carteria di Sesto', lat: 44.4287875, lon: 11.3521866 },
];

// Comuni limitrofi fuori whitelist: usati per riconoscere il geocoding omonimo.
// Gli aggregatori risolvono l'indirizzo nel comune sbagliato quando la via esiste
// in entrambi (caso reale: "Via Alcide De Gasperi a Cento" → JSON-LD Bologna
// 40132, con coordinate valide e ROI 61,5% del tutto falso).
export const COMUNI_FUORI = [
  'Cento', 'Ferrara', 'Modena', 'Imola', 'Castel Bolognese', 'Faenza', 'Ravenna',
  "Anzola dell'Emilia", 'Argelato',
  'Calderara di Reno', 'Bentivoglio', "Granarolo dell'Emilia", 'Castel Maggiore',
  'Crevalcore', 'San Giovanni in Persiceto', 'Nonantola', 'Budrio', 'Molinella',
  'Malalbergo', "Ozzano dell'Emilia", 'Medicina', 'Castel San Pietro Terme',
  'Monterenzio', 'Loiano', 'Monzuno', 'Marzabotto', 'Sasso Marconi', 'Valsamoggia',
  'Crespellano', 'Bazzano', 'Savigno', 'Castello di Serravalle',
  // Appennino bolognese fuori focus: case "a Bologna" che stanno a 900 m di
  // quota (55dcdce1: casetta a Noci, Comune di Granaglione, ma coordinate del
  // centro di Bologna).
  'Granaglione', 'Borgo Capanne', 'Castel di Casio', 'Camugnano',
  'Castiglione dei Pepoli', 'Gaggio Montano', 'Lizzano in Belvedere',
  'Porretta Terme', 'Alto Reno Terme', 'Vergato', 'Grizzana Morandi',
  'San Benedetto Val di Sambro', 'Monghidoro', 'Pievepelago',
];

// Zone collinari escluse dall'utente: bassa piazzabilità per lo split viste le
// alluvioni del 2024 in valle dello Zena; Colli bolognesi esclusi per scelta.
// Restano valide: Pianoro Nuovo/Vecchio, Rastignano, San Lazzaro centro, Idice,
// Cicogna, Ponticella, Colunga e le zone urbane di Bologna (Murri, Saragozza…).
export const ZONE_ESCLUSE = [
  { name: 'Valle dello Zena (rischio alluvione)', re: /\b(?:zena|tazzola|crocione|gorgognano|rastignolo)\b/i, zonaRe: /\b(?:zena|tazzola|crocione|gorgognano|rastignolo)\b/i },
  { name: 'Colli bolognesi', re: /\bcolli(?:\s+(?:bolognesi|murri))?\b|\b(?:barbiano|paderno|gaibola)\b/i, zonaRe: /\bcolli\b|\b(?:barbiano|paderno|gaibola)\b/i },
];

// Ritorna il nome della zona esclusa in cui cade l'annuncio, altrimenti ''.
// La zona strutturata è affidabile; nel testo libero "zena"/"colli" generici
// richiedono un contesto di LUOGO (via/località/zona/a…) per non colpire
// "vista sui colli"; i nomi propri di frazione (Tazzola, Barbiano…) bastano.
export function zonaEsclusa(ad) {
  const zona = String(ad.zona || '').trim();
  for (const z of ZONE_ESCLUSE) {
    if (zona && z.zonaRe.test(zona)) return z.name;
  }
  const text = [ad.titolo, ad.indirizzo, ad.descrizione].filter(Boolean).join(' \n ');
  if (!text) return '';
  let inContacts = false;
  for (const raw of text.split(/(?<=[.!?;])\s+|\n+/)) {
    if (/agenzia|sede|societ[àa]|franchising|network|ufficio/i.test(raw)) continue;
    const contact = raw.match(/maggiori informazioni|per info|contatt\w*|tempocasa|tecnocasa|tecnorete|affiliat/i);
    const s = contact ? raw.slice(0, contact.index) : (inContacts ? '' : raw);
    if (contact) inContacts = true;
    if (!s) continue;
    for (const z of ZONE_ESCLUSE) {
      if (!z.re.test(s)) continue;
      // Nome proprio di frazione/via: basta la menzione non-agenzia.
      if (/\b(?:tazzola|crocione|gorgognano|rastignolo|barbiano|paderno|gaibola)\b/i.test(s)) return z.name;
      // "Zena"/"colli" generici: contesto di luogo, non panorama ("vista sui colli").
      if (/\b(?:via|localit[àa]|frazione|zona|quartiere|borgo|a|presso)\s+(?:santa\s+maria\s+di\s+|pieve\s+di\s+)?(?:zena|colli)\b/i.test(s)) return z.name;
      // Etichetta di zona appiccicata all'indirizzo: "via X, 2 Colli San Mamolo".
      if (/,\s*\d*\s*colli\b/i.test(s)) return z.name;
    }
  }
  return '';
}

// Ritorna il comune fuori-whitelist citato come LUOGO dell'immobile, altrimenti ''.
// Richiede una preposizione di luogo e scarta le frasi su agenzie/sedi/confronti
// di mercato, dove il comune nominato non è quello dell'immobile.
export function comuneContraddetto(ad) {
  const d = String(ad.descrizione || '');
  if (!d) return '';
  const NON_LUOGO = /\b(?:agenzia|sede|ufficio|filiale|studio|rispetto|media|prezzi|mercato|confronto|come)\b/i;
  for (const c of COMUNI_FUORI) {
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${esc}\\b`, 'i').test(String(ad.comune || ''))) continue;
    const re = new RegExp(`(?:\\ba|\\bnel\\s+comune\\s+di|\\bin\\s+comune\\s+di|\\bcomune\\s+di|\\bnel|\\bpresso)\\s+${esc}\\b`, 'i');
    if (!re.test(d)) continue;
    if (d.split(/(?<=[.!?])\s+|\n+/).some((f) => re.test(f) && !NON_LUOGO.test(f))) return c;
  }
  return '';
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function nearestCenter(lat, lon) {
  let best = null;
  for (const c of CENTRI_ABITATI) {
    const km = distanceKm(lat, lon, c.lat, c.lon);
    if (!best || km < best.km) best = { name: c.name, km };
  }
  return best;
}

// Parsing numeri da stringhe italiane ("1.234", "55 m²", "2.129 €/m²").
export function num(v) {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function numFloat(v) {
  const m = String(v ?? '').replace(/\./g, '').replace(',', '.').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}