// Adattatore remax.it — Playwright.
// Listing: /vendita-appartamenti/{comune}?prezzo_max=160000&superficie_min=40
//   Filtri NATIVI via query (probe 21/11, generati dai pannelli "Fascia di prezzo"
//   e "Superficie"). Paginazione &page=N. A 0 risultati il sito mostra card
//   SUGGERITE fuori comune: si ignorano quando compare "Nessun annuncio trovato".
// Dettaglio: JSON-LD RealEstateListing (address, description, image) + DOM per
// prezzo/mq/locali/bagni/piano ("115 mq 4 locali 2 bagni 1° piano"). Camere dedotte.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato } from '../core/schema.mjs';

const BASE = 'https://www.remax.it';
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'pianoro', name: 'Pianoro' },
  { slug: 'san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
];

function findListingNode(ld) {
  for (const block of ld) {
    const nodes = block['@graph'] || [block];
    for (const n of nodes) {
      const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
      if (types.includes('RealEstateListing')) return n;
    }
  }
  return null;
}
function firstVal(x) { return Array.isArray(x) ? x[0] : x; }
function statoFromText(t) {
  t = String(t || '').toLowerCase();
  if (/da ristrutturare|da restaurare|da rimodernare/.test(t)) return 'Da ristrutturare';
  if (/ristrutturat[ao]|pari al nuovo|nuovo/.test(t)) return 'Ottimo / Ristrutturato';
  if (/buono stato|abitabile|buone condizioni|discreto/.test(t)) return 'Buono / Abitabile';
  return '';
}
function bedroomsFromText(desc, locali) {
  const t = String(desc || '');
  let m = t.match(/(\d+)\s*(?:camere?\s+da\s+letto|camere\b)/i);
  if (m) return parseInt(m[1], 10);
  const words = { una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, singola: 1, doppia: 2, matrimoniale: 1 };
  m = t.match(/\b(una|due|tre|quattro|cinque|singola|doppia|matrimoniale)\s+camera/i);
  if (m) return words[m[1].toLowerCase()] || null;
  const cnt = (t.match(/camera\s+da\s+letto|camera\s+(?:singola|doppia|matrimoniale)/gi) || []).length;
  if (cnt > 0) return cnt;
  if (locali && locali >= 2) return locali - 1;
  return null;
}
function parseNum(s) { const n = parseInt(String(s).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; }

export default {
  id: 'remax',
  name: 'RE/MAX',

  // A Bologna 0 annunci nel target (baseline 6, tutti >200k): la pagina filtrata
  // è legittimamente vuota → minLinks 0. Un 404/errore darebbe comunque -1/0 sui card.
  probeChecks: {
    listingUrl: 'https://www.remax.it/vendita-appartamenti/bologna?prezzo_max=160000&superficie_min=40',
    cardSelectors: ['a[href*="prestige.remax.it/vendita-"]'],
    linkPattern: 'prestige\\.remax\\.it\\/vendita-.+-\\d+-\\d+$|\\/vendita-appartamento\\/.+-\\d+-\\d+$',
    minLinks: 0,
    minCards: 0, // Bologna nel target ha 0 annunci: listing vuota legittima
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const url = `${BASE}/vendita-appartamenti/${c.slug}?prezzo_max=160000&superficie_min=40`;
      log(`[remax] Area ${c.name}: ${url}`);
      let pageNum = 1;
      const maxPages = 10;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const pageUrl = pageNum === 1 ? url : `${url}&page=${pageNum}`;
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 25000 });
        await dismissCookies(page);
        await humanPause(2200, 3800);
        await checkBlocked(page, resp);
        // 0 risultati reali → il sito propone card di altri comuni: non raccoglierle.
        const empty = await page.evaluate(() => /Nessun annuncio trovato/i.test(document.body?.innerText || ''));
        if (empty) { log(`[remax] ${c.name} pag ${pageNum}: nessun annuncio nel target (suggeriti fuori comune ignorati)`); break; }
        const links = await page.evaluate(() =>
          [...document.querySelectorAll('a[href*="prestige.remax.it/vendita-"], a[href*="/vendita-appartamento/"]')]
            .map((a) => a.href.split('#')[0].split('?')[0])
            .filter((h) => /-\d+-\d+$/.test(h))
        );
        let added = 0;
        for (const h of links) {
          const id = h.match(/-(\d+-\d+)$/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          cards.push({ id, url: h, area: c.name });
          added++;
        }
        log(`[remax] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length})`);
        if (added === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`page=${n + 1}`)), pageNum);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(2500, 4500));
      }
      await sleep(rand(2000, 4000));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 20000 });
    await dismissCookies(page);
    await humanPause(2000, 3500);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const ld = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try { ld.push(JSON.parse(s.textContent)); } catch { /* */ }
      });
      return { ld, bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ') };
    });
    const node = findListingNode(data.ld);
    if (!node) return null;
    const addr = node.address || {};
    const desc = node.description || '';
    const body = data.bodyText;
    // Riga caratteristiche: "115 mq 4 locali 2 bagni 1° piano"
    const mq = parseNum(body.match(/(\d[\d.]*)\s*mq/i)?.[1]);
    const locali = parseNum(body.match(/(\d+)\s*local[ie]/i)?.[1]);
    const bagni = parseNum(body.match(/(\d+)\s*bagn[io]/i)?.[1]);
    const prezzo = parseNum(body.match(/([\d.]+)\s*€/)?.[1]);
    const pianoM = body.match(/(\d+)[°º]?\s*piano/i) || body.match(/piano\s+(terra|rialzato|seminterrato|ultimo)/i);
    const apeM = body.match(/Classe\s+Energetica[:\s]*([A-G][1-4]?)/i) || desc.match(/classe\s+energetica\s*([A-G][1-4]?)/i);
    const zonaM = (node.name || '').match(/a\s+[^,]+,\s*(.+)$/) || desc.match(/zona\s+([A-Za-zàèéìòù' ]{3,30}?)(?:,|\.| in| di)/i);
    const speseM = desc.match(/spese\s+condominiali[^.]*?(\d[\d.]*)\s*euro/i);
    const foto = firstVal(node.image) || '';

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: node.name || 'Immobile in vendita',
      comune: addr.addressLocality || '',
      provincia: 'BO',
      zona: zonaM ? zonaM[1].trim() : '',
      indirizzo: addr.streetAddress || '',
      lat: null,
      lon: null,
      prezzo: prezzo ?? null,
      tipologia: 'Appartamento',
      locali,
      camere: bedroomsFromText(desc, locali),
      bagni,
      superficieMq: mq,
      piano: pianoM ? pianoM[1] : '',
      stato: mapStato(statoFromText(desc)),
      ape: apeM ? apeM[1].toUpperCase() : '',
      speseCondominio: speseM ? parseNum(speseM[1]) : null,
      agenzia: 'RE/MAX',
      privato: false,
      descrizione: desc,
      foto: typeof foto === 'string' ? foto : '',
    };
  },
};