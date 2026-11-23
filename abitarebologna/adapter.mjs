// Adattatore abitarebologna.it (PHP custom) — Playwright headed.
// Listing verificata dal parent:
//   /immobili.php?op=vendita&tip=Residenziale&loc=Bologna&mq=40|999999999999999&prezzo1=0|160000&start=0
// ⚠️ CRITICO: le chiavi `mq` e `prezzo1` vanno SEMPRE incluse (pipe %7C, valori
//   arbitrari accettati), altrimenti risposta rotta da 538 byte.
//   loc=San+Lazzaro+di+Savena → 0 oggi ma interrogata comunque; Pianoro NON nel select → skip.
//   Paginazione &start=10,20… (offset, 10/pagina).
// Dettaglio: scheda.php?q=<slug>&rif=<codice> — la QUERY è parte dell'identità
//   dell'annuncio (stripQuery:false nel probe). ld+json solo LocalBusiness → ignorato.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.abitarebologna.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const WHITELIST = ['San Lazzaro di Savena', 'Pianoro', 'Bologna'];
const MQ_KEY = 'mq=40%7C999999999999999';
function listingUrl(loc, maxPrezzo) {
  return `${BASE}/immobili.php?op=vendita&tip=Residenziale&loc=${loc}&${MQ_KEY}&prezzo1=0%7C${maxPrezzo}&start=0`;
}
const QUERIES = [
  { area: 'Bologna', url: listingUrl('Bologna', MAX_PREZZO) },
  { area: 'San Lazzaro di Savena', url: listingUrl('San+Lazzaro+di+Savena', MAX_PREZZO) },
];

// Contesto pagina: card con link scheda.php (query preservata).
function extractCards() {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href*="scheda.php"]')) {
    let href;
    try { href = new URL(a.getAttribute('href'), location.href).href.split('#')[0]; } catch { continue; }
    if (!/scheda\.php\?/.test(href) || seen.has(href)) continue;
    seen.add(href);
    let host = a;
    for (let i = 0; i < 7 && host; i++) {
      if (/card|listing|item|immobile|box|annuncio|col/i.test(String(host.className))) break;
      host = host.parentElement;
    }
    const priceEl = host && host.querySelector('[class*="prezzo"], [class*="price"]');
    const text = norm(host && host.innerText).slice(0, 500);
    let rif = '';
    try { rif = new URL(href).searchParams.get('rif') || ''; } catch { /* */ }
    out.push({ href, rif, price: norm(priceEl && priceEl.textContent), text });
  }
  return out;
}

// Contesto pagina: dettaglio scheda.php.
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
  document.querySelectorAll('li, tr, dt, [class*="caratteristic"] div, [class*="dettagl"] div, td').forEach((el) => {
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
  const price = norm((document.querySelector('[class*="prezzo"], [class*="price"]') || {}).textContent);
  const addr = norm((document.querySelector('[class*="indirizzo"], address, [class*="address"], [class*="zona"]') || {}).textContent);
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
// Prezzo dal corpo del dettaglio: "Bologna (Centro-…) € 1.200,00 Stato …".
// Accetta anche migliaia senza punti (€ 95000) ma MAI valori < 10000 (affitti/mese).
function parsePrezzoBody(body) {
  const m = String(body || '').match(/€\s*([\d.]{1,})/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/\./g, ''), 10);
  // € 0,00 = "trattative riservate" (verificato: villa 0002VILLA); <10000 = affitti/mese.
  return n >= 10000 ? n : null;
}
// Il sito mescola AFFITTI nella ricerca vendita (verificato 22/11: rif 0002687A
// "€ 1.200,00" con "LOCAZIONE … EURO 1200,00" in descrizione). Riconoscimento euristico.
function isAffitto(data, prezzo) {
  const t = `${data.title} ${data.desc} ${data.body}`;
  if (/locazione\s+rivolta|affittasi|in\s+affitto|canone\s+(?:mensile|di\s+locazione)|\/\s*mese\b/i.test(t)) return true;
  if (prezzo != null && prezzo < 10000) return true; // nessun residenziale in vendita a <10k€
  return false;
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
  id: 'abitarebologna',
  name: 'Abitare Bologna',

  probeChecks: {
    // ≤200000 per il probe: 5 risultati, più stabile (il collect usa 160000).
    listingUrl: listingUrl('Bologna', 200000),
    cardSelectors: ['a[href*="scheda.php"]'],
    linkPattern: 'scheda\\.php\\?',
    stripQuery: false, // l'identità dell'annuncio è nella query (q=…&rif=…)
    minLinks: 1,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const q of QUERIES) {
      log(`[abitarebologna] Area ${q.area}: ${q.url}`);
      let offset = 0;
      const maxPages = 6;
      while (offset / 10 < maxPages && cards.length < maxAds) {
        const url = q.url.replace(/&start=\d+$/, `&start=${offset}`);
        const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
        await dismissCookies(page);
        await humanPause(2200, 3800);
        await checkBlocked(page, resp);
        const rows = await page.evaluate(extractCards);
        let added = 0;
        let skipped = 0;
        for (const r of rows) {
          const id = r.rif || r.href;
          if (seen.has(id)) continue;
          seen.add(id);
          const p = parsePrezzo(r.price) ?? parsePrezzo(r.text);
          if (p != null && p > MAX_PREZZO) { skipped++; continue; }
          if (isNonResidential(r.text, '')) { skipped++; continue; }
          const mq = parseMq(r.text);
          if (mq != null && mq < MIN_MQ) { skipped++; continue; }
          cards.push({ id: String(id), url: r.href, area: q.area, prezzoCard: p, mqCard: mq });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[abitarebologna] ${q.area} start=${offset}: +${added} (tot ${cards.length}, ${skipped} scartate da card)`);
        if (rows.length === 0) break;
        if (rows.length < 10) break; // ultima pagina (10/pagina)
        offset += 10;
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
      log(`[abitarebologna] non residenziale (${tipologia || titolo}): scarto ${card.id}`);
      return null;
    }
    // parsePrezzoBody normalizza già: € 0,00 (trattative riservate) e <10000 (affitti) → null.
    // NIENTE fallback grezzi (pairVal/card): ripescherebbero il "2" di "€ 0,00".
    const prezzo = parsePrezzoBody(data.body);
    if (isAffitto(data, prezzo)) {
      log(`[abitarebologna] annuncio in affitto misto alla vendita (${prezzo ?? '?'} €): scarto ${card.id}`);
      return null;
    }
    const mq = parseMq(pairVal(p, /superficie|metri|dimensione|mq|area/)) ?? card.mqCard ?? parseMq(`${titolo} ${data.body}`);
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[abitarebologna] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    if (prezzo == null) {
      log(`[abitarebologna] prezzo non determinato: scarto prudenziale ${card.id}`);
      return null;
    }
    const comuneRaw = pairVal(p, /^comune$|^città$|^city$/);
    const comune = comuneFromText(comuneRaw) || comuneFromText(data.addr) || comuneFromText(titolo) || card.area;
    if (comuneRaw && !comuneFromText(comuneRaw)) {
      log(`[abitarebologna] comune fuori whitelist (${comuneRaw}): scarto ${card.id}`);
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
      tipologia: tipologia || 'Appartamento',
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
      agenzia: 'Abitare Bologna',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};