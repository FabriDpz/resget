// Adattatore proprieta.intesasanpaolo.com — Playwright headed.
// Vetrina del patrimonio dismesso del gruppo Intesa Sanpaolo (vendita diretta,
// NON aste giudiziarie: si partecipa con "manifestazione di interesse").
//
// Listing: /immobili?comune=<codice ISTAT a 6 cifre> (SSR, query string diretta).
//   Il form usa dropdown custom <ul><li> (nessun <select>): pilotarlo è fragile,
//   ma i link breadcrumb del dettaglio espongono gli stessi parametri in chiaro
//   (?comune=037011&tipologia=29) → si va dritti all'URL, senza toccare il form.
//   ATTENZIONE: ?provincia=<codice interno> NON è il codice ISTAT (Bologna = 037),
//   mentre ?comune= usa l'ISTAT completo (Casalecchio = 037011). Passing "Bologna"
//   come valore produce 0 risultati senza errori.
//   Paginazione: /immobili/pag-N?<stessi parametri>. 6 card per pagina.
//   Card root: il <table> con Indirizzo/Superficie; titolo in h2 > a[href*="/ID"].
//   Il badge "Venduto" è un link separato nella stessa card → va escluso.
//
// Dettaglio: /ID<numero>. Coppie label→valore in <p> adiacenti:
//   TIPOLOGIA, COMUNE, INDIRIZZO, VALORE, SUPERFICIE + descrizione + brochure PDF.
//   NON espone locali/camere/bagni/piano: per un eventuale residenziale si ricava
//   dalle camere dalla descrizione (fail-closed: senza camere niente BIG/SMA).
//
// Anti-bot: nessun WAF rilevato. Banner iubenda #iubenda-cs-banner intercetta i
//   click → rimosso via JS. reCAPTCHA solo sul form di contatto (mai usato).

import { sleep, rand, humanPause, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText, zonaFromDescrizione } from '../core/schema.mjs';

const BASE = 'https://www.proprieta.intesasanpaolo.com';

// Il footer di ogni pagina cita "Questo sito è protetto da reCAPTCHA" (solo il
// form di contatto lo usa): il checkBlocked condiviso, che cerca /captcha/i nel
// testo, abortirebbe ogni dettaglio. Qui si verifica solo il blocco vero — HTTP
// e assenza dei dati attesi — restando fail-closed.
async function checkPage(page, resp, expected, { log }) {
  if (resp && (resp.status() === 403 || resp.status() === 429)) {
    throw new Error(`HTTP ${resp.status()} — blocco anti-bot su Intesa`);
  }
  const probe = await page.evaluate(() => {
    const t = document.body?.innerText || '';
    return {
      len: t.length,
      denied: /accesso negato|access denied|unusual traffic|sei un robot/i.test(t),
      challenge: !!document.querySelector('iframe[src*="recaptcha/api2/bframe"], iframe[title*="challenge" i]'),
      hasData: /Tipologia|Nessun immobile corrisponde/i.test(t),
    };
  });
  if (probe.denied || probe.challenge) throw new Error('Pagina di blocco/CAPTCHA reale su Intesa');
  if (expected === 'detail' && !probe.hasData) {
    log('[intesasanpaolo] dettaglio senza dati attesi: pagina non renderizzata');
  }
  return probe;
}

// Codici ISTAT dei comuni target (whitelist ≤3 km da POI≥35).
const COMUNI = [
  { code: '037006', name: 'Bologna' },
  { code: '037054', name: 'San Lazzaro di Savena' },
  { code: '037011', name: 'Casalecchio di Reno' },
  { code: '037019', name: 'Castenaso' },
  { code: '037047', name: 'Pianoro' },
  { code: '037061', name: 'Zola Predosa' },
];
const MAX_PREZZO = 160000;

// Il catalogo è dominato da filiali bancarie, uffici e depositi: la whitelist
// è sulle TIPOLOGIE dichiarate, non sul testo libero (che cita "edificio a
// destinazione residenziale" anche per un magazzino interrato).
const RESIDENZIALI = new Set([
  'appartamento', 'casa indipendente', 'porzione di casa', 'villa',
  'villa a schiera', 'villa unifamiliare', 'terratetto - terracielo',
]);
function isResidential(tipologia) {
  return RESIDENZIALI.has(String(tipologia || '').trim().toLowerCase());
}

// "65.000,00 €" → 65000. I centesimi dopo la virgola non vanno concatenati.
function parseNum(s) {
  const clean = String(s || '').replace(/[^\d.,]/g, '');
  if (!clean) return null;
  const intPart = clean.split(',')[0].replace(/\./g, '');
  const n = parseInt(intPart, 10);
  return Number.isNaN(n) ? null : n;
}

