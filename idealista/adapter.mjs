// Adattatore idealista.it — Playwright (headed, profilo persistente).
// Listing: /vendita-case/{provincia}/{comune}/ con paginazione lista-N.htm.
//   Card: article.item[data-element-id] → a.item-link (/immobile/{id}/),
//   .item-price, .item-price-by-area, .item-detail-char, .item-description.
// Dettaglio: lista .details-property-feature (mq, locali, bagni, stato, piano,
//   ascensore, APE, riscaldamento, cantina…) + descrizione + mappa (lat/lon).
// Nessun JSON-LD: parsing DOM + testo. Anti-bot: fail-closed (policy §8).

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.idealista.it';
// Slug col TRATTINO (provincia-comune), scoperto col browser agent-controlled.
const COMUNI = [
  { slug: 'bologna-bologna', name: 'Bologna' },
  { slug: 'bologna-pianoro', name: 'Pianoro' },
  { slug: 'bologna-san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
];
// Filtro prezzo via URL "con-prezzo_160000" (impostando "Max 160.000" nel filtro
// UI: l'URL risultante è /vendita-case/{slug}/con-prezzo_160000/, NON
// "con-prezzo-massimo_" che dà 404). 142 annunci ≤160k a Bologna (22/11).
// Filtro superficie: token SEO "dimensione_40" = MINIMO mq (verificato browser
// reale 22/11 dai link preset del dropdown Dimensione: dimensione_N=min,
// dimensione-max_N=max; 142→81 con dimensione_40). "dimensione-da_40" dà 404.
// Filtro anche client-side su .item-price come rete di sicurezza.
const MAX_PREZZO = 160000;
const FILTRI_PATH = `con-prezzo_${MAX_PREZZO},dimensione_40`;

function parsePrice(txt) {
  const m = String(txt || '').replace(/\./g, '').match(/(\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}
function statoFromText(t) {
  t = String(t || '').toLowerCase();
  if (/da ristrutturare|da restaurare|da rimodernare|da sistemare/.test(t)) return 'Da ristrutturare';
  if (/ristrutturat[ao]|pari al nuovo|ottimo stato|nuovo/.test(t)) return 'Ottimo / Ristrutturato';
  if (/buono stato|abitabile|buone condizioni|discreto/.test(t)) return 'Buono / Abitabile';
  return '';
}

export default {
  id: 'idealista',
  name: 'Idealista',

  probeChecks: {
    listingUrl: 'https://www.idealista.it/vendita-case/bologna-bologna/con-prezzo_160000,dimensione_40/',
    cardSelectors: ['article.item[data-element-id] a.item-link'],
    linkPattern: '\\/immobile\\/\\d+',
    minLinks: 3,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const baseUrl = `${BASE}/vendita-case/${c.slug}/${FILTRI_PATH}/`;
      log(`[idealista] Area ${c.name}: ${baseUrl}`);
      let pageNum = 1;
      const maxPages = 15;
      while (pageNum <= maxPages && cards.length < maxAds) {
        // pag 1 = URL base; pag N = {baseUrl}lista-N.htm (token filtri preservati)
        const pageUrl = pageNum === 1 ? baseUrl : `${baseUrl}lista-${pageNum}.htm`;
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 25000 });
        await dismissCookies(page);
        await humanPause(2500, 4200);
        await checkBlocked(page, resp);
        const rows = await page.evaluate(() =>
          [...document.querySelectorAll('article.item[data-element-id]')].map((a) => {
            const id = a.getAttribute('data-element-id');
            const link = a.querySelector('a.item-link, a[href*="/immobile/"]');
            const prof = a.getAttribute('data-is-professional-ad');
            const price = a.querySelector('.item-price')?.textContent?.trim() || '';
            return {
              id,
              url: link ? link.href.split('#')[0].split('?')[0] : null,
              privato: prof === 'false',
              price,
            };
          })
        );
        let added = 0;
        let skippedPrice = 0;
        for (const r of rows) {
          if (!r.id || !r.url || seen.has(r.id)) continue;
          seen.add(r.id);
          const p = parsePrice(r.price);
          if (p !== null && p > MAX_PREZZO) { skippedPrice++; continue; }
          cards.push({ id: r.id, url: r.url, area: c.name, privato: r.privato });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[idealista] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skippedPrice} oltre budget)`);
        if (rows.length === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`lista-${n + 1}.htm`)), pageNum);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(3000, 5500));
      }
      await sleep(rand(2500, 4500));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 20000 });
    await dismissCookies(page);
    await humanPause(2200, 3800);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const title = document.querySelector('h1, .main-info__title')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const priceTxt = document.querySelector('.info-data-price, .price, .item-price')?.textContent || '';
      const priceMqTxt = document.querySelector('.item-price-by-area, .price-by-area')?.textContent || '';
      // Caratteristiche strutturate
      const features = [...document.querySelectorAll('.details-property-feature, .details-property li, .info-features li, .details-property_features li')]
        .map((li) => li.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      // Descrizione dell'inserzionista
      const descEl = document.querySelector('.comment, .adCommentsLanguage, [class*="description"] .expandable, .description');
      const descrizione = (descEl?.textContent || '').replace(/\s+/g, ' ').trim();
      // Agenzia / privato
      const agencyEl = document.querySelector('.professional-name, .advertiser-name, [class*="professional"] a, .commercial-name');
      const agenzia = agencyEl?.textContent?.replace(/\s+/g, ' ').trim() || '';
      // Coordinate dalla mappa (data attributi o script)
      let lat = null, lon = null;
      const mapEl = document.querySelector('[data-lat], [data-latitude], #map, .map-container');
      if (mapEl) {
        lat = parseFloat(mapEl.getAttribute('data-lat') || mapEl.getAttribute('data-latitude')) || null;
        lon = parseFloat(mapEl.getAttribute('data-lng') || mapEl.getAttribute('data-longitude')) || null;
      }
      if (lat == null) {
        const m = body.match(/"latitude"\s*:\s*([-\d.]+)\s*,\s*"longitude"\s*:\s*([-\d.]+)/);
        if (m) { lat = parseFloat(m[1]); lon = parseFloat(m[2]); }
      }
      // Foto principale
      const foto = document.querySelector('.main-image img, picture img, .detail-multimedia img')?.src || '';
      // Planimetrie inline (rare): alt/caption le marca come "planimetria".
      // Quelle nella galleria multimedia si raccolgono dopo il click sul
      // bottone "N planimetrie" (vedi sotto, fuori dall'evaluate).
      const planimetrie = [...document.querySelectorAll('img, picture source')]
        .map((el) => ({
          url: el.src || el.srcset?.split(/[ ,]/)[0] || '',
          caption: `${el.alt || ''} ${el.title || ''}`.trim(),
        }))
        .filter((p) => p.url && /floor\s*plan|planimetr/i.test(p.caption))
        .filter((p, i, arr) => arr.findIndex((x) => x.url === p.url) === i);
      // Zona dal breadcrumb / sottotitolo
      const sub = document.querySelector('.main-info__title-minor, .header-map-list, [class*="subtitle"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      return { title, priceTxt, priceMqTxt, features, descrizione, agenzia, lat, lon, foto, sub, planimetrie, body: body.slice(0, 6000) };
    });

    // Planimetrie dalla galleria multimedia: il bottone "N planimetrie" apre
    // /immobile/<id>/planimetria/N/ con immagini WEB_DETAIL-XL a tutta pagina.
    // Servono per la verifica visiva delle camere reali (caso 29655698:
    // trilocale dichiarato, la planimetria mostra 1 sola camera).
    const planBtn = await page.$('button.icon-plan, button.multimedia-shortcuts-button:has-text("planimetr")');
    if (planBtn) {
      const detailUrl = page.url();
      const btnTxt = (await planBtn.textContent().catch(() => '')) || '';
      const nM = btnTxt.match(/(\d+)/);
      const nPlans = nM ? Math.min(parseInt(nM[1], 10), 4) : 1;
      await planBtn.click().catch(() => {});
      await humanPause(2500, 4000);
      for (let i = 1; i <= nPlans; i++) {
        if (i > 1) {
          await gotoResilient(page, `${card.url.replace(/\/$/, '')}/planimetria/${i}/`, { log, baseWait: 15000 }).catch(() => null);
          await humanPause(2000, 3500);
        }
        const urls = await page.evaluate(() =>
          [...document.querySelectorAll('img[src*="WEB_DETAIL-XL"]')]
            .filter((el) => el.offsetWidth || el.offsetHeight)
            .map((el) => el.src));
        for (const url of urls) {
          if (!data.planimetrie.some((p) => p.url === url)) {
            data.planimetrie.push({ url, caption: `Planimetria ${data.planimetrie.length + 1}` });
          }
        }
      }
      // Torna alla pagina di dettaglio per il resto del flusso del runner
      await gotoResilient(page, detailUrl, { log, baseWait: 15000 }).catch(() => null);
      await humanPause(2000, 3000);
    }

    const feat = data.features.join(' | ');
    const body = data.body;
    const desc = data.descrizione || '';
    const all = `${feat} ${desc}`;

    // Superficie
    const mqM = feat.match(/(\d+)\s*m²/i) || body.match(/(\d+)\s*m²/);
    const superficieMq = mqM ? parseInt(mqM[1], 10) : null;
    // Locali
    const localiM = feat.match(/(\d+)\s*local[io]/i) || body.match(/(\d+)\s*local[io]/);
    const locali = localiM ? parseInt(localiM[1], 10) : null;
    // Bagni
    const bagniM = feat.match(/(\d+)\s*bagno/i);
    const bagni = bagniM ? parseInt(bagniM[1], 10) : null;
    // Camere: idealista raramente le espone → bedroomsFromText
    const camere = bedroomsFromText(`${data.title} ${desc}`, locali);
    // Piano
    const pianoM = feat.match(/(\d+º?\s*piano|piano\s+terra|seminterrato|interrato|ultimo\s+piano|piano\s+rialzato)/i)
      || body.match(/(\d+º\s*piano|piano\s+terra|seminterrato|interrato)/i);
    const piano = pianoM ? pianoM[1].replace(/\s+/g, ' ').trim() : '';
    // Ascensore
    let ascensore = '';
    if (/senza ascensore/i.test(all)) ascensore = 'No';
    else if (/con ascensore|ascensore/i.test(all)) ascensore = 'Sì';
    // Stato
    const statoM = feat.match(/(Buono stato|Ottimo stato|Da ristrutturare|Nuovo|Pari al nuovo|Abitabile)/i);
    const stato = mapStato(statoM ? statoM[1] : statoFromText(all));
    // APE
    const apeM = feat.match(/Classe energetica[:\s]*([A-G][1-4]?|Non indicato)/i) || body.match(/Classe energetica[:\s]*([A-G][1-4]?)/i);
    const ape = apeM && /non indicato/i.test(apeM[1]) ? '' : (apeM ? apeM[1].toUpperCase() : '');
    // Riscaldamento
    const riscM = feat.match(/Riscaldamento([^|]+)/i);
    const riscaldamento = riscM ? riscM[1].trim() : '';
    // Cantina / balcone / terrazzo / giardino / arredato
    const cantina = /cantina/i.test(feat) ? 'Sì' : '';
    const balcone = /balcon/i.test(all) ? 'Sì' : '';
    const terrazzo = /terrazz/i.test(all) ? 'Sì' : '';
    const arredato = /arredat/i.test(all) ? 'Sì' : (/non arredat/i.test(all) ? 'No' : '');
    // Prezzo
    const prezzo = parsePrice(data.priceTxt) ?? parsePrice(body);
    // Zona: dal sottotitolo "Irnerio, Bologna" → prima parte
    let zona = '';
    if (data.sub) {
      const z = data.sub.split(',')[0].trim();
      if (z && !/bologna|pianoro|san lazzaro/i.test(z)) zona = z;
    }
    // Comune dal titolo/breadcrumb
    let comune = card.area || '';
    const comM = body.match(/(?:a|in)\s+(Bologna|Pianoro|San Lazzaro di Savena)\b/i);
    if (comM) comune = comM[1];

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: data.title || 'Immobile in vendita',
      comune,
      provincia: 'BO',
      zona,
      indirizzo: '',
      lat: data.lat,
      lon: data.lon,
      prezzo,
      prezzoMq: data.priceMqTxt?.trim() || '',
      tipologia: /monolocale/i.test(data.title) ? 'Monolocale' : (/villa/i.test(data.title) ? 'Villa' : 'Appartamento'),
      locali,
      camere,
      bagni,
      superficieMq,
      piano,
      ascensore,
      cucina: '',
      arredato,
      balcone,
      terrazzo,
      cantina,
      stato,
      ape,
      riscaldamento,
      agenzia: data.agenzia || (card.privato ? '' : 'Idealista'),
      privato: card.privato ?? false,
      descrizione: desc,
      foto: data.foto || '',
      planimetrie: data.planimetrie || [],
      planimetriaUrl: data.planimetrie?.[0]?.url || '',
    };
  },
};