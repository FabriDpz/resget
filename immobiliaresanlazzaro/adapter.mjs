// Adattatore immobiliaresanlazzaro.it — RealHomes, Playwright headed.
// ⚠️ BUG VERIFICATO 22/11: location + max-price insieme → SEMPRE 0 risultati;
// max-price è una SELECT a preset (160000 non è un preset → 0!).
// Strategia: una query per comune SENZA prezzo:
//   /ricerca-immobili/?status=vendita&location={comune} (18/5/33 annunci)
// + filtro CLIENT-SIDE prezzo≤160k e mq≥40 SUL DETTAGLIO (scarto loggato,
// return null, come tempocasa). Paginazione RealHomes /page/N/ sui risultati.
// Dettaglio /immobile/<slug>/ DOM VERIFICATO 22/11: prezzo "€390,000"
// (migliaia con VIRGOLA — le option dei preset usano lo stesso formato:
// prendere il prezzo DOPO "Vendita", mai dal body intero). "Area 102 mq",
// "Camere da letto 3 Bagni 2"; sezione "Dettagli aggiuntivi" con coppie
// "Piano: 3", "Ascensore: SI", "Certificazione: Classe E", "Cantina: …".
// id dallo slug.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.immobiliaresanlazzaro.it';
const RESULTS = `${BASE}/ricerca-immobili/`;
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const LINK_RE = /\/immobile\/[^/]+\/?$/;
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'pianoro', name: 'Pianoro' },
  { slug: 'san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
];

