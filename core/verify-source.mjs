// Verifica che gli annunci degli AGGREGATORI esistano ancora sul portale d'origine.
// Caso reale: flatsearch 942fddb2 (via Battindarno, origin Wikicasa 31152501)
// ancora "online" sull'aggregatore ma l'annuncio originale risponde
// "Ci dispiace, purtroppo questo annuncio non è più disponibile".
//
// I link origine su flatsearch sono tracker: /api/property-analytics/<ID>/track
// (ID = id dell'annuncio sul portale d'origine). Si segue il redirect con la
// stessa pagina Playwright del run (headed, profilo persistente) e si valuta
// l'esito sulla pagina d'arrivo.
//
// Backfill descrizione: gli aggregatori spesso non copiano il testo
// dell'inserzionista (flatsearch ecd8fb7c → immobiliare 133727750 "NUDA
// PROPRIETÀ" visibile solo sull'originale). Se l'annuncio aggregato è vivo ma
// senza descrizione, si recupera dall'originale durante la verifica.
//
// Esiti: 'vivo' | 'morto' | 'sconosciuto'.
// Fail-closed sui BLOCCHI, non sulla verifica: 403/429/CAPTCHA/timeout NON
// significano annuncio morto → 'sconosciuto' (non esclude, si riprova al run dopo).
// Solo segnali espliciti di rimozione (404, 410 Gone, testo "non più
// disponibile", redirect alla home nuda del portale) producono 'morto'.
// Con più origini: vivo se ALMENO UNA è viva (l'annuncio esiste ancora).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { humanPause } from './human.mjs';

const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'origini-cache.json');
const CACHE_TTL_DAYS = 7;

const DEAD_RE = /non\s+è\s+più\s+(?:disponibile|pubblicato)|non\s+più\s+disponibile|questo\s+non\s+è\s+più\s+disponibile|ha\s+cancellato\s+l['’]annuncio|l['’]inserzionista\s+lo\s+ha\s+disattivato|annuncio\s+(?:scaduto|rimosso|non\s+trovato|non\s+disponibile)|pagina\s+non\s+trovata|l['’]annuncio\s+che\s+cerchi\s+non|immobile\s+non\s+(?:più\s+)?disponibile|questo\s+annuncio\s+è\s+stato\s+(?:rimosso|venduto)|page\s+not\s+found|errore\s*404|404\s*not\s*found/i;
// Blocchi anti-bot: le pagine Cloudflare/DataDome contengono riferimenti a
// "403/404" che non c'entrano con l'annuncio → il check blocco viene PRIMA.
const BLOCK_RE = /captcha|sei un robot|are you a human|verify you are human|accesso negato|access denied|unusual traffic|you have been blocked|unable to access|security service to protect|checking your browser|just a moment|datadome|cf-chl|challenge-platform/i;

// URL dei portali d'origine noti: il tracker redirecta qui. La home nuda
// (pathname "/") dopo il redirect = annuncio sparito, il portale non sa dove mandarti.
const ORIGIN_BASE = [
  { re: /wikicasa/i, base: 'https://www.wikicasa.it' },
  { re: /immobiliare/i, base: 'https://www.immobiliare.it' },
  { re: /idealista/i, base: 'https://www.idealista.it' },
  { re: /subito/i, base: 'https://www.subito.it' },
  { re: /casa\.it/i, base: 'https://www.casa.it' },
  { re: /trovacasa/i, base: 'https://www.trovacasa.it' },
  { re: /allalaricerca|allaricerca/i, base: 'https://www.allaricerca.it' },
];

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

function saveCache(cache) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch { /* best effort */ }
}

function cacheFresh(entry) {
  if (!entry || !entry.verificatoIl || entry.esito === 'sconosciuto') return false;
  const age = (Date.now() - new Date(entry.verificatoIl).getTime()) / 86400000;
  return age < CACHE_TTL_DAYS;
}

// Naviga verso l'annuncio e valuta l'esito sulla pagina d'arrivo.
// trackUrl: tracker flatsearch; altrimenti url diretto dell'annuncio (mitula/trovit).
async function probe(page, { portale, id, trackUrl, url }, { log = () => {} } = {}) {
  let resp = null;
  try {
    resp = await page.goto(trackUrl || url, { waitUntil: 'domcontentloaded', timeout: 40000 });
  } catch (e) {
    log(`[verifica] ${portale}/${id}: navigazione fallita (${String(e.message).slice(0, 60)}) → sconosciuto`);
    return { esito: 'sconosciuto', portale, id, urlFinale: '' };
  }
  await humanPause(1200, 2200);
  const status = resp ? resp.status() : 0;
  const urlFinale = page.url();
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '').catch(() => '');
  // PRIMA i blocchi: un 403 anti-bot NON è un annuncio morto.
  if (status === 403 || status === 429 || BLOCK_RE.test(body)) {
    return { esito: 'sconosciuto', portale, id, urlFinale };
  }
  // 410 Gone = rimosso definitivamente (Subito lo usa per gli annunci scaduti).
  if (status === 404 || status === 410 || DEAD_RE.test(body)) {
    return { esito: 'morto', portale, id, urlFinale, evidenza: `HTTP ${status} — ${body.slice(0, 300)}` };
  }
  // Redirect alla home nuda del portale d'origine = annuncio rimosso.
  try {
    const u = new URL(urlFinale);
    const bare = (u.pathname === '/' || u.pathname === '') && !u.search;
    const isOriginHome = !/flatsearch\.it|mitula|trovit/i.test(u.hostname) && bare;
    if (isOriginHome) return { esito: 'morto', portale, id, urlFinale };
  } catch { /* URL non parsabile: si prosegue */ }
  if (status >= 400) {
    return { esito: 'sconosciuto', portale, id, urlFinale };
  }
  return { esito: 'vivo', portale, id, urlFinale };
}

