// Adattatore bakeca.it — Playwright. Sottodominio città bologna.bakeca.it.
// Listing: /annunci/vendita-case/mqcaseinvendita/40-0/prezzoimmobile/0-160000/
//   Filtri NATIVI via slug {campo}/{min}-{max}/ (probe 21/11): il server IGNORA
//   qualsiasi query string. Paginazione /page/N/ in coda agli slug. 141 vs 519 annunci.
// Dettaglio: JSON-LD Product + DOM "Dettagli" (Prezzo, Inserzionista, Tipo,
// Metri quadri, Arredato, Classe energetica, Comune, Quartiere) + Pubblicato il.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const SUB = 'https://bologna.bakeca.it';
// Bologna + hinterland: il sottodominio bologna copre l'area; filtriamo per comune nel dettaglio.
const LIST_URL = `${SUB}/annunci/vendita-case/mqcaseinvendita/40-0/prezzoimmobile/0-160000/`;

function parseNum(s) { const n = parseInt(String(s).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; }
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&igrave;/g, 'ì').replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à').replace(/&ograve;/g, 'ò').replace(/&ugrave;/g, 'ù').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
}
function statoFromText(t) {
  t = String(t || '').toLowerCase();
  if (/da ristrutturare|da restaurare|da rimodernare|da sistemare/.test(t)) return 'Da ristrutturare';
  if (/ristrutturat[ao]|pari al nuovo|nuovo|recente costruzione|perfetto stato/.test(t)) return 'Ottimo / Ristrutturato';
  if (/buono stato|abitabile|buone condizioni|discreto/.test(t)) return 'Buono / Abitabile';
  return '';
}
function labelVal(flat, label) {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*([^A-Z][^\\n]*?)(?=\\s+(?:Prezzo|Inserzionista|Tipo immobile|Metri quadri|Arredato|Classe energetica|Comune|Quartiere|Piano|Locali|Bagni|Descrizione)\\b|$)', 'i');
  const m = flat.match(re);
  return m ? m[1].trim() : '';
}

