// Adattatore vivacasaimmobiliare.it (Houzez) — Playwright headed.
// RICOGNIZIONE LIVE 22/11 (corregge i parametri del brief):
//   - /ricerca-avanzata/?status[]=vendita&…&max-price=160000/200000 → "0 Result Found":
//     i link /immobile/ residui sono widget "IMMOBILI RECENTI" (laterali), NON risultati.
//   - La pagina "IN VENDITA" del menu è /immobili-in-vendita/ (8 annunci, pagina unica):
//     card .item-listing-wrap con prezzo li.item-price, titolo, indirizzo, mq, tipologia.
// Strategia: listing /immobili-in-vendita/ + filtri CLIENT-SIDE sulle card
//   (prezzo ≤160k, tipologia residenziale, comune whitelist dall'indirizzo della card),
//   poi conferma prezzo/mq/comune sul dettaglio (DOM, nessun ld+json utile).
// Il portfolio include Budrio/Zola Predosa/Castenaso (fuori whitelist → scarto in card).

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.vivacasaimmobiliare.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const WHITELIST = ['San Lazzaro di Savena', 'Pianoro'];
// Bologna va DOPO gli altri e NON deve matchare "provincia di Bologna" negli indirizzi completi.
const LISTING_URL = `${BASE}/immobili-in-vendita/`;

// Eseguita nel contesto pagina: card Houzez della pagina IN VENDITA.
function extractCards() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('.item-listing-wrap')].map((w) => {
    const a = w.querySelector('a[href*="/immobile/"]');
    const href = a ? a.href.split('#')[0].split('?')[0] : '';
    const price = norm((w.querySelector('li.item-price') || {}).textContent);
    const title = norm((w.querySelector('h2, h3, h4, .item-title') || {}).textContent);
    const text = norm(w.innerText);
    const addrM = text.match(/([A-ZÀ-Ü0-9][^]{5,160}?,\s*Italia,?\s*\d{5})/) || text.match(/(Via [^]{5,140}?Italia)/);
    const mqM = text.match(/(\d{1,5})\s*m²/);
    const tipoM = text.match(/m²\s+([A-ZÀ-Ü /]{3,40}?)\s+Dettagli/);
    return { href, price, title, addr: addrM ? norm(addrM[1]) : '', mq: mqM ? parseInt(mqM[1], 10) : null, tipo: tipoM ? norm(tipoM[1]) : '', text: text.slice(0, 400) };
  }).filter((c) => c.href);
}

// Eseguita nel contesto pagina: dettaglio DOM (coppie label/valore della sezione DETTAGLI).
function extractDetail() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const body = norm(document.body && document.body.innerText).slice(0, 30000);
  const title = norm((document.querySelector('h1') || {}).textContent);
  const pairs = {};
  document.querySelectorAll('li, tr, dt').forEach((el) => {
    if (el.children.length > 4) return;
    const m = norm(el.textContent).match(/^([^:]{2,40}):\s*(.{1,120})$/);
    if (m) {
      const k = m[1].toLowerCase().trim();
      if (!pairs[k]) pairs[k] = m[2].trim();
    }
  });
  const priceEl = document.querySelector('.property-title-price-wrap li.item-price, .detail-title li.item-price, li.item-price');
  const price = norm(priceEl && priceEl.textContent);
  const addr = norm((document.querySelector('.property-address, address, [class*="address"]') || {}).textContent);
  const descEl = document.querySelector('[class*="description"], .property-description, #description');
  const desc = norm(descEl && descEl.textContent).slice(0, 6000);
  const og = document.querySelector('meta[property="og:image"]');
  const img = document.querySelector('[class*="gallery"] img, [class*="slider"] img');
  const foto = (og && og.content) || (img && img.src) || '';
  const inVendita = /IN VENDITA/i.test(body.slice(0, 1500));
  return { title, body, price, addr, pairs, desc, foto, inVendita };
}

