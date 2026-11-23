// Adattatore paologiacopini.it (Gestim) — Playwright headed.
// Listing verificata dal parent:
//   /p/gli-immobili.html?cf=yes&Motivazione[]=1&Tipologia[]=1&Comune=764
//   (vendita appartamenti Bologna; 764=Bologna; Pianoro/San Lazzaro NON trattati).
//   &Prezzo_a=160000 funziona MA oggi 0 appartamenti sotto soglia → si usa la query
//   SENZA Prezzo_a (3 annunci con Tipologia) e si filtra client-side sul dettaglio,
//   così il probe vede link reali e il radar resta utile se i prezzi scendono.
//   Nessun campo mq nel form → mq client-side.
// Card: li.listing, div.prezzo_full-grid, div.codice.
// Dettaglio: /i/<id>--vendita-<tipo>-<comune>.html DOM.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://paologiacopini.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const WHITELIST = ['San Lazzaro di Savena', 'Pianoro', 'Bologna'];
const LISTING_URL = `${BASE}/p/gli-immobili.html?cf=yes&Motivazione%5B%5D=1&Tipologia%5B%5D=1&Comune=764`;

// Contesto pagina: card Gestim li.listing.
function extractCards() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  const items = document.querySelectorAll('li.listing');
  const hosts = items.length ? [...items] : [...document.querySelectorAll('a[href*="/i/"]')];
  for (const host of hosts) {
    const a = host.tagName === 'A' ? host : host.querySelector('a[href*="/i/"]');
    if (!a) continue;
    let href;
    try { href = new URL(a.getAttribute('href'), location.href).href.split('#')[0].split('?')[0]; } catch { continue; }
    if (!/\/i\/\d+--/.test(href) || seen.has(href)) continue;
    seen.add(href);
    const price = norm((host.querySelector('div.prezzo_full-grid, [class*="prezzo"]') || {}).textContent);
    const cod = norm((host.querySelector('div.codice, [class*="codice"]') || {}).textContent);
    const title = norm((host.querySelector('h2, h3, h4, [class*="titolo"]') || {}).textContent);
    const text = norm(host.innerText).slice(0, 500);
    out.push({ href, price, cod, title, text });
  }
  return out;
}