export default {
  id: 'bakeca',
  name: 'Bakeca',

  probeChecks: {
    listingUrl: 'https://bologna.bakeca.it/annunci/vendita-case/mqcaseinvendita/40-0/prezzoimmobile/0-160000/',
    cardSelectors: ['a[href*="/dettaglio/vendita-case/"]'],
    linkPattern: '\\/dettaglio\\/vendita-case\\/.+[a-z0-9]{6,}$',
    minLinks: 5,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    let pageNum = 1;
    const maxPages = 15;
    while (pageNum <= maxPages && cards.length < maxAds) {
      const pageUrl = pageNum === 1 ? LIST_URL : `${LIST_URL}page/${pageNum}/`;
      log(`[bakeca] Listing pag ${pageNum}: ${pageUrl}`);
      const resp = await gotoResilient(page, pageUrl, { log, baseWait: 25000 });
      await dismissCookies(page);
      await humanPause(2200, 3800);
      await checkBlocked(page, resp);
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/dettaglio/vendita-case/"]')]
          .map((a) => a.href.split('#')[0].split('?')[0])
          .filter((h) => /\/dettaglio\/vendita-case\/.+[a-z0-9]{6,}$/.test(h))
      );
      let added = 0;
      for (const h of links) {
        const id = h.match(/([a-z0-9]{6,})$/)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        cards.push({ id, url: h, area: 'Bologna' });
        added++;
      }
      log(`[bakeca] pag ${pageNum}: +${added} (tot ${cards.length})`);
      if (added === 0) break;
      const hasNext = await page.evaluate((n) =>
        [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`/page/${n + 1}/`)), pageNum);
      if (!hasNext) break;
      pageNum++;
      await sleep(rand(2500, 4500));
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
      return { ld, flat: (document.body?.innerText || '').replace(/\s+/g, ' ') };
    });
    const flat = data.flat;
    let prod = null;
    for (const b of data.ld) {
      const types = Array.isArray(b['@type']) ? b['@type'] : [b['@type']];
      if (types.includes('Product') || types.includes('SingleFamilyResidence') || types.includes('Apartment')) prod = b;
    }
    const desc = decodeEntities(prod?.description || '');
    const titoloM = flat.match(/(?:Torna alla ricerca.*?Case\s+)?((?:Monolocale|Bilocale|Trilocale|Quadrilocale|Appartamento|Attico|Loft|Villa|Villetta|Casa|Terratetto)[^€]{0,80}?)\s+[\d.]+\s*€/i);
    const prezzoM = flat.match(/Prezzo:\s*([\d.]+)\s*€/) || flat.match(/([\d.]+)\s*€/);
    const mqM = flat.match(/Metri quadri[^:]*:\s*([\d.]+)/i) || flat.match(/(\d+)\s*m²/);
    const tipoM = flat.match(/Tipo immobile:\s*([A-Za-zà ]+?)(?=\s+(?:Metri|Arredato|Classe|Comune|Quartiere|Prezzo|Inserzionista))/i);
    const comuneM = flat.match(/Comune\s+([A-Za-zàèéìòù' ]+?)(?=\s+Quartiere|\s+Descrizione|\s+Prezzo|$)/i);
    const quartiereM = flat.match(/Quartiere:\s*([A-Za-zàèéìòù'/ ]+?)(?=\s+Descrizione|\s+Prezzo|$)/i);
    const inserzM = flat.match(/Inserzionista:\s*(Agenzia|Privato)/i);
    const arredM = flat.match(/Arredato:\s*([A-Za-zà ]+?)(?=\s+Classe|\s+Comune|\s+Quartiere)/i);
    const apeM = flat.match(/Classe energetica:\s*([A-G][1-4]?)/i);
    const pubM = flat.match(/Pubblicato il\s+(\d{2}\/\d{2}\/\d{4})/i);
    const bagniM = flat.match(/(\d+)\s*bagn[io]/i) || desc.match(/(\d+)\s*bagn[io]/i);
    const localiM = flat.match(/con\s+(\d+)\s*local[ie]/i) || desc.match(/(\d+)\s*local[ie]/i);
    const pianoM = desc.match(/(?:al\s+)?(primo|secondo|terzo|quarto|quinto|sesto|ultimo|terra|rialzato|seminterrato|interrato)\s+piano/i);
    const indirizzoM = desc.match(/(?:Via|Viale|Piazza|Vicolo|Largo|Corso)\s+[A-Z][A-Za-zàèéìòù' ]{2,38}(?:\s+\d+)?/i);
    const fotoM = flat.match(/Galleria/) ? (prod?.image || '') : '';
    const isAsta = /asta|tribunale|rge\s*\d|nuda propriet/i.test(flat + ' ' + desc);

    const camere = bedroomsFromText(desc + ' ' + (titoloM ? titoloM[1] : ''));
    const pubDate = pubM ? pubM[1].split('/').reverse().join('-') : '';

    return {
      id: card.id,
      url: card.url,
      area: 'Bologna',
      titolo: titoloM ? titoloM[1].trim() : 'Immobile in vendita',
      comune: comuneM ? comuneM[1].trim() : '',
      provincia: 'BO',
      zona: quartiereM ? quartiereM[1].trim() : '',
      indirizzo: indirizzoM ? indirizzoM[0] : '',
      lat: null,
      lon: null,
      prezzo: prezzoM ? parseNum(prezzoM[1]) : null,
      tipologia: tipoM ? tipoM[1].trim() : 'Appartamento',
      locali: localiM ? parseNum(localiM[1]) : null,
      camere,
      bagni: bagniM ? parseNum(bagniM[1]) : null,
      superficieMq: mqM ? parseNum(mqM[1]) : null,
      piano: pianoM ? pianoM[1] : '',
      arredato: /arredato|parziale|completo/i.test(arredM?.[1] || '') && !/non arredato/i.test(arredM?.[1] || ''),
      stato: mapStato(statoFromText(desc)),
      ape: apeM ? apeM[1].toUpperCase() : '',
      agenzia: inserzM && inserzM[1] === 'Agenzia' ? 'Agenzia (Bakeca)' : '',
      privato: inserzM ? inserzM[1] === 'Privato' : false,
      descrizione: desc,
      pubblicatoIl: pubDate,
      foto: typeof fotoM === 'string' ? fotoM : (fotoM?.[0] || ''),
      isAuction: isAsta,
    };
  },
};