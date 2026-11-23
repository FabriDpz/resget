// Adattatore limmobiliarebologna.it (RealHomes) — Playwright headed.
// Listing verificata dal parent:
//   /ricerca-immobili/?status=vendita&location=bologna  (4 annunci)
//   NON aggiungere max-price: a ≤160k in zona restano solo posti auto.
//   location=pianoro / san-lazzaro-di-savena → 0 (non interrogarli).
// ⚠️ Il portfolio globale include BOLZANO: filtro comune whitelist obbligatorio.
// Card: span.price ins.property-current-price, p.property-address.
// Dettaglio /property/<slug>/<slug>/ DOM (nessun ld+json).
// Filtri client-side sul dettaglio: prezzo ≤160k, mq ≥40, comune whitelist.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://limmobiliarebologna.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const WHITELIST = ['San Lazzaro di Savena', 'Pianoro', 'Bologna'];
const LISTING_URL = `${BASE}/ricerca-immobili/?status=vendita&location=bologna`;

// Contesto pagina: card RealHomes.
function extractCards() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/property/"]')) {
    let href;
    try { href = new URL(a.getAttribute('href'), location.href).href.split('#')[0].split('?')[0]; } catch { continue; }
    if (!/\/property\//.test(href) || seen.has(href)) continue;
    seen.add(href);
    let host = a;
    for (let i = 0; i < 7 && host; i++) {
      if (/property-item|article|card|listing/i.test(String(host.className)) || host.tagName === 'ARTICLE') break;
      host = host.parentElement;
    }
    const price = norm((host && host.querySelector('span.price ins.property-current-price, span.price, .property-current-price') || {}).textContent);
    const addr = norm((host && host.querySelector('p.property-address, .property-address') || {}).textContent);
    const title = norm((host && host.querySelector('h2, h3, h4, .property-title') || {}).textContent);
    const text = norm(host && host.innerText).slice(0, 500);
    out.push({ href, price, addr, title, text });
  }
  return out;
}

// Contesto pagina: dettaglio RealHomes (property-meta label/valore + testo).
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
  // RealHomes: span con strong label + valore, li della property-meta, tabelle.
  document.querySelectorAll('.property-meta li, .property-meta span, li, tr, dt, [class*="detail"] span').forEach((el) => {
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
  const price = norm((document.querySelector('span.price ins.property-current-price, span.price, .property-price') || {}).textContent);
  const addr = norm((document.querySelector('p.property-address, .property-address, address') || {}).textContent);
  const descEl = document.querySelector('.property-description, [class*="description"], #property-description');
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
    || String(txt || '').match(/(?:superficie|metri quadri|dimensioni|mq|area)\D{0,15}(\d{1,5})/i);
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
  id: 'limmobiliare',
  name: "L'Immobiliare",

  probeChecks: {
    listingUrl: LISTING_URL,
    cardSelectors: ['a[href*="/property/"]', 'span.price'],
    linkPattern: '\\/property\\/[^/]+\\/',
    minLinks: 1,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    log(`[limmobiliare] Area Bologna: ${LISTING_URL}`);
    let pageNum = 1;
    const maxPages = 6;
    while (pageNum <= maxPages && cards.length < maxAds) {
      const url = pageNum === 1 ? LISTING_URL : `${LISTING_URL}&paged=${pageNum}`;
      const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
      await dismissCookies(page);
      await humanPause(2200, 3800);
      await checkBlocked(page, resp);
      const rows = await page.evaluate(extractCards);
      let added = 0;
      let skipped = 0;
      for (const r of rows) {
        const id = r.href.match(/\/property\/([^/]+)/)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const p = parsePrezzo(r.price);
        if (p != null && p > MAX_PREZZO) { skipped++; continue; }
        if (isNonResidential(r.title, r.text)) { skipped++; continue; }
        // Bolzano e altri comuni fuori target nel portfolio: scarto se l'indirizzo
        // della card è esplicito e non contiene un comune whitelist.
        const comune = comuneFromText(`${r.addr} ${r.title}`);
        if ((r.addr || r.title) && !comune) { skipped++; continue; }
        cards.push({ id, url: r.href, area: comune || 'Bologna', prezzoCard: p });
        added++;
        if (cards.length >= maxAds) break;
      }
      log(`[limmobiliare] pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} scartate da card)`);
      if (rows.length === 0 || added === 0) break;
      const hasNext = await page.evaluate((n) =>
        [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`paged=${n + 1}`)), pageNum);
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
    const tipologia = pairVal(p, /tipologia|property type|tipo/) || '';
    if (isNonResidential(titolo, tipologia)) {
      log(`[limmobiliare] non residenziale (${tipologia || titolo}): scarto ${card.id}`);
      return null;
    }
    const prezzo = parsePrezzo(pairVal(p, /^prezzo$|^price$/)) ?? parsePrezzo(data.price) ?? card.prezzoCard ?? null;
    // RealHomes espone "Area 70 MQ" (senza unità attaccata al numero): parseMq non lo vede.
    const mq = parseMq(pairVal(p, /superficie|metri|dimensione|mq|area|size/))
      ?? firstNum((data.body.match(/\bArea\s+(\d{1,5})\s*(?:MQ|m²|m2)?\b/i) || [])[1])
      ?? parseMq(`${titolo} ${data.body}`);
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[limmobiliare] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const comuneRaw = pairVal(p, /^comune$|^città$|^city$/);
    const comune = comuneFromText(comuneRaw) || comuneFromText(data.addr) || comuneFromText(titolo) || comuneFromText(card.area);
    if (!comune) {
      log(`[limmobiliare] comune fuori whitelist (${(comuneRaw || data.addr || titolo).slice(0, 60)}): scarto ${card.id}`);
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
      indirizzo: data.addr || '',
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
      stato: mapStato(pairVal(p, /^stato$|^condizioni$/) || (desc.match(/\b(da ristrutturare|ristrutturato|buono stato|abitabile|nuovo|pari al nuovo)\b/i) || [])[1] || ''),
      ape: ape.toUpperCase(),
      riscaldamento: pairVal(p, /riscaldament|heating/),
      agenzia: "L'Immobiliare",
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};