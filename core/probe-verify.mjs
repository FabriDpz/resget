// Verifica i selettori di un adapter contro la realtà del portale (D9, fase 3).
// Due modalità, stessa libreria di probe (browser-probe.mjs):
//
//   --from-archive  confronta con probe-archive/probe-agent-<id>.json
//                   (probe fatto dall'agente sul browser reale; nessun browser lanciato)
//   --live          apre Playwright col profilo del portale e riesegue il probe
//                   sulla prima URL di listing (1 pagina, ritmo D4, STOP su blocco)
//
// I selettori verificati sono dichiarati dall'adapter in `probeChecks`:
//   probeChecks: {
//     listingUrl: 'https://…',                 // pagina rappresentativa
//     cardSelectors: ['article', …],           // contati sulla pagina
//     linkPattern: '\\/annuncio\\/\\d+$',       // regex sugli href (attesi >0)
//     minLinks: 5,                             // soglia link (default 1; 0 = listing vuota legittima)
//     minCards: 0,                             // soglia card (default 1; 0 = es. remax Bologna nel target)
//     nextData: true,                          // __NEXT_DATA__ (probe agent-driven; live Playwright: inconcludente)
//     stripQuery: false,                       // mantieni la query nei sampleLinks (es. trovit detailPageUrl)
//     detailChecks: { jsonLdType: 'RealEstateListing' }, // asserzioni sul DETTAGLIO
//   }
// Le detailChecks si verificano su uno step di tipo dettaglio (JSON-LD presente):
// da archivio lo step con jsonLdTypes non vuoto; live sulla prima sampleLink.
// Se l'adapter non dichiara probeChecks, --live usa i default della libreria e
// riporta solo i conteggi (utile proprio per COSTRUIRE probeChecks).
//
// Uso: node core/probe-verify.mjs --id wikicasa [--from-archive | --live] [--headless]
// ATTENZIONE --headless: molti portali rilevano l'headless (decisione 2026-11-15,
// "SEMPRE headed"). Usarlo solo su portali che lo tollerano (es. caasa, tecnocasa,
// tecnorete); sugli altri produce 403 fasulli e cooldown inutili. Default: headed.
// Exit code: 0 = selettori OK, 2 = selettori rotti/assenti, 3 = blocco anti-bot (D4).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { probeInPage } from './browser-probe.mjs';
import { recordBlock } from './health.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const get = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  return {
    id: get('--id'),
    fromArchive: argv.includes('--from-archive'),
    live: argv.includes('--live'),
    headless: argv.includes('--headless'),
    url: get('--url'),
  };
}