function pairVal(pairs, re) {
  for (const [k, v] of Object.entries(pairs || {})) if (re.test(k)) return v;
  return '';
}
function parsePrezzo(txt) {
  const m = String(txt || '').match(/(\d{1,3}(?:\.\d{3})+|\d{3,})(?:[.,]\d{2})?/);
  return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
}
function parseMq(txt) {
  const m = String(txt || '').match(/(\d{1,5})\s*(?:m²|m2|mq)\b/i);
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
  // Indirizzo Houzez: "Via X, Quartiere, Comune, Bologna, Emilia-Romagna, CAP, Italia":
  // il comune è il token PRIMA di ", Bologna," (la provincia). Senza quel contesto
  // (titolo/slug), "Bologna" come ultima parola va bene.
  const provM = s.match(/([A-Za-zàèéìòù'’\- ]{3,40}),\s*Bologna,\s*(?:Emilia|$|\d{5})/i);
  if (provM) {
    return /^\s*bologna\s*$/i.test(provM[1]) ? 'Bologna' : '';
  }
  if (/\bbologna\b/i.test(s)) return 'Bologna';
  return '';
}
function isNonResidential(title, tipo) {
  const t = `${tipo || ''} ${title || ''}`;
  if (/appartamento|villa|casa indip|attico|mansarda|loft|mono|bilocale|trilocale|quadrilocale|plurilocale|rustico|casale|porzione/i.test(t)) return false;
  return /\b(box|garage|cantina|posto\s*auto|magazzino|negozio|ufficio|capannone|terreno|locale\s+commerciale)\b/i.test(t);
}

export default {
  id: 'vivacasa',
  name: 'Viva Casa',

  probeChecks: {
    listingUrl: LISTING_URL,
    cardSelectors: ['.item-listing-wrap', 'a[href*="/immobile/"]'],
    linkPattern: '\\/immobile\\/[^/]+\\/?$',
    minLinks: 1,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    log(`[vivacasa] IN VENDITA: ${LISTING_URL}`);
    const resp = await gotoResilient(page, LISTING_URL, { log, baseWait: 20000 });
    await dismissCookies(page);
    await humanPause(2200, 3800);
    await checkBlocked(page, resp);
    const rows = await page.evaluate(extractCards);
    let skipped = 0;
    for (const r of rows) {
      const id = r.href.match(/\/immobile\/([^/]+)\/?$/)?.[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const prezzo = parsePrezzo(r.price);
      if (prezzo != null && prezzo > MAX_PREZZO) { skipped++; continue; }
      if (isNonResidential(r.title, r.tipo)) { skipped++; continue; }
      const comune = comuneFromText(r.addr) || comuneFromText(r.title) || comuneFromText(r.text);
      if (!comune) { skipped++; continue; } // indirizzo card esplicito: fuori whitelist (Budrio, Zola, Castenaso…)
      if (r.mq != null && r.mq < MIN_MQ) { skipped++; continue; }
      cards.push({ id, url: r.href, area: comune, prezzoCard: prezzo, mqCard: r.mq });
      if (cards.length >= maxAds) break;
    }
    log(`[vivacasa] ${rows.length} card → ${cards.length} nel target (${skipped} scartate: prezzo/tipo/comune/mq)`);
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
    const tipologia = pairVal(p, /^tipologia$|^tipo$/) || 'Appartamento';
    if (isNonResidential(titolo, tipologia)) {
      log(`[vivacasa] non residenziale (${tipologia}): scarto ${card.id}`);
      return null;
    }
    if (!data.inVendita && /\/mese|in affitto/i.test(data.price)) {
      log(`[vivacasa] annuncio in affitto: scarto ${card.id}`);
      return null;
    }
    const prezzo = parsePrezzo(pairVal(p, /^prezzo$/)) ?? parsePrezzo(data.price) ?? card.prezzoCard ?? null;
    const mq = parseMq(pairVal(p, /^dimensione$|superficie|metri/)) ?? card.mqCard ?? null;
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[vivacasa] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    // Il comune del DETTAGLIO è autoritativo: la card può essere ambigua.
    const comuneDet = comuneFromText(data.addr) || comuneFromText(titolo);
    if (!comuneDet) {
      log(`[vivacasa] comune fuori whitelist (${data.addr.slice(0, 80)}): scarto ${card.id}`);
      return null;
    }
    const comune = comuneDet;
    const desc = data.desc || '';
    const locali = firstNum(pairVal(p, /^locali$|^vani$/));
    const camere = firstNum(pairVal(p, /camere|letto/)) ?? bedroomsFromText(`${titolo} ${desc}`, locali);
    const bagni = firstNum(pairVal(p, /^bagno$|^bagni$/));
    const piano = pairVal(p, /^piano$/);
    const ape = (pairVal(p, /classe\s*energetica|^ape$|ipe/).match(/\b([A-G][1-4]?)\b/) || data.body.match(/classe\s*energetica[:\s]*([A-G][1-4]?)\b/i) || [])[1] || '';
    const statoRaw = pairVal(p, /^condizione$|^stato$/);
    const zonaM = data.addr.match(/,\s*([A-Za-zàèéìòù'’\- ]{3,40}),\s*(?:Porto-|Navile|Savena|San Donato|Bologna)/);
    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo,
      comune,
      provincia: 'BO',
      zona: zonaM ? zonaM[1].trim() : '',
      indirizzo: (data.addr.split(',').slice(0, 2).join(',') || '').trim(),
      prezzo,
      tipologia,
      locali,
      camere,
      bagni,
      superficieMq: mq,
      piano,
      ascensore: /^s[iì]$/i.test(pairVal(p, /^ascensore$/)) ? 'Sì' : (/^no$/i.test(pairVal(p, /^ascensore$/)) ? 'No' : ''),
      cucina: pairVal(p, /^cucina$/),
      balcone: firstNum(pairVal(p, /^balcon/)) > 0 ? 'Sì' : '',
      cantina: /cantina/i.test(desc) ? 'Sì' : '',
      stato: mapStato(statoRaw),
      ape: ape.toUpperCase(),
      riscaldamento: /riscaldamento\s+(autonomo|centralizzato)/i.test(data.body) ? (data.body.match(/riscaldamento\s+(autonomo|centralizzato)/i) || [])[1] : '',
      agenzia: 'Viva Casa Immobiliare',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};