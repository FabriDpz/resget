// POI condivisi (OpenStreetMap/Overpass): libreria + CLI generica multi-portale.
// Libreria: ensurePois(cacheFile) / computePoi(ad, pois).
// CLI: node core/poi.mjs --resume <json> [--refresh] [--reapply]
//   ricalcola il rank POI nel JSON; con --reapply riapplica anche filtri+flip
//   usando i moduli core e lo storico prezzi accanto al JSON.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POI_BBOX, POI_CATEGORIES, MIN_POI_RANK, CACHE_TTL_DAYS,
  rankLabel, categoryScore, buildOverpassQuery,
} from './poi-config.mjs';
import { applyProfiles } from './filters.mjs';
import { detectNonResidential } from './filters.mjs';
import { analyzeFlip, loadPriceHistory, updatePriceHistory } from './flip.mjs';

const UA = 'PersonalHousingSearch/1.0 (local research script; contact: local user)';
const log = (m) => console.log(`[${new Date().toLocaleTimeString('it-IT')}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function distanceM(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
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
    pois.push({ id, lat, lon, cats, name: tags.name || tags.operator || tags.brand || null });
  }
  return pois;
}

// Carica la cache (TTL + validità bbox) o scarica da Overpass.
export async function ensurePois(cacheFile, { refresh = false } = {}) {
  if (!refresh && fs.existsSync(cacheFile)) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const ageDays = (Date.now() - new Date(c.fetchedAt).getTime()) / 86400000;
      const b = c.bbox;
      const bboxOk = b && b.south <= POI_BBOX.south && b.west <= POI_BBOX.west &&
        b.north >= POI_BBOX.north && b.east >= POI_BBOX.east;
      if (ageDays <= CACHE_TTL_DAYS && bboxOk) {
        log(`Cache POI: ${c.pois.length} POI del ${c.fetchedAt.slice(0, 10)}.`);
        return c.pois;
      }
      log('Cache POI scaduta o bbox non valida: riscarico.');
    } catch { /* cache corrotta */ }
  }
  const elements = await fetchOverpass();
  const pois = normalizePois(elements);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAt: new Date().toISOString(), bbox: POI_BBOX, pois }, null, 1));
  log(`Scaricati ${elements.length} elementi → ${pois.length} POI unici.`);
  return pois;
}

// Per un annuncio: POI più vicino per categoria + rank pesato 0-100.
export function computePoi(ad, pois) {
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
    categories[c.key] = { distanzaM: near?.distanceM ?? null, nome: near?.name ?? null, punteggio: score };
  }
  const rank = Math.round(scoreSum / wSum);
  return { rank, etichetta: rankLabel(rank), categories, calcolatoAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const getOpt = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };
  const RESUME_FILE = getOpt('--resume', null);
  if (!RESUME_FILE || !fs.existsSync(RESUME_FILE)) {
    throw new Error('Uso: node core/poi.mjs --resume <json> [--refresh] [--reapply]');
  }
  const ads = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
  const cacheFile = path.join(path.dirname(RESUME_FILE), 'poi-cache.json');
  const pois = await ensurePois(cacheFile, { refresh: args.includes('--refresh') });
  let withCoords = 0;
  for (const ad of ads) {
    ad.poi = computePoi(ad, pois);
    if (ad.poi) withCoords++;
  }
  if (args.includes('--reapply')) {
    for (const ad of ads) Object.assign(ad, applyProfiles(ad));
    const histFile = path.join(path.dirname(RESUME_FILE), 'prezzi-storico.json');
    updatePriceHistory(ads, histFile);
    analyzeFlip(ads, { detectNonResidential, storico: loadPriceHistory(histFile) });
  }
  fs.writeFileSync(RESUME_FILE, JSON.stringify(ads, null, 2));
  log(`Rank POI calcolato per ${withCoords}/${ads.length} annunci (JSON aggiornato).`);
  const target = ads.filter((a) => ['Bologna', 'Pianoro', 'San Lazzaro di Savena'].includes(a.comune) && a.poi);
  target.sort((a, b) => b.poi.rank - a.poi.rank);
  for (const a of target.slice(0, 15)) {
    log(`  ${a.id} ${a.comune} — ${a.poi.rank}/100 (${a.poi.etichetta})${a.poi.rank < MIN_POI_RANK ? '  ← SOTTO SOGLIA' : ''}`);
  }
}