// ---------------------------------------------------------------------------
// Generatore del sito statico di analisi (punto sintetico multi-portale).
// Uso: node build-site.mjs [--resume <json>] [--out <dir>]
// Senza --resume usa il JSON annunci più recente in output/.
// Il sito si apre con doppio clic su site/index.html (nessun server):
// i dati sono embeddati in data.js per evitare i limiti CORS di file://.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

const args = process.argv.slice(2);
const getOpt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const RESUME = getOpt('--resume', null);
const OUT_DIR = path.resolve(getOpt('--out', path.join(__dirname, 'site')));

function latestJson() {
  const files = fs.readdirSync(OUTPUT_DIR).filter((f) => /^annunci-.*\.json$/i.test(f)).sort();
  if (!files.length) throw new Error(`Nessun annunci-*.json in ${OUTPUT_DIR}`);
  return path.join(OUTPUT_DIR, files[files.length - 1]);
}

const jsonPath = RESUME ? path.resolve(RESUME) : latestJson();
const ads = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const missingFlip = ads.filter((a) => !a.flip).length;
if (missingFlip) {
  console.warn(`ATTENZIONE: ${missingFlip} annunci senza analisi flip. Esegui prima:`);
  console.warn(`  node scrape.mjs --reapply-filters --resume ${jsonPath}`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  source: path.basename(jsonPath),
  portals: [
    {
      id: 'immobiliare',
      name: 'Immobiliare.it',
      active: true,
      ads: ads.map((a) => ({ ...a, portale: 'immobiliare' })),
    },
    // Struttura multi-portale: aggiungere qui i futuri adattatori.
    { id: 'idealista', name: 'Idealista', active: false, ads: [] },
    { id: 'casait', name: 'Casa.it', active: false, ads: [] },
  ],
};
// </script> non deve comparire nel JS embeddato (_escape difensivo)
const dataJs = `// Generato da build-site.mjs — non modificare a mano.\nwindow.RADAR_DATA = ${JSON.stringify(payload).replace(/</g, '\\u003c')};\n`;
fs.writeFileSync(path.join(OUT_DIR, 'data.js'), dataJs);

// Copia gli asset (index/app/style) dalla cartella site-src accanto allo script.
const SRC_DIR = path.join(__dirname, 'site-src');
for (const f of ['index.html', 'app.js', 'style.css']) {
  fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT_DIR, f));
}

const reno = ads.filter((a) => a.flip?.reno?.candidato).length;
const staleAlto = ads.filter((a) => (a.flip?.stale?.score ?? 0) >= 60).length;
console.log(`Sito generato: ${path.join(OUT_DIR, 'index.html')}`);
console.log(`Dati: ${path.basename(jsonPath)} — ${ads.length} annunci, ${reno} candidati RENO, ${staleAlto} STALE alto.`);
console.log('Apri il file index.html con doppio clic (nessun server necessario).');