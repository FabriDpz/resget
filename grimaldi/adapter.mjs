// Adattatore grimaldifranchising.it — Laravel, Playwright headed.
// Listing: /agenzia/store-bologna-centro/immobili?contratto=vendita&prezzo=0-160000&mq=40-100000
// (3 risultati col filtro vs base 7; MA verificato live 22/11: tra i 3 c'è un
// annuncio da 297k → i filtri NON sono affidabili). Doppia rete: filtro
// CLIENT-SIDE prezzo/mq sulla card in raccolta + sul dettaglio.
// Paginazione &page=N. Dettaglio /vendita/<tipo>/bo/<comune>/<id>, DOM:
// prezzo "297.000 €" (importo PRIMA di €), sezione Caratteristiche con coppie
// "Mq 85", "Tipo piano Terzo", "Stato interno Ristrutturato", "Destinazione uso".
// NB: lo store vende anche a Ozzano (fuori whitelist) → scarto per comune.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.grimaldifranchising.it';
const LISTING = `${BASE}/agenzia/store-bologna-centro/immobili?contratto=vendita&prezzo=0-160000&mq=40-100000`;
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const LINK_RE = /\/vendita\/[^/]+\/bo\/[^/]+\/\d+$/;
const WHITELIST = {
  'bologna': 'Bologna',
  'pianoro': 'Pianoro',
  'san-lazzaro-di-savena': 'San Lazzaro di Savena',
};

