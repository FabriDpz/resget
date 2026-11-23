// Helper "umani" condivisi per tutti gli scraper Playwright.
// Policy anti-bot: requisiti-immobilare.md §8 — fail-closed, nessun aggiramento.

import { chromium } from 'playwright';

export const rand = (min, max) => Math.floor(min + Math.random() * (max - min));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(`[${new Date().toLocaleTimeString('it-IT')}]`, ...a);

// Ritmo di navigazione per-portale. L'adapter può dichiarare `pace` (ms):
// ogni pausa viene alzata almeno a quel minimo. casa.it: ≥20s (WAF DataDome).
let paceFloorMs = 0;
export function setPace(minMs) { paceFloorMs = Math.max(0, minMs || 0); }
export const humanPause = (min = 2000, max = 5000) =>
  sleep(Math.max(rand(min, max), paceFloorMs ? rand(paceFloorMs, paceFloorMs + 5000) : 0));

export class BlockedError extends Error {}

// Profilo persistente per portale: cookies/sessione restano tra i run.
export async function launchPortal(profileDir, { headless = false } = {}) {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);
  return { context, page };
}

// Banner cookie: preferisce il rifiuto, poi l'accettazione (minimo indispensabile).
// Cerca anche negli iframe (Didomi, Quantcast, Iubenda, Cookiebot…).
export async function dismissCookies(page) {
  const patterns = [
    /continua senza accettare|continue without agreeing|rifiuta tutto|rifiuta e|rifiuta|reject all|decline|non accetto/i,
    /accetta tutto|accetta e chiudi|accetta|agree\s*&?\s*close|accept all|accept|ho capito|ok,? grazie|consenti/i,
  ];
  const frames = [page, ...page.frames()];
  for (const re of patterns) {
    for (const frame of frames) {
      try {
        const btn = frame.locator('button, [role="button"], a', { hasText: re }).first();
        if (await btn.isVisible({ timeout: 700 })) {
          await btn.click({ timeout: 2500 });
          await sleep(rand(500, 1200));
          return true;
        }
      } catch { /* banner assente o non cliccabile */ }
    }
  }
  return false;
}

export async function humanScroll(page, steps = rand(3, 6)) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, rand(500, 1000));
    await sleep(rand(350, 900));
  }
}

// Navigazione resiliente: sul 403/429 (rate-limit) attende con backoff e riprova,
// rispettando il limite del sito (nessun aggiramento). Dopo i tentativi, lancia BlockedError.
export async function gotoResilient(page, url, { log = () => {}, tries = 4, baseWait = 20000, waitUntil = 'domcontentloaded', timeout = 40000 } = {}) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let resp = null;
    try { resp = await page.goto(url, { waitUntil, timeout }); } catch (e) {
      log(`[goto] errore navigazione (${String(e.message).slice(0, 60)}) tentativo ${attempt}/${tries}`);
    }
    lastStatus = resp ? resp.status() : 0;
    if (resp && lastStatus !== 403 && lastStatus !== 429) return resp;
    const wait = baseWait * attempt; // 20s, 40s, 60s, 80s
    log(`[goto] HTTP ${lastStatus} su ${url} — attendo ${Math.round(wait / 1000)}s (rate-limit) tentativo ${attempt}/${tries}`);
    await sleep(wait);
  }
  throw new BlockedError(`HTTP ${lastStatus} persistente su ${url} dopo ${tries} tentativi`);
}

// STOP graceful su blocchi: nessuna tecnica di aggiramento.
export async function checkBlocked(page, response) {
  if (response && (response.status() === 403 || response.status() === 429)) {
    throw new BlockedError(`HTTP ${response.status()} — possibile blocco anti-bot`);
  }  const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '').catch(() => '');
  if (/captcha|sei un robot|are you a human|verify you are human|accesso negato|access denied|unusual traffic/i.test(txt)) {
    throw new BlockedError('CAPTCHA o pagina di blocco rilevata');
  }
}