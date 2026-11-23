// Adattatore living-in.it — WordPress ct-listings, Playwright headed.
// Listing: /?search-listings=true&ct_city={bologna|pianoro}&ct_price_to=160000&ct_sqft_from=40
// ⚠️ VERIFICATO LIVE 22/11: i filtri NON funzionano come dichiarato nel brief:
// l'unico risultato "Pianoro ≤160k ≥40m²" è un CAPANNONE IN AFFITTO a €1.000
// (10442). Il JSON-LD è malformato (JSON.parse fallisce) → niente Product.
// Strategia: aggiungere ct_keyword=vendita se supportato NON verificato →
// si tiene la URL del brief ma si filtra CLIENT-SIDE: contratto (scarto
// AFFITTO), tipologia non residenziale (capannoni), prezzo≤160k, mq≥40.
// ct_sqft è in m²; San Lazzaro NON esiste tra le città → non interrogarlo.
// Dettaglio /listings/<id>/ parsing DOM: "Pianoro, BO €1.000 2 250 m2",
// "Classe Energetica G", "Condizioni:", "Piano:", "Riscaldamento autonomo".

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://living-in.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const LINK_RE = /\/listings\/\d+/;
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'pianoro', name: 'Pianoro' },
];
const WHITELIST = { 'bologna': 'Bologna', 'pianoro': 'Pianoro', 'san-lazzaro-di-savena': 'San Lazzaro di Savena' };

