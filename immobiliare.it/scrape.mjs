// Scraper personale Immobiliare.it — Playwright + sito web statico (site/)
// Requisiti: vedi requisiti-immobilare.md
// Uso:
//   npm run scrape                 (browser visibile, come un utente normale)
//   npm run scrape -- --headless   (senza finestra)
//   npm run scrape -- --max-ads 50 --only pianoro
//   npm run login                  (login assistito, salva la sessione nel profilo)
// Credenziali (opzionali, mai nel codice): IMMOBILIARE_EMAIL, IMMOBILIARE_PASSWORD

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MIN_POI_RANK } from './poi-config.mjs';
import { analyzeFlip, loadPriceHistory, updatePriceHistory } from './flip.mjs';
import { zonaEsclusa, comuneContraddetto } from '../core/geo.mjs';
import { detectAffitto, detectNudaProprieta } from '../core/filters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, 'profile');
const OUTPUT_DIR = path.join(__dirname, 'output');
const PRICE_HISTORY_FILE = path.join(OUTPUT_DIR, 'prezzi-storico.json');
const SITE_DIR = path.join(__dirname, 'site');

// ---------------------------------------------------------------- configurazione

// Superset delle due ricerche BIG/SMA: prezzo max 160k (BIG) e localiMinimo=1
// (monolocali ≥55 m² per SMA). I criteri per profilo sono applicati lato script.
const COMMON_FILTERS =
  'prezzoMassimo=160000&superficieMinima=55&localiMinimo=1&bathrooms[0]=1&ownershipTypes[0]=1&noAste=1';

const VRT_BOLOGNA =
  '44.519129%2C11.229828%3B44.523463%2C11.251906%3B44.509516%2C11.257427%3B44.510116%2C11.267407%3B44.497753%2C11.269748%3B44.482524%2C11.258946%3B44.47815%2C11.287022%3B44.445016%2C11.294923%3B44.436448%2C11.308169%3B44.420691%2C11.310881%3B44.413699%2C11.293766%3B44.400256%2C11.30766%3B44.395161%2C11.301711%3B44.402707%2C11.276586%3B44.391475%2C11.265938%3B44.391107%2C11.300454%3B44.374176%2C11.301676%3B44.362932%2C11.287037%3B44.365856%2C11.306805%3B44.385201%2C11.310101%3B44.388501%2C11.319999%3B44.340158%2C11.320347%3B44.338203%2C11.33539%3B44.351075%2C11.339726%3B44.35307%2C11.350413%3B44.366377%2C11.344044%3B44.377596%2C11.365422%3B44.389486%2C11.35941%3B44.395125%2C11.394233%3B44.414891%2C11.395858%3B44.419917%2C11.414876%3B44.434177%2C11.40716%3B44.446221%2C11.415161%3B44.424077%2C11.438552%3B44.44513%2C11.473624%3B44.461404%2C11.464522%3B44.465211%2C11.471944%3B44.425302%2C11.615819%3B44.465874%2C11.493371%3B44.482222%2C11.483221%3B44.5027%2C11.491507%3B44.527779%2C11.457688%3B44.545155%2C11.453325%3B44.547944%2C11.439928%3B44.559666%2C11.432258%3B44.553702%2C11.420047%3B44.566882%2C11.412304%3B44.56859%2C11.395973%3B44.574941%2C11.391446%3B44.583365%2C11.404141%3B44.632007%2C11.426198%3B44.565632%2C11.381013%3B44.556303%2C11.336398%3B44.543785%2C11.334582%3B44.531244%2C11.31484%3B44.54106%2C11.307288%3B44.531185%2C11.293092%3B44.531966%2C11.261488%3B44.519129%2C11.229828';

const AREAS = [
  {
    name: 'Bologna (area salvata)',
    url: `https://www.immobiliare.it/search-list/?idCategoria=1&idContratto=1&idNazione=IT&${COMMON_FILTERS}&pag=1&vrt=${VRT_BOLOGNA}&id=183235176&imm_source=bookmarkricerche`,
  },
  {
    name: 'Pianoro',
    url: `https://www.immobiliare.it/vendita-case/pianoro/?${COMMON_FILTERS}`,
  },
  {
    name: 'San Lazzaro di Savena',
    url: `https://www.immobiliare.it/vendita-case/san-lazzaro-di-savena/?${COMMON_FILTERS}`,
  },
];

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getOpt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const LOGIN_ONLY = hasFlag('--login');
const HEADLESS = hasFlag('--headless');
const MAX_ADS = parseInt(getOpt('--max-ads', '200'), 10);
const MIN_BEDROOMS = parseInt(getOpt('--min-bedrooms', '2'), 10); // override camere minime del profilo BIG
const ONLY_AREA = getOpt('--only', null);
const CUSTOM_URL = getOpt('--url', null);
const RESUME_FILE = getOpt('--resume', null); // JSON di un run precedente: salta gli annunci già raccolti
const REBUILD_SITE = hasFlag('--rebuild-site') || hasFlag('--sort-only'); // rigenera il sito da un JSON (--resume) senza browser (--sort-only: alias storico)
const REAPPLY_FILTERS = hasFlag('--reapply-filters'); // riapplica i filtri ai dati del JSON (--resume), senza browser
const ENRICH = hasFlag('--enrich'); // aggiunge le coordinate agli annunci del JSON (--resume) che ne sono privi
const MAX_KM = parseFloat(getOpt('--max-km', '3')); // distanza max (linea d'aria) dal centro abitato più vicino
const MIN_POI = parseFloat(getOpt('--min-poi', String(MIN_POI_RANK))); // rank POI minimo (se il campo poi è presente)
const MAX_PAGES = 40;

