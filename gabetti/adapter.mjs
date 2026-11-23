// Adattatore gabetti.it — Next.js SSR, Playwright headed.
// Listing: /vendita/{comune}?prezzoMax=160000&mqMin=40 (server-side VERIFICATO
// 22/11: BO 10, Pianoro 1, San Lazzaro 0). Paginazione ?page=N mantenendo i filtri.
// Dettaglio: NO JSON-LD → parsing DOM (h1, prezzo €, caratteristiche sul body
// innerText). Comune dal path dell'URL /vendita/<comune>/<tipo>/<id>.
// Filtri server-side completi: nessun filtro client-side prezzo/mq necessario,
// ma resta la rete di sicurezza sul dettaglio (come tempocasa).

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.gabetti.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const LINK_RE = /\/vendita\/[^/]+\/[^/]+\/\d+$/;
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'pianoro', name: 'Pianoro' },
  { slug: 'san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
];
const WHITELIST = new Set(['bologna', 'pianoro', 'san-lazzaro-di-savena']);
// Il portale mescola magazzino/box/cantina tra i risultati anche coi filtri mq/prezzo.
const NON_RESIDENZIALE = new Set(['magazzino', 'box', 'box-auto', 'garage', 'cantina', 'capannone', 'ufficio', 'negozio', 'locale-commerciale', 'attivita', 'terreno', 'posto-auto', 'bar', 'ristorante', 'albergo', 'hotel', 'stabile-palazzo']);

