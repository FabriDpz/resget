// Runner condiviso per gli scraper dei portali.
// Un adattatore esporta: { id, name, collectListings(page, opts), scrapeDetail(page, card, opts) }
// Il runner gestisce: profilo persistente, resume, salvataggi incrementali,
// filtri BIG/SMA, analisi FLIP, storico prezzi, STOP graceful sui blocchi.
//
// Uso (dentro <portale>/scrape.mjs):
//   import { runPortal } from '../core/runner.mjs';
//   import adapter from './adapter.mjs';
//   runPortal(adapter, import.meta.url);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPortal, humanPause, sleep, rand, log, BlockedError, dismissCookies, setPace } from './human.mjs';
import { applyProfiles } from './filters.mjs';
import { detectNonResidential } from './filters.mjs';
import { analyzeFlip, loadPriceHistory, updatePriceHistory } from './flip.mjs';
import { normalizeAd } from './schema.mjs';
import { enrichAds } from './enrich.mjs';
import { verifyOrigins } from './verify-source.mjs';
import { recordBlock, recordSuccess, inCooldown } from './health.mjs';

export async function runPortal(adapter, moduleUrl, argv = process.argv.slice(2)) {
  const dir = path.dirname(fileURLToPath(moduleUrl));
  const PROFILE_DIR = path.join(dir, 'profile');
  const OUTPUT_DIR = path.join(dir, 'output');
  const PRICE_HISTORY_FILE = path.join(OUTPUT_DIR, 'prezzi-storico.json');

  const hasFlag = (f) => argv.includes(f);
  const getOpt = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  const HEADLESS = hasFlag('--headless');
  const MAX_ADS = parseInt(getOpt('--max-ads', '200'), 10);
  const RESUME_FILE = getOpt('--resume', null);
  const REAPPLY = hasFlag('--reapply-filters');
  const VERIFY = hasFlag('--verify-origins');
  const NO_VERIFY = hasFlag('--no-verify');
  const RETRY_FAILED = hasFlag('--retry-failed');
  const FORCE = hasFlag('--force');
  const maxKm = parseFloat(getOpt('--max-km', '3'));
  const minPoi = parseFloat(getOpt('--min-poi', '35'));
  const NO_GEOCODE = hasFlag('--no-geocode');
  const NO_POI = hasFlag('--no-poi');
  const REFRESH_POI = hasFlag('--refresh-poi');
  const POI_CACHE = path.join(dir, '..', 'core', 'poi-cache.json');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Ritmo lento richiesto dal portale (adapter.pace, ms): ogni pausa ≥ quel minimo.
  if (adapter.pace) {
    setPace(adapter.pace.minMs);
    log(`[${adapter.id}] Ritmo lento: pause ≥ ${Math.round(adapter.pace.minMs / 1000)}s (${adapter.pace.reason || 'richiesto dal portale'})`);
  }

  const runFlip = (ads, { updateHistory = true } = {}) => {
    if (updateHistory) updatePriceHistory(ads, PRICE_HISTORY_FILE);
    analyzeFlip(ads, { detectNonResidential, storico: loadPriceHistory(PRICE_HISTORY_FILE) });
  };

  if (REAPPLY) {
    if (!RESUME_FILE) throw new Error('--reapply-filters richiede --resume <json>');
    const prev = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
    for (const ad of prev) Object.assign(ad, applyProfiles(ad, { maxKm, minPoi }));
    runFlip(prev);
    fs.writeFileSync(RESUME_FILE, JSON.stringify(prev, null, 2));
    const sel = prev.filter((a) => a.esito === 'Selezionato').length;
    const selSma = prev.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato').length;
    log(`[${adapter.id}] Filtri riapplicati: ${prev.length} annunci (${sel} BIG, ${selSma} SMA).`);
    return;
  }

  // Verifica live delle origini (aggregatori): --verify-origins --resume <json>.
  // Segue i tracker (flatsearch) o il link diretto (mitula/trovit), marca ad.verificaOrigine e
  // riapplica i filtri (esito 'morto' → escluso BIG e SMA).
  if (VERIFY) {
    if (!RESUME_FILE) throw new Error('--verify-origins richiede --resume <json>');
    const prev = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
    const { context, page } = await launchPortal(PROFILE_DIR, { headless: HEADLESS });
    try {
      await dismissCookies(page);
      await verifyOrigins(prev, page, { log });
    } finally {
      try { await context.close(); } catch { /* già chiuso */ }
    }
    for (const ad of prev) Object.assign(ad, applyProfiles(ad, { maxKm, minPoi }));
    runFlip(prev);
    fs.writeFileSync(RESUME_FILE, JSON.stringify(prev, null, 2));
    log(`[${adapter.id}] Verifica origini completata su ${path.basename(RESUME_FILE)}.`);
    return;
  }

  // Cooldown anti-ban (miglioria A): un portale bloccato di recente non viene
  // ritentato per 24h. --force scavalca SOLO il cooldown (mai i blocchi live, D4).
  const cd = inCooldown(adapter.id);
  if (cd && !FORCE) {
    log(`[${adapter.id}] In cooldown fino a ${cd.until} (${cd.hoursLeft}h) — ultimo blocco: ${cd.reason}. Salto (usa --force per ignorare).`);
    process.exitCode = 3;
    return;
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const jsonPath = path.join(OUTPUT_DIR, `annunci-${stamp}.json`);
  const failedPath = path.join(OUTPUT_DIR, `falliti-${stamp}.json`);
  const summaryPath = path.join(OUTPUT_DIR, `run-summary-${stamp}.json`);
  const failed = [];
  let blocked = null;
  const startedAt = Date.now();
  const ads = [];
  if (RESUME_FILE) {
    try {
      ads.push(...JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8')));
      log(`Resume: ${ads.length} annunci da ${path.basename(RESUME_FILE)}`);
    } catch (e) {
      log(`Resume non leggibile (${e.message}): parto da zero.`);
    }
  }
  const doneIds = new Set(ads.map((a) => a.id));
  const adsAtStart = ads.length;

  const { context, page } = await launchPortal(PROFILE_DIR, { headless: HEADLESS });
  let browserClosed = false;
  context.on('close', () => { browserClosed = true; });
  page.on('close', () => { browserClosed = true; });

  const save = () => {
    for (const ad of ads) Object.assign(ad, applyProfiles(ad, { maxKm, minPoi }));
    runFlip(ads);
    fs.writeFileSync(jsonPath, JSON.stringify(ads, null, 2));
  };
  process.on('SIGINT', async () => {
    log('Interrotto: salvo i dati raccolti…');
    try { save(); } catch { /* best effort */ }
    await context.close();
    process.exit(0);
  });

  // Coda falliti (miglioria B): --retry-failed riprova gli annunci falliti
  // dell'ultimo run senza rifare la listing. Usa --resume <json> per non
  // perdere gli annunci già raccolti (con --resume vengono caricati sopra).
  let retryCards = null;
  if (RETRY_FAILED) {
    const files = fs.readdirSync(OUTPUT_DIR).filter((f) => /^falliti-.*\.json$/.test(f)).sort();
    const lastFailed = files.length ? path.join(OUTPUT_DIR, files[files.length - 1]) : null;
    retryCards = lastFailed ? JSON.parse(fs.readFileSync(lastFailed, 'utf8')) : [];
    if (!retryCards.length) {
      log('Nessuna coda falliti: niente da riprovare.');
      try { await context.close(); } catch { /* già chiuso */ }
      return;
    }
    log(`Retry falliti: ${retryCards.length} annunci da ${path.basename(lastFailed)}`);
    if (!RESUME_FILE) log('Nota: senza --resume <json> il nuovo file conterrà solo gli annunci riprovati.');
  }

  try {
    // 1) raccolta card dalle aree di ricerca (saltata in --retry-failed)
    let cards = [];
    if (retryCards) {
      cards = retryCards;
    } else {
      try {
        cards = await adapter.collectListings(page, { log, maxAds: MAX_ADS, dismissCookies });
      } catch (e) {
        if (e instanceof BlockedError) {
          blocked = e.message;
          log(`STOP in raccolta: ${e.message}. Nessun aggiramento. Portale non accessibile al momento.`);
          recordBlock(adapter.id, e.message);
          save();
          return;
        }
        throw e;
      }
    }
    const targets = cards.filter((c) => !doneIds.has(String(c.id))).slice(0, MAX_ADS);
    log(`[${adapter.id}] Annunci da visitare: ${targets.length} (già raccolti: ${doneIds.size})`);

    // 2) dettaglio di ogni annuncio, con pause umane e backup incrementale.
    // Errori transitori: 1 ritento con pausa lunga; poi l'annuncio va nella
    // coda falliti (recuperabile con --retry-failed). BlockedError: mai ritentato.
    let i = 0;
    const scrapeOne = async (card) => {
      const partial = await adapter.scrapeDetail(page, card, { log, dismissCookies });
      if (partial) {
        const ad = normalizeAd(adapter.id, partial);
        ads.push(ad);
        save();
        log(`  ✓ ${ad.comune || '?'} — ${ad.prezzo ?? '?'} € — ${ad.superficieMq ?? '?'} m²`);
      } else {
        log('  Annuncio non più disponibile, salto.');
      }
    };
    for (const card of targets) {
      if (browserClosed) { log('Browser chiuso: salvo. Usa --resume per completare.'); break; }
      i++;
      log(`[${i}/${targets.length}] ${card.id} ${card.url}`);
      try {
        await scrapeOne(card);
      } catch (e) {
        if (e instanceof BlockedError) {
          blocked = e.message;
          log(`STOP: ${e.message}. Dati parziali salvati (${ads.length}). Nessun aggiramento.`);
          recordBlock(adapter.id, e.message);
          break;
        }
        log(`  Errore: ${e.message} — ritento una volta dopo pausa lunga…`);
        await sleep(rand(15000, 25000));
        try {
          await scrapeOne(card);
          log('  ✓ recuperato al ritento');
        } catch (e2) {
          if (e2 instanceof BlockedError) {
            blocked = e2.message;
            log(`STOP al ritento: ${e2.message}. Nessun aggiramento.`);
            recordBlock(adapter.id, e2.message);
            break;
          }
          failed.push({ ...card, error: String(e2.message).slice(0, 200), failedAt: new Date().toISOString() });
          log(`  ✖ fallito due volte: in coda falliti (${failed.length})`);
        }
      }
      if (i < targets.length) await humanPause(5000, 10000);
    }
    // 3) arricchimento: geocoding (se mancano coordinate) + rank POI condivisi
    if (!NO_GEOCODE || !NO_POI) {
      try {
        await enrichAds(ads, { log, poiCache: NO_POI ? null : POI_CACHE, refreshPoi: REFRESH_POI, skipGeocode: NO_GEOCODE });
      } catch (e) { log(`Arricchimento parziale: ${e.message}`); }
    }
    save();
    // Aggregatori con idsOrigine: verifica che gli annunci selezionati esistano
    // ancora sui portali d'origine (regola progetto), poi riapplica i filtri.
    if (!NO_VERIFY && !browserClosed && ads.some((a) => (Array.isArray(a.idsOrigine) && a.idsOrigine.length) || (a.fonteAggregata && /^https?:/i.test(a.url || '')))) {
      try {
        await verifyOrigins(ads, page, { log });
        save();
      } catch (e) {
        if (e instanceof BlockedError) log(`Verifica origini interrotta: ${e.message}. Nessun aggiramento.`);
        else log(`Verifica origini parziale: ${e.message}`);
      }
    }
    const sel = ads.filter((a) => a.esito === 'Selezionato').length;
    const selSma = ads.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato').length;
    if (blocked) {
      log(`[${adapter.id}] Interrotto da blocco: ${ads.length} annunci parziali salvati → ${jsonPath}`);
    } else {
      recordSuccess(adapter.id);
      log(`[${adapter.id}] Completato: ${ads.length} annunci (${sel} BIG, ${selSma} SMA) → ${jsonPath}`);
    }
  } finally {
    try { await context.close(); } catch { /* già chiuso */ }
    // Coda falliti + summary del run (migliorie B e D). Sempre scritti, anche
    // su stop: run-all li legge per il report globale.
    try {
      fs.writeFileSync(failedPath, JSON.stringify(failed, null, 2));
      if (failed.length) log(`[${adapter.id}] ${failed.length} annunci in coda falliti → ${path.basename(failedPath)} (riprova: --retry-failed --resume <json>)`);
      const summary = {
        id: adapter.id,
        startedAt: new Date(startedAt).toISOString(),
        durationMin: +((Date.now() - startedAt) / 60000).toFixed(1),
        ads: ads.length,
        newAds: ads.length - adsAtStart,
        big: ads.filter((a) => a.esito === 'Selezionato').length,
        sma: ads.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato').length,
        resumed: adsAtStart,
        failed: failed.length,
        blocked,
        retryFailed: RETRY_FAILED,
        json: path.basename(jsonPath),
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    } catch (e) { log(`Summary/coda falliti non scritti: ${e.message}`); }
    if (blocked) process.exitCode = 3;
  }
}