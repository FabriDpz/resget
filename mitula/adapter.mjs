// Adattatore mitula (immobiliare.mitula.it) — aggregatore Playwright.
// Le card del listing espongono data-attributes completi (prezzo, locali, mq,
// zona, città, listingid) + testo (bagni, età annuncio, fonte). Non serve il
// dettaglio: i dati card bastano per flip e dedup.
// ⚠️ VERIFICA BROWSER REALE 22/11: la URL SEO "-160000-euro" significa "INTORNO
// a 160000" (card fino a 179k+). Il filtro VERO è l'endpoint /find generato dal
// pannello Prezzo: /find?geoId={id}&operationType=sell&propertyType=apartment
//   &maxPrice=160000&minArea=40 (Bologna 276→171 con minArea; tutti ≤160k, mq≥40).
// geoId (dal form): Bologna=R43172, Pianoro=R43050, San Lazzaro=R43173
//   (il geoId composito "mitula-IT-poblacion-…#R43173" del form SL funziona ma
//   la forma semplice R43173 è equivalente). Paginazione ?page=N.
// ⚠️ FALLBACK: se i risultati esatti sono 0 il sito mostra "l'abbiamo ampliata"
//   con annunci fuori filtro → guardia sul messaggio + rete client-side.
// Una sola fascia ≤160k: gli SMA ≤130k sono sottoinsieme, il profilo li separa.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://immobiliare.mitula.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const COMUNI = [
  { geoId: 'R43172', name: 'Bologna' },
  { geoId: 'R43050', name: 'Pianoro' },
  { geoId: 'R43173', name: 'San Lazzaro di Savena' },
];

function decodeClick(b64) {
  try {
    const url = Buffer.from(b64, 'base64').toString('utf8');
    const m = url.match(/detailPageUrl=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    return url;
  } catch { return ''; }
}
// "1 giorno, 2 ore fa" / "1 settimana, 3 giorni fa" → giorni fa (per STALE)
function ageDays(txt) {
  let d = 0;
  const w = txt.match(/(\d+)\s*settiman/i); if (w) d += +w[1] * 7;
  const g = txt.match(/(\d+)\s*giorn/i); if (g) d += +g[1];
  const mo = txt.match(/(\d+)\s*mes[ei]/i); if (mo) d += +mo[1] * 30;
  if (/oggi|ore fa|minut/i.test(txt) && d === 0) return 0;
  return d || null;
}

export default {
  id: 'mitula',
  name: 'Mitula',

  // Le card mitula non hanno <a href>: il link è nel data-clickdestination
  // (base64) → nessun linkPattern verificabile via DOM, bastano le card.
  probeChecks: {
    listingUrl: 'https://immobiliare.mitula.it/find?geoId=R43172&operationType=sell&propertyType=apartment&maxPrice=160000&minArea=40',
    cardSelectors: ['article.listing-card', 'article[data-listingid]'],
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
        log(`[mitula] ${c.name} pag ${pageNum}: ${pageUrl}`);
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 25000 });
        await dismissCookies(page);
        await humanPause(2500, 4000);
        await checkBlocked(page, resp);
        // Guardia fallback: messaggio "l'abbiamo ampliata" = risultati esatti 0
        const expanded = await page.evaluate(() =>
          /l'abbiamo ampliata|Non abbiamo trovato corrispondenze esatte/i.test(document.body?.innerText || ''));
        if (expanded) {
          log(`[mitula] ${c.name}: fallback risultati ampliati → area saltata (0 risultati esatti)`);
          break;
        }
        const items = await page.evaluate(() =>
          [...document.querySelectorAll('article.listing-card, article[data-listingid]')].map((el) => {
            const d = {};
            for (const a of el.attributes) if (a.name.startsWith('data-')) d[a.name] = a.value;
            return { d, txt: (el.innerText || '').replace(/\s+/g, ' ') };
          })
        );
        let added = 0;
        let skipped = 0;
        for (const it of items) {
          const id = it.d['data-listingid'];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          // rete client-side prezzo/mq dai data-attributes
          const p = parseInt(String(it.d['data-price'] || '').replace(/[^\d]/g, ''), 10) || null;
          const mq = parseInt(String(it.d['data-floorarea'] || '').replace(/[^\d]/g, ''), 10) || null;
          if (p !== null && p > MAX_PREZZO) { skipped++; continue; }
          if (mq !== null && mq < MIN_MQ) { skipped++; continue; }
          cards.push({ id, url: decodeClick(it.d['data-clickdestination'] || '') || `${BASE}/adclickdetail/${id}`, area: c.name, data: it });
          added++;
        }
        log(`[mitula] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} fuori filtro)`);
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

  // Nessun viaggio in dettaglio: i dati sono già nella card raccolta.
  async scrapeDetail(page, card) {
    const { d, txt } = card.data;
    const price = parseInt(String(d['data-price'] || '').replace(/[^\d]/g, ''), 10) || null;
    const mq = parseInt(String(d['data-floorarea'] || '').replace(/[^\d]/g, ''), 10) || null;
    const locali = parseInt(d['data-rooms'], 10) || null;
    const bagniM = txt.match(/(\d+)\s*Bagno/i);
    const fonteM = txt.match(/\bin\s+([A-Za-z. ]+?)\s*$/i);
    const fonte = fonteM ? fonteM[1].trim() : '';
    const hood = d['data-neighbourhood'] || '';
    const city = d['data-city'] || '';
    const days = ageDays(txt);
    const pubblicatoIl = days != null ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : '';
    const ascensore = /ascensore/i.test(txt);
    const isAsta = /asta|nuda propriet|tribunale/i.test(txt);

    return {
      id: card.id,
      url: card.url,
      area: card.area || 'Bologna',
      titolo: `${locali ? locali + ' locali' : 'Appartamento'} ${hood ? 'a ' + hood : ''}`.trim(),
      comune: city || card.area || 'Bologna',
      provincia: 'BO',
      zona: hood,
      indirizzo: '',
      lat: null,
      lon: null,
      prezzo: price,
      tipologia: 'Appartamento',
      locali,
      camere: bedroomsFromText(txt, locali),
      bagni: bagniM ? parseInt(bagniM[1], 10) : null,
      superficieMq: mq,
      piano: '',
      ascensore,
      stato: '',
      ape: '',
      agenzia: fonte && !/privato/i.test(fonte) ? fonte : '',
      privato: /privato/i.test(fonte),
      descrizione: txt,
      pubblicatoIl,
      foto: '',
      isAuction: isAsta,
      fonteAggregata: fonte,
    };
  },
};