// Comuni ammessi (filtro stringente sul campo strutturato "comune" dell'annuncio)
const ALLOWED_COMUNI = ['bologna', 'pianoro', 'san lazzaro di savena'];

// Centri abitati di riferimento (coordinate verificate su OpenStreetMap/Nominatim).
// Capoluoghi + frazioni principali abitate dei 3 comuni. Le località isolate
// (Tazzola, Livergnano…) NON sono centri di riferimento: un annuncio lì deve
// trovarsi entro MAX_KM da uno di questi centri.
const CENTRI_ABITATI = [
  { name: 'Bologna centro', lat: 44.4938203, lon: 11.3426327 },
  { name: 'Borgo Panigale', lat: 44.5194898, lon: 11.2761784 },
  { name: 'Santa Viola', lat: 44.5075279, lon: 11.3035231 },
  { name: 'Corticella', lat: 44.5461652, lon: 11.3564921 },
  { name: 'San Lazzaro di Savena', lat: 44.4715668, lon: 11.4048591 },
  { name: 'Idice', lat: 44.4568907, lon: 11.4426928 },
  { name: 'Cicogna', lat: 44.4610325, lon: 11.4191043 },
  { name: 'Pianoro', lat: 44.3856330, lon: 11.3435428 },
  { name: 'Pianoro Vecchio', lat: 44.3707577, lon: 11.3408417 },
  { name: 'Rastignano', lat: 44.4429957, lon: 11.3561198 },
  { name: 'Carteria di Sesto', lat: 44.4287875, lon: 11.3521866 },
];

// Distanza in linea d'aria (haversine), km
function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function nearestCenter(lat, lon) {
  let best = null;
  for (const c of CENTRI_ABITATI) {
    const km = distanceKm(lat, lon, c.lat, c.lon);
    if (!best || km < best.km) best = { name: c.name, km };
  }
  return best;
}

// ---------------------------------------------------------------- utilità "umane"

const rand = (min, max) => Math.floor(min + Math.random() * (max - min));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanPause = (min = 2000, max = 5000) => sleep(rand(min, max));
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('it-IT')}]`, ...a);

class BlockedError extends Error {}

async function dismissCookies(page) {
  for (const re of [
    /continua senza accettare|continue without agreeing|rifiuta/i,
    /accetta tutto|agree\s*&?\s*close|accept all/i,
  ]) {
    try {
      const btn = page.locator('button', { hasText: re }).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await sleep(rand(500, 1200));
        return;
      }
    } catch { /* banner assente */ }
  }
}

async function humanScroll(page, steps = rand(3, 6)) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, rand(500, 1000));
    await sleep(rand(350, 900));
  }
}

async function checkBlocked(page, response) {
  if (response && (response.status() === 403 || response.status() === 429)) {
    throw new BlockedError(`HTTP ${response.status()} — possibile blocco anti-bot`);
  }
  const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '');
  if (/captcha|sei un robot|are you a human|accesso negato|access denied/i.test(txt)) {
    throw new BlockedError('CAPTCHA o pagina di blocco rilevata');
  }
}

// ---------------------------------------------------------------- login

async function isLoggedIn(page) {
  await page.goto('https://www.immobiliare.it/user/searches/', {
    waitUntil: 'domcontentloaded', timeout: 45000,
  });
  await sleep(2000);
  if (/\/login/i.test(page.url())) return false;
  const hasLoginForm = await page.locator('input[name="password"]').count();
  return hasLoginForm === 0;
}

async function ensureLogin(page) {
  if (await isLoggedIn(page)) {
    log('Sessione già attiva (profilo persistente).');
    return true;
  }
  log('Sessione non attiva: provo il login…');
  await page.goto('https://www.immobiliare.it/login/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissCookies(page);
  await humanPause(1000, 2500);

  const email = process.env.IMMOBILIARE_EMAIL;
  const password = process.env.IMMOBILIARE_PASSWORD;
  if (email && password) {
    try {
      await page.locator('input[name="email"]').fill('');
      await page.locator('input[name="email"]').pressSequentially(email, { delay: rand(50, 130) });
      await humanPause(600, 1500);
      await page.locator('input[name="password"]').pressSequentially(password, { delay: rand(50, 130) });
      await humanPause(800, 1800);
      await page.locator('button', { hasText: /^ACCEDI$/i }).first().click();
      await page.waitForLoadState('domcontentloaded');
      await humanPause(3000, 5000);
      if (!/\/login/i.test(page.url())) {
        log('Login automatico riuscito.');
        return true;
      }
      log('Login automatico non completato (OTP/verifica?): attendo login manuale…');
    } catch (e) {
      log('Login automatico fallito:', e.message, '— attendo login manuale…');
    }
  } else {
    log('Variabili IMMOBILIARE_EMAIL / IMMOBILIARE_PASSWORD non impostate.');
  }

  if (HEADLESS) {
    log('Modalità headless: impossibile login manuale. Continuo come ospite (dati pubblici).');
    return false;
  }
  log('>>> Completa il login nella finestra del browser (hai 5 minuti). <<<');
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(4000);
    try {
      if (!/\/login/i.test(page.url()) && (await page.locator('input[name="password"]').count()) === 0) {
        log('Login manuale completato.');
        return true;
      }
    } catch { /* navigazione in corso */ }
  }
  log('Timeout login: continuo come ospite (i dati degli annunci sono pubblici).');
  return false;
}

// ---------------------------------------------------------------- listing + paging

async function extractCards(page) {
  return page.evaluate(() => {
    const out = [];
    for (const li of document.querySelectorAll('li.nd-list__item')) {
      const a = li.querySelector('a[href*="/annunci/"]');
      if (!a) continue;
      const m = a.href.match(/\/annunci\/(\d+)/);
      if (!m) continue;
      out.push({ id: m[1], url: `https://www.immobiliare.it/annunci/${m[1]}/` });
    }
    return out;
  });
}

