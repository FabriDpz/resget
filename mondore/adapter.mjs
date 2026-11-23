// Adattatore mondore.it — Houzez, Playwright headed.
// Listing SOLO su pagina risultati: /risultati-ricerca-immobili/?status=vendita
//   &location[]=…&type[]=…&max-price=160000&min-area=30.
// ⚠️ VERIFICATO LIVE 22/11: min-area=40 INSIEME a max-price → SEMPRE 0 (min-area
//   è a preset: 40 non è un valore accettato in combinazione; 30 e 10 funzionano).
//   max-price=160000 da solo OK (BO 1), min-area=40 da solo OK (BO 44).
//   → min-area=30 server-side + filtro CLIENT-SIDE mq≥40 sul dettaglio.
// type[] obbligatorio per escludere cantine/attività; array ripetuto con
// villa/attico/monolocale/mansarda/casa-indipendente accettato (verificato BO 1).
// Paginazione /risultati-ricerca-immobili/page/N/?<stessi param>.
// Dettaglio /immobile/<slug>/ DOM (ld+json solo WebPage). id dallo slug.
// DOM VERIFICATO 22/11: prezzo li.item-price "145.000,00€" (decimali ,00);
// "Scheda immobile": "Appartamento Tipologia Immobile", "1 Camera da letto",
// "1 Bagno", "33 mq"; sezione Indirizzo: Via/Comune/Provincia/CAP/Zona.
// NB: min-area è in piedi quadri?? NO — 33 mq passava min-area=30: il filtro
// client-side ≥40 sul dettaglio è quindi indispensabile (monolocale 33 scartato).

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://mondore.it';
const RESULTS = `${BASE}/risultati-ricerca-immobili/`;
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const LINK_RE = /\/immobile\/[^/]+\/?$/;
const TYPES = ['appartamento', 'villa', 'attico', 'monolocale', 'mansarda', 'casa-indipendente'];
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'pianoro', name: 'Pianoro' },
  { slug: 'san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
];
const WHITELIST = new Set(['bologna', 'pianoro', 'san lazzaro di savena', 'san-lazzaro-di-savena']);

