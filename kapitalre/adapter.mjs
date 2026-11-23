// Adattatore immobiliarekapitalre.it (JetSmartFilters/JetEngine) — Playwright headed.
// Grammatica verificata dal parent:
//   /vendita/?jsf=jet-engine:immobili&tax=comune:<ID>&meta=_immobili_prezzo:0,160000
//   Bologna=204 (3 risultati con meta prezzo), Pianoro=18, San Lazzaro=218.
// BUG NOTI:
//   - tax≠204 + meta → sempre 0 risultati.
//   - meta prezzo + superficie insieme → 0.
//   - pagenum con meta → 0.
// Strategia:
//   Bologna → tax=204 + meta prezzo (3 annunci, 1 pagina, niente paginazione).
//   Pianoro/San Lazzaro → SOLO tax, paginazione &pagenum=N (10/pagina, max 6 pagine),
//   filtro prezzo CLIENT-SIDE dalle CARD (le card espongono il prezzo) prima del dettaglio.
// Dettaglio /immobili/<codice>/ (t####/xt###/ct###) DOM.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://immobiliarekapitalre.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const WHITELIST = ['San Lazzaro di Savena', 'Pianoro', 'Bologna'];
const JSF = 'jsf=jet-engine:immobili';
const QUERIES = [
  { area: 'Bologna', url: `${BASE}/vendita/?${JSF}&tax=comune:204&meta=_immobili_prezzo:0,160000`, paginate: false, maxPages: 1 },
  { area: 'Pianoro', url: `${BASE}/vendita/?${JSF}&tax=comune:18`, paginate: true, maxPages: 6 },
  { area: 'San Lazzaro di Savena', url: `${BASE}/vendita/?${JSF}&tax=comune:218`, paginate: true, maxPages: 6 },
];
const LINK_RE = /\/immobili\/[a-z]*t?\d+\/?$/;

// Contesto pagina: card JetEngine con prezzo (e mq se esposti).
function extractCards() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/immobili/"]')) {
    let href;
    try { href = new URL(a.getAttribute('href'), location.href).href.split('#')[0].split('?')[0]; } catch { continue; }
    if (!/\/immobili\/[a-z]*t?\d+\/?$/.test(href) || seen.has(href)) continue;
    seen.add(href);
    let host = a;
    for (let i = 0; i < 7 && host; i++) {
      if (/jet-listing|jet-engine|card|listing|item|post/i.test(String(host.className))) break;
      host = host.parentElement;
    }
    const text = norm(host && host.innerText).slice(0, 600);
    const priceEl = host && host.querySelector('[class*="price"], [class*="prezzo"]');
    out.push({ href, price: norm(priceEl && priceEl.textContent), text });
  }
  return out;
}

// Contesto pagina: dettaglio DOM.
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
  document.querySelectorAll('li, tr, dt, [class*="jet-listing-dynamic-field"]').forEach((el) => {
    if (el.tagName === 'TR' && el.cells && el.cells.length === 2) { addPair(el.cells[0].textContent, el.cells[1].textContent); return; }
    if (el.tagName === 'DT' && el.nextElementSibling && el.nextElementSibling.tagName === 'DD') { addPair(el.textContent, el.nextElementSibling.textContent); return; }
    const lab = el.querySelector('[class*="label"], strong, b');
    const val = el.querySelector('[class*="value"], [class*="content"]');
    if (lab && val && lab !== val) { addPair(lab.textContent, val.textContent); return; }
    if (el.children.length > 4) return;
    const m = norm(el.textContent).match(/^([^:]{2,40}):\s*(.{1,120})$/);
    if (m) addPair(m[1], m[2]);
  });
  const priceEl = document.querySelector('[class*="price"], [class*="prezzo"]');
  const price = norm(priceEl && priceEl.textContent);
  const addrEl = document.querySelector('[class*="address"], address, [class*="indirizzo"]');
  const addr = norm(addrEl && addrEl.textContent);
  const descEl = document.querySelector('[class*="description"], [class*="descrizione"], .elementor-widget-theme-post-content');
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
function parsePrezzoCard(txt) {
  // Card: "€ 145.000" o "145.000 €" — evita codici annuncio (t1234) e mq.
  const m = String(txt || '').match(/(?:€|EUR)\s*([\d.]{4,})|([\d.]{5,})\s*(?:€|EUR)/i);
  return m ? parseInt((m[1] || m[2]).replace(/\./g, ''), 10) : null;
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
  return /\b(box|garage|cantina|posto\s*auto|magazzino|negozio|ufficio|capannone|terreno|locale\s+commerciale|chiosco|bar\/|licenza|attivita|attività|cedesi|cede)\b/i.test(t);
}
//_xt### = attività commerciali (verificato: xt307 era un chiosco bar); ct### = cantine/box.
function isCommercialCode(id) { return /^(xt|ct)\d+$/i.test(String(id || '')); }