async function collectArea(page, area) {
  log(`Area "${area.name}": apro la ricerca…`);
  const resp = await page.goto(area.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await checkBlocked(page, resp);
  await dismissCookies(page);
  try {
    await page.waitForSelector('li.nd-list__item a[href*="/annunci/"]', { timeout: 20000 });
  } catch {
    log(`  Nessun annuncio trovato per "${area.name}".`);
    return [];
  }
  await humanPause(1500, 3000);

  const totalMatch = await page.evaluate(() => {
    const m = document.body.innerText.match(/\d[\d.,]*\s*(risultat[oi]|annunc[io])/i);
    return m ? m[0] : null;
  });
  if (totalMatch) log(`  Conteggio dichiarato: ${totalMatch}`);

  const found = new Map();
  let pageNum = 1;
  let prevFirstId = null;
  while (pageNum <= MAX_PAGES) {
    await humanScroll(page);
    const cards = await extractCards(page);
    const firstId = cards[0]?.id;
    if (prevFirstId && firstId === prevFirstId) break; // pagina ripetuta: stop
    prevFirstId = firstId;
    let nuovi = 0;
    for (const c of cards) {
      if (!found.has(c.id)) { found.set(c.id, { ...c, area: area.name }); nuovi++; }
    }
    log(`  Pagina ${pageNum}: ${cards.length} card, ${nuovi} nuovi (totale area: ${found.size})`);

    // paging naturale: click su "Successiva" o sul numero di pagina successivo
    const next = page.locator('a', { hasText: /successiva/i }).first();
    let hasNext = false;
    try { hasNext = await next.isVisible({ timeout: 1500 }); } catch { /* no */ }
    if (!hasNext) {
      const numLink = page.locator(`a[href*="pag=${pageNum + 1}"]`).first();
      try { hasNext = await numLink.isVisible({ timeout: 1000 }); } catch { /* no */ }
      if (hasNext) {
        await humanPause(2000, 4500);
        await numLink.click();
      }
    } else {
      await humanPause(2000, 4500);
      await next.click();
    }
    if (!hasNext) break;
    await page.waitForLoadState('domcontentloaded');
    try {
      await page.waitForSelector('li.nd-list__item a[href*="/annunci/"]', { timeout: 20000 });
    } catch { break; }
    await humanPause(1500, 3000);
    pageNum++;
  }
  return [...found.values()];
}

// ---------------------------------------------------------------- dettaglio annuncio

function mapDetail(re, url, areaName) {
  const p = re.properties?.[0] || {};
  const loc = p.location || {};
  // codeName è spesso vuoto: match sul nome (case-insensitive)
  const feat = (reName) => (p.primaryFeatures || []).find((f) => reName.test(String(f.name || '')));
  const yesNo = (reName) => {
    const f = feat(reName);
    if (!f || f.value == null) return '';
    return f.value ? 'Sì' : 'No';
  };
  const arredato = (() => {
    const un = feat(/non arredato/i);
    const fu = feat(/(^|\s)arredato/i);
    if (fu && !/non/i.test(fu.name) && fu.value) return 'Sì';
    if (un && un.isVisible) return 'No';
    return '';
  })();
  const surfElems = p.surfaceConstitution?.surfaceConstitutionElements || [];
  const surfaceDetail = surfElems
    .map((s) => `${s.constitution}: ${s.floor?.value || '-'}, ${s.surface}, coeff. ${s.percentage}%, ${s.surfaceType}, comm. ${s.commercialSurface}`)
    .join(' | ');
  const epoch = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : '');
  const num = (v) => {
    const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };
  const surfaceNum = (() => {
    const m = String(p.surface || '').replace(',', '.').match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  })();
  const out = {
    id: String(re.id),
    url,
    area: areaName,
    titolo: re.title || '',
    comune: loc.city || '',
    provincia: loc.province || '',
    zona: [loc.macrozone, loc.microzone].filter(Boolean).join(' / '),
    indirizzo: [loc.address, loc.streetNumber].filter(Boolean).join(' '),
    lat: loc.latitude ?? null,
    lon: loc.longitude ?? null,
    prezzo: re.price?.value ?? null,
    prezzoMq: re.price?.pricePerSquareMeter || '',
    tipologia: p.typologyValue || p.caption || '',
    locali: num(p.rooms),
    camere: num(p.bedRoomsNumber),
    bagni: num(p.bathrooms),
    superficieMq: surfaceNum,
    piano: p.floor?.value || '',
    pianoSolo: p.floor?.floorOnlyValue || '',
    pianiEdificio: p.floors || '',
    ascensore: p.elevator == null ? '' : p.elevator ? 'Sì' : 'No',
    cucina: p.kitchenStatus || '',
    arredato,
    balcone: yesNo(/balcone/i),
    terrazzo: yesNo(/terrazz/i),
    cantina: yesNo(/cantina/i),
    stato: p.condition || '',
    ape: p.energy?.energyStatus || '',
    riscaldamento: p.energy?.heatingType || '',
    speseCondominio: p.costs?.condominiumExpenses || '',
    altreCaratteristiche: (p.features || p.ga4features || []).join('; '),
    dettaglioSuperficie: surfaceDetail,
    agenzia: re.advertiser?.agency?.displayName || re.advertiser?.supervisor?.displayName || '',
    aggiornatoIl: epoch(re.updatedAt),
    pubblicatoIl: epoch(re.createdAt),
    descrizione: p.description || '',
    foto: p.multimedia?.photos?.[0]?.urls?.large || '',
    // Planimetrie: fonte primaria multimedia.floorplans; fallback su foto con
    // caption "planimetria" (alcuni annunci la caricano tra le foto). Il conteggio
    // reale delle camere (camerePlanimetria) è una verifica visiva fatta a valle.
    planimetrie: (() => {
      const fps = (p.multimedia?.floorplans || []).map((f) => ({
        url: f.urls?.large || f.urls?.xxl || '',
        caption: f.caption || '',
      }));
      if (fps.length) return fps;
      return (p.multimedia?.photos || [])
        .filter((f) => /planimetria/i.test(f.caption || ''))
        .map((f) => ({ url: f.urls?.large || f.urls?.xxl || '', caption: f.caption || '' }));
    })(),
    planimetriaUrl: '',
    camerePlanimetria: null,
    notaPlanimetria: '',
    scrapedAt: new Date().toISOString(),
  };
  out.planimetriaUrl = out.planimetrie[0]?.url || '';
  return out;
}