function queryParams(comuneSlug) {
  const p = new URLSearchParams();
  p.set('status', 'vendita');
  p.append('location[]', comuneSlug);
  for (const t of TYPES) p.append('type[]', t);
  p.set('max-price', String(MAX_PREZZO));
  // min-area=40 + max-price → 0 (bug preset verificato): 30 + rete client-side ≥40.
  p.set('min-area', '30');
  return p.toString();
}
function parsePrice(txt) {
  const t = String(txt || '');
  // "145.000,00€" (decimali) o "145.000 €" o "€ 145.000".
  const m = t.match(/([\d.]{4,})(?:,\d{2})?\s*€/) || t.match(/€\s*([\d.]{4,})/);
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
  id: 'mondore',
  name: 'Mondore',

  probeChecks: {
    listingUrl: `${RESULTS}?${queryParams('bologna')}`,
    cardSelectors: ['a[href*="/immobile/"]'],
    linkPattern: '\\/immobile\\/[^/]+\\/?$',
    minLinks: 1,
    minCards: 0, // portfolio piccolo: listing quasi vuota legittima
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const qs = queryParams(c.slug);
      log(`[mondore] Area ${c.name}: ${RESULTS}?${qs}`);
      let pageNum = 1;
      const maxPages = 10;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const pageUrl = pageNum === 1 ? `${RESULTS}?${qs}` : `${RESULTS}page/${pageNum}/?${qs}`;
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 20000 });
        await dismissCookies(page);
        await humanPause(2000, 4000);
        await checkBlocked(page, resp);
        const links = await page.evaluate((reSrc) => {
          const re = new RegExp(reSrc);
          return [...document.querySelectorAll('a[href*="/immobile/"]')]
            .map((a) => a.href.split('#')[0].split('?')[0])
            .filter((h) => re.test(h));
        }, LINK_RE.source);
        let added = 0;
        for (const h of links) {
          const slug = h.match(/\/immobile\/([^/]+)\/?$/)?.[1];
          if (!slug || seen.has(slug)) continue;
          seen.add(slug);
          cards.push({ id: slug, url: h, area: c.name });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[mondore] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length})`);
        if (added === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`/risultati-ricerca-immobili/page/${n}/`)), pageNum + 1);
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
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const titolo = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const prezzoTxt = document.querySelector('li.item-price')?.textContent?.trim() || '';
      // Scheda immobile: valore PRIMA dell'etichetta ("1 Bagno", "33 mq",
      // "Appartamento Tipologia Immobile").
      const feats = {};
      const inv = (labelRe, valRe) => {
        const m = body.match(new RegExp(valRe + '\\s+(?:' + labelRe + ')\\b', 'i'));
        return m ? m[1].trim() : '';
      };
      feats.tipologia = inv('Tipologia Immobile', '([A-Za-zàèéìòù ]{3,30})');
      feats.camere = inv('Camer[ae] da letto', '(\\d{1,2})');
      feats.bagni = inv('Bagn[io]', '(\\d{1,2})');
      feats.mq = inv('mq|m²|m2', '(\\d{2,5})');
      feats.locali = inv('Locali', '(\\d{1,2})');
      feats.anno = inv('Anno Costruzione', '(\\d{4})');
      // Sezione Indirizzo: "Indirizzo Via X Comune Bologna Provincia Bologna CAP 40138 Zona Massarenti".
      feats.indirizzo = (body.match(/Indirizzo\s+(?:Apri con Google Maps\s+)?Indirizzo\s+(.{3,80}?)\s+Comune\b/i) || [])[1] || '';
      feats.comune = (body.match(/Comune\s+([A-Za-zàèéìòù ]{3,40}?)\s+Provincia\b/i) || [])[1] || '';
      feats.zona = (body.match(/Zona\s+([A-Za-zàèéìòù' ]{3,40}?)(?:\s+[+−]|\s+Efficienza|\s+Classe|\s*$)/i) || [])[1] || '';
      // Classe energetica (sezione Efficienza).
      feats.ape = (body.match(/Classe\s+[Ee]nergetica\s+([A-G][1-4]?)\b/) || [])[1] || '';
      // Descrizione tra "Descrizione" e "Indirizzo".
      let descrizione = '';
      const dIdx = body.search(/Descrizione\s+/);
      if (dIdx >= 0) {
        const rest = body.slice(dIdx + 12);
        const end = rest.search(/\sIndirizzo\s|\sEfficienza\s|\sDettagli\s/);
        descrizione = (end > 0 ? rest.slice(0, end) : rest.slice(0, 3500)).trim();
      }
      const foto = document.querySelector('[class*="gallery"] img, [class*="slider"] img, .listing-slider img, picture img')?.src || '';
      const breadcrumb = [...document.querySelectorAll('[class*="breadcrumb"] a, [class*="breadcrumb"] span')]
        .map((a) => a.textContent.trim()).filter(Boolean);
      return { body: body.slice(0, 12000), titolo, prezzoTxt, feats, descrizione, foto, breadcrumb };
    });

    const f = data.feats;
    const body = data.body;
    const desc = data.descrizione || '';
    const prezzo = parsePrice(data.prezzoTxt) ?? parsePrice(body);
    const mq = firstInt(f['mq']) ?? firstInt((body.match(/(\d{2,5})\s*(?:m²|m2|mq)\b/i) || [])[1]);
    // mq≥40 OBBLIGATORIO client-side (server min-area=30 per bug preset).
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[mondore] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    // Comune: sezione Indirizzo "Comune X", altrimenti breadcrumb, altrimenti area.
    let comune = card.area;
    const cityRaw = String(f['comune'] || '').toLowerCase();
    const crumbTxt = data.breadcrumb.join(' ').toLowerCase();
    const hay = cityRaw || crumbTxt;
    if (/san lazzaro/.test(hay)) comune = 'San Lazzaro di Savena';
    else if (/pianoro/.test(hay)) comune = 'Pianoro';
    else if (/bologna/.test(hay)) comune = 'Bologna';
    else if (cityRaw && !WHITELIST.has(cityRaw.trim())) {
      log(`[mondore] comune fuori whitelist (${cityRaw.slice(0, 40)}): scarto ${card.id}`);
      return null;
    }
    const locali = firstInt(f['locali']);
    const bagni = firstInt(f['bagni']);
    const camere = firstInt(f['camere']) ?? bedroomsFromText(`${data.titolo} ${desc}`, locali);
    const pianoM = desc.match(/piano\s+(terra|rialzato|seminterrato|interrato|ultimo|intermedio|primo|secondo|terzo|quarto|quinto|sesto)/i)
      || desc.match(/(primo|secondo|terzo|quarto|quinto|sesto|ultimo)(?:\s+ed\s+ultimo)?\s+piano/i);
    const piano = pianoM ? pianoM[1] : '';
    const ape = String(f['ape'] || '').toUpperCase().slice(0, 2);
    const stato = /ottime condizioni|ottimo stato/i.test(desc) ? 'ottimo' : (/da ristrutturare/i.test(desc) ? 'da ristrutturare' : (/buon[oe] stato|buone condizioni/i.test(desc) ? 'buono' : ''));
    const balcone = /balcon[ei]|loggia/i.test(`${data.titolo} ${desc}`) ? 'Sì' : '';
    const cantina = /cantina/i.test(desc) ? 'Sì' : '';
    const ascensore = /ascensore/i.test(`${data.titolo} ${desc}`) && !/senza ascensore|no ascensore/i.test(desc) ? 'Sì' : (/senza ascensore|no ascensore/i.test(desc) ? 'No' : '');
    const riscaldamento = /riscaldamento\s+autonomo/i.test(desc) ? 'Autonomo' : (/riscaldamento\s+centralizzato/i.test(desc) ? 'Centralizzato' : '');
    const zonaM = desc.match(/zona\s+([A-Za-zàèéìòù' ]{3,30}?)(?:[,.;]| più| comoda| in\b)/i);

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: data.titolo || 'Immobile in vendita',
      comune,
      provincia: 'BO',
      zona: f['zona'] || (zonaM ? zonaM[1].trim() : ''),
      indirizzo: f['indirizzo'] || '',
      lat: null,
      lon: null,
      prezzo,
      tipologia: f['tipologia'] || 'Appartamento',
      locali,
      camere,
      bagni,
      superficieMq: mq,
      piano,
      ascensore,
      cucina: /cucina\s+separata/i.test(desc) ? 'Separata' : (/cucina\s+a\s+vista|angolo cottura/i.test(desc) ? 'A vista' : ''),
      balcone,
      cantina,
      stato: mapStato(stato),
      ape,
      riscaldamento,
      agenzia: 'Mondore',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};