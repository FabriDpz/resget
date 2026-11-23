// Arricchisce un JSON di annunci flatsearch con gli ID d'origine per portale
// (link tracker /api/property-analytics/<ID>/track nel box "Pubblicato su").
// Serve al dedup ESATTO cross-portale in GLOBAL (core/dedup.mjs → sameOriginId).
// Non riscarica gli annunci: visita solo le pagine di dettaglio già raccolte.
//
// Uso: node flatsearch/enrich-ids.mjs [--headless] [--resume <json>] [--force]
//   senza --resume usa l'ultimo output/annunci-*.json
//   --force riestrae anche gli annunci che hanno già idsOrigine

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPortal, dismissCookies, gotoResilient, humanPause, log, sleep, rand, BlockedError } from '../core/human.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getOpt = (f, def) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };

const outDir = path.join(HERE, 'output');
const latest = () => {
  const f = fs.readdirSync(outDir).filter((x) => x.startsWith('annunci-') && x.endsWith('.json')).sort();
  return f.length ? path.join(outDir, f[f.length - 1]) : null;
};
const FILE = getOpt('--resume', null) || latest();
if (!FILE || !fs.existsSync(FILE)) throw new Error('Nessun JSON annunci: usa --resume <json>');

const ads = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const todo = ads.filter((a) => a.url && (hasFlag('--force') || !Array.isArray(a.idsOrigine) || !a.idsOrigine.length));
log(`File: ${path.basename(FILE)} — ${ads.length} annunci, ${todo.length} da arricchire`);
if (!todo.length) { log('Niente da fare.'); process.exit(0); }

const { context, page } = await launchPortal(path.join(HERE, 'profile'), { headless: hasFlag('--headless') });
let ok = 0; let vuoti = 0; let i = 0;
try {
  for (const ad of todo) {
    i++;
    try {
      await gotoResilient(page, ad.url, { log });
      await sleep(rand(700, 1400));
      if (i === 1) await dismissCookies(page);
      const origini = await page.evaluate(() => [...document.querySelectorAll('.property-detail-sources__link')].map((a) => {
        const nome = a.querySelector('.property-detail-sources__name')?.textContent?.trim() || '';
        const oid = ((a.getAttribute('href') || '').match(/property-analytics\/(\d+)\/track/) || [])[1] || '';
        return nome && oid ? { portale: nome, id: oid } : null;
      }).filter(Boolean));
      ad.idsOrigine = origini;
      if (!ad.portaliOrigine?.length) ad.portaliOrigine = origini.map((o) => o.portale);
      if (origini.length) { ok++; log(`[${i}/${todo.length}] ${ad.id} → ${origini.map((o) => `${o.portale}:${o.id}`).join(', ')}`); }
      else { vuoti++; log(`[${i}/${todo.length}] ${ad.id} → nessuna fonte dichiarata`); }
      fs.writeFileSync(FILE, JSON.stringify(ads, null, 2));
      await humanPause(1200, 2600);
    } catch (e) {
      fs.writeFileSync(FILE, JSON.stringify(ads, null, 2));
      if (e instanceof BlockedError) { log(`Blocco dal sito: stop graceful. Riprendi con --resume "${FILE}"`); break; }
      log(`[${i}/${todo.length}] errore su ${ad.id}: ${e.message}`);
    }
  }
} finally {
  fs.writeFileSync(FILE, JSON.stringify(ads, null, 2));
  await context.close();
}
log(`Fatto: ${ok} con ID d'origine, ${vuoti} senza fonti. Salvato ${path.basename(FILE)}`);