function findProduct(ld) {
  for (const block of ld) {
    const nodes = block['@graph'] || (Array.isArray(block) ? block : [block]);
    for (const n of nodes) {
      const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
      if (types.includes('Product')) return n;
    }
  }
  return null;
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
  id: 'livingin',
  name: 'Living In',

  probeChecks: {
    listingUrl: `${BASE}/?search-listings=true&ct_city=pianoro&ct_price_to=160000&ct_sqft_from=40`,
    cardSelectors: ['a[href*="/listings/"]'],
    linkPattern: '\\/listings\\/\\d+',
    minLinks: 1,
    minCards: 0, // Pianoro ha 1 risultato verificato, BO 0: listing quasi vuota legittima
    // NIENTE detailChecks jsonLdType: il JSON-LD del portale è malformato
    // (verificato 22/11, JSON.parse fallisce) → asserzione impossibile.
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const url = `${BASE}/?search-listings=true&ct_city=${c.slug}&ct_price_to=${MAX_PREZZO}&ct_sqft_from=${MIN_MQ}`;
      log(`[livingin] Area ${c.name}: ${url}`);
      let pageNum = 1;
      const maxPages = 8;
      while (pageNum <= maxPages && cards.length < maxAds) {
        // Paginazione WP: /page/N/?<stessi param>
        const pageUrl = pageNum === 1 ? url : `${BASE}/page/${pageNum}/?search-listings=true&ct_city=${c.slug}&ct_price_to=${MAX_PREZZO}&ct_sqft_from=${MIN_MQ}`;
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 20000 });
        await dismissCookies(page);
        await humanPause(2000, 4000);
        await checkBlocked(page, resp);
        const links = await page.evaluate((reSrc) => {
          const re = new RegExp(reSrc);
          return [...document.querySelectorAll('a[href*="/listings/"]')]
            .map((a) => a.href.split('#')[0].split('?')[0])
            .filter((h) => re.test(h));
        }, LINK_RE.source);
        let added = 0;
        for (const h of links) {
          const id = h.match(/\/listings\/(\d+)/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          cards.push({ id, url: h, area: c.name });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[livingin] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length})`);
        if (added === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`/page/${n}/`)), pageNum + 1);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(2500, 5000));
      }
      await sleep(rand(2000, 4000));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 18000 });
    await dismissCookies(page);
    await humanPause(2000, 4000);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      // JSON-LD del portale malformato (verificato 22/11): best effort, DOM primario.
      const ld = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try { ld.push(JSON.parse(s.textContent)); } catch { /* malformato: normale qui */ }
      });
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const titolo = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      // Riga riassuntiva: "Pianoro, BO €1.000 2 250 m2" (locali, mq).
      const summaryM = body.match(/((?:Bologna|Pianoro|San Lazzaro di Savena|Monzuno)[^€]{0,20}),\s*BO\s*€\s*([\d.]+)\s+(\d{1,2})\s+(\d{2,5})\s*m2/i);
      // Descrizione: dopo il blocco riassuntivo, prima di "Efficienza Energetica".
      let descrizione = '';
      const dIdx = body.search(/Property ID\s*#\s*\S+\s+/);
      if (dIdx >= 0) {
        const rest = body.slice(dIdx).replace(/^Property ID\s*#\s*\S+\s+/, '');
        const end = rest.search(/Efficienza Energetica|Visita Virtuale|La Struttura/i);
        descrizione = (end > 0 ? rest.slice(0, end) : rest.slice(0, 3000)).replace(/^(Next\s+)+/, '').trim();
      }
      const foto = document.querySelector('[class*="gallery"] img, [class*="slider"] img, .ct-listing-gallery img, picture img')?.src || '';
      return { ld, body: body.slice(0, 12000), titolo, summary: summaryM ? { luogo: summaryM[1], prezzo: summaryM[2], locali: summaryM[3], mq: summaryM[4] } : null, descrizione, foto };
    });

    const product = findProduct(data.ld);
    const offers = product?.offers || {};
    const body = data.body;
    const desc = data.descrizione || product?.description || '';
    const s = data.summary;
    // Contratto: la ricerca NON filtra vendita (affitto visto live) → scarto.
    if (/\bAFFITTO\b/.test(body.slice(0, 2500)) || /\bin affitto\b/i.test(desc.slice(0, 300))) {
      log(`[livingin] annuncio in affitto: scarto ${card.id}`);
      return null;
    }
    // Tipologia: h1 "Capannoni, 2 Locali" / "Appartamento, …".
    const tipoM = (data.titolo || '').match(/^([A-Za-zàèéìòù ]+?),/);
    const tipologia = tipoM ? tipoM[1].trim() : (/monolocale/i.test(data.titolo) ? 'Monolocale' : 'Appartamento');
    if (/capannon|magazzin|garage|box|cantina|ufficio|negozio|terreno|attività/i.test(tipologia)) {
      log(`[livingin] tipologia non residenziale (${tipologia}): scarto ${card.id}`);
      return null;
    }
    const prezzo = offers.price != null ? Number(offers.price)
      : (s ? parseInt(s.prezzo.replace(/\./g, ''), 10) : firstInt((body.match(/€\s*([\d.]{3,})/) || [])[1]?.replace(/\./g, '')));
    const mq = (s ? parseInt(s.mq, 10) : null)
      ?? firstInt((body.match(/(\d{2,5})\s*(?:m²|m2|mq)\b/i) || [])[1]);
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[livingin] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    // Comune dalla riga riassuntiva; whitelist (Monzuno è tra le città del sito).
    let comune = card.area;
    const cityRaw = String(s?.luogo || '').toLowerCase();
    if (cityRaw) {
      const match = Object.entries(WHITELIST).find(([slug, name]) => cityRaw.includes(name.toLowerCase()));
      if (!match) {
        log(`[livingin] comune fuori whitelist (${cityRaw}): scarto ${card.id}`);
        return null;
      }
      comune = match[1];
    }
    const locali = s ? parseInt(s.locali, 10) : null;
    const bagni = firstInt(feat(body, 'bagni|bathrooms', '(\\d{1,2})'));
    const camere = firstInt(feat(body, 'camere(?:\\s+da\\s+letto)?|bedrooms', '(\\d{1,2})')) ?? bedroomsFromText(`${data.titolo} ${desc}`, locali);
    const piano = feat(body, 'piano', '(terra|rialzato|seminterrato|interrato|ultimo|primo|secondo|terzo|quarto|\\d{1,2})');
    const ape = String(feat(body, 'classe\\s+energetica', '([A-G][1-4]?)')).toUpperCase().slice(0, 2);
    const riscaldamento = /riscaldamento\s+autonomo/i.test(body) ? 'Autonomo' : (/riscaldamento\s+centralizzato/i.test(body) ? 'Centralizzato' : '');
    const balcone = /balcon[ei]/i.test(desc) ? 'Sì' : '';
    const cantina = /cantina/i.test(desc) ? 'Sì' : '';
    const zonaM = desc.match(/zona\s+([A-Za-zàèéìòù' ]{3,35}?)(?:[,.;]| più| comoda| in\b)/i);

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: data.titolo || product?.name || 'Immobile in vendita',
      comune,
      provincia: 'BO',
      zona: zonaM ? zonaM[1].trim() : '',
      indirizzo: '',
      lat: null,
      lon: null,
      prezzo,
      tipologia,
      locali,
      camere,
      bagni,
      superficieMq: mq,
      piano,
      ascensore: /ascensore/i.test(desc) && !/senza ascensore/i.test(desc) ? 'Sì' : '',
      cucina: '',
      balcone,
      cantina,
      stato: mapStato(/buono stato/i.test(desc) ? 'buono' : (/ristrutturat/i.test(desc) ? 'ristrutturato' : '')),
      ape,
      riscaldamento,
      agenzia: 'Living In',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};