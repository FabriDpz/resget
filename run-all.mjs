// Runner centralizzato: lancia gli scraper dei portali in parallelo (grado 8,
// headed di default) e alla fine rigenera + valida il sito globale.
//
// Uso:
//   node run-all.mjs                     tutti i portali, 8 in parallelo
//   node run-all.mjs --parallel 4        cambia il grado di parallelismo
//   node run-all.mjs --only flatsearch,casait
//   node run-all.mjs --exclude mitula,trovit
//   node run-all.mjs --resume            riprende dall'ultimo JSON di ogni portale
//   node run-all.mjs --site-only         solo build-site + validate-site
//   node run-all.mjs --headless          (sconsigliato: i WAF rilevano l'headless)
//   node run-all.mjs --max-ads 50 --no-verify   (passati agli scraper)
//
// Log per portale in logs/run-<data>.log; Ctrl+C ferma tutto (gli scraper
// salvano i dati parziali: si riprende con --resume). Nessun aggiramento anti-bot.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { inCooldown } from './core/health.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Portali attivi con scraper funzionante. Esclusi di default:
// - intesasanpaolo: solo storico prezzi, non annunci (schema diverso)
// - casait: WAF DataDome persistente → opt-in con --only casait (ritmo ≥20s già attivo)
const PORTALS = [
  'immobiliare.it', 'flatsearch', 'idealista', 'subito', 'wikicasa',
  'tecnocasa', 'tecnorete', 'tempocasa', 'remax', 'trovacasa',
  'caasa', 'bakeca', 'attico', 'casadaprivato', 'mitula', 'trovit',
  // Siti proprietari di agenzie locali/affiliate (censimento 22/11/2026).
  'gabetti', 'toscano', 'professionecasa', 'grimaldi', 'livingin', 'mondore',
  'immobiliaresanlazzaro', 'grandicase', 'vivacasa', 'reportimmobiliare',
  'ars', 'kapitalre', 'limmobiliare', 'giacopini', 'abitarebologna',
  'millecase', 'cavallo', 'alfaeomega',
];
const OPT_IN = ['casait'];

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getOpt = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const PARALLEL = Math.max(1, parseInt(getOpt('--parallel', '8'), 10));
const RESUME = hasFlag('--resume');
const SITE_ONLY = hasFlag('--site-only');
const ONLY = getOpt('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const EXCLUDE = getOpt('--exclude', '').split(',').map((s) => s.trim()).filter(Boolean);
// Flag inoltrati agli scraper dei portali.
const PASSTHROUGH = ['--headless', '--no-verify', '--no-geocode', '--no-poi', '--refresh-poi', '--retry-failed', '--force'];
const PASS_OPTS = ['--max-ads', '--max-km', '--min-poi'];

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('it-IT')}]`, ...a);

function latestJson(portal) {
  const dir = path.join(ROOT, portal, 'output');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^annunci-.*\.json$/.test(f)).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function portalArgs(portal) {
  const args = [path.join(ROOT, portal, 'scrape.mjs')];
  for (const f of PASSTHROUGH) if (hasFlag(f)) args.push(f);
  for (const o of PASS_OPTS) if (argv.includes(o)) args.push(o, getOpt(o, ''));
  if (RESUME) {
    const prev = latestJson(portal);
    if (prev) args.push('--resume', prev);
  }
  return args;
}

const children = new Set();
let shuttingDown = false;
process.on('SIGINT', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Ctrl+C: inoltro SIGINT agli scraper (salvano i dati parziali)…');
  for (const c of children) { try { c.kill('SIGINT'); } catch { /* già uscito */ } }
});

function runPortal(portal, logDir) {
  return new Promise((resolve) => {
    const logFile = path.join(logDir, `${portal.replace(/[^\w.-]/g, '_')}.log`);
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    const started = Date.now();
    log(`▶ ${portal} (log: ${path.relative(ROOT, logFile)})`);
    const child = spawn(process.execPath, portalArgs(portal), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    child.stdout.pipe(out); child.stderr.pipe(out);
    child.on('close', (code) => {
      children.delete(child);
      out.end();
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      const json = latestJson(portal);
      let counts = '';
      if (json) {
        try {
          const ads = JSON.parse(fs.readFileSync(json, 'utf8'));
          const big = ads.filter((a) => a.esito === 'Selezionato').length;
          const sma = ads.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato').length;
          counts = ` — ${ads.length} annunci, ${big} BIG, ${sma} SMA`;
        } catch { /* JSON non leggibile */ }
      }
      // Summary scritto dal runner (miglioria D): bloccato/falliti/nuovi.
      let summary = null;
      try {
        const dir = path.join(ROOT, portal, 'output');
        const sFiles = fs.readdirSync(dir).filter((f) => /^run-summary-.*\.json$/.test(f)).sort();
        if (sFiles.length) {
          const s = JSON.parse(fs.readFileSync(path.join(dir, sFiles[sFiles.length - 1]), 'utf8'));
          // ignora summary di run precedenti (questo run è partito dopo)
          if (new Date(s.startedAt).getTime() >= started - 5000) summary = s;
        }
      } catch { /* summary assente */ }
      const ok = code === 0;
      const blockedRun = code === 3 || (summary && summary.blocked);
      const icon = blockedRun ? '⛔' : ok ? '✔' : '✖';
      const extra = summary && summary.failed ? `, ${summary.failed} falliti in coda` : '';
      log(`${icon} ${portal} (${mins} min, exit ${code})${counts}${extra}${blockedRun ? ' — BLOCCATO, cooldown 24h' : ''}`);
      resolve({ portal, ok, code, logFile, summary, blocked: !!blockedRun });
    });
  });
}

function runScript(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, name)], { cwd: ROOT, stdio: 'inherit' });
    children.add(child);
    child.on('close', (code) => { children.delete(child); resolve(code === 0); });
  });
}

async function main() {
  let targets = ONLY.length ? ONLY : PORTALS;
  targets = targets.filter((p) => !EXCLUDE.includes(p));
  for (const p of targets) {
    if (!fs.existsSync(path.join(ROOT, p, 'scrape.mjs'))) {
      log(`⚠ ${p}: scrape.mjs non trovato, salto.`);
      targets = targets.filter((x) => x !== p);
    }
  }

  const results = [];
  const skipped = [];
  if (!SITE_ONLY && targets.length) {
    // Cooldown anti-ban (miglioria A): salta i portali bloccati nelle ultime 24h.
    if (!hasFlag('--force')) {
      for (const p of [...targets]) {
        const cd = inCooldown(p);
        if (cd) {
          skipped.push({ portal: p, ...cd });
          targets = targets.filter((x) => x !== p);
          log(`⏸ ${p}: in cooldown (${cd.hoursLeft}h residue, fino a ${cd.until}) — ${cd.reason}`);
        }
      }
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const logDir = path.join(ROOT, 'logs', `run-${stamp}`);
    fs.mkdirSync(logDir, { recursive: true });
    log(`Run globale: ${targets.length} portali, parallelismo ${PARALLEL}, headed${hasFlag('--headless') ? ' NO (headless)' : ''}${RESUME ? ', resume' : ''}`);
    if (!ONLY.length) log(`Opt-in non inclusi: ${OPT_IN.join(', ')} (usare --only per includerli)`);
    const queue = [...targets];
    const workers = Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      while (queue.length && !shuttingDown) results.push(await runPortal(queue.shift(), logDir));
    });
    await Promise.all(workers);
    const failed = results.filter((r) => !r.ok && !r.blocked);
    const blockedPortals = results.filter((r) => r.blocked);
    if (blockedPortals.length) log(`Portali bloccati (cooldown 24h): ${blockedPortals.map((r) => r.portal).join(', ')}`);
    if (failed.length) log(`Portali con errori: ${failed.map((r) => r.portal).join(', ')} (vedi log in ${path.relative(ROOT, logDir)})`);

    // Report sintetico del run (miglioria D): leggibile da utente e agente.
    try {
      const report = {
        runAt: new Date().toISOString(),
        parallel: PARALLEL,
        resume: RESUME,
        portals: results.map((r) => ({
          portal: r.portal, exit: r.code, blocked: r.blocked,
          ...(r.summary ? { ads: r.summary.ads, newAds: r.summary.newAds, big: r.summary.big, sma: r.summary.sma, failed: r.summary.failed, durationMin: r.summary.durationMin, blockReason: r.summary.blocked } : {}),
        })),
        skippedCooldown: skipped,
      };
      fs.writeFileSync(path.join(logDir, 'report.json'), JSON.stringify(report, null, 2));
      log(`Report: ${path.relative(ROOT, path.join(logDir, 'report.json'))}`);
    } catch (e) { log(`Report non scritto: ${e.message}`); }
  }

  if (shuttingDown) { log('Interrotto: sito NON rigenerato. Riprendi con --resume.'); process.exit(1); }

  log('Rigenero il sito globale…');
  const built = await runScript('build-site.mjs');
  if (!built) { log('build-site fallito.'); process.exit(1); }
  const valid = await runScript('validate-site.mjs');
  log(valid ? '✔ Run globale completata: site/index.html aggiornato e validato.' : '⚠ Sito generato ma validazione con errori.');
  process.exit(valid ? 0 : 1);
}

main();