function parsePrice(txt) {
  const t = String(txt || '');
  // "€390,000" (virgola migliaia) o "390.000 €" (punto).
  const m = t.match(/€\s*([\d.,]{4,})/) || t.match(/([\d.]{4,})\s*€/);
  return m ? parseInt(m[1].replace(/[.,]/g, ''), 10) : null;
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
  id: 'immobiliaresanlazzaro',
  name: 'Immobiliare San Lazzaro',

  probeChecks: {
    listingUrl: `${RESULTS}?status=vendita&location=san-lazzaro-di-savena`,
    cardSelectors: ['a[href*="/immobile/"]'],
    linkPattern: '\\/immobile\\/[^/]+\\/?$',
    minLinks: 5, // 33 annunci a San Lazzaro verificati (nessun filtro prezzo)
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const qs = `status=vendita&location=${c.slug}`;
      log(`[immobiliaresanlazzaro] Area ${c.name}: ${RESULTS}?${qs}`);
      let pageNum = 1;
      const maxPages = 12; // senza filtri prezzo: più pagine, tutte da visitare
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
        log(`[immobiliaresanlazzaro] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length})`);
        if (added === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`/ricerca-immobili/page/${n}/`)), pageNum + 1);
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
      // Prezzo: "Vendita €390,000" sotto il titolo (MAI dal body: le option
      // dei preset contengono €1,000…€400,000 e inquinerebbero il match).
      const prezzoM = body.match(/Vendita\s*€\s*([\d.,]{4,})/);
      const prezzoTxt = prezzoM ? `€${prezzoM[1]}` : '';
      // Riga sotto il titolo: "Via Benedetto Marcello, Bologna, BO".
      const addrM = body.match(/\S+\s+(.{5,90}?,\s*(?:Bologna|Pianoro|San Lazzaro di Savena),\s*BO)\s+Vendita/i);
      // Scheda: "Camere da letto 3 Bagni 2 Garage 1 Anno di costruzione 1976 Area 102 mq".
      const schedaIdx = body.search(/ID Immobile:/i);
      const scheda = schedaIdx >= 0 ? body.slice(schedaIdx, schedaIdx + 400) : '';
      // "Dettagli aggiuntivi": coppie "Piano: 3", "Ascensore: SI", ecc.
      const detIdx = body.search(/Dettagli aggiuntivi/i);
      const dettagli = detIdx >= 0 ? body.slice(detIdx, detIdx + 900) : '';
      // Descrizione tra "Descrizione" e "Dettagli aggiuntivi".
      let descrizione = '';
      const dIdx = body.search(/Descrizione\s+/);
      if (dIdx >= 0) {
        const rest = body.slice(dIdx + 12);
        const end = rest.search(/\sDettagli aggiuntivi\s|\sCaratteristiche\s/);
        descrizione = (end > 0 ? rest.slice(0, end) : rest.slice(0, 3500)).trim();
      }
      const foto = document.querySelector('[class*="gallery"] img, [class*="slider"] img, .property-slider img, picture img')?.src || '';
      const breadcrumb = [...document.querySelectorAll('[class*="breadcrumb"] a, [class*="breadcrumb"] span')]
        .map((a) => a.textContent.trim()).filter(Boolean);
      return { body: body.slice(0, 12000), titolo, prezzoTxt, addr: addrM ? addrM[1] : '', scheda, dettagli, descrizione, foto, breadcrumb };
    });

    const body = data.body;
    const det = data.dettagli || '';
    const scheda = data.scheda || '';
    const desc = data.descrizione || '';
    const prezzo = parsePrice(data.prezzoTxt);
    const mq = firstInt((scheda.match(/Area\s+(\d{2,5})\s*mq/i) || [])[1])
      ?? firstInt((body.match(/(\d{2,5})\s*(?:m²|m2|mq)\b/i) || [])[1]);
    // FILTRO CLIENT-SIDE OBBLIGATORIO: il server non supporta prezzo+location.
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[immobiliaresanlazzaro] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    // Comune dall'indirizzo sotto il titolo ("…, Bologna, BO") o breadcrumb.
    let comune = card.area;
    const hay = String(data.addr || data.breadcrumb.join(' ')).toLowerCase();
    if (/san lazzaro/.test(hay)) comune = 'San Lazzaro di Savena';
    else if (/pianoro/.test(hay)) comune = 'Pianoro';
    else if (/bologna/.test(hay)) comune = 'Bologna';
    else if (hay && !/bologna|pianoro|san lazzaro/.test(hay)) {
      log(`[immobiliaresanlazzaro] comune fuori whitelist (${hay.slice(0, 40)}): scarto ${card.id}`);
      return null;
    }
    const locali = firstInt((det.match(/Vani:\s*(\d{1,2})/i) || [])[1]);
    const bagni = firstInt((scheda.match(/Bagni\s+(\d{1,2})/i) || det.match(/Bagni:\s*(\d{1,2})/i) || [])[1]);
    const camere = firstInt((scheda.match(/Camere da letto\s+(\d{1,2})/i) || det.match(/Camere da letto:\s*(\d{1,2})/i) || [])[1])
      ?? bedroomsFromText(`${data.titolo} ${desc}`, locali);
    const piano = (det.match(/Piano:\s*(\d{1,2}|terra|rialzato|seminterrato|interrato|ultimo)/i) || [])[1] || '';
    const pianiEdificio = (det.match(/Totale Piani:\s*(\d{1,2})/i) || [])[1] || '';
    const ape = String((det.match(/Certificazione:\s*(?:Classe\s+)?([A-G][1-4]?)/i) || desc.match(/APE\s*[“"']?([A-G][1-4]?)/i) || [])[1] || '').toUpperCase().slice(0, 2);
    const stato = /ristrutturat[ao] a nuovo|ristrutturazione totale/i.test(desc) ? 'ristrutturato' : (/da ristrutturare/i.test(desc) ? 'da ristrutturare' : (/buon[oe] stato|buone condizioni/i.test(desc) ? 'buono' : ''));
    const siNo = (raw) => /^(si|sì|presente)/i.test(String(raw || '').trim()) ? 'Sì' : (/^(no|assente|-)\s*$/i.test(String(raw || '').trim()) ? 'No' : '');
    const balcone = siNo((det.match(/Balcone:\s*(\S+)/i) || [])[1]) || (/balcon[ei]|loggiat/i.test(desc) ? 'Sì' : '');
    const cantinaRaw = (det.match(/Cantina:\s*([^\n]{1,30}?)(?=\s+(?:Anno|Infissi|Climatizzazione|Tipo|Certificazione|Stato|Spese|Accesso|Balcone|Cancello)\b)/i) || [])[1] || '';
    const cantina = cantinaRaw && !/^-\s*$/.test(cantinaRaw.trim()) ? 'Sì' : (/cantina/i.test(desc) ? 'Sì' : '');
    const ascensore = siNo((det.match(/Ascensore:\s*(\S+)/i) || [])[1]) || (/ascensore/i.test(desc) && !/senza ascensore/i.test(desc) ? 'Sì' : '');
    const riscaldamento = (det.match(/Tipo riscaldamento:\s*([A-Za-zàèéìòù]{3,20})/i) || [])[1] || '';
    const speseCondominio = (det.match(/Spese condominio:\s*([\d.,]+\s*€)/i) || [])[1] || '';
    const cucina = /cucina abitabile/i.test(desc) ? 'Abitabile' : (/angolo cottura|cucina a vista/i.test(desc) ? 'A vista' : '');
    // Zona dal breadcrumb "Home BO Bologna Toscana/S. Ruffillo" o dal titolo.
    const zonaM = (data.titolo || '').match(/^(?:Appartamento|Villa|Casa|Attico|Monolocale|Mansarda)\s+(.{3,40})$/i);

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: data.titolo || 'Immobile in vendita',
      comune,
      provincia: 'BO',
      zona: zonaM ? zonaM[1].trim() : '',
      indirizzo: (data.addr || '').replace(/,\s*(?:Bologna|Pianoro|San Lazzaro di Savena),\s*BO$/i, '').trim(),
      lat: null,
      lon: null,
      prezzo,
      tipologia: ((data.titolo || '').match(/^(Appartamento|Villa|Casa[ A-Za-z]*|Attico|Monolocale|Mansarda)/i) || [])[1] || 'Appartamento',
      locali,
      camere,
      bagni,
      superficieMq: mq,
      piano,
      pianiEdificio,
      ascensore,
      cucina,
      balcone,
      cantina,
      stato: mapStato(stato),
      ape,
      riscaldamento,
      speseCondominio,
      agenzia: 'Immobiliare San Lazzaro',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};