// Arricchimento condiviso: geocoding (Nominatim) + POI (Overpass) per tutti i portali.
// Libreria usata dal runner dopo lo scraping. Policy: 1 req/s Nominatim, cache POI condivisa.
import fs from 'node:fs';
import path from 'node:path';
import { ensurePois, computePoi } from './poi.mjs';
import { nearestCenter } from './geo.mjs';
import { frazioneCentro } from './frazione-centri.mjs';

const UA = 'PersonalHousingSearch/1.0 (local research script; contact: local user)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Un risultato Nominatim è plausibile solo se cade entro ~12 km dai centri target:
// scarta omònimi (es. "Santo Stefano" frazione remota invece del quartiere di Bologna).
const MAX_GEOCODE_KM = 12;
function plausible(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return nearestCenter(lat, lon).km <= MAX_GEOCODE_KM;
}

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=it&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'it' } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return res.json();
}
function acceptable(r) {
  if (r.category === 'boundary') return false;
  return ['place', 'building', 'highway'].includes(r.category) || r.addresstype === 'house';
}
// Per le query "zona, comune" (aggregatori senza indirizzo) si accettano anche
// i place urbani/rurali (quartiere, frazione): la precisione è ~±1 km e viene
// dichiarata in geocodeFonte. Il filtro distanza ≤3 km resta il giudice finale.
const PLACE_TYPES = new Set(['suburb', 'quarter', 'hamlet', 'village', 'neighbourhood', 'locality', 'city_district', 'borough']);
function acceptablePlace(r) {
  return acceptable(r) || (r.category === 'place' && PLACE_TYPES.has(r.addresstype));
}

