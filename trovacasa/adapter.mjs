// Adattatore trovacasa.it — Playwright headed (gruppo Immobiliare.it S.p.A.).
// Listing: /case-in-vendita/{comune}?PrezzoMax=160000&MqMin=40&page=N (SSR).
//   Filtri SERVER-SIDE verificati browser reale 22/11 leggendo i name= degli
//   input nel pannello "+ Altre opzioni": PrezzoMax (196 su 3371) e MqMin
//   (196→118, tutte le card ≥40 m²). "SuperficieMinima"/"superficieMinima" sono
//   IGNORATI. "Locali" è ignorato lato URL → si filtra nel runner. Paginazione ?page=N.
//   Card root .card.js_card_immobile: prezzo .card__price, titolo .card__title,
//   feature .card__info ("73 m²", "3 locali"), link /annunci/{slug}-{id}.
// Dettaglio: DOM (no __NEXT_DATA__, no JSON-LD). Dati ricchi:
//   .immobileInfo.info (comune, indirizzo, m², locali), .immobileInfo.price,
//   tag .immobileDetails__tag, descrizione nel body dopo "Descrizione",
//   coordinate negli script inline: var latitude = X; var longitude = Y;
//   foto pic.trovacasa.it/image/{id}/m-c.jpg, agenzia dal blocco publisher.
// Camere da letto: dedotte dalla descrizione (regex) o locali-1.
// Anti-bot: fail-closed (policy §8). Nessun WAF rilevato sul contenuto.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText, zonaFromDescrizione } from '../core/schema.mjs';

const BASE = 'https://www.trovacasa.it';
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'pianoro', name: 'Pianoro' },
  { slug: 'san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
];
const MAX_PREZZO = 160000;

function parseNum(s) {
  const n = parseInt(String(s || '').replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

// Estrae lo stato immobile dal title/h1 e dai tag (es. "ristrutturato", "da ristrutturare").
function statoFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/da ristrutturare|da sistemare|da renovare|in fase di.*ristrutturazione|totale ristrutturazione/.test(t)) return mapStato('da ristrutturare');
  if (/ristrutturat|pari al nuovo|ottimo stato|perfetto/.test(t)) return mapStato('ristrutturato');
  if (/nuova costruzione|nuovo|in costruzione/.test(t)) return mapStato('nuovo');
  if (/abitabile|buono stato|discreto/.test(t)) return mapStato('abitabile');
  return '';
}

