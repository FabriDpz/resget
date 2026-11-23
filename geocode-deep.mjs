// Geocoding approfondito OFFLINE sui dati già raccolti (nessun browser).
// Uso: node geocode-deep.mjs [--dry-run] [--only <portale>]
// Per ogni portale prende l'ultimo annunci-*.json, geocodifica gli annunci
// senza coordinate con la strategia a 3 livelli di core/enrich.mjs:
//   1. tabella frazioni verificata (core/frazione-cache.json, zero richieste)
//   2. Nominatim su indirizzo strutturato / indirizzo estratto dal titolo
//   3. Nominatim sulla zona come place (quartiere/frazione, ~±1 km)
// Poi riapplica i filtri (applyProfiles) + POI dai dati in cache e rigenera
// il sito. NON tocca il ledger (lo fa build-site).
import fs from 'node:fs';
import path from 'node:path';
import { geocodeAds, enrichPoi } from './core/enrich.mjs';
import { applyProfiles } from './core/filters.mjs';
import { analyzeFlip, loadPriceHistory } from './core/flip.mjs';
import { detectNonResidential } from './core/filters.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();
const log = (s) => console.log(s);

const dirs = fs.readdirSync('.', { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(d.name, 'output')))
  .map((d) => d.name)
  .filter((d) => !ONLY || d === ONLY);

let totMissing = 0, totOk = 0;
for (const dir of dirs) {
  const outDir = path.join(dir, 'output');
  const files = fs.readdirSync(outDir).filter((f) => /^annunci-.*\.json$/.test(f)).sort();
  if (!files.length) continue;
  const file = path.join(outDir, files[files.length - 1]);
  const ads = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = ads.filter((a) => (a.lat == null || a.lon == null) && /bologna|pianoro|san lazzaro/i.test(a.comune || ''));
  if (!missing.length) continue;
  log(`\n[${dir}] ${files[files.length - 1]}: ${missing.length} senza coordinate`);
  totMissing += missing.length;
  if (DRY) {
    for (const a of missing.slice(0, 5)) log(`  - ${a.id} zona="${a.zona}" ind="${a.indirizzo}" titolo="${String(a.titolo).slice(0, 50)}"`);
    continue;
  }
  const before = new Map(missing.map((a) => [a.id, a.esito]));
  const ok = await geocodeAds(missing, { log });
  totOk += ok;
  if (ok) {
    await enrichPoi(ads, path.join('core', 'poi-cache.json'), { log });
    for (const ad of ads) Object.assign(ad, applyProfiles(ad, { maxKm: 3, minPoi: 35 }));
    const storico = loadPriceHistory(path.join(outDir, 'prezzi-storico.json'));
    analyzeFlip(ads, { detectNonResidential, storico });
    fs.writeFileSync(file, JSON.stringify(ads, null, 2));
    const nuoviSel = ads.filter((a) => before.has(a.id) && before.get(a.id) !== 'Selezionato' && (a.esito === 'Selezionato' || a.esitoSma === 'Selezionato'));
    for (const a of nuoviSel) log(`  ★ NUOVO TARGET: ${a.id} ${a.prezzo}€ ${a.superficieMq}m² ${a.camere}cam (${a.esito === 'Selezionato' ? 'BIG' : 'SMA'}) — ${a.geocodeFonte}`);
    log(`  salvato ${file}: ${ok} geocodificati, ${nuoviSel.length} nuovi target`);
  }
}
log(`\nTotale: ${totOk}/${totMissing} geocodificati${DRY ? ' (dry-run)' : ''}.`);
if (!DRY && totOk) log('Rigenera il sito con: node build-site.mjs');