async function extractDetailDom(page, url, areaName) {
  // Fallback se __NEXT_DATA__ non contiene detailData
  return page.evaluate(({ url, areaName }) => {
    const pairs = {};
    for (const dt of document.querySelectorAll('dl dt')) {
      const k = dt.innerText.trim();
      const dd = dt.nextElementSibling;
      if (k && dd && dd.tagName === 'DD') pairs[k] = dd.innerText.trim();
    }
    const h1 = document.querySelector('h1')?.innerText?.trim() || '';
    let desc = '';
    const dh = [...document.querySelectorAll('h2,h3')].find((h) => /descrizione/i.test(h.innerText));
    if (dh) {
      const sec = dh.closest('section') || dh.parentElement?.parentElement;
      if (sec) desc = sec.innerText.replace(/^descrizione\s*/i, '').trim();
    }
    const agency = document.querySelector('[class*="gency"]')?.innerText?.split('\n')[0] || '';
    return { pairs, h1, desc, agency, url, areaName };
  }, { url, areaName });
}

async function scrapeDetail(page, ad) {
  const resp = await page.goto(ad.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await checkBlocked(page, resp);
  await page.waitForSelector('#__NEXT_DATA__', { timeout: 20000 }).catch(() => {});
  await humanPause(1500, 3000);
  await humanScroll(page, rand(2, 4)); // comportamento naturale + lazy-load

  const re = await page.evaluate(() => {
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      const j = JSON.parse(el.textContent);
      return j?.props?.pageProps?.detailData?.realEstate || null;
    } catch { return null; }
  });

  if (re) return mapDetail(re, ad.url, ad.area);

  log(`  ${ad.id}: JSON non disponibile, uso il DOM…`);
  const dom = await extractDetailDom(page, ad.url, ad.area);
  const num = (v) => {
    const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: ad.id, url: ad.url, area: ad.area, titolo: dom.h1,
    comune: '', provincia: '', zona: '', indirizzo: '',
    prezzo: num(dom.pairs['Prezzo']), prezzoMq: dom.pairs['Prezzo al m²'] || '',
    tipologia: dom.pairs['Tipologia'] || '', locali: num(dom.pairs['Locali']),
    camere: num(dom.pairs['Camere da letto']), bagni: num(dom.pairs['Bagni']),
    superficieMq: num(dom.pairs['Superficie']), piano: dom.pairs['Piano'] || '',
    pianoSolo: dom.pairs['Piano'] || '', pianiEdificio: dom.pairs['Piani edificio'] || '',
    ascensore: dom.pairs['Ascensore'] || '', cucina: dom.pairs['Cucina'] || '',
    arredato: dom.pairs['Arredato'] || '', balcone: dom.pairs['Balcone'] || '',
    terrazzo: dom.pairs['Terrazzo'] || '', cantina: dom.pairs['Cantina'] || '', stato: '', ape: '',
    riscaldamento: dom.pairs['Riscaldamento'] || '',
    speseCondominio: dom.pairs['Spese condominio'] || '',
    altreCaratteristiche: '', dettaglioSuperficie: '', agenzia: dom.agency,
    aggiornatoIl: '', pubblicatoIl: '', descrizione: dom.desc, foto: '',
    planimetrie: [], planimetriaUrl: '', camerePlanimetria: null, notaPlanimetria: '',
    scrapedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- filtri

// Uso non residenziale (uffici/studi A10, laboratori C3, magazzini C2…):
// il sito a volte etichetta "appartamento" immobili che sono uffici. Si guarda
// tipologia + descrizione, ma SOLO frasi che parlano dell'immobile: i contatti
// ("Ufficio TEMPOCASA…", "appuntamenti in ufficio") e i vani accessori non contano.
function detectNonResidential(ad) {
  if (/ufficio|studio|negozio|capannon|laboratorio|magazzino|deposito|commerciale/i.test(ad.tipologia || '')) {
    return 'Tipologia non residenziale';
  }
  const desc = ad.descrizione || '';
  // classificazione catastale: A/10 uffici, B (collegi/istituti), C/1 negozi, C/2 magazzini,
  // C/3 laboratori, D, E — residenziale: A/1–A/9 e A/11 (A/10 escluso)
  const catRe = /cat(?:egoria)?\.?\s*(?:catastale\s*)?[BDE]\s*\/?\s*\d+|cat(?:egoria)?\.?\s*(?:catastale\s*)?C\s*\/?\s*(?!(?:[2-9]|1[01])\b)\d+|A\s*\/\s*10\b/i;
  const phraseRe = /accatast\w*|licenziat\w*|destinazione d'uso|cambio d'uso|uso ufficio|studio professionale|propon\w*\s+(?:in vendita\s+)?(?:un\s+|ampio\s+)*ufficio|vendita\s+(?:di\s+)?(?:un\s+|ampio\s+)*ufficio|(?:questo|tale|il)\s+locale\s+commerciale|trasform\w*\s+questo\s+locale/i;
  const sentences = desc.split(/(?<=[.!?])\s+|\n+/);
  let inContacts = false;
  for (const s of sentences) {
    // il footer con i contatti dell'agenzia non descrive l'immobile
    if (/maggiori informazioni|per info|contatt\w*|appuntament|visite agli immobili|astenersi contatti/i.test(s)) inContacts = true;
    if (inContacts) continue;
    if (!catRe.test(s) && !phraseRe.test(s)) continue;
    // "vano ufficio" interno, pertinenze e singoli vani accessori (box/cantina accatastati
    // C/…, vano di deposito…) non sono l'unità principale: contano solo le frasi sul soggetto
    const accessory = /vano|box|garage|cantina|soffitta|posto auto|locale tecnico|quest[’']ultimo/i.test(s);
    const subject = /l[’']immobile|l[’']unit[àa]|appartamento|accatastat[ao]\s+(?:come\s+)?ufficio/i.test(s);
    if (accessory && !subject) continue;
    const m = s.trim().match(/.{0,60}(?:accatast\w*|licenziat\w*|destinazione d'uso|cambio d'uso|uso ufficio|studio professionale|cat(?:egoria)?\.?\s*(?:catastale\s*)?[ABCDE]\s*\/?\s*\d+|ufficio).{0,60}/i);
    return `Uso non residenziale: "${(m ? m[0] : s).trim().slice(0, 140)}…"`;
  }
  return '';
}

// Profili di ricerca (fonte di verità: requisiti-immobilare.md §2).
// BIG: ≤160k, ≥2 camere reali, ≥2 locali (bilocali solo se convertibili).
// SMA: ≤130k, esattamente 1 camera reale, ≥1 locale (anche monolocali ≥55 m²).
const PROFILES = {
  big: { label: 'BIG', maxPrezzo: 160000, minCamere: 2, maxCamere: null, minLocali: 2, bilocaliRule: true, monolocaleIsCamera: false },
  sma: { label: 'SMA', maxPrezzo: 130000, minCamere: 1, maxCamere: 1, minLocali: 1, bilocaliRule: false, monolocaleIsCamera: true },
};
const BIG_PROFILE = { ...PROFILES.big, minCamere: MIN_BEDROOMS };

function applyFilters(ad, profile = BIG_PROFILE) {
  const reasons = [];
  // Comune: il poligono di ricerca può sbordare nei comuni limitrofi
  const comune = String(ad.comune || '').trim().toLowerCase();
  if (comune && !ALLOWED_COMUNI.includes(comune)) reasons.push(`Comune non ammesso: ${ad.comune}`);
  const fuori = comuneContraddetto(ad);
  if (fuori) reasons.push(`Comune reale ${fuori}: la descrizione contraddice "${ad.comune}" (geocoding omonimo)`);
  const zonaNo = zonaEsclusa(ad);
  if (zonaNo) reasons.push(`Zona esclusa: ${zonaNo} (bassa piazzabilità per lo split)`);
  // Distanza dal centro abitato più vicino (linea d'aria)
  let centroVicino = '';
  let distanzaKm = null;
  if (ad.lat != null && ad.lon != null) {
    const near = nearestCenter(ad.lat, ad.lon);
    centroVicino = near.name;
    distanzaKm = Math.round(near.km * 10) / 10;
    if (near.km > MAX_KM) {
      reasons.push(`Troppo distante dal centro abitato: ${distanzaKm} km da ${near.name} (max ${MAX_KM} km)`);
    }
  } else if (!comune || ALLOWED_COMUNI.includes(comune)) {
    reasons.push('Coordinate non disponibili: distanza non verificabile');
  }
  const floorTxt = `${ad.piano} ${ad.pianoSolo}`.toLowerCase();
  if (/seminterr|sotterr|interrato/.test(floorTxt)) reasons.push('Seminterrato');
  const nonRes = detectNonResidential(ad);
  if (nonRes) reasons.push(nonRes);
  // nuda proprietà: spesso dichiarata solo in descrizione (la tipologia dice "intera proprietà")
  const naked = detectNudaProprieta(ad);
  if (naked) reasons.push(naked);
  const affitto = detectAffitto(ad);
  if (affitto) reasons.push(affitto);
  if (ad.prezzo != null && ad.prezzo > profile.maxPrezzo) {
    reasons.push(`Prezzo > ${profile.maxPrezzo.toLocaleString('it-IT')} €`);
  }
  if (/demolire|cattivo stato/i.test(ad.stato)) reasons.push(`Stato: ${ad.stato}`);
  // Rank di vicinanza ai POI (OpenStreetMap): filtro attivo solo se il campo
  // poi è stato calcolato (node poi.mjs); run senza POI restano invariati.
  if (ad.poi?.rank != null && ad.poi.rank < MIN_POI) {
    reasons.push(`Rank POI insufficiente: ${ad.poi.rank}/100 (minimo ${MIN_POI})`);
  }

  let convertibile = '';
  const rooms = ad.locali ?? 0;
  // Camere reali: se la planimetria è stata verificata visivamente (camerePlanimetria)
  // prevale sul dato dichiarato dall'annuncio, che può essere gonfiato.
  let bedrooms = ad.camerePlanimetria ?? ad.camere ?? 0;
  const planVerified = ad.camerePlanimetria != null;
  // SMA: in un monolocale il vano unico vale come camera da letto
  if (profile.monolocaleIsCamera && rooms === 1 && bedrooms < 1) bedrooms = 1;
  if (rooms > 0 && rooms < profile.minLocali) {
    reasons.push(`Monolocale: minimo ${profile.minLocali} locali`);
  }
  // Regola bilocali convertibili: solo per il profilo BIG
  const bilocaliRule = profile.bilocaliRule && rooms === 2;
  if (bilocaliRule) {
    const convRe = /convertibil|trasformabil|possibilit[àa]\s+(di\s+)?(ricavare|creare|realizzare|terza\s+camera|seconda\s+camera|trilocale)|ricavare\s+(una?\s+)?(seconda|terza|nuova)\s+(camera|stanza)|frazionabil|terzo\s+locale|gi[àa]\s+due\s+camere/i;
    const text = `${ad.descrizione} ${ad.altreCaratteristiche}`;
    if (bedrooms >= 2) {
      convertibile = 'Sì';
      ad.motivazioneFiltro = 'Bilocale con 2 camere da letto reali';
    } else if (convRe.test(text)) {
      convertibile = 'Sì';
      const m = text.match(convRe);
      ad.motivazioneFiltro = `Bilocale convertibile in trilocale (rilevato: "${m[0]}")`;
    } else {
      convertibile = 'No';
      reasons.push('Bilocale non convertibile in trilocale');
    }
  }
  if (bedrooms < profile.minCamere && !bilocaliRule) {
    if (planVerified) {
      reasons.push(`Planimetria: ${bedrooms} camera/e da letto reali (dichiarate ${ad.camere ?? '?'}, min ${profile.minCamere})`);
    } else {
      reasons.push(`Camere da letto: ${ad.camere ?? '?'} (< ${profile.minCamere})`);
    }
  }
  if (profile.maxCamere != null && bedrooms > profile.maxCamere) {
    const src = planVerified
      ? `Planimetria: ${bedrooms} camere da letto reali`
      : `Camere da letto: ${bedrooms}`;
    reasons.push(`${src} (${profile.label}: esattamente ${profile.maxCamere})`);
  }
  if (bedrooms < profile.minCamere && bilocaliRule && convertibile === 'Sì') {
    // bilocale convertibile ma senza 2 camere reali: tenuto, con nota
    ad.motivazioneFiltro += ` — camere dichiarate: ${ad.camere ?? '?'}`;
  }
  return {
    convertibile,
    centroVicino,
    distanzaKm,
    esito: reasons.length ? 'Escluso' : 'Selezionato',
    motivazione: reasons.join('; ') || (profile.bilocaliRule ? ad.motivazioneFiltro : '') || 'Tutti i criteri soddisfatti',
  };
}

// Doppio esito per annuncio: BIG (esito/motivazione/convertibile, invariati per
// retrocompatibilità) + SMA (esitoSma/motivazioneSma). La priorità BIG (chi è
// Selezionato BIG non compare nella vista SMA) è applicata nella webapp.
function applyProfiles(ad) {
  delete ad.motivazioneFiltro;
  const big = applyFilters(ad, BIG_PROFILE);
  const sma = applyFilters(ad, PROFILES.sma);
  return { ...big, esitoSma: sma.esito, motivazioneSma: sma.motivazione };
}

// ---------------------------------------------------------------- analisi FLIP

// Calcola ad.flip (RENO + STALE) su tutto il dataset e aggiorna lo storico
// prezzi. Va chiamata dopo applyProfiles, prima di scrivere il JSON.
function runFlipAnalysis(ads, { updateHistory = true } = {}) {
  if (updateHistory) updatePriceHistory(ads, PRICE_HISTORY_FILE);
  const storico = loadPriceHistory(PRICE_HISTORY_FILE);
  analyzeFlip(ads, { detectNonResidential, storico });
}

// Rigenera il sito statico (build-site.mjs) dal JSON indicato. Best effort:
// un errore del builder non deve far fallire lo scraping.
function rebuildSite(jsonPath) {
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'build-site.mjs'), '--resume', jsonPath], {
      stdio: 'inherit',
      cwd: __dirname,
    });
    if (r.status !== 0) log('Build sito: terminato con errori (vedi sopra).');
  } catch (e) {
    log(`Build sito saltato: ${e.message}`);
  }
}

