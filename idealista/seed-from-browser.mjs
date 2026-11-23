// Seed idealista da browser agent-controlled (profilo adapter WAF-bloccato).
// Estrae le card ≤160k dalla pagina filtrata, le normalizza col core condiviso
// e applica filtri BIG/SMA + flip. Uso: node idealista/seed-from-browser.mjs <file>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd } from '../core/schema.mjs';
import { applyProfiles, detectNonResidential } from '../core/filters.mjs';
import { analyzeFlip, loadPriceHistory, updatePriceHistory } from '../core/flip.mjs';
import { enrichAds } from '../core/enrich.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');
// Il file è "Result: \"<json escaped>\"\nPage Title...". Estraggo il JSON.
const start = raw.indexOf('Result: ');
const jsonStart = raw.indexOf('"', start) + 1;
const jsonEnd = raw.indexOf('"\nPage Title', jsonStart);
let s = raw.slice(jsonStart, jsonEnd);
// decode delle escape JSON del wrapper
s = s.replace(/\\"/g, '"').replace(/\\n/g, '').replace(/\\\\/g, '\\');
const data = JSON.parse(s);
const cards = data.cards || data;
console.log('card dal browser:', cards.length);

function parsePrice(t) {
  const m = String(t || '').replace(/\./g, '').match(/(\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}
function parseDetail(d) {
  const locali = (d.match(/(\d+)\s*local/i) || [])[1];
  const mq = (d.match(/(\d+)\s*m²/) || [])[1];
  const piano = (d.match(/Piano\s+(\w+)/i) || [])[1];
  const asc = /con ascensore/i.test(d) ? true : /senza ascensore/i.test(d) ? false : null;
  return { locali: locali ? +locali : null, mq: mq ? +mq : null, piano, asc };
}

const ads = [];
for (const c of cards) {
  const prezzo = parsePrice(c.price);
  if (!prezzo || prezzo > 160000) continue;
  const det = parseDetail(c.detail || '');
  // tipologia dal titolo (Monolocale/Bilocale/Trilocale/...)
  const tipM = (c.title || '').match(/^(Monolocale|Bilocale|Trilocale|Quadrilocale|Appartamento|Attico|Loft|Villa|Casa)/i);
  const partial = {
    id: c.id,
    url: c.url,
    area: 'Bologna',
    titolo: c.title,
    comune: 'Bologna',
    provincia: 'BO',
    prezzo,
    superficieMq: det.mq,
    locali: det.locali,
    piano: det.piano,
    ascensore: det.asc,
    tipologia: tipM ? tipM[1] : '',
    privato: c.privato,
    descrizione: `${c.title} ${c.detail || ''}`,
  };
  ads.push(normalizeAd('idealista', partial));
}
console.log('normalizzati:', ads.length);

const log = (m) => console.log(m);
const POI_CACHE = path.join(__dirname, 'output', 'poi-cache.json');
const PRICE_HISTORY_FILE = path.join(__dirname, 'output', 'prezzi-storico.json');
try {
  await enrichAds(ads, { log, poiCache: POI_CACHE });
} catch (e) { log('Arricchimento parziale: ' + e.message); }
for (const ad of ads) Object.assign(ad, applyProfiles(ad, { maxKm: 3, minPoi: 35 }));
analyzeFlip(ads, { detectNonResidential, storico: loadPriceHistory(PRICE_HISTORY_FILE) });
updatePriceHistory(ads, PRICE_HISTORY_FILE);

const big = ads.filter((a) => a.esito === 'Selezionato').length;
const sma = ads.filter((a) => a.esitoSma === 'Selezionato').length;
console.log('BIG:', big, 'SMA:', sma);
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const out = path.join(__dirname, 'output', `annunci-${stamp}.json`);
fs.writeFileSync(out, JSON.stringify(ads, null, 2));
console.log('salvato:', out);