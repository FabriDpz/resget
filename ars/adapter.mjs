// Adattatore arsimmobiliare.com (Directorist) — Playwright headed.
// BUG NOTI (verificati dal parent):
//   - address + price insieme → 0 risultati (bug Directorist del sito).
//   - address matcha anche la DESCRIZIONE → falsi positivi (comuni fuori target).
// Strategia (due query separate, MAI address+price insieme):
//   1) /ricerca/?directory_type=immobili-vendita&price[1]=160000&in_cat=41
//      &custom_field[custom-number]=40-1000  (prezzo + Appartamento + mq≥40
//      server-side, audit 23/11; portfolio ≤160k oggi vuoto → minLinks 0 legittimo)
//   2) /ricerca/?directory_type=immobili-vendita&address=Pianoro  (1 villa oggi)
// Filtri nativi verificati (audit 23/11): in_cat 41=Appartamento,
// custom_field[custom-number]=MIN-MAX (Superficie mq),
// custom_field[custom-radio-2]=Da ristrutturare (stato).
// Paginazione &paged=N. Dettaglio /immobili/<slug>/ DOM: il ld+json è
// RealEstateAgent dell'AGENZIA, non dell'annuncio → ignorato.
// Filtri client-side sul dettaglio: comune whitelist, prezzo ≤160k, mq ≥40.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://arsimmobiliare.com';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const WHITELIST = ['San Lazzaro di Savena', 'Pianoro', 'Bologna'];
const QUERIES = [
  { url: `${BASE}/ricerca/?directory_type=immobili-vendita&price%5B1%5D=160000&in_cat=41&custom_field%5Bcustom-number%5D=40-1000`, area: 'Bologna', label: 'prezzo≤160k+appartamento+mq≥40' },
  { url: `${BASE}/ricerca/?directory_type=immobili-vendita&address=Pianoro`, area: 'Pianoro', label: 'address=Pianoro' },
];

// Contesto pagina: link annuncio + eventuale prezzo esposto nella card.
function extractCards() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/immobili/"]')) {
    let href;
    try { href = new URL(a.getAttribute('href'), location.href).href.split('#')[0].split('?')[0]; } catch { continue; }
    if (!/\/immobili\/[^/]+\/?$/.test(href) || seen.has(href)) continue;
    seen.add(href);
    let host = a;
    for (let i = 0; i < 6 && host; i++) {
      if (/directorist|card|listing|grid/i.test(String(host.className))) break;
      host = host.parentElement;
    }
    const text = norm(host && host.innerText).slice(0, 500);
    const priceEl = host && host.querySelector('[class*="price"]');
    out.push({ href, price: norm(priceEl && priceEl.textContent), text });
  }
  return out;
}

// Contesto pagina: dettaglio Directorist (label/valore + testo).
function extractDetail() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const body = norm(document.body && document.body.innerText).slice(0, 30000);
  const title = norm((document.querySelector('h1') || {}).textContent);
  const pairs = {};
  const addPair = (k, v) => {
    k = norm(k).toLowerCase().replace(/[:\s]+$/, '');
    v = norm(v);
    if (k && v && k.length <= 40 && v.length <= 150 && !pairs[k]) pairs[k] = v;
  };
  document.querySelectorAll('li, tr, dt, .directorist-custom-field, [class*="single-listing"] [class*="info"]').forEach((el) => {
    if (el.tagName === 'TR' && el.cells && el.cells.length === 2) { addPair(el.cells[0].textContent, el.cells[1].textContent); return; }
    if (el.tagName === 'DT' && el.nextElementSibling && el.nextElementSibling.tagName === 'DD') { addPair(el.textContent, el.nextElementSibling.textContent); return; }
    const lab = el.querySelector('[class*="label"], strong, b');
    const val = el.querySelector('[class*="value"], [class*="content"]');
    if (lab && val && lab !== val) { addPair(lab.textContent, val.textContent); return; }
    if (el.children.length > 4) return;
    const m = norm(el.textContent).match(/^([^:]{2,40}):\s*(.{1,120})$/);
    if (m) addPair(m[1], m[2]);
  });
  const priceEl = document.querySelector('[class*="price"]');
  const price = norm(priceEl && priceEl.textContent);
  const addrEl = document.querySelector('[class*="address"], address');
  const addr = norm(addrEl && addrEl.textContent);
  const descEl = document.querySelector('[class*="description"], [class*="content-area"], .directorist-details-content');
  const desc = norm(descEl && descEl.textContent).slice(0, 6000);
  const og = document.querySelector('meta[property="og:image"]');
  const img = document.querySelector('[class*="gallery"] img, [class*="slider"] img');
  const foto = (og && og.content) || (img && img.src) || '';
  return { title, body, price, addr, pairs, desc, foto };
}