// Contesto pagina: dettaglio Gestim.
function extractDetail() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const body = norm(document.body && document.body.innerText).slice(0, 30000);
  const title = norm((document.querySelector('h1') || {}).textContent);
  const pairs = {};
  const addPair = (k, v) => {
    k = norm(k).toLowerCase().replace(/[:\s]+$/, '');
    v = norm(v);
    if (k && v && k.length <= 45 && v.length <= 150 && !pairs[k]) pairs[k] = v;
  };
  document.querySelectorAll('li, tr, dt, [class*="caratteristic"] div, [class*="dettaglio"] div').forEach((el) => {
    if (el.tagName === 'TR' && el.cells && el.cells.length === 2) { addPair(el.cells[0].textContent, el.cells[1].textContent); return; }
    if (el.tagName === 'DT' && el.nextElementSibling && el.nextElementSibling.tagName === 'DD') { addPair(el.textContent, el.nextElementSibling.textContent); return; }
    const lab = el.querySelector('strong, b, [class*="label"]');
    if (lab) {
      const full = norm(el.textContent);
      const labTxt = norm(lab.textContent);
      const v = full.startsWith(labTxt) ? full.slice(labTxt.length).replace(/^[:\s]+/, '') : '';
      if (v) { addPair(labTxt, v); return; }
    }
    if (el.children.length > 4) return;
    const m = norm(el.textContent).match(/^([^:]{2,45}):\s*(.{1,120})$/);
    if (m) addPair(m[1], m[2]);
  });
  const price = norm((document.querySelector('[class*="prezzo"]') || {}).textContent);
  const addr = norm((document.querySelector('[class*="indirizzo"], address, [class*="address"]') || {}).textContent);
  const descEl = document.querySelector('[class*="descrizione"], [class*="description"]');
  const desc = norm(descEl && descEl.textContent).slice(0, 6000);
  const og = document.querySelector('meta[property="og:image"]');
  const img = document.querySelector('[class*="gallery"] img, [class*="slider"] img, [class*="foto"] img');
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
    || String(txt || '').match(/(?:superficie|metri quadri|dimensioni|mq|commerciali)\D{0,15}(\d{1,5})/i);
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
  id: 'giacopini',
  name: 'Paolo Giacopini',

  probeChecks: {
    listingUrl: LISTING_URL,
    cardSelectors: ['li.listing', 'a[href*="/i/"]'],
    linkPattern: '\\/i\\/\\d+--',
    minLinks: 1,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    log(`[giacopini] Vendita appartamenti Bologna: ${LISTING_URL}`);
    let pageNum = 1;
    const maxPages = 6;
    while (pageNum <= maxPages && cards.length < maxAds) {
      const url = pageNum === 1 ? LISTING_URL : `${LISTING_URL}&page=${pageNum}`;
      const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
      await dismissCookies(page);
      await humanPause(2200, 3800);
      await checkBlocked(page, resp);
      const rows = await page.evaluate(extractCards);
      let added = 0;
      let skipped = 0;
      for (const r of rows) {
        const id = r.href.match(/\/i\/(\d+)--/)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const p = parsePrezzo(r.price);
        if (p != null && p > MAX_PREZZO) { skipped++; continue; }
        if (isNonResidential(r.title, r.text)) { skipped++; continue; }
        cards.push({ id, url: r.href, area: 'Bologna', prezzoCard: p, codice: r.cod });
        added++;
        if (cards.length >= maxAds) break;
      }
      log(`[giacopini] pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} oltre budget)`);
      if (rows.length === 0 || added === 0) break;
      const hasNext = await page.evaluate((n) =>
        [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`page=${n + 1}`)), pageNum);
      if (!hasNext) break;
      pageNum++;
      await sleep(rand(2500, 4500));
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
    const tipologia = pairVal(p, /tipologia|categoria|tipo/) || 'Appartamento';
    if (isNonResidential(titolo, tipologia)) {
      log(`[giacopini] non residenziale (${tipologia || titolo}): scarto ${card.id}`);
      return null;
    }
    const prezzo = parsePrezzo(pairVal(p, /^prezzo$|^price$/)) ?? parsePrezzo(data.price) ?? card.prezzoCard ?? null;
    const mq = parseMq(pairVal(p, /superficie|metri|dimensione|mq|area/)) ?? parseMq(`${titolo} ${data.body}`);
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[giacopini] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const comuneRaw = pairVal(p, /^comune$|^città$|^city$/);
    const comune = comuneFromText(comuneRaw) || comuneFromText(data.addr) || comuneFromText(titolo) || comuneFromText(card.url) || card.area;
    if (comuneRaw && !comuneFromText(comuneRaw)) {
      log(`[giacopini] comune fuori whitelist (${comuneRaw}): scarto ${card.id}`);
      return null;
    }
    const desc = data.desc || '';
    const locali = firstNum(pairVal(p, /locali|vani/));
    const camere = firstNum(pairVal(p, /camere|letto/)) ?? bedroomsFromText(`${titolo} ${desc}`, locali);
    const bagni = firstNum(pairVal(p, /bagn/));
    const piano = pairVal(p, /^piano$/);
    const ape = (pairVal(p, /classe\s*energetica|ape|ipe|energy/).match(/\b([A-G][1-4]?)\b/) || data.body.match(/classe\s*energetica[:\s]*([A-G][1-4]?)\b/i) || [])[1] || '';
    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo,
      comune,
      provincia: 'BO',
      zona: pairVal(p, /^zona$|^quartiere$/),
      indirizzo: data.addr || '',
      prezzo,
      tipologia,
      locali,
      camere,
      bagni,
      superficieMq: mq,
      piano,
      ascensore: /ascensore/i.test(data.body) ? (/senza ascensore|no ascensore/i.test(data.body) ? 'No' : 'Sì') : '',
      cucina: pairVal(p, /cucina/),
      balcone: /balcon/i.test(`${pairVal(p, /balcon/)} ${desc}`) ? 'Sì' : '',
      cantina: /cantina/i.test(`${pairVal(p, /cantina/)} ${desc}`) ? 'Sì' : '',
      stato: mapStato(pairVal(p, /^stato$|^condizioni$/) || (desc.match(/\b(da ristrutturare|ristrutturato|buono stato|abitabile|nuovo|pari al nuovo)\b/i) || [])[1] || ''),
      ape: ape.toUpperCase(),
      riscaldamento: pairVal(p, /riscaldament/),
      agenzia: 'Paolo Giacopini',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};