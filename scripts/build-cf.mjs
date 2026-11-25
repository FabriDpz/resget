// ---------------------------------------------------------------------------
// Prepara il bundle per Cloudflare Pages (produzione remota):
//   1. node build-site.mjs             → site/ (dati + UI, sorgente unico)
//   2. statici                         → dist-cf/
//   3. data.mjs (root)                 → modulo ES dei dati per il Worker
//      (data.js assegna window.RADAR_DATA, che nel runtime Worker non esiste)
//   4. wrangler pages functions build  → dist-cf/_worker.js: functions/ + core/
//      + data.mjs compilati in un solo script (niente sorgenti serviti come asset)
//   5. routes custom                   → dist-cf/_routes.json: include ["/*"],
//      TUTTO passa dal Worker (gate password sull'intero sito, non solo /api/*);
//      gli asset arrivano via next() → env.ASSETS dopo il controllo del cookie
//
// Uso: npm run build:cf (solo bundle). Deploy completo: npm run deploy.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'dist-cf');

const argv = process.argv.slice(2);
if (!argv.includes('--skip-build')) {
  execFileSync(process.execPath, [path.join(ROOT, 'build-site.mjs')], { stdio: 'inherit', cwd: ROOT });
}

if (!fs.existsSync(path.join(SITE, 'data.js'))) {
  console.error('site/data.js mancante: esegui prima node build-site.mjs');
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// data.js → data.mjs: stessa tecnica del server locale (JSON tra prima { e ultima }).
// Vive nella root del repo (FUORI da dist-cf): entra solo nel bundle del Worker.
const txt = fs.readFileSync(path.join(SITE, 'data.js'), 'utf8');
const i = txt.indexOf('{');
const j = txt.lastIndexOf('}');
JSON.parse(txt.slice(i, j + 1)); // validazione: un JSON rotto non va mai in produzione
fs.writeFileSync(path.join(ROOT, 'data.mjs'), `export const RADAR_DATA = ${txt.slice(i, j + 1)};\n`);

// Statici per il browser (data.js incluso, come in locale).
for (const f of fs.readdirSync(SITE)) {
  const src = path.join(SITE, f);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(OUT, f));
}

// Compila functions/ (+ import di core/ e data.mjs) in un unico modulo ES.
// --outdir produce un modulo piano (index.js); --outfile produrrebbe un
// multipart non eseguibile da pages dev. wrangler via node diretto: niente
// shell/npx (EINVAL su Windows con .cmd).
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const FN_TMP = path.join(ROOT, 'dist-cf-functions');
fs.rmSync(FN_TMP, { recursive: true, force: true });
execFileSync(process.execPath, [
  WRANGLER, 'pages', 'functions', 'build', 'functions',
  '--outdir', FN_TMP,
  '--compatibility-date', '2026-11-01',
], { stdio: 'inherit', cwd: ROOT });
fs.renameSync(path.join(FN_TMP, 'index.js'), path.join(OUT, '_worker.js'));
fs.rmSync(FN_TMP, { recursive: true, force: true });

// Gate su tutto il sito: il Worker deve vedere OGNI richiesta, anche gli asset.
// _routes.json generato da wrangler coprirebbe solo /api/*: lo sostituiamo.
fs.writeFileSync(path.join(OUT, '_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: [] }, null, 2) + '\n');

console.log(`Bundle Cloudflare pronto: ${OUT}`);