function parsePrice(txt) {
  const t = String(txt || '');
  const m = t.match(/([\d.]{4,})\s*€/) || t.match(/€\s*([\d.]{4,})/);
  return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
}
function firstInt(txt) {
  const m = String(txt || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
function feat(body, labelRe, valRe = '([A-Za-zàèéìòù0-9°º/ ]{1,40})') {
  const m = body.match(new RegExp('(?:' + labelRe + ')\\s*[:\\s]\\s*' + valRe, 'i'));
  return m ? m[1].trim() : '';
}

export default {
  id: 'grimaldi',
  name: 'Grimaldi',

  probeChecks: {
    listingUrl: LISTING,
    cardSelectors: ['a[href*="/vendita/"]'],
    linkPattern: '\\/vendita\\/[^/]+\\/bo\\/[^/]+\\/\\d+$',
    minLinks: 1,
    minCards: 0, // portfolio piccolo: 0 risultati è legittimo
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    let pageNum = 1;
    const maxPages = 10;
    while (pageNum <= maxPages && cards.length < maxAds) {
      const pageUrl = pageNum === 1 ? LISTING : `${LISTING}&page=${pageNum}`;
      const resp = await gotoResilient(page, pageUrl, { log, baseWait: 20000 });
      await dismissCookies(page);
      await humanPause(2000, 4000);
      await checkBlocked(page, resp);
      const rows = await page.evaluate((reSrc) => {
        const re = new RegExp(reSrc);
        const out = [];
        const seenH = new Set();
        for (const a of document.querySelectorAll('a[href*="/vendita/"]')) {
          const h = a.href.split('#')[0].split('?')[0];
          if (!re.test(h) || seenH.has(h)) continue;
          seenH.add(h);
          let el = a, txt = '';
          for (let i = 0; i < 6 && el; i++) {
            el = el.parentElement;
            txt = (el?.innerText || '').replace(/\s+/g, ' ');
            if (/€/.test(txt) && txt.length > 40) break;
          }
          out.push({ url: h, txt: txt.slice(0, 500) });
        }
        return out;
      }, LINK_RE.source);
      let added = 0, skippedPrice = 0;
      for (const r of rows) {
        const id = r.url.match(/\/(\d+)$/)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const slug = r.url.match(/\/bo\/([^/]+)\/\d+$/)?.[1] || '';
        if (slug && !WHITELIST[slug]) { log(`[grimaldi] comune fuori whitelist (${slug}): scarto`); continue; }
        // Filtri server inaffidabili (297k visto con prezzo=0-160000): rete client-side.
        const p = parsePrice(r.txt);
        if (p !== null && p > MAX_PREZZO) { skippedPrice++; continue; }
        const mq = firstInt((r.txt.match(/(\d{2,4})\s*(?:m²|m2|mq)\b/i) || [])[1]);
        if (mq !== null && mq < MIN_MQ) { log(`[grimaldi] ${mq} m² < ${MIN_MQ}: scarto ${id}`); continue; }
        cards.push({ id, url: r.url, area: WHITELIST[slug] || 'Bologna', price: p, mq });
        added++;
        if (cards.length >= maxAds) break;
      }
      log(`[grimaldi] pag ${pageNum}: +${added} (tot ${cards.length}, ${skippedPrice} oltre budget)`);
      if (rows.length === 0) break;
      const hasNext = await page.evaluate((n) =>
        [...document.querySelectorAll('a[href]')].some((a) => new RegExp(`[?&]page=${n}(?:&|$)`).test(a.href)), pageNum + 1);
      if (!hasNext) break;
      pageNum++;
      await sleep(rand(2500, 5000));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 18000 });
    await dismissCookies(page);
    await humanPause(2000, 4000);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const titolo = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      // Prezzo: h6.price "297.000 €" (importo PRIMA del simbolo).
      let prezzoTxt = '';
      const priceEl = document.querySelector('h6.price, [class*="price"]');
      if (priceEl && /[\d.]{4,}\s*€/.test(priceEl.textContent || '')) prezzoTxt = priceEl.textContent.trim();
      // Caratteristiche: sezione a coppie "Mq 85", "Tipo piano Terzo", ecc.
      const carIdx = body.search(/Caratteristiche\s+Tipologia/i);
      const caratteristiche = carIdx >= 0 ? body.slice(carIdx, carIdx + 1200) : '';
      // Descrizione tra "Descrizione" e "Rif." / "Caratteristiche".
      const dIdx = body.search(/Descrizione\s+/);
      let descrizione = '';
      if (dIdx >= 0) {
        const rest = body.slice(dIdx + 12);
        const end = rest.search(/\sRif\.\s|\sCaratteristiche\s/);
        descrizione = (end > 0 ? rest.slice(0, end) : rest.slice(0, 3000)).trim();
      }
      const foto = document.querySelector('[class*="gallery"] img, [class*="slider"] img, picture img, [class*="photo"] img')?.src || '';
      return { body: body.slice(0, 12000), titolo, prezzoTxt, caratteristiche, descrizione, foto };
    });

    const pathM = card.url.match(/\/vendita\/([^/]+)\/bo\/([^/]+)\/(\d+)$/);
    const comuneSlug = pathM ? pathM[2] : '';
    if (comuneSlug && !WHITELIST[comuneSlug]) {
      log(`[grimaldi] comune fuori whitelist (${comuneSlug}): scarto ${card.id}`);
      return null;
    }
    const comune = WHITELIST[comuneSlug] || card.area;
    const body = data.body;
    const car = data.caratteristiche || '';
    const desc = data.descrizione || '';
    // Destinazione d'uso esplicita nelle Caratteristiche.
    const uso = feat(car, 'destinazione\\s+(?:d[’\']?uso|uso)', '([A-Za-zàèéìòù]{3,20})');
    if (uso && !/residenziale|abitativ/i.test(uso)) {
      log(`[grimaldi] destinazione uso "${uso}": scarto ${card.id}`);
      return null;
    }
    const prezzo = parsePrice(data.prezzoTxt) ?? parsePrice(car) ?? card.price ?? null;
    const mq = firstInt(feat(car, 'mq|superficie', '(\\d{2,4})')) ?? card.mq
      ?? firstInt((body.match(/(\d{2,4})\s*(?:m²|m2|mq)\b/i) || [])[1]);
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[grimaldi] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const locali = firstInt(feat(car, 'locali|vani', '(\\d{1,2})'));
    const bagni = firstInt(feat(car, '(?:tipo\\s+)?bagn[io]', '(\\d{1,2})')) ?? firstInt((desc.match(/(\d+)\s+bagn[io]/i) || [])[1]);
    const camere = firstInt(feat(car, 'camere(?:\\s+da\\s+letto)?', '(\\d{1,2})')) ?? bedroomsFromText(`${data.titolo} ${desc}`, locali);
    const piano = feat(car, 'tipo\\s+piano|piano', '(terra|rialzato|seminterrato|interrato|ultimo|intermedio|primo|secondo|terzo|quarto|quinto|sesto|\\d{1,2}[°º]?)');
    const stato = feat(car, 'stato\\s+interno|stato\\s+costruzione', '([A-Za-zàèéìòù /]{3,30})');
    const ape = String(feat(car, 'classe\\s+energetica', '([A-G][1-4]?)') || feat(body, 'classe\\s+energetica|APE', '([A-G][1-4]?)')).toUpperCase().slice(0, 2);
    const riscaldamento = feat(car, 'tipo\\s+(?:di\\s+)?riscaldamento(?:\\s+impianto)?', '(autonomo|centralizzato|assente)');
    const cucina = feat(car, 'tipo\\s+cucina|cucina', '([A-Za-zàèéìòù ]{3,25})');
    const speseCondominio = feat(car, 'spese\\s+condominiali\\s+mensili', '([\\d.]+\\s*€)');
    const balcone = /balcon[ei]/i.test(desc) ? 'Sì' : '';
    const cantina = /cantina/i.test(desc) ? 'Sì' : '';
    const ascensore = /ascensore/i.test(`${car} ${desc}`) && !/senza ascensore|no ascensore/i.test(desc) ? 'Sì' : (/senza ascensore|no ascensore/i.test(desc) ? 'No' : '');
    const zonaM = desc.match(/[Zz]ona\s+([A-Za-zàèéìòù' -]{3,35}?)(?:[,.;]| più| comoda| in\b)/);
    // Indirizzo dal titolo: "Appartamento in Via Bruno Monterumici, Bologna, BO".
    const addrM = (data.titolo || '').match(/\bin\s+(.+?),\s*(?:Bologna|Pianoro|San Lazzaro)/i);
    const tipologia = feat(car, 'tipologia', '([A-Za-zàèéìòù ]{3,30})') || (pathM ? pathM[1].replace(/-/g, ' ') : '');

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: data.titolo || 'Immobile in vendita',
      comune,
      provincia: 'BO',
      zona: zonaM ? zonaM[1].trim() : '',
      indirizzo: addrM ? addrM[1].trim() : '',
      lat: null,
      lon: null,
      prezzo,
      tipologia: tipologia.charAt(0).toUpperCase() + tipologia.slice(1),
      locali,
      camere,
      bagni,
      superficieMq: mq,
      piano,
      ascensore,
      cucina,
      balcone,
      cantina,
      stato: mapStato(stato),
      ape,
      riscaldamento,
      speseCondominio,
      agenzia: 'Grimaldi Bologna Centro',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};