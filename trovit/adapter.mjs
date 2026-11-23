// Adattatore trovit (case.trovit.it) — aggregatore Playwright (piattaforma Lifull,
// stesso DB di Mitula: data-retis-id combacia). Card con prezzo (anche ribassato),
// descrizione, locali, bagni, mq, età annuncio, fonte. Nessun dettaglio necessario.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://case.trovit.it';
// ⚠️ VERIFICA BROWSER REALE 22/11: la URL SEO "-160000-euro" è "INTORNO a"
// (il title dice "intorno 160.000 €"), non un max. Il filtro VERO è l'endpoint
// /find della piattaforma Lifull (stesso DB di Mitula, geoId condivisi):
//   /find?geoId={id}&operationType=sell&propertyType=apartment&maxPrice=160000&minArea=40
// geoId verificati: Bologna=R43172, Pianoro=R43050, San Lazzaro=R43173
// (tutte le card del comune giusto, prezzi ≤160k; i prezzi superiori visibili
// sono prezzi BARRATI pre-ribasso). freeText=bologna matcha la PROVINCIA
// (Monterenzio!) → mai usare freeText, sempre geoId. Paginazione &page=N.
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const COMUNI = [
  { geoId: 'R43172', name: 'Bologna' },
  { geoId: 'R43050', name: 'Pianoro' },
  { geoId: 'R43173', name: 'San Lazzaro di Savena' },
];