export default {
  id: 'trovacasa',
  name: 'Trovacasa.it',

  probeChecks: {
    listingUrl: 'https://www.trovacasa.it/case-in-vendita/bologna?PrezzoMax=160000&MqMin=40',
    cardSelectors: ['.card.js_card_immobile a[href*="/annunci/"]'],
    linkPattern: '\\/annunci\\/[\\w-]+',
    minLinks: 5,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const url = `${BASE}/case-in-vendita/${c.slug}?PrezzoMax=${MAX_PREZZO}&MqMin=40`;
      log(`[trovacasa] Area ${c.name}: ${url}`);
      let pageNum = 1;
      const maxPages = 12;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const pageUrl = pageNum === 1 ? url : `${url}&page=${pageNum}`;
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 30000 });
        await dismissCookies(page);
        await humanPause(2500, 4000);
        await checkBlocked(page, resp);
        await page.waitForSelector('.card.js_card_immobile a[href*="/annunci/"]', { timeout: 8000 }).catch(() => {});
        const rows = await page.evaluate(() => {
          const roots = [...document.querySelectorAll('.card.js_card_immobile')];
          return roots.map((card) => {
            const a = card.querySelector('a[href*="/annunci/"]');
            const href = a?.href || '';
            const id = (href.match(/\/annunci\/([\w-]+)/) || [])[1] || null;
            const price = card.querySelector('.card__price')?.textContent?.trim() || '';
            const title = card.querySelector('.card__title')?.textContent?.trim() || '';
            const feats = [...card.querySelectorAll('.card__info')].map((e) => (e.textContent || '').trim());
            return { id, url: href.split('#')[0].split('?')[0], price, title, feats };
          }).filter((r) => r.id);
        });
        let added = 0;
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          cards.push({ id: r.id, url: r.url, area: c.name, price: r.price, title: r.title, feats: r.feats });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[trovacasa] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length})`);
        if (added === 0) break;
        const hasNext = await page.evaluate((n) => {
          return [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`page=${n + 1}`));
        }, pageNum);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(2500, 4500));
      }
      await sleep(rand(2000, 4000));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 25000 });
    await dismissCookies(page);
    await humanPause(2000, 3500);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';
      const title = document.title || '';
      const infoBlock = document.querySelector('.immobileInfo.info')?.innerText?.trim().replace(/\s+/g, ' ') || '';
      const priceTxt = document.querySelector('.immobileInfo.price')?.textContent?.trim() || '';
      const addrTxt = document.querySelector('.indirizzo')?.innerText?.trim().replace(/\s+/g, ' ') || '';
      const tags = [...document.querySelectorAll('.immobileDetails__tag')].map((e) => (e.textContent || '').trim()).filter(Boolean);
      // descrizione: testo dopo "Descrizione" nel body
      const di = body.search(/Descrizione/i);
      const desc = di >= 0 ? body.slice(di + 11, di + 4000).trim() : '';
      // coordinate dagli script inline
      const scripts = [...document.querySelectorAll('script')].map((s) => s.textContent).join('\n');
      const latM = scripts.match(/var\s+latitude\s*=\s*([\d.]+)/i);
      const lonM = scripts.match(/var\s+longitude\s*=\s*([\d.]+)/i);
      // foto reali dell'immobile (gallery)
      const gal = [...document.querySelectorAll('[class*="gallery"] img,[class*="slider"] img,[class*="foto"] img')]
        .map((i) => i.src || i.dataset?.src || '').filter((s) => /pic\.trovacasa\.it\/image\//.test(s));
      const foto = gal[0] ? gal[0].replace(/\/[a-z-]+\.jpg$/i, '/l-c.jpg') : '';
      // agenzia: blocco publisher
      const agEl = [...document.querySelectorAll('*')].find((e) => /(?:Il gruppo|agenzia|immobiliare|real estate)\s+[A-Z]/i.test(e.textContent || '') && (e.textContent || '').length < 120 && e.children.length <= 3);
      const agenzia = agEl?.textContent?.trim().replace(/\s+/g, ' ') || '';
      // bagni dal testo
      const bm = body.match(/(\d+)\s*bagn[io]/i);
      return { h1, title, infoBlock, priceTxt, addrTxt, tags, desc, lat: latM?.[1] || null, lon: lonM?.[1] || null, foto, agenzia, bagni: bm?.[1] || null };
    });
    if (!data.priceTxt && !data.infoBlock) return null;

    // infoBlock: "Bologna, Vicolo Dè Facchini 34 m² 1 locale"
    const mqM = data.infoBlock.match(/([\d.]+)\s*m²/i);
    const localiM = data.infoBlock.match(/(\d+)\s*local[ei]/i);
    const superficieMq = mqM ? parseNum(mqM[1]) : null;
    const locali = localiM ? parseInt(localiM[1], 10) : null;
    // addrTxt: "Bologna, Vicolo Dè Facchini"
    const addrParts = data.addrTxt.split(',').map((s) => s.trim());
    const comune = addrParts[0] || card.area || '';
    const indirizzo = addrParts.slice(1).join(', ').trim();
    const prezzo = parseNum(data.priceTxt);
    const camere = bedroomsFromText(data.desc, locali);
    const tagStr = data.tags.join(', ');
    const stato = statoFromText(`${data.title} ${data.h1} ${tagStr} ${data.desc.slice(0, 300)}`);
    const zona = zonaFromDescrizione(data.desc) || '';
    const privato = /da privato|privato/i.test(data.agenzia) && !/agenzia|gruppo|immobiliare|real estate/i.test(data.agenzia);

    return {
      id: String(card.id),
      url: card.url,
      area: card.area,
      titolo: data.h1 || `${card.title || 'Immobile'} in vendita`,
      comune,
      provincia: 'Bologna',
      zona,
      indirizzo,
      lat: data.lat ? parseFloat(data.lat) : null,
      lon: data.lon ? parseFloat(data.lon) : null,
      prezzo,
      tipologia: (data.h1.match(/^(\w+)\s+in vendita/i) || [])[1] || card.title?.split(' ')[0] || '',
      locali,
      camere,
      bagni: data.bagni ? parseInt(data.bagni, 10) : null,
      superficieMq,
      piano: (data.desc.match(/piano\s+(terra|primo|secondo|terzo|quarto|quinto|\d+)/i) || [])[1] || '',
      ascensore: /senza ascensore/i.test(data.desc) ? 'No' : (/ascensore/i.test(tagStr) ? 'Sì' : ''),
      balcone: /balcon/i.test(tagStr) ? 'Sì' : '',
      cantina: /cantin/i.test(tagStr) ? 'Sì' : '',
      terrazzo: /terrazz/i.test(tagStr) ? 'Sì' : '',
      stato,
      ape: (tagStr.match(/\b([A-G][1-4]?)\b/) || [])[1] || '',
      riscaldamento: /riscaldamento autonomo/i.test(tagStr) ? 'Autonomo' : (/riscaldamento centralizzato/i.test(tagStr) ? 'Centralizzato' : ''),
      altreCaratteristiche: tagStr,
      agenzia: data.agenzia,
      privato,
      descrizione: data.desc,
      foto: data.foto,
      planimetrie: [],
      isAuction: /all'asta|asta giudiziaria/i.test(`${data.title} ${tagStr}`),
    };
  },
};