// Indirizzo dal titolo: molti portali lo scrivono lì ("Trilocale via Ferrarese
// 127, Bolognina" / "Bilocale in vendita in Via del Milliario"). Estrae solo
// vie/piazze/viali con civico opzionale, mai zone generiche.
export function indirizzoDaTitolo(titolo, { maxWords = Infinity } = {}) {
  const t = String(titolo || '');
  const m = t.match(/\b(?:via|viale|piazza|piazzale|vicolo|largo|borgo)\s+(?:(?:di|de|del|della|dei|delle|degli|d[’'])\s+)?[\w'’À-ü.]+(?:\s+(?:(?:di|de|del|della|dei|delle|degli|d[’'])\s+)?[A-ZÀ-Ü][\w'’À-ü.]*)*(?:,?\s+\d+[\/\w]*)?/i);
  if (!m) return '';
  // "Borgo Panigale" senza civico è una zona, non una via.
  if (/^borgo\b/i.test(m[0]) && !/\d/.test(m[0])) return '';
  let out = m[0].replace(/,\s*$/, '').trim();
  // Nel testo libero le parole dopo la via sono spesso descrizione, non toponimo
  // ("via Andrea Costa proponiamo…"): maxWords limita la coda (via+2 parole).
  const w = out.split(/\s+/);
  if (w.length > maxWords && !/\d/.test(w[maxWords - 1])) out = w.slice(0, maxWords).join(' ');
  return out;
}

// Geocodifica gli annunci senza coordinate. Ritorna il numero arricchiti.
export async function geocodeAds(ads, { log = () => {} } = {}) {
  const missing = ads.filter((a) => a.lat == null || a.lon == null);
  if (!missing.length) return 0;
  log(`[geocode] ${missing.length} annunci senza coordinate`);
  let ok = 0, okFrazione = 0;
  for (const ad of missing) {
    // 1) Tabella frazioni verificata (offline, zero richieste): precisione
    //    "centro frazione" ~±1 km, sufficiente per il filtro ≤3 km.
    const fz = frazioneCentro(ad.zona, ad.comune);
    if (fz) {
      ad.lat = fz.lat;
      ad.lon = fz.lon;
      ad.geocodeFonte = `Frazione verificata (${fz.fonte}); precisione centro-località ~±1 km`;
      ok++; okFrazione++;
      continue;
    }
    // 2) Nominatim: indirizzo strutturato, poi indirizzo estratto dal titolo,
    //    poi la zona come place (quartiere/frazione).
    const queries = [];
    if (ad.indirizzo && ad.comune) {
      // Alcuni adapter salvano l'indirizzo sporco ("VIA GIOTTO in condominio
      // riqualificato con…"): se non inizia con un token di via, ri-estrailo.
      let ind = String(ad.indirizzo).trim();
      if (!/^(?:via|viale|piazza|piazzale|vicolo|largo|borgo)\b/i.test(ind)) {
        ind = indirizzoDaTitolo(ind) || ind;
      }
      // "Borgo Panigale, Aeroporto, Bologna (BO)" è una zona, non un indirizzo:
      // niente query via, ma i segmenti sono utili come place (sotto).
      const isVia = /^(?:via|viale|piazza|piazzale|vicolo|largo)\b/i.test(ind)
        || (/^borgo\b/i.test(ind) && /\d/.test(ind));
      if (isVia) {
        queries.push({ q: `${ind}, ${ad.comune}, Italia`, place: false });
        const soloVia = ind.replace(/\s*\d+[\/\w]*\s*$/, '').trim();
        if (soloVia && soloVia !== ind) queries.push({ q: `${soloVia}, ${ad.comune}, Italia`, place: false });
      } else {
        for (const seg of ind.split(',').map((s) => s.replace(/\(BO\)\s*$/i, '').trim())) {
          if (seg && seg.toLowerCase() !== String(ad.comune).toLowerCase()) {
            queries.push({ q: `${seg}, ${ad.comune}, Italia`, place: true });
          }
        }
      }
    }
    const daTitolo = indirizzoDaTitolo(ad.titolo);
    if (daTitolo && ad.comune && daTitolo !== ad.indirizzo) {
      queries.push({ q: `${daTitolo}, ${ad.comune}, Italia`, place: false });
      // Il titolo può appiccicare la zona alla via ("Via del Milliario Santa
      // Viola"): retry con le ultime 1-2 parole tagliate.
      const words = daTitolo.split(/\s+/);
      if (words.length > 3 && !/\d$/.test(daTitolo)) {
        queries.push({ q: `${words.slice(0, -2).join(' ')}, ${ad.comune}, Italia`, place: false });
      }
    }
    //Ultima spiaggia prima della zona: una via citata nella descrizione
    // ("APPARTAMENTO LIBERO SUBITO – Rastignano, via Andrea Costa").
    if (!queries.some((x) => !x.place)) {
      const daDesc = indirizzoDaTitolo(String(ad.descrizione || '').slice(0, 400), { maxWords: 4 });
      if (daDesc && ad.comune) queries.push({ q: `${daDesc}, ${ad.comune}, Italia`, place: false });
    }
    const micro = (ad.zona || '').split('/').pop().trim();
    if (micro && ad.comune) queries.push({ q: `${micro}, ${ad.comune}, Italia`, place: true });
    for (const { q, place } of queries) {
      try {
        const rows = await nominatim(q);
        const check = place ? acceptablePlace : acceptable;
        const hit = rows.find((r) => check(r) && plausible(parseFloat(r.lat), parseFloat(r.lon))
          && (!place || new RegExp(`\\b${ad.comune}\\b`, 'i').test(r.display_name)));
        if (hit) {
          ad.lat = parseFloat(hit.lat);
          ad.lon = parseFloat(hit.lon);
          ad.geocodeFonte = `Nominatim: ${q} → ${hit.display_name.split(',').slice(0, 3).join(',')} (${hit.addresstype})`
            + (place && PLACE_TYPES.has(hit.addresstype) ? '; precisione centro-località ~±1 km' : '');
          ok++;
          break;
        }
      } catch (e) { log(`[geocode] errore "${q}": ${e.message}`); }
      await sleep(1100);
    }
    await sleep(1100);
  }
  log(`[geocode] arricchiti ${ok}/${missing.length} (${okFrazione} da tabella frazioni)`);
  return ok;
}

// Calcola il rank POI per tutti gli annunci con coordinate, usando la cache condivisa.
export async function enrichPoi(ads, cacheFile, { log = () => {}, refresh = false } = {}) {
  const withCoords = ads.filter((a) => a.lat != null && a.lon != null);
  if (!withCoords.length) { log('[poi] nessuna coordinata, salto'); return; }
  const pois = await ensurePois(cacheFile, { refresh });
  for (const ad of withCoords) ad.poi = computePoi(ad, pois);
  log(`[poi] rank calcolato per ${withCoords.length} annunci`);
}

// Orchestratore: geocode + POI. cacheFile = path cache POI condivisa (root).
export async function enrichAds(ads, { log = () => {}, poiCache, refreshPoi = false, skipGeocode = false } = {}) {
  if (!skipGeocode) await geocodeAds(ads, { log });
  if (poiCache) await enrichPoi(ads, poiCache, { log, refresh: refreshPoi });
}