function realUrl(href) {
  const m = String(href).match(/detailPageUrl=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : href;
}
function ageDays(txt) {
  if (/30\+\s*giorni/i.test(txt)) return 35;
  let d = 0;
  const w = txt.match(/(\d+)\s*settiman/i); if (w) d += +w[1] * 7;
  const g = txt.match(/(\d+)\s*giorn/i); if (g) d += +g[1];
  const mo = txt.match(/(\d+)\s*mes[ei]/i); if (mo) d += +mo[1] * 30;
  if (/oggi|ore fa|minut/i.test(txt) && d === 0) return 0;
  return d || null;
}

export default {
  id: 'trovit',
  name: 'Trovit',

  // Card article con data-id; link thribee/detailPageUrl (query preservata: stripQuery false).
  probeChecks: {
    listingUrl: 'https://case.trovit.it/find?geoId=R43172&operationType=sell&propertyType=apartment&maxPrice=160000&minArea=40',
    cardSelectors: ['article.snippet-listing', 'article[data-id]'],
    linkPattern: 'detailPageUrl=|\\/detail\\/',
    minLinks: 5,
    stripQuery: false,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const baseUrl = `${BASE}/find?geoId=${c.geoId}&operationType=sell&propertyType=apartment&maxPrice=${MAX_PREZZO}&minArea=${MIN_MQ}`;
      let pageNum = 1;
      const maxPages = 8;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const pageUrl = pageNum === 1 ? baseUrl : `${baseUrl}&page=${pageNum}`;
        log(`[trovit] ${c.name} pag ${pageNum}: ${pageUrl}`);
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 25000 });
        await dismissCookies(page);
        // banner "Continua senza accettare"
        try {
          const btn = page.locator('text=/Continua senza accettare/i').first();
          if (await btn.isVisible({ timeout: 1500 })) await btn.click();
        } catch { /* nessun banner */ }
        await humanPause(2500, 4000);
        await checkBlocked(page, resp);
        const items = await page.evaluate(() =>
          [...document.querySelectorAll('article.snippet-listing, article[data-id]')].map((el) => {
            const d = {};
            for (const a of el.attributes) if (a.name.startsWith('data-')) d[a.name] = a.value;
            const link = el.querySelector('a[href*="detailPageUrl"], a[href*="thribee"], a[href]')?.href || '';
            return { d, link, txt: (el.innerText || '').replace(/\s+/g, ' ') };
          })
        );
        let added = 0;
        let skipped = 0;
        for (const it of items) {
          const id = it.d['data-id'];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          // rete client-side: primo prezzo = corrente (il secondo è il barrato)
          const pM = it.txt.match(/([\d.]+)\s*€/);
          const p = pM ? parseInt(pM[1].replace(/[^\d]/g, ''), 10) : null;
          if (p !== null && p > MAX_PREZZO) { skipped++; continue; }
          const mqM = it.txt.match(/(\d+)\s*m²/);
          if (mqM && parseInt(mqM[1], 10) < MIN_MQ) { skipped++; continue; }
          cards.push({ id, url: realUrl(it.link), area: c.name, data: it });
          added++;
        }
        log(`[trovit] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} fuori filtro)`);
        if (items.length === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`page=${n + 1}`)), pageNum);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(2500, 4500));
      }
      await sleep(rand(2000, 3500));
    }
    return cards;
  },

  async scrapeDetail(page, card) {
    const { txt } = card.data;
    // prezzi: il primo è l'attuale, il secondo (se presente) il precedente ribassato
    const prezzi = [...txt.matchAll(/([\d.]+)\s*€/g)].map((m) => parseInt(m[1].replace(/[^\d]/g, ''), 10)).filter((n) => n > 1000);
    const price = prezzi[0] || null;
    const prezzoPrec = prezzi.length > 1 && prezzi[1] > price ? prezzi[1] : null;
    const mqM = txt.match(/(\d+)\s*m²/);
    const localiM = txt.match(/(\d+)\s*local[ie]/i);
    const bagniM = txt.match(/(\d+)\s*bagn[io]/i);
    // "Casa a Saragozza-Porto, Bologna, Provincia di Bologna" / "Appartamento a 40132, Borgo Panigale-Reno, Bologna"
    const locM = txt.match(/(?:Casa|Appartamento|Attico|Villa|Loft|Monolocale)\s+a\s+(?:\d{5},\s*)?([^,]+),\s*([^,]+),/i);
    const zona = locM ? locM[1].trim() : '';
    const comune = locM ? locM[2].trim() : 'Bologna';
    // descrizione: dopo la località, prima dei dati numerici
    const descM = txt.match(/Provincia di Bologna\s+(.+?)\s+\d+\s*local[ie]/i);
    const desc = descM ? descM[1].trim() : '';
    const fonteM = txt.match(/\b([A-Z][A-Z0-9.]+\.(?:IT|COM|it|com))\b/) || txt.match(/\bin\s+([A-Za-z. ]+?)\s*$/i);
    const fonte = fonteM ? fonteM[1].trim() : '';
    const days = ageDays(txt);
    const pubblicatoIl = days != null ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : '';
    const locali = localiM ? parseInt(localiM[1], 10) : null;
    const isAsta = /asta|nuda propriet|tribunale/i.test(txt);
    const cantina = /cantina/i.test(txt);

    return {
      id: card.id,
      url: card.url,
      area: card.area || 'Bologna',
      titolo: desc ? desc.slice(0, 70) : `${locali ? locali + ' locali' : 'Immobile'} ${zona ? 'a ' + zona : ''}`.trim(),
      comune: comune || card.area || 'Bologna',
      provincia: 'BO',
      zona,
      indirizzo: '',
      lat: null,
      lon: null,
      prezzo: price,
      prezzoPrecedente: prezzoPrec,
      tipologia: 'Appartamento',
      locali,
      camere: bedroomsFromText(desc, locali),
      bagni: bagniM ? parseInt(bagniM[1], 10) : null,
      superficieMq: mqM ? parseInt(mqM[1], 10) : null,
      piano: /piano terra/i.test(desc) ? 'terra' : '',
      cantina,
      stato: '',
      ape: '',
      agenzia: fonte && !/privato/i.test(fonte) ? fonte : '',
      privato: /privato/i.test(fonte),
      descrizione: desc || txt,
      pubblicatoIl,
      foto: '',
      isAuction: isAsta,
      fonteAggregata: fonte,
    };
  },
};