// ---------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const jsonPath = path.join(OUTPUT_DIR, `annunci-${stamp}.json`);

  if (ENRICH && !RESUME_FILE) throw new Error('--enrich richiede --resume <json>');
  if (REBUILD_SITE || REAPPLY_FILTERS) {
    if (!RESUME_FILE) throw new Error('--rebuild-site/--reapply-filters richiede --resume <json>');
    const prev = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
    if (REAPPLY_FILTERS) {
      for (const ad of prev) {
        const before = ad.esito;
        Object.assign(ad, applyProfiles(ad));
        if (ad.esito !== before) log(`  ${ad.id}: ${before} → ${ad.esito} (${ad.motivazione})`);
      }
      runFlipAnalysis(prev);
      fs.writeFileSync(RESUME_FILE, JSON.stringify(prev, null, 2));
      log(`Filtri riapplicati a ${prev.length} annunci (JSON aggiornato, analisi FLIP inclusa).`);
    } else if (!prev.every((a) => a.flip)) {
      runFlipAnalysis(prev, { updateHistory: false });
      fs.writeFileSync(RESUME_FILE, JSON.stringify(prev, null, 2));
    }
    const sel = prev.filter((a) => a.esito === 'Selezionato').length;
    const selSma = prev.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato').length;
    const reno = prev.filter((a) => a.flip?.reno?.candidato).length;
    log(`${prev.length} annunci (${sel} selezionati BIG, ${selSma} selezionati SMA, ${reno} candidati FLIP RENO).`);
    rebuildSite(RESUME_FILE);
    return;
  }

  let context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  let page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);

  const ads = [];
  if (RESUME_FILE) {
    try {
      const prev = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
      ads.push(...prev);
      log(`Resume: ${prev.length} annunci già raccolti da ${path.basename(RESUME_FILE)}`);
    } catch (e) {
      log(`Resume non leggibile (${e.message}): parto da zero.`);
    }
  }
  const doneIds = new Set(ads.map((a) => a.id));

  // Apre la homepage; se il profilo è marcato dall'anti-bot (403/429), lo ricrea
  // vergine (le ricerche sono pubbliche: la sessione salvata non è indispensabile).
  const openHome = async () => {
    const resp = await page.goto('https://www.immobiliare.it/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && (resp.status() === 403 || resp.status() === 429)) {
      log(`Profilo bloccato (HTTP ${resp.status()}): ricreo un profilo browser vergine…`);
      await context.close();
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: HEADLESS,
        locale: 'it-IT',
        timezoneId: 'Europe/Rome',
        viewport: { width: 1366, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
      });
      page = context.pages()[0] || (await context.newPage());
      page.setDefaultTimeout(30000);
      await page.goto('https://www.immobiliare.it/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await dismissCookies(page);
  };

  // --enrich: recupera le coordinate degli annunci del JSON che ne sono privi
  if (ENRICH) {
    const missing = ads.filter((a) => a.lat == null || a.lon == null);
    log(`Enrich: ${missing.length} annunci senza coordinate su ${ads.length}`);
    try {
      await openHome();
      let i = 0;
      for (const ad of missing) {
        i++;
        log(`[${i}/${missing.length}] Coordinate annuncio ${ad.id}…`);
        try {
          await page.goto(ad.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await checkBlocked(page);
          await page.waitForSelector('#__NEXT_DATA__', { timeout: 20000 }).catch(() => {});
          const loc = await page.evaluate(() => {
            try {
              const j = JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
              const l = j.props?.pageProps?.detailData?.realEstate?.properties?.[0]?.location;
              return l ? { lat: l.latitude ?? null, lon: l.longitude ?? null } : null;
            } catch { return null; }
          });
          if (loc?.lat != null) {
            ad.lat = loc.lat;
            ad.lon = loc.lon;
            log(`  → ${ad.lat}, ${ad.lon}`);
          } else {
            log('  → coordinate non trovate');
          }
        } catch (e) {
          if (e instanceof BlockedError) { log(`STOP: ${e.message}`); break; }
          log(`  Errore: ${e.message}`);
        }
        fs.writeFileSync(RESUME_FILE, JSON.stringify(ads, null, 2)); // backup incrementale
        if (i < missing.length) await sleep(rand(5000, 10000));
      }
      for (const ad of ads) {
        Object.assign(ad, applyProfiles(ad));
      }
      runFlipAnalysis(ads, { updateHistory: false });
      fs.writeFileSync(RESUME_FILE, JSON.stringify(ads, null, 2));
      const sel = ads.filter((a) => a.esito === 'Selezionato').length;
      const selSma = ads.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato').length;
      log(`Enrich completato: ${ads.length} annunci (${sel} selezionati BIG, ${selSma} selezionati SMA). JSON + sito aggiornati.`);
      rebuildSite(RESUME_FILE);
    } finally {
      try { await context.close(); } catch { /* già chiuso */ }
    }
    return;
  }

  let browserClosed = false;
  context.on('close', () => { browserClosed = true; });
  page.on('close', () => { browserClosed = true; });
  let blocked = false;
  const save = () => {
    runFlipAnalysis(ads);
    fs.writeFileSync(jsonPath, JSON.stringify(ads, null, 2));
  };
  process.on('SIGINT', async () => {
    log('Interrotto: salvo i dati raccolti…');
    try { await save(); } catch { /* best effort */ }
    await context.close();
    process.exit(0);
  });

  try {
    await openHome();
    await humanPause(1500, 3000);

    if (LOGIN_ONLY || process.env.IMMOBILIARE_EMAIL) {
      await ensureLogin(page);
      if (LOGIN_ONLY) {
        log('Login completato: sessione salvata nel profilo. Esci.');
        return;
      }
    } else {
      log('Nessuna credenziale in env: procedo come ospite (gli annunci sono pubblici).');
      log('Per il login: imposta IMMOBILIARE_EMAIL/IMMOBILIARE_PASSWORD o usa "npm run login".');
    }

    // 1) raccolta annunci da tutte le aree (con paging)
    const areas = CUSTOM_URL
      ? [{ name: 'URL personalizzato', url: CUSTOM_URL }]
      : AREAS.filter((a) => !ONLY_AREA || a.name.toLowerCase().includes(ONLY_AREA.toLowerCase()));
    const all = new Map();
    for (const area of areas) {
      const cards = await collectArea(page, area);
      for (const c of cards) if (!all.has(c.id)) all.set(c.id, c);
      await humanPause(3000, 6000);
    }
    const targets = [...all.values()].filter((a) => !doneIds.has(a.id)).slice(0, MAX_ADS);
    log(`Annunci da visitare: ${targets.length} (già raccolti: ${doneIds.size}, max ${MAX_ADS})`);

    // 2) visita di ogni singolo annuncio
    let i = 0;
    for (const ad of targets) {
      if (browserClosed) {
        log('Browser chiuso: interrompo e salvo i dati raccolti. Usa --resume per completare.');
        break;
      }
      i++;
      log(`[${i}/${targets.length}] Annuncio ${ad.id} (${ad.area})…`);
      try {
        const detail = await scrapeDetail(page, ad);
        Object.assign(detail, applyProfiles(detail));
        ads.push(detail);
        log(`  → ${detail.titolo || '(senza titolo)'} | ${detail.prezzo ?? '?'} € | locali ${detail.locali ?? '?'} | camere ${detail.camere ?? '?'} | BIG: ${detail.esito} | SMA: ${detail.esitoSma}`);
      } catch (e) {
        if (e instanceof BlockedError) throw e;
        if (browserClosed) {
          log('Browser chiuso: interrompo e salvo i dati raccolti. Usa --resume per completare.');
          break;
        }
        log(`  Errore su ${ad.id}: ${e.message} — riprovo una volta…`);
        await humanPause(5000, 9000);
        try {
          const detail = await scrapeDetail(page, ad);
          Object.assign(detail, applyProfiles(detail));
          ads.push(detail);
        } catch (e2) {
          if (e2 instanceof BlockedError) throw e2;
          if (browserClosed) {
            log('Browser chiuso: interrompo e salvo i dati raccolti. Usa --resume per completare.');
            break;
          }
          log(`  Annuncio ${ad.id} saltato: ${e2.message}`);
        }
      }
      fs.writeFileSync(jsonPath, JSON.stringify(ads, null, 2)); // backup incrementale
      if (i < targets.length) await sleep(rand(5000, 10000)); // ritmo umano
    }
  } catch (e) {
    if (e instanceof BlockedError) {
      blocked = true;
      log(`STOP: ${e.message}. Nessun aggiramento delle protezioni: salvo i dati parziali.`);
    } else {
      log('Errore inatteso:', e);
    }
  } finally {
    if (ads.length) {
      await save();
      const sel = ads.filter((a) => a.esito === 'Selezionato').length;
      const selSma = ads.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato').length;
      const reno = ads.filter((a) => a.flip?.reno?.candidato).length;
      log(`Completato: ${ads.length} annunci (${sel} selezionati BIG, ${selSma} selezionati SMA, ${reno} candidati FLIP RENO).`);
      log(`JSON:  ${jsonPath}`);
      rebuildSite(jsonPath);
    } else {
      log('Nessun dato raccolto.');
    }
    try { await context.close(); } catch { /* già chiuso */ }
    if (blocked) process.exitCode = 2;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });