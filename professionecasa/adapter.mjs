// Adattatore professionecasa.it — ASP.NET, Playwright headed.
// Listing: /agenzia/bologna-san-vitale?contratto=vendita&uso=abitativo&prezzomassimo=160000&mqmin=40
// ⚠️ VERIFICATO LIVE 22/11: i parametri prezzo/mq vengono IGNORATI dal server
// (la listing mostra anche 280k e 870k). Filtri CLIENT-SIDE sul prezzo in card
// (come attico) + rete prezzo/mq sul dettaglio. `uso=abitativo` non esclude
// magazzini etichettati "appartamento" (C2 visto) → scarto non-residenziale dal testo.
// Link dettaglio /<tipo>/vendita/<comune>/<id>. Comune dal path → whitelist.
// Dettaglio DOM (ld+json solo WebSite): h2 (l'h1 è il brand), prezzo "€60.000",
// "Tipologia: Appartamento", "Superficie 115 mq Locali 2 Bagni 1".

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.professionecasa.it';
const LISTING = `${BASE}/agenzia/bologna-san-vitale?contratto=vendita&uso=abitativo&prezzomassimo=160000&mqmin=40`;
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const LINK_RE = /\/vendita\/[^/]+\/\d+$/;
const NON_RES_RE = /\bmagazzino\b|\(C2\)|categoria catastale C2|\bbox auto in vendita\b|\bcantina in vendita\b|\bgarage in vendita\b/i;
const WHITELIST = {
  'bologna': 'Bologna',
  'pianoro': 'Pianoro',
  'san-lazzaro-di-savena': 'San Lazzaro di Savena',
};

function parsePrice(txt) {
  const m = String(txt || '').match(/€\s*([\d.]{4,})/);
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
  id: 'professionecasa',
  name: 'Professionecasa',

  probeChecks: {
    listingUrl: LISTING,
    cardSelectors: ['a[href*="/vendita/"]'],
    linkPattern: '\\/vendita\\/[^/]+\\/\\d+$',
    minLinks: 1,
    minCards: 0, // portfolio piccolo: listing vuota legittima
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    let pageNum = 1;
    const maxPages = 10;
    while (pageNum <= maxPages && cards.length < maxAds) {
      const pageUrl = pageNum === 1 ? LISTING : `${LISTING}&pagina=${pageNum}`;
      const resp = await gotoResilient(page, pageUrl, { log, baseWait: 20000 });
      await dismissCookies(page);
      await humanPause(2000, 4000);
      await checkBlocked(page, resp);
      // Card: risali dall'anchor al contenitore con prezzo/mq (col-12 col-md-8).
      const rows = await page.evaluate((reSrc) => {
        const re = new RegExp(reSrc);
        const out = [];
        const seenH = new Set();
        for (const a of document.querySelectorAll('a[href*="/vendita/"]')) {
          const h = a.href.split('#')[0].split('?')[0];
          if (!re.test(h) || seenH.has(h)) continue;
          seenH.add(h);
          let el = a, txt = '';
          for (let i = 0; i < 6 && el; i++) {
            el = el.parentElement;
            txt = (el?.innerText || '').replace(/\s+/g, ' ');
            if (/€/.test(txt) && txt.length > 60) break;
          }
          out.push({ url: h, txt: txt.slice(0, 600) });
        }
        return out;
      }, LINK_RE.source);
      let added = 0, skippedPrice = 0, skippedNonRes = 0;
      for (const r of rows) {
        const id = r.url.match(/\/(\d+)$/)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const slug = r.url.match(/\/vendita\/([^/]+)\/\d+$/)?.[1] || '';
        if (slug && !WHITELIST[slug]) { log(`[professionecasa] comune fuori whitelist (${slug}): scarto`); continue; }
        const p = parsePrice(r.txt);
        // Filtri prezzo/mq IGNORATI dal server → filtro client-side sulla card.
        if (p !== null && p > MAX_PREZZO) { skippedPrice++; continue; }
        if (NON_RES_RE.test(r.txt)) { skippedNonRes++; log(`[professionecasa] non residenziale (${id}): scarto`); continue; }
        const mq = firstInt((r.txt.match(/Superficie\s*(\d{2,4})\s*mq/i) || [])[1]);
        if (mq !== null && mq < MIN_MQ) { log(`[professionecasa] ${mq} m² < ${MIN_MQ}: scarto ${id}`); continue; }
        cards.push({ id, url: r.url, area: WHITELIST[slug] || 'Bologna', price: p, mq });
        added++;
        if (cards.length >= maxAds) break;
      }
      log(`[professionecasa] pag ${pageNum}: +${added} (tot ${cards.length}, ${skippedPrice} oltre budget, ${skippedNonRes} non res.)`);
      if (rows.length === 0) break;
      const hasNext = await page.evaluate((n) =>
        [...document.querySelectorAll('a[href]')].some((a) => new RegExp(`[?&]pagina=${n}(?:&|$)`).test(a.href)), pageNum + 1);
      if (!hasNext) break;
      pageNum++;
      await sleep(rand(2500, 5000));
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
      // h1 è il brand: il titolo annuncio è un h2 ("Appartamento in vendita a Bologna").
      let titolo = '';
      for (const h of document.querySelectorAll('h2, h1')) {
        const t = (h.textContent || '').replace(/\s+/g, ' ').trim();
        if (/in vendita/i.test(t)) { titolo = t; break; }
      }
      let prezzoTxt = '';
      for (const el of document.querySelectorAll('h1, h2, h3, span, div, p, strong')) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        if (/^€\s*[\d.]{4,}$/.test(t)) { prezzoTxt = t; break; }
      }
      const descEl = document.querySelector('[class*="description"], [class*="descrizione"], #description');
      let descrizione = (descEl?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!descrizione) {
        const i = body.search(/INFORMAZIONI GENERALI\s+/i);
        if (i >= 0) {
          const rest = body.slice(i + 21);
          const end = rest.search(/\s(?:INFORMAZIONI AGGIUNTIVE|CLASSE ENERGETICA|DETTAGLI AGENZIA|IMMOBILI SIMILARI)\b/i);
          descrizione = (end > 0 ? rest.slice(0, end) : rest.slice(0, 3000)).trim();
        }
      }
      const foto = document.querySelector('[class*="gallery"] img, [class*="slider"] img, picture img, [class*="photo"] img')?.src || '';
      return { body: body.slice(0, 12000), titolo, prezzoTxt, descrizione, foto };
    });

    const pathM = card.url.match(/\/([^/]+)\/vendita\/([^/]+)\/(\d+)$/);
    const comuneSlug = pathM ? pathM[2] : '';
    if (comuneSlug && !WHITELIST[comuneSlug]) {
      log(`[professionecasa] comune fuori whitelist (${comuneSlug}): scarto ${card.id}`);
      return null;
    }
    const comune = WHITELIST[comuneSlug] || card.area;
    const body = data.body;
    const desc = data.descrizione || '';
    if (NON_RES_RE.test(`${data.titolo} ${desc.slice(0, 400)}`)) {
      log(`[professionecasa] non residenziale (magazzino/box/cantina): scarto ${card.id}`);
      return null;
    }
    const prezzo = parsePrice(data.prezzoTxt) ?? parsePrice(body) ?? card.price ?? null;
    const mq = firstInt((body.match(/Superficie\s*(\d{2,4})\s*mq/i) || [])[1])
      ?? firstInt(feat(body, 'superficie|metri quadri', '(\\d{2,4})')) ?? card.mq ?? null;
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[professionecasa] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const locali = firstInt((body.match(/Locali\s*(\d{1,2})/i) || [])[1]);
    const bagni = firstInt((body.match(/Bagni\s*(\d{1,2})/i) || [])[1]);
    const camere = firstInt(feat(body, 'camere(?:\\s+da\\s+letto)?', '(\\d{1,2})')) ?? bedroomsFromText(`${data.titolo} ${desc}`, locali);
    const piano = feat(body, 'piano', '(terra|rialzato|seminterrato|interrato|ultimo|intermedio|primo|secondo|terzo|quarto|quinto|sesto|\\d{1,2}[°º]?)')
      || (desc.match(/(\d{1,2})°\s+piano/i) || [])[1] || '';
    const stato = feat(body, 'stato(?:\\s+immobile)?|condizioni', '(ottime|buone|discrete|da ristrutturare|nuovo|abitabile|ristrutturat[ao])');
    const ape = String(feat(body, 'classe\\s+energetica', '([A-G][1-4]?)') || (body.match(/Classe\s+([A-G][1-4]?)\b/) || [])[1] || '').toUpperCase().slice(0, 2);
    const riscaldamento = feat(body, 'riscaldamento', '(autonomo|centralizzato|assente)');
    const cucina = feat(body, 'cucina', '(abitabile|angolo cottura|cucinotto|a vista)');
    const ascensore = /ascensore/i.test(desc) && !/senza ascensore|no ascensore/i.test(desc) ? 'Sì' : (/senza ascensore|no ascensore/i.test(desc) ? 'No' : '');
    const balcone = /balcon[ei]|loggia/i.test(desc) ? 'Sì' : '';
    const cantina = /cantina/i.test(desc) ? 'Sì' : '';
    const zonaM = (desc.match(/zona\s+([A-Za-zàèéìòù' ]{3,30}?)(?:[,.;]| più| comoda| in)/i) || desc.match(/in\s+zona\s+([A-Za-zàèéìòù' ]{3,30})/i));
    // Indirizzo in testa: "VIA BENVENUTO CELLINI, 20 - BOLOGNA (BO)".
    const addrM = body.match(/((?:VIA|VIALE|PIAZZA|CORSO|VICOL[OA]|STRADA)\s+[A-ZÀÈÉÌÒÙ' ]{3,50}(?:,\s*\d+[A-Za-z/]{0,4})?)\s*-\s*(?:BOLOGNA|PIANORO|SAN LAZZARO)/i);
    const tipologia = feat(body, 'tipologia', '([A-Za-zàèéìòù ]{3,30})') || (pathM ? pathM[1].replace(/-/g, ' ') : '');

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
      tipologia,
      locali,
      camere,
      bagni,
      superficieMq: mq,
      piano,
      ascensore,
      cucina,
      balcone,
      cantina,
      stato: mapStato(stato || (desc.match(/ottime condizioni|ottimo stato/i) ? 'ottimo' : '')),
      ape,
      riscaldamento,
      agenzia: 'Professionecasa Bologna San Vitale',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};