function pairVal(pairs, re) {
  for (const [k, v] of Object.entries(pairs || {})) if (re.test(k)) return v;
  return '';
}
function parsePrezzo(txt) {
  const m = String(txt || '').match(/(\d{1,3}(?:\.\d{3})+|\d{4,})/);
  return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
}
function parseMq(txt) {
  const m = String(txt || '').match(/(\d{1,5})\s*(?:m²|m2|mq|metri quadri)\b/i)
    || String(txt || '').match(/(?:superficie|metri quadri|dimensioni|mq)\D{0,15}(\d{1,5})/i);
  return m ? parseInt(m[1], 10) : null;
}
function firstNum(txt) {
  const m = String(txt || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}
function comuneFromText(t) {
  const s = String(t || '');
  for (const c of WHITELIST) {
    if (new RegExp('\\b' + c.replace(/ /g, '\\s+') + '\\b', 'i').test(s)) return c;
  }
  return '';
}
function isNonResidential(title, tipo) {
  const t = `${tipo || ''} ${title || ''}`;
  if (/appartamento|villa|casa|attico|mansarda|loft|mono|bilocale|trilocale|quadrilocale|plurilocale|rustico|casale|porzione/i.test(t)) return false;
  return /\b(box|garage|cantina|posto\s*auto|magazzino|negozio|ufficio|capannone|terreno|locale\s+commerciale)\b/i.test(t);
}

export default {
  id: 'ars',
  name: 'ARS Immobiliare',

  probeChecks: {
    listingUrl: `${BASE}/ricerca/?directory_type=immobili-vendita&address=Pianoro`,
    cardSelectors: ['a[href*="/immobili/"]'],
    linkPattern: '\\/immobili\\/[^/]+\\/?$',
    minLinks: 1,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const q of QUERIES) {
      log(`[ars] Query ${q.label}: ${q.url}`);
      let pageNum = 1;
      const maxPages = 8;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const url = pageNum === 1 ? q.url : `${q.url}&paged=${pageNum}`;
        const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
        await dismissCookies(page);
        await humanPause(2200, 3800);
        await checkBlocked(page, resp);
        const rows = await page.evaluate(extractCards);
        let added = 0;
        let skipped = 0;
        for (const r of rows) {
          const id = r.href.match(/\/immobili\/([^/]+)\/?$/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          // Prezzo dalla card se esposto: risparmia visite fuori budget.
          const p = parsePrezzo(r.price);
          if (p != null && p > MAX_PREZZO) { skipped++; continue; }
          cards.push({ id, url: r.href, area: q.area, prezzoCard: p });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[ars] ${q.label} pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} oltre budget)`);
        if (rows.length === 0 || added === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => /[?&]paged=/.test(a.href) && a.href.includes(`paged=${n + 1}`)), pageNum);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(2500, 4500));
      }
      await sleep(rand(2000, 4000));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 18000 });
    await dismissCookies(page);
    await humanPause(2000, 3500);
    await checkBlocked(page, resp);
    const data = await page.evaluate(extractDetail);
    const p = data.pairs;
    const titolo = data.title || 'Immobile in vendita';
    const tipologia = pairVal(p, /tipologia|categoria|tipo/) || '';
    if (isNonResidential(titolo, tipologia)) {
      log(`[ars] non residenziale (${tipologia || titolo}): scarto ${card.id}`);
      return null;
    }
    const prezzo = parsePrezzo(pairVal(p, /^prezzo$|^price$/)) ?? parsePrezzo(data.price) ?? card.prezzoCard ?? null;
    const mq = parseMq(pairVal(p, /superficie|metri|dimensione|mq|area|size/)) ?? parseMq(`${titolo} ${data.body}`);
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[ars] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    // address matcha la descrizione (falsi positivi): il comune va confermato
    // da indirizzo/campo città/titolo, NON dalla descrizione libera.
    const comuneRaw = pairVal(p, /^comune$|^città$|^city$|^località$|^indirizzo$|^address$/);
    const comune = comuneFromText(comuneRaw) || comuneFromText(data.addr) || comuneFromText(titolo);
    if (!comune) {
      log(`[ars] comune non confermato in whitelist (${(comuneRaw || data.addr || titolo).slice(0, 60)}): scarto ${card.id}`);
      return null;
    }
    const desc = data.desc || '';
    const locali = firstNum(pairVal(p, /locali|vani|rooms/));
    const camere = firstNum(pairVal(p, /camere|letto|bedroom/)) ?? bedroomsFromText(`${titolo} ${desc}`, locali);
    const bagni = firstNum(pairVal(p, /bagn|bath/));
    const piano = pairVal(p, /^piano$|floor/);
    const ape = (pairVal(p, /classe\s*energetica|ape|ipe|energy/).match(/\b([A-G][1-4]?)\b/) || data.body.match(/classe\s*energetica[:\s]*([A-G][1-4]?)\b/i) || [])[1] || '';
    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo,
      comune,
      provincia: 'BO',
      zona: pairVal(p, /^zona$|^quartiere$/),
      indirizzo: data.addr || comuneRaw || '',
      prezzo,
      tipologia: tipologia || 'Appartamento',
      locali,
      camere,
      bagni,
      superficieMq: mq,
      piano,
      ascensore: /ascensore/i.test(data.body) ? (/senza ascensore|no ascensore/i.test(data.body) ? 'No' : 'Sì') : '',
      cucina: pairVal(p, /cucina|kitchen/),
      balcone: /balcon/i.test(`${pairVal(p, /balcon/)} ${desc}`) ? 'Sì' : '',
      cantina: /cantina/i.test(`${pairVal(p, /cantina/)} ${desc}`) ? 'Sì' : '',
      stato: mapStato(pairVal(p, /stato|condizioni|condition/) || desc),
      ape: ape.toUpperCase(),
      riscaldamento: pairVal(p, /riscaldament|heating/),
      agenzia: 'ARS Immobiliare',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};