function slugToName(slug) {
  const c = COMUNI.find((x) => x.slug === slug);
  return c ? c.name : '';
}
function parsePrice(txt) {
  const t = String(txt || '');
  // Gabetti: "150.000 €" (importo PRIMA del simbolo).
  const m = t.match(/([\d.]{4,})\s*€/) || t.match(/€\s*([\d.]{4,})/);
  return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
}
function firstInt(txt) {
  const m = String(txt || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
function feat(body, labelRe, valRe = '([^.;|\\n]{1,40})') {
  const m = body.match(new RegExp('(?:' + labelRe + ')\\s*[:\\s]\\s*' + valRe, 'i'));
  return m ? m[1].trim() : '';
}

export default {
  id: 'gabetti',
  name: 'Gabetti',

  probeChecks: {
    listingUrl: 'https://www.gabetti.it/vendita/bologna?prezzoMax=160000&mqMin=40',
    cardSelectors: ['a[href*="/vendita/"]'],
    linkPattern: '\\/vendita\\/[^/]+\\/[^/]+\\/\\d+$',
    minLinks: 3,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const url = `${BASE}/vendita/${c.slug}?prezzoMax=${MAX_PREZZO}&mqMin=${MIN_MQ}`;
      log(`[gabetti] Area ${c.name}: ${url}`);
      let pageNum = 1;
      const maxPages = 10;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const pageUrl = pageNum === 1 ? url : `${BASE}/vendita/${c.slug}?page=${pageNum}&prezzoMax=${MAX_PREZZO}&mqMin=${MIN_MQ}`;
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 20000 });
        await dismissCookies(page);
        await humanPause(2000, 4000);
        await checkBlocked(page, resp);
        const links = await page.evaluate((reSrc) => {
          const re = new RegExp(reSrc);
          return [...document.querySelectorAll('a[href*="/vendita/"]')]
            .map((a) => a.href.split('#')[0].split('?')[0])
            .filter((h) => re.test(h));
        }, LINK_RE.source);
        let added = 0;
        for (const h of links) {
          const id = h.match(/\/(\d+)$/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const tipo = h.match(/\/vendita\/[^/]+\/([^/]+)\/\d+$/)?.[1] || '';
          if (NON_RESIDENZIALE.has(tipo)) { log(`[gabetti] tipologia non residenziale (${tipo}): scarto ${id}`); continue; }
          cards.push({ id, url: h, area: c.name });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[gabetti] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length})`);
        if (added === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => /[?&]page=/.test(a.href) && new RegExp(`[?&]page=${n}(?:&|$)`).test(a.href)), pageNum + 1);
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
      // Prezzo: elemento foglia "150.000 €" (h2 in testa alla pagina dettaglio).
      let prezzoTxt = '';
      for (const el of document.querySelectorAll('h1, h2, dd, span, div, p')) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        if (/^[\d.]{4,}\s*€$/.test(t) || /^€\s*[\d.]{4,}$/.test(t)) { prezzoTxt = t; break; }
      }
      // Caratteristiche: coppie dt/dd VERIFICATE 22/11 (Superficie/Locali/Bagni/
      // Camere da letto/Piano/Condizioni dell'immobile/Classe energetica).
      const feats = {};
      document.querySelectorAll('dt').forEach((dt) => {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD') {
          const k = (dt.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const v = (dd.textContent || '').replace(/\s+/g, ' ').trim();
          if (k && v && !feats[k]) feats[k] = v;
        }
      });
      // Fallback: sezioni Caratteristiche/Efficienza come testo (dt/dd assenti).
      const carIdx = body.search(/Caratteristiche\s+Superficie/i);
      const effIdx = body.search(/Efficienza\s+Condizioni/i);
      const caratteristiche = carIdx >= 0 ? body.slice(carIdx, carIdx + 600) : '';
      const efficienza = effIdx >= 0 ? body.slice(effIdx, effIdx + 400) : '';
      // Descrizione: sezione dedicata (dopo "Descrizione", prima di "Caratteristiche").
      // "Descrizione" compare DUE volte: nei tab di navigazione (inizio pagina,
      // seguito da Caratteristiche/Efficienza/Costi) e come titolo della sezione
      // col testo vero (dopo mappa/POI). Prendi l'ultima occorrenza seguita da
      // testo lungo; la prima dava "Caratteristiche" (15 char) e faceva perdere
      // "NUDA PROPRIETÀ" ai filtri core (caso reale 3343643).
      let descrizione = '';
      const re = /Descrizione\s+/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        const rest = body.slice(m.index + m[0].length);
        const end = rest.search(/\sCaratteristiche\s|\sEfficienza\s|\sCosti\s|\sCalcola mutuo\s/);
        const cand = (end > 0 ? rest.slice(0, end) : rest.slice(0, 3000)).trim();
        if (cand.length > descrizione.length) descrizione = cand;
      }
      const foto = document.querySelector('[class*="gallery"] img, [class*="slider"] img, picture img, [class*="photo"] img')?.src || '';
      return { body: body.slice(0, 12000), titolo, prezzoTxt, feats, caratteristiche, efficienza, descrizione, foto };
    });

    const body = data.body;
    const pathM = card.url.match(/\/vendita\/([^/]+)\/([^/]+)\/(\d+)$/);
    const comuneSlug = pathM ? pathM[1] : '';
    // Whitelist: scarta subito i comuni fuori target (suggerimenti fuori zona).
    if (comuneSlug && !WHITELIST.has(comuneSlug)) {
      log(`[gabetti] comune fuori whitelist (${comuneSlug}): scarto ${card.id}`);
      return null;
    }
    const tipoSlug = pathM ? pathM[2] : '';
    if (NON_RESIDENZIALE.has(tipoSlug)) {
      log(`[gabetti] tipologia non residenziale (${tipoSlug}): scarto ${card.id}`);
      return null;
    }
    // Il path può dire "appartamento" ma il titolo rivelare una cessione
    // d'attività (caso reale: /bar/3335850 "Attività in Via…", 30k/50m²).
    if (/^\s*(attivit[àa]|bar\b|ristorante\b|negozio\b|locale commerciale|magazzino|capannone|ufficio\b)/i.test(data.titolo || '')) {
      log(`[gabetti] titolo non residenziale ("${(data.titolo || '').slice(0, 50)}"): scarto ${card.id}`);
      return null;
    }
    const comune = slugToName(comuneSlug) || card.area;
    // dt/dd verificati + fallback regex sulle sezioni Caratteristiche/Efficienza.
    const f = data.feats || {};
    const car = `${data.caratteristiche || ''} ${data.efficienza || ''}`;
    const prezzo = parsePrice(data.prezzoTxt) ?? parsePrice(body);
    const mq = firstInt(f['superficie']) ?? firstInt(feat(car, 'superficie', '(\\d{2,4})'))
      ?? firstInt((body.match(/(\d{2,4})\s*(?:m²|m2|mq)\b/i) || [])[1]);
    // Rete client-side di sicurezza (i filtri server sono già applicati).
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[gabetti] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const locali = firstInt(f['locali']) ?? firstInt(feat(car, 'locali', '(\\d{1,2})'));
    const bagni = firstInt(f['bagni']) ?? firstInt(feat(car, 'bagn[io]', '(\\d{1,2})'));
    const desc = data.descrizione || '';
    const camere = firstInt(f['camere da letto'] || f['camere']) ?? bedroomsFromText(`${data.titolo} ${desc}`, locali);
    const piano = f['piano'] || feat(car, 'piano', '(terra|rialzato|seminterrato|interrato|ultimo|intermedio|primo|secondo|terzo|quarto|quinto|sesto|\\d{1,2}[°º]?)');
    const stato = f['condizioni dell\u2019immobile'] || f["condizioni dell'immobile"] || f['condizioni'] || feat(car, 'condizioni\\s+dell[’\']?immobile', '([A-Za-zàèéìòù /]{3,30})');
    const ape = String(f['classe energetica'] || feat(car, 'classe\\s+energetica', '([A-G][1-4]?)')).toUpperCase().slice(0, 2);
    const riscaldamento = f['riscaldamento'] || feat(body, 'riscaldamento', '(autonomo|centralizzato|assente)');
    const cucina = f['cucina'] || '';
    const ascTxt = f['ascensore'] || '';
    const ascensore = /^(s[iì]|presente)/i.test(ascTxt) ? 'Sì' : (/^(no|assente)/i.test(ascTxt) ? 'No' : (/ascensore/i.test(desc) && !/senza ascensore|no ascensore/i.test(desc) ? 'Sì' : ''));
    const balcone = /balcon[ei]|loggia/i.test(`${f['balcone'] || ''} ${desc}`) ? 'Sì' : '';
    const cantina = /cantina/i.test(`${f['cantina'] || ''} ${desc}`) ? 'Sì' : '';
    const zonaM = desc.match(/zona\s+([A-Za-zàèéìòù' ]{3,30}?)(?:[,.;]| più| comoda| in)/i);
    const tipologia = pathM ? pathM[2].replace(/-/g, ' ') : '';
    // Indirizzo dal titolo: "Appartamento in Via del Triumvirato 20, Bologna (BO)".
    const addrM = (data.titolo || '').match(/\bin\s+(.+?),\s*(?:Bologna|Pianoro|San Lazzaro)/i);

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
      agenzia: 'Gabetti',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};