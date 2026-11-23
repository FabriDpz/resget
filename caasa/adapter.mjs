// Adattatore caasa (www.caasa.it) — aggregatore Playwright. Card .result-item con
// prezzo, €/m², mq, indirizzo, zona, piano, bagni, APE, agenzia, data. Link ClickTag
// verso il portale originale (immobiliare.it ecc.). Nessun dettaglio necessario.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.caasa.it';
// Filtri NATIVI via query (probe 21/11: ?euro-a=prezzo max &mq-da=mq min;
// h1 conferma "superficie maggiore di 40mq … meno di 160000€").
// ATTENZIONE paginazione: CON i filtri query il vecchio /page-N.html dà 404;
// il sito pagina con &page=N sulla URL .html (letto dai link reali in pagina).
const LISTING = `${BASE}/bologna/bologna/appartamento/in-vendita.html?euro-a=160000&mq-da=40`;

function realUrl(href) {
  const m = String(href).match(/[?&]url=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : href;
}
function parseDate(txt) {
  // "mer 11 novembre 2026" → ISO
  const mesi = { gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5, luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11 };
  const m = txt.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[3], mesi[m[2].toLowerCase()], +m[1]));
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

export default {
  id: 'caasa',
  name: 'Caasa',

  probeChecks: {
    listingUrl: 'https://www.caasa.it/bologna/bologna/appartamento/in-vendita.html?euro-a=160000&mq-da=40',
    cardSelectors: ['.result-item', '[id^="ID_"]', 'a[href*="ClickTag"]'],
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    let pageNum = 1;
    const maxPages = 8;
    while (pageNum <= maxPages && cards.length < maxAds) {
      const pageUrl = pageNum === 1 ? LISTING : `${LISTING}&page=${pageNum}`;
      log(`[caasa] pag ${pageNum}: ${pageUrl}`);
      const resp = await gotoResilient(page, pageUrl, { log, baseWait: 25000 });
      await dismissCookies(page);
      await humanPause(2500, 4000);
      await checkBlocked(page, resp);
      const items = await page.evaluate(() =>
        [...document.querySelectorAll('.result-item, [id^="ID_"]')].map((el) => ({
          id: el.id || el.getAttribute('data-id') || '',
          txt: (el.innerText || '').replace(/\s+/g, ' '),
          href: el.querySelector('a[href*="ClickTag"]')?.href || el.querySelector('a[href]')?.href || '',
        }))
      );
      let added = 0;
      for (const it of items) {
        const idM = it.id.match(/ID_(\d+)/) || it.href.match(/adv=(\d+)/);
        const id = idM ? idM[1] : it.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        cards.push({ id: `caasa-${id}`, url: realUrl(it.href), area: 'Bologna', data: it });
        added++;
      }
      log(`[caasa] pag ${pageNum}: +${added} (tot ${cards.length})`);
      if (added === 0) break;
      const hasNext = await page.evaluate((n) =>
        [...document.querySelectorAll('a[href]')].some((a) => /[?&]page=/.test(a.href) && a.href.includes(`page=${n + 1}`)), pageNum);
      if (!hasNext) break;
      pageNum++;
      await sleep(rand(2500, 4500));
    }
    return cards;
  },

  async scrapeDetail(page, card) {
    const { txt, href } = card.data;
    // "330.000 € | m² 75 prezzo al m²: 4400 €/m² Via Santo Stefano, Santo Stefano, Bologna PROPOSTO DA: EB GESTIONI ... piano: 3 ... bagni: 2 C.E. C"
    const priceM = txt.match(/([\d.]+)\s*€\s*\|/);
    const price = priceM ? parseInt(priceM[1].replace(/[^\d]/g, ''), 10) : null;
    const mqM = txt.match(/\|\s*m²\s*(\d+)/);
    const pmqM = txt.match(/prezzo al m²:\s*([\d.]+)/);
    const bagniM = txt.match(/bagni:\s*(\d+)/i);
    const pianoM = txt.match(/piano:\s*(\d+|terra|seminterrato|ultimo)/i);
    const apeM = txt.match(/C\.E\.\s*([A-G]\d?)/i);
    const agM = txt.match(/PROPOSTO DA:\s*([^p]+?)(?:\s*piano:|\s*bagni:|\s*C\.E\.|$)/i);
    // indirizzo: dopo "€/m²" e prima di "PROPOSTO DA"/"piano"/"bagni"
    const addrM = txt.match(/€\/m²\s+(.+?)(?:\s+PROPOSTO DA:|\s+piano:|\s+bagni:|\s+C\.E\.)/i);
    const addrParts = addrM ? addrM[1].split(',').map((s) => s.trim()) : [];
    const indirizzo = addrParts[0] || '';
    const zona = addrParts.length >= 2 ? addrParts[addrParts.length - 2] : '';
    const comune = addrParts.length >= 1 ? addrParts[addrParts.length - 1].replace(/\s*\(.*\)/, '') : 'Bologna';
    const pubblicatoIl = parseDate(txt);
    const fonteM = href.match(/agency=([^&]+)/);
    const fonte = fonteM ? decodeURIComponent(fonteM[1]) : '';
    const isAsta = /asta|nuda propriet|tribunale/i.test(txt);
    const ascensore = /con ascensore/i.test(txt);

    return {
      id: card.id,
      url: card.url,
      area: 'Bologna',
      titolo: `${zona ? 'Appartamento a ' + zona : 'Appartamento'}${indirizzo ? ', ' + indirizzo : ''}`,
      comune,
      provincia: 'BO',
      zona,
      indirizzo,
      lat: null,
      lon: null,
      prezzo: price,
      prezzoMq: pmqM ? parseInt(pmqM[1].replace(/[^\d]/g, ''), 10) : null,
      tipologia: 'Appartamento',
      locali: null,
      camere: bedroomsFromText(txt, null),
      bagni: bagniM ? parseInt(bagniM[1], 10) : null,
      superficieMq: mqM ? parseInt(mqM[1], 10) : null,
      piano: pianoM ? pianoM[1] : '',
      ascensore: ascensore ? 'sì' : '',
      stato: '',
      ape: apeM ? apeM[1] : '',
      agenzia: agM ? agM[1].trim() : (fonte && !/privato/i.test(fonte) ? fonte : ''),
      privato: /privato/i.test(fonte),
      descrizione: txt,
      pubblicatoIl,
      foto: '',
      isAuction: isAsta,
      fonteAggregata: fonte,
    };
  },
};