export default {
  id: 'intesasanpaolo',
  name: 'Intesa Sanpaolo Proprietà',

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      let pageNum = 1;
      const maxPages = 10;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const qs = `comune=${c.code}`;
        const url = pageNum === 1 ? `${BASE}/immobili?${qs}` : `${BASE}/immobili/pag-${pageNum}?${qs}`;
        const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
        await dismissCookies(page);
        await page.evaluate(() => { try { document.querySelector('#iubenda-cs-banner')?.remove(); } catch (e) { /* banner assente */ } });
        await humanPause(1800, 3000);
        await checkPage(page, resp, 'list', { log });

        const rows = await page.evaluate(() => {
          const anchors = [...document.querySelectorAll('h2 a[href*="/ID"]')];
          return anchors.map((a) => {
            const href = a.href || '';
            const idM = href.match(/\/ID(\d+)/);
            // risali al contenitore che ha la tabella Indirizzo/Superficie
            let box = a;
            for (let i = 0; i < 6 && box; i++) {
              if (box.querySelector && box.querySelector('table')) break;
              box = box.parentElement;
            }
            const txt = (box?.innerText || '').replace(/\s+/g, ' ');
            const cells = [...(box?.querySelectorAll('table tr') || [])]
              .map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent.trim()));
            const cell = (label) => (cells.find((r) => r[0] === label) || [])[1] || '';
            const priceEl = [...(box?.querySelectorAll('h2') || [])].find((h) => /Prezzo/i.test(h.textContent || ''));
            return {
              id: idM ? idM[1] : null,
              url: href.split('?')[0].split('#')[0],
              title: (a.textContent || '').trim().replace(/\s+/g, ' '),
              indirizzo: cell('Indirizzo'),
              superficie: cell('Superficie'),
              price: (priceEl?.textContent || '').replace(/Prezzo/i, '').trim(),
              venduto: /venduto|aggiudicato/i.test(txt),
              txt,
            };
          }).filter((r) => r.id && r.url);
        });

        let added = 0, skippedType = 0, skippedPrice = 0, skippedSold = 0;
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          // "Filiale Bancaria a Bologna" → tipologia = parte prima di " a <comune>"
          const tipologia = r.title.replace(/\s+a\s+.+$/i, '').trim();
          if (r.venduto) { skippedSold++; continue; }
          if (!isResidential(tipologia)) { skippedType++; continue; }
          const p = parseNum(r.price);
          if (p !== null && p > MAX_PREZZO) { skippedPrice++; continue; }
          cards.push({ id: r.id, url: r.url, area: c.name, price: r.price, title: r.title, tipologia, indirizzo: r.indirizzo, superficie: r.superficie });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[intesasanpaolo] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}; ${skippedType} non res., ${skippedSold} venduti, ${skippedPrice} oltre budget)`);
        if (rows.length === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`/immobili/pag-${n}`)), pageNum + 1);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(2000, 3500));
      }
      await sleep(rand(1500, 2800));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 18000 });
    await dismissCookies(page);
    await page.evaluate(() => { try { document.querySelector('#iubenda-cs-banner')?.remove(); } catch (e) { /* banner assente */ } });
    await humanPause(1800, 3000);
    await checkPage(page, resp, 'detail', { log });

    const data = await page.evaluate(() => {
      // Le coppie label→valore sono <p> fratelli: "Tipologia" seguito da "Deposito".
      const pairs = {};
      const wanted = ['Tipologia', 'Comune', 'Indirizzo', 'Valore', 'Superficie'];
      for (const p of document.querySelectorAll('p')) {
        const label = (p.textContent || '').trim();
        if (!wanted.includes(label)) continue;
        const val = p.nextElementSibling?.textContent?.trim() || '';
        if (val) pairs[label] = val.replace(/\s+/g, ' ');
      }
      const h1 = document.querySelector('h1')?.textContent?.trim().replace(/\s+/g, ' ') || '';
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const di = body.indexOf('Descrizione');
      const stop = body.indexOf('Scarica la brochure');
      const descrizione = di >= 0
        ? body.slice(di + 'Descrizione'.length, stop > di ? stop : di + 3000).replace(/Leggi di più/i, '').trim()
        : '';
      const brochure = [...document.querySelectorAll('a[href$=".pdf"]')]
        .map((a) => a.href).find((h) => /immobile|brochure|media\./i.test(h)) || '';
      const foto = [...document.querySelectorAll('img')]
        .map((i) => i.src || '').find((s) => s && /immobile|media\.|foto/i.test(s) && !/logo|icon/i.test(s)) || '';
      const rifM = (document.title || '').match(/rif\.\s*([A-Z0-9]+)/i);
      return { pairs, h1, descrizione: descrizione.slice(0, 3000), brochure, foto, rif: rifM?.[1] || '', body: body.slice(0, 4000) };
    });

    const p = data.pairs;
    if (!p.Tipologia && !data.h1) return null;

    const tipologia = p.Tipologia || card.tipologia || '';
    const superficieMq = parseNum(p.Superficie || card.superficie);
    // VALORE è il prezzo richiesto nella vendita diretta (non un base d'asta).
    let prezzo = parseNum(p.Valore) || parseNum(card.price);
    if (prezzo !== null && prezzo < 15000) prezzo = null;
    const locali = null;
    const camere = bedroomsFromText(data.descrizione, locali);

    return {
      id: String(card.id),
      url: card.url,
      area: card.area,
      titolo: data.h1 || `${tipologia || 'Immobile'} in vendita`,
      comune: p.Comune || card.area,
      provincia: 'Bologna',
      zona: zonaFromDescrizione(data.descrizione) || '',
      indirizzo: p.Indirizzo || card.indirizzo || '',
      lat: null,
      lon: null,
      prezzo,
      tipologia,
      locali,
      camere,
      bagni: null,
      superficieMq,
      piano: '',
      stato: mapStato(data.descrizione),
      riscaldamento: '',
      altreCaratteristiche: [data.rif ? `Rif. ${data.rif}` : '', data.brochure ? `Brochure: ${data.brochure}` : ''].filter(Boolean).join('; '),
      agenzia: 'Intesa Sanpaolo',
      privato: false,
      descrizione: data.descrizione,
      foto: data.foto,
      planimetrie: data.brochure ? [data.brochure] : [],
      // "In gara" è una procedura competitiva del gruppo, non un'asta giudiziaria,
      // ma il criterio noAste la esclude comunque: la flagghiamo per trasparenza.
      isAuction: /\bin gara\b|base d'asta|asta giudiziaria/i.test(data.body),
    };
  },
};
