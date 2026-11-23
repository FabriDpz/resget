// Arricchimento coordinate via geocoding indirizzi (OpenStreetMap Nominatim).
// Uso: node geocode-nominatim.mjs output\annunci-….json [--max-km 3]
// 1 richiesta/secondo (policy Nominatim), User-Agent identificativo.
// Precisione: livello via/civico o località; MAI il centroide del comune.
// Al termine riapplica i filtri e rigenera il sito come scrape.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { nearestCenter } from './geo.mjs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) throw new Error('Uso: node geocode-nominatim.mjs <json>');
const ads = JSON.parse(fs.readFileSync(file, 'utf8'));
const UA = 'PersonalHousingSearch/1.0 (local research script; contact: local user)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=it&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'it' } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return res.json();
}

// accettabile: place (via/località) o building/house; NON boundary amministrativi
function acceptable(r) {
  if (r.category === 'boundary') return false;
  return ['place', 'building', 'highway'].includes(r.category) || r.addresstype === 'house';
}

// Scarta gli omònimi lontani: un risultato oltre 12 km dai centri target
// (es. "Santo Stefano" frazione remota invece del quartiere di Bologna) è errato.
const MAX_GEOCODE_KM = 12;
function plausible(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return nearestCenter(lat, lon).km <= MAX_GEOCODE_KM;
}

const missing = ads.filter((a) => a.lat == null || a.lon == null);
console.log(`${missing.length} annunci senza coordinate su ${ads.length}`);
let i = 0;
for (const ad of missing) {
  i++;
  const queries = [];
  if (ad.indirizzo && ad.comune) {
    queries.push(`${ad.indirizzo}, ${ad.comune}, Italia`);
    const soloVia = ad.indirizzo.replace(/\s*\d+[\/\w]*\s*$/, '').trim(); // senza civico
    if (soloVia && soloVia !== ad.indirizzo) queries.push(`${soloVia}, ${ad.comune}, Italia`);
  }
  const micro = (ad.zona || '').split('/').pop().trim();
  if (micro && ad.comune) queries.push(`${micro}, ${ad.comune}, Italia`);
  let done = false;
  for (const q of queries) {
    try {
      const rows = await nominatim(q);
      const hit = rows.find((r) => acceptable(r) && plausible(parseFloat(r.lat), parseFloat(r.lon)));
      if (hit) {
        ad.lat = parseFloat(hit.lat);
        ad.lon = parseFloat(hit.lon);
        ad.geocodeFonte = `Nominatim: ${q} → ${hit.display_name.split(',').slice(0, 3).join(',')} (${hit.addresstype})`;
        console.log(`[${i}/${missing.length}] ${ad.id}: ${ad.lat.toFixed(5)}, ${ad.lon.toFixed(5)}  ← ${q}`);
        done = true;
        break;
      }
      console.log(`[${i}/${missing.length}] ${ad.id}: nessun risultato utile per "${q}"`);
    } catch (e) {
      console.log(`[${i}/${missing.length}] ${ad.id}: errore "${q}": ${e.message}`);
    }
    await sleep(1100);
  }
  if (!done) console.log(`[${i}/${missing.length}] ${ad.id}: coordinate NON trovate (sarà escluso come non verificabile)`);
  fs.writeFileSync(file, JSON.stringify(ads, null, 2));
  await sleep(1100);
}
const withCoords = ads.filter((a) => a.lat != null).length;
console.log(`\nCoordinate presenti: ${withCoords}/${ads.length}. Riapplico i filtri…`);
execFileSync(process.execPath, ['scrape.mjs', '--reapply-filters', '--resume', path.resolve(file)], { stdio: 'inherit' });