export default {
  id: 'kapitalre',
  name: 'KapitalRE',

  probeChecks: {
    listingUrl: `${BASE}/vendita/?${JSF}&tax=comune:204&meta=_immobili_prezzo:0,160000`,
    cardSelectors: ['a[href*="/immobili/"]'],
    linkPattern: '\\/immobili\\/[a-z]*t?\\d+\\/?$',
    minLinks: 1,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const q of QUERIES) {
      log(`[kapitalre] Area ${q.area}: ${q.url}`);
      let pageNum = 1;
      while (pageNum <= q.maxPages && cards.length < maxAds) {
        const url = pageNum === 1 ? q.url : `${q.url}&pagenum=${pageNum}`;
        const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
        await dismissCookies(page);
        await humanPause(2200, 3800);
        await checkBlocked(page, resp);
        const rows = await page.evaluate(extractCards);
        let added = 0;
        let skipped = 0;
        for (const r of rows) {
          const id = r.href.match(/\/immobili\/([a-z]*t?\d+)\/?$/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (isCommercialCode(id)) { skipped++; continue; } // xt=attività, ct=cantine/box
          // Filtro prezzo dalla CARD (Pianoro/San Lazzaro senza meta): non sprecare visite.
          const p = parsePrezzoCard(r.price) ?? parsePrezzoCard(r.text);
          if (p != null && p > MAX_PREZZO) { skipped++; continue; }
          if (isNonResidential(r.text, '')) { skipped++; continue; }
          const mq = parseMq(r.text);
          if (mq != null && mq < MIN_MQ) { skipped++; continue; }
          cards.push({ id, url: r.href, area: q.area, prezzoCard: p, mqCard: mq });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[kapitalre] ${q.area} pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} scartate da card)`);
        if (rows.length === 0) break;
        if (!q.paginate) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`pagenum=${n + 1}`)), pageNum);
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
    if (isCommercialCode(card.id) || isNonResidential(titolo, tipologia) || isNonResidential(data.desc.slice(0, 300), '')) {
      log(`[kapitalre] non residenziale (${tipologia || titolo.slice(0, 60)}): scarto ${card.id}`);
      return null;
    }
    const prezzo = parsePrezzo(pairVal(p, /^prezzo$|^price$/)) ?? parsePrezzoCard(data.price) ?? card.prezzoCard ?? null;
    const mq = parseMq(pairVal(p, /superficie|metri|dimensione|mq|area/)) ?? card.mqCard ?? parseMq(`${titolo} ${data.body}`);
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[kapitalre] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const comuneRaw = pairVal(p, /^comune$|^città$|^city$|^località$/);
    const comune = comuneFromText(comuneRaw) || comuneFromText(data.addr) || comuneFromText(titolo) || card.area;
    if (comuneRaw && !comuneFromText(comuneRaw)) {
      log(`[kapitalre] comune fuori whitelist (${comuneRaw}): scarto ${card.id}`);
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
      stato: mapStato(pairVal(p, /^stato$|^stato immobile$|^condizioni$/) || (desc.match(/\b(da ristrutturare|ristrutturato|buono stato|abitabile|nuovo|pari al nuovo)\b/i) || [])[1] || ''),
      ape: ape.toUpperCase(),
      riscaldamento: pairVal(p, /riscaldament|heating/),
      agenzia: 'KapitalRE',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};