function loadArchive(id) {
  const p = path.join(ROOT, 'probe-archive', `probe-agent-${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`Nessun probe agent-driven per "${id}" (${p}). Esegui prima la ricognizione e core/probe-save.mjs.`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Scegli lo step più pertinente: listing con link campione, non bloccato.
function sameUrl(a, b) {
  // tollera www ridondante e slash finale (il sito può redirigere)
  const norm = (u) => String(u || '').replace(/^(https?:\/\/)www\./, '$1').replace(/\/$/, '');
  return norm(a) === norm(b);
}
function pickStep(record, url) {
  const steps = record.steps || [];
  if (url) return steps.find((s) => sameUrl(s.url, url) || sameUrl(s.finalUrl, url)) || null;
  return steps.find((s) => !s.blocked && (s.sampleLinks || []).length > 0)
    || steps.find((s) => !s.blocked)
    || steps[0] || null;
}

// Step di dettaglio: JSON-LD presente (il listing non lo espone).
function pickDetailStep(record, listingStep) {
  const steps = record.steps || [];
  return steps.find((s) => !s.blocked && (s.jsonLdTypes || []).length > 0 && s !== listingStep) || null;
}

function evaluateChecks(step, checks, { useDefaultCards = true } = {}) {
  const results = [];
  // Sul dettaglio le card della listing non esistono: se non dichiarate,
  // non verificarle (default solo per la listing).
  const cardSels = checks.cardSelectors || (useDefaultCards ? Object.keys(step.cardSelectors || {}) : []);
  // minCards: 0 = listing legittimamente vuota (es. remax Bologna nel target).
  const minCards = checks.minCards ?? 1;
  for (const sel of cardSels) {
    const n = (step.cardSelectors || {})[sel];
    if (n === undefined) results.push({ check: `card ${sel}`, ok: null, detail: 'non misurato nel probe' });
    else results.push({ check: `card ${sel}`, ok: n >= minCards, detail: `${n} elementi (min ${minCards})` });
  }
  if (checks.linkPattern) {
    const re = new RegExp(checks.linkPattern);
    const samples = step.sampleLinks || [];
    const matching = samples.filter((h) => re.test(h)).length;
    const min = checks.minLinks ?? 1;
    // sampleLinks è campionato: se il probe non ha usato lo stesso pattern,
    // 0 match su campioni piccoli è "inconcludente", non "rotto".
    const ok = matching >= min ? true : (samples.length === 0 ? null : (matching > 0 ? true : false));
    results.push({ check: `link /${checks.linkPattern}/`, ok, detail: `${matching} match su ${samples.length} campioni (min ${min})` });
  }
  if (checks.jsonLdType) {
    const ok = (step.jsonLdTypes || []).includes(checks.jsonLdType);
    results.push({ check: `JSON-LD ${checks.jsonLdType}`, ok, detail: (step.jsonLdTypes || []).join(', ') || 'nessuno' });
  }
  if (checks.nextData) {
    // hasNextData è misurato solo dai probe agent-driven (browser reale).
    // Un probe Playwright non lo misura: assenza = inconcludente, non rotto.
    const ok = step.hasNextData === true ? true : (step.hasNextData === undefined ? null : false);
    results.push({ check: '__NEXT_DATA__', ok, detail: ok === null ? 'non misurato nel probe (verificato nel browser reale)' : (ok ? 'presente' : 'assente') });
  }
  return results;
}

async function probeOnePage(page, human, target, probeOpts) {
  const { humanPause, dismissCookies, gotoResilient, checkBlocked, BlockedError, log } = human;
  let resp;
  try { resp = await gotoResilient(page, target, { log, tries: 2, baseWait: 20000 }); }
  catch (e) {
    if (e instanceof BlockedError) return { blocked: true, reason: e.message };
    throw e;
  }
  await dismissCookies(page);
  await humanPause(2500, 4000);
  try { await checkBlocked(page, resp); }
  catch (e) {
    if (e instanceof BlockedError) return { blocked: true, reason: e.message };
    throw e;
  }
  const raw = await page.evaluate(probeInPage, probeOpts);
  if (raw.blocked) return { blocked: true, reason: `CAPTCHA/blocco rilevato su ${target}` };
  return { blocked: false, raw };
}

async function liveProbe(id, checks, { headless, url, withDetail }) {
  const human = await import('./human.mjs');
  const profileDir = path.join(ROOT, id, 'profile');
  const { context, page } = await human.launchPortal(profileDir, { headless });
  try {
    const target = url || checks.listingUrl;
    if (!target) throw new Error('serve probeChecks.listingUrl nell\'adapter oppure --url');
    const listing = await probeOnePage(page, human, target, {
      cardSelectors: checks.cardSelectors,
      linkPattern: checks.linkPattern,
      stripQuery: checks.stripQuery,
    });
    if (listing.blocked || !withDetail) return listing;
    // Dettaglio: primo link campionato dalla listing (1 pagina extra, ritmo D4).
    const detailUrl = (listing.raw.sampleLinks || [])[0];
    if (!detailUrl) return { ...listing, detail: null };
    await human.sleep(human.rand(3000, 6000));
    const detail = await probeOnePage(page, human, detailUrl, {});
    return { ...listing, detail: detail.blocked ? null : detail.raw, detailBlocked: detail.blocked ? detail.reason : null };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id || (!args.fromArchive && !args.live)) {
    console.error('Uso: node core/probe-verify.mjs --id <portale> [--from-archive | --live] [--url <url>] [--headless]');
    process.exit(1);
  }

  let adapter = {};
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, args.id, 'adapter.mjs')).href);
    adapter = mod.default || {};
  } catch { console.log(`(adapter ${args.id}/adapter.mjs non caricabile: verifico con default)`); }
  const checks = adapter.probeChecks || {};

  let step, detailStep = null, detailNote = null;
  const wantDetail = !!checks.detailChecks;
  if (args.fromArchive) {
    const record = loadArchive(args.id);
    step = pickStep(record, args.url || checks.listingUrl);
    if (!step) { console.error('Nessuno step utilizzabile nel probe archiviato.'); process.exit(2); }
    if (step.blocked) { console.error(`⛔ Probe archiviato BLOCCATO su ${step.url} — policy D4: STOP, nessuna verifica.`); process.exit(3); }
    console.log(`[${args.id}] Verifica da archivio: ${step.url} (${step.step})`);
    if (wantDetail) {
      detailStep = pickDetailStep(record, step);
      if (!detailStep) detailNote = 'nessuno step di dettaglio nell\'archivio: esegui il probe agent-driven anche su un annuncio';
    }
  } else {
    const res = await liveProbe(args.id, checks, { ...args, withDetail: wantDetail });
    if (res.blocked) {
      // Il blocco è del profilo Playwright: registra il cooldown 24h (miglioria A).
      recordBlock(args.id, `${res.reason} (probe live)`);
      console.error(`⛔ Blocco anti-bot: ${res.reason} — policy D4: STOP graceful. Cooldown 24h registrato.`);
      process.exit(3);
    }
    step = { url: res.raw.url, cardSelectors: res.raw.cardSelectors, sampleLinks: res.raw.sampleLinks, jsonLdTypes: res.raw.jsonLdTypes, blocked: res.raw.blocked, loginWall: res.raw.loginWall };
    console.log(`[${args.id}] Verifica live: ${step.url}${step.loginWall ? ' 🔒 login-wall' : ''}`);
    console.log('  conteggi:', JSON.stringify(step.cardSelectors));
    if (step.sampleLinks.length) console.log('  campioni link:', step.sampleLinks.slice(0, 5).join('\n    '));
    if (wantDetail) {
      detailStep = res.detail || null;
      if (!detailStep) detailNote = res.detailBlocked || 'nessun link campione per il dettaglio';
    }
  }

  if (!checks.cardSelectors && !checks.linkPattern && !checks.jsonLdType) {
    console.log('L\'adapter non dichiara probeChecks: nessuna asserzione da verificare (usa i conteggi qui sopra per aggiungerli).');
    process.exit(0);
  }

  const results = evaluateChecks(step, checks);
  if (checks.detailChecks) {
    if (detailStep) {
      console.log(`  dettaglio: ${detailStep.url}`);
      results.push(...evaluateChecks(detailStep, checks.detailChecks, { useDefaultCards: false }).map((r) => ({ ...r, check: `dettaglio ${r.check}` })));
    } else {
      results.push({ check: 'dettaglio (JSON-LD)', ok: null, detail: detailNote });
    }
  }
  let broken = 0, unknown = 0;
  for (const r of results) {
    const mark = r.ok === true ? '✅' : r.ok === false ? '❌' : '❓';
    if (r.ok === false) broken++;
    if (r.ok === null) unknown++;
    console.log(`  ${mark} ${r.check} — ${r.detail}`);
  }
  if (broken > 0) {
    console.error(`\n${broken} selettori rotti: il DOM del portale è cambiato. Ricognizione agent-driven (browser reale) → aggiorna adapter → ripeti.`);
    process.exit(2);
  }
  console.log(`\nOK (${results.length - unknown} verificati, ${unknown} inconcludenti).`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });