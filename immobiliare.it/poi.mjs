// Censimento POI (OpenStreetMap/Overpass) e rank di vicinanza per immobile.
// Uso: node poi.mjs --resume output\annunci-….json [--refresh]
// 1 query Overpass sull'area dei 3 comuni (cache locale, TTL 30 giorni),
// poi calcolo locale delle distanze haversine e del rank 0-100 pesato.
// Al termine salva il campo `poi` nel JSON e rigenera il sito via scrape.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  POI_BBOX, POI_CATEGORIES, MIN_POI_RANK, CACHE_TTL_DAYS,
  rankLabel, categoryScore, buildOverpassQuery,
} from './poi-config.mjs';

const args = process.argv.slice(2);
const getOpt = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const RESUME_FILE = getOpt('--resume', null);
const REFRESH = args.includes('--refresh');
if (!RESUME_FILE || !fs.existsSync(RESUME_FILE)) {
  throw new Error('Uso: node poi.mjs --resume <json> [--refresh]');
}

const UA = 'PersonalHousingSearch/1.0 (local research script; contact: local user)';
const CACHE_FILE = path.join(path.dirname(RESUME_FILE), 'poi-cache.json');
const log = (m) => console.log(`[${new Date().toLocaleTimeString('it-IT')}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Distanza in linea d'aria (haversine), metri — stessa formula di scrape.mjs
function distanceM(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

function loadCache() {
  if (REFRESH || !fs.existsSync(CACHE_FILE)) return null;
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const ageDays = (Date.now() - new Date(c.fetchedAt).getTime()) / 86400000;
    if (ageDays > CACHE_TTL_DAYS) {
      log(`Cache POI scaduta (${Math.round(ageDays)} giorni): riscarico.`);
      return null;
    }
    // Una cache con bbox più piccola di quella attuale darebbe rank falsati
    // agli annunci di confine: invalidare e riscaricare.
    const b = c.bbox;
    if (!b || b.south > POI_BBOX.south || b.west > POI_BBOX.west ||
        b.north < POI_BBOX.north || b.east < POI_BBOX.east) {
      log('Cache POI con bbox non più valida (config cambiata): riscarico.');
      return null;
    }
    log(`Cache POI: ${c.pois.length} POI del ${c.fetchedAt.slice(0, 10)} (usa --refresh per aggiornare).`);
    return c.pois;
  } catch {
    return null;
  }
}

async function fetchOverpass() {
  const query = buildOverpassQuery();
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const url = endpoints[(attempt - 1) % endpoints.length];
    try {
      log(`Overpass (${url.split('/')[2]}), tentativo ${attempt}/4…`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(150000),
      });
      if (res.status === 429 || res.status === 504 || res.status === 502) {
        const wait = attempt * 20000;
        log(`Overpass HTTP ${res.status}: attendo ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const data = await res.json();
      return data.elements || [];
    } catch (e) {
      log(`Errore Overpass: ${e.message}`);
      if (attempt < 4) await sleep(attempt * 15000);
    }
  }
  throw new Error('Overpass non raggiungibile dopo 4 tentativi.');
}

// Normalizza gli elementi Overpass: coordinate (nodo o centroide way),
// nome, e categorie di appartenenza (un POI può stare in più categorie).
function normalizePois(elements) {
  const seen = new Set();
  const pois = [];
  for (const el of elements) {
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const tags = el.tags || {};
    const cats = POI_CATEGORIES.filter((c) =>
      c.tags.some((t) => {
        const [k, v] = t.split('=');
        return tags[k] === v;
      })
    ).map((c) => c.key);
    if (!cats.length) continue;
    seen.add(id);
    pois.push({
      id, lat, lon, cats,
      name: tags.name || tags.operator || tags.brand || null,
    });
  }
  return pois;
}

// Per un annuncio: POI più vicino per categoria + rank pesato 0-100.
function computePoi(ad, pois) {
  if (ad.lat == null || ad.lon == null) return null;
  const byCat = {};
  for (const c of POI_CATEGORIES) byCat[c.key] = null;
  for (const p of pois) {
    const d = distanceM(ad.lat, ad.lon, p.lat, p.lon);
    for (const k of p.cats) {
      if (!byCat[k] || d < byCat[k].distanceM) {
        byCat[k] = { distanceM: Math.round(d), name: p.name, osmId: p.id };
      }
    }
  }
  let wSum = 0;
  let scoreSum = 0;
  const categories = {};
  for (const c of POI_CATEGORIES) {
    const near = byCat[c.key];
    const score = categoryScore(near?.distanceM);
    wSum += c.weight;
    scoreSum += c.weight * score;
    categories[c.key] = {
      distanzaM: near?.distanceM ?? null,
      nome: near?.name ?? null,
      punteggio: score,
    };
  }
  const rank = Math.round(scoreSum / wSum);
  return { rank, etichetta: rankLabel(rank), categories, calcolatoAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- main

const ads = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));

let pois = loadCache();
if (!pois) {
  const elements = await fetchOverpass();
  pois = normalizePois(elements);
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({ fetchedAt: new Date().toISOString(), bbox: POI_BBOX, pois }, null, 1)
  );
  log(`Scaricati ${elements.length} elementi → ${pois.length} POI unici (cache: ${path.basename(CACHE_FILE)}).`);
}
for (const c of POI_CATEGORIES) {
  const n = pois.filter((p) => p.cats.includes(c.key)).length;
  log(`  ${c.label}: ${n} POI`);
}

let withCoords = 0;
for (const ad of ads) {
  ad.poi = computePoi(ad, pois);
  if (ad.poi) withCoords++;
}
fs.writeFileSync(RESUME_FILE, JSON.stringify(ads, null, 2));
log(`Rank POI calcolato per ${withCoords}/${ads.length} annunci (JSON aggiornato).`);

const target = ads.filter((a) => ['Bologna', 'Pianoro', 'San Lazzaro di Savena'].includes(a.comune) && a.poi);
target.sort((a, b) => b.poi.rank - a.poi.rank);
log('Rank POI (annunci target, dal migliore):');
for (const a of target) {
  log(`  ${a.id} ${a.comune} — ${a.poi.rank}/100 (${a.poi.etichetta})${a.poi.rank < MIN_POI_RANK ? '  ← SOTTO SOGLIA' : ''}`);
}

execFileSync(
  process.execPath,
  ['scrape.mjs', '--reapply-filters', '--resume', path.resolve(RESUME_FILE)],
  { stdio: 'inherit', cwd: path.dirname(fileURLToPath(import.meta.url)) }
);