// Estrae la descrizione dell'inserzionista dalla pagina d'origine già aperta.
// Selettori noti per portale + fallback euristico (blocco dopo "Descrizione").
async function extractOriginDescription(page) {
  return page.evaluate(() => {
    const sels = ['.im-description__text', '.im-description', '[class*="description__text"]', '.comment .adCommentsLanguage', '.comment', '#description'];
    for (const s of sels) {
      const el = document.querySelector(s);
      const t = el?.innerText?.trim();
      if (t && t.length > 80) return t.slice(0, 4000);
    }
    const body = document.body?.innerText || '';
    const m = body.match(/Descrizione\s*\n([\s\S]{100,4000}?)(?:\nLEGGI TUTTO|\nCaratteristiche|\nContatta|\nAgenzia)/);
    return m ? m[1].trim().slice(0, 4000) : '';
  }).catch(() => '');
}

// Verifica una singola origine seguendo il tracker flatsearch.
export async function verifyOne(page, { portale, id }, opts = {}) {
  return probe(page, { portale, id, trackUrl: `https://flatsearch.it/api/property-analytics/${id}/track` }, opts);
}

// Verifica un annuncio aprendo il suo URL diretto (aggregatori senza tracker,
// es. mitula/trovit: caso reale mitula-IT-8270000794305974691 "Spiacenti, ma
// questo non è più disponibile").
export async function verifyDirect(page, ad, opts = {}) {
  return probe(page, { portale: ad.portale, id: ad.id, url: ad.url }, opts);
}

// Verifica le origini di tutti gli annunci (consigliato: solo i selezionati).
// Scrive ad.verificaOrigine = { esito, portale, id, verificatoIl, urlFinale } e
// ritorna il numero di annunci risultati morti. Cache condivisa per (portale,id).
// Aggregatori con link diretto (fonteAggregata, senza idsOrigine): verifica ad.url.
export async function verifyOrigins(ads, page, { log = () => {}, force = false } = {}) {
  const cache = loadCache();
  let morti = 0, verificati = 0;
  for (const ad of ads) {
    const origini = Array.isArray(ad.idsOrigine) ? ad.idsOrigine : [];
    const direct = !origini.length && ad.fonteAggregata && /^https?:/i.test(ad.url || '');
    if (!origini.length && !direct) continue;
    const selected = ad.esito === 'Selezionato' || ad.esitoSma === 'Selezionato';
    if (!selected && !force) continue;
    if (direct) {
      const key = `${String(ad.portale).toLowerCase()}|${ad.id}`;
      let entry = !force && cacheFresh(cache[key]) ? cache[key] : null;
      if (!entry) {
        entry = { ...(await verifyDirect(page, ad, { log })), verificatoIl: new Date().toISOString() };
        if (entry.esito !== 'sconosciuto') cache[key] = entry;
        verificati++;
        await humanPause(2500, 4500);
      }
      log(`[verifica] ${ad.id} ← ${ad.portale} (link diretto): ${entry.esito}`);
      ad.verificaOrigine = {
        esito: entry.esito,
        portale: ad.portale,
        id: ad.id,
        verificatoIl: entry.verificatoIl,
        urlFinale: entry.urlFinale || '',
        ...(entry.evidenza ? { evidenza: entry.evidenza } : {}),
      };
      if (entry.esito === 'morto') morti++;
      continue;
    }
    let esitoFinale = 'sconosciuto';
    let dettaglio = null;
    for (const o of origini) {
      const key = `${String(o.portale).toLowerCase()}|${o.id}`;
      let entry = !force && cacheFresh(cache[key]) ? cache[key] : null;
      if (!entry) {
        entry = { ...(await verifyOne(page, o, { log })), verificatoIl: new Date().toISOString() };
        if (entry.esito !== 'sconosciuto') cache[key] = entry;
        verificati++;
        await humanPause(2500, 4500);
      }
      log(`[verifica] ${ad.id} ← ${o.portale}/${o.id}: ${entry.esito}`);
      if (entry.esito === 'vivo') {
        esitoFinale = 'vivo'; dettaglio = entry;
        // Backfill: aggregatore senza descrizione → testo dall'originale
        // (la pagina è quella appena visitata dal probe, se non era in cache).
        if (!String(ad.descrizione || '').trim() && entry.urlFinale) {
          const desc = await extractOriginDescription(page);
          if (desc) {
            ad.descrizione = desc;
            log(`[verifica] ${ad.id}: descrizione integrata dall'origine (${desc.length} caratteri)`);
          }
        }
        break;
      }
      if (entry.esito === 'morto') { esitoFinale = 'morto'; dettaglio = entry; }
      else if (!dettaglio) dettaglio = entry;
    }
    ad.verificaOrigine = {
      esito: esitoFinale,
      portale: dettaglio?.portale || origini[0].portale,
      id: dettaglio?.id || origini[0].id,
      verificatoIl: dettaglio?.verificatoIl || new Date().toISOString(),
      urlFinale: dettaglio?.urlFinale || '',
      ...(dettaglio?.evidenza ? { evidenza: dettaglio.evidenza } : {}),
    };
    if (esitoFinale === 'morto') morti++;
  }
  saveCache(cache);
  log(`[verifica] origini: ${verificati} controlli live, ${morti} annunci morti`);
  return morti;
}