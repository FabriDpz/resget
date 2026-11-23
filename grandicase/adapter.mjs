// Adattatore grandicasebologna.it — Joomla RealEstateManager, Playwright headed.
// Portfolio minuscolo (7 annunci al 22/11), ricerca del componente inaffidabile →
// NESSUN filtro server: listing completa /tutte-le-proposte/tutte-le-proposte/785/all_houses
// (pagina unica). Card: #gallery_rem → wrapper con .okno_R (.rem_listing_status
// RESIDENZIALE/COMMERCIALE, .col_rent 'In vendita'), .texthouse (.titlehouse a,
// .row_text Mq/Locali/Camere), .rem_house_viewlist (.price 'EUR 440.000').
// Scarto in raccolta: non vendita, non residenziale, prezzo > 160000
// (oggi 0 target: legittimo, il portfolio parte da 179k residenziale).
// Dettaglio /…/view/<cat>-<nome>/<id>/<tipo>: DOM puro, nessun ld+json.
// Cookie banner Joomla: "Ok, accetto!" / "Disattiva" (non matched da dismissCookies).

import { rand, sleep, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const LISTING = 'https://grandicasebologna.it/tutte-le-proposte/tutte-le-proposte/785/all_houses';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const WHITELIST = ['bologna', 'san lazzaro di savena', 'pianoro'];

function parsePrice(txt) {
  const m = String(txt || '').replace(/\./g, '').match(/(\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}

async function dismissJoomlaCookies(page) {
  for (const re of [/^disattiva$/i, /ok,?\s*accetto/i]) {
    try {
      const btn = page.locator('a, button', { hasText: re }).first();
      if (await btn.isVisible({ timeout: 700 })) {
        await btn.click({ timeout: 2500 });
        await sleep(rand(500, 1000));
        return;
      }
    } catch { /* banner assente */ }
  }
}

export default {
  id: 'grandicase',
  name: 'Grandi Case',

  probeChecks: {
    listingUrl: LISTING,
    cardSelectors: ['#gallery_rem .texthouse'],
    linkPattern: '\\/view\\/',
    minLinks: 3,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const resp = await gotoResilient(page, LISTING, { log, baseWait: 20000 });
    await dismissCookies(page);
    await dismissJoomlaCookies(page);
    await humanPause(2200, 4000);
    await checkBlocked(page, resp);
    const rows = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#gallery_rem .texthouse').forEach((th) => {
        const wrap = th.parentElement;
        const a = th.querySelector('.titlehouse a[href*="/view/"]') || th.querySelector('a[href*="/view/"]');
        if (!a) return;
        const url = a.href.split('#')[0];
        const id = url.match(/\/view\/[^/]+\/(\d+)\//)?.[1] || null;
        const status = wrap.querySelector('.rem_listing_status')?.textContent?.trim() || '';
        const contract = wrap.querySelector('.col_rent')?.textContent?.trim() || '';
        const price = wrap.querySelector('.price')?.textContent?.trim() || '';
        let mq = null, locali = null, camere = null;
        th.querySelectorAll('.row_text').forEach((r) => {
          const label = r.querySelector('.col_text_1')?.textContent?.trim() || '';
          const val = parseInt(r.querySelector('.col_text_2')?.textContent?.match(/\d+/)?.[0], 10) || null;
          if (/locali/i.test(label)) locali = val;
          else if (/camere/i.test(label)) camere = val;
          else if (r.querySelector('.fa-expand')) mq = val;
        });
        out.push({ id, url, titolo: a.textContent.trim(), status, contract, price, mq, locali, camere });
      });
      return out;
    });
    const cards = [];
    let skipped = 0;
    for (const r of rows) {
      if (!r.id) continue;
      const p = parsePrice(r.price);
      const ok = /vendita/i.test(r.contract) && /residenziale/i.test(r.status) && (p == null || p <= MAX_PREZZO);
      if (!ok) { skipped++; log(`[grandicase] scarto ${r.id} (${r.status}, ${r.contract}, ${r.price})`); continue; }
      cards.push({ id: r.id, url: r.url, area: 'Bologna', titolo: r.titolo, prezzo: p, mq: r.mq, locali: r.locali, camere: r.camere });
      if (cards.length >= maxAds) break;
    }
    log(`[grandicase] listing unica: ${rows.length} annunci, +${cards.length} nel target (${skipped} scartati)`);
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 20000 });
    await dismissCookies(page);
    await dismissJoomlaCookies(page);
    await humanPause(2000, 3800);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').replace(/\r/g, '');
      const plan = [...document.querySelectorAll('a[href]')]
        .filter((a) => /planimetr/i.test(a.textContent || '') || /planimetr/i.test(a.href || ''))
        .map((a) => ({ url: a.href, caption: 'Planimetria' }));
      const foto = document.querySelector('.rem_house_fullview img, #gallery img, img.big')?.src || '';
      return { bodyText, plan, foto };
    });
    const body = data.bodyText;
    const prezzo = card.prezzo ?? parsePrice(body.match(/EUR\s*([\d.]+)/i)?.[1]);
    const statsM = body.match(/Locali:\s*(\d+)\s+Bagni:\s*(\d+)\s+Camere:\s*(\d+)\s+Superfice:\s*(\d+)\s*Mq/i);
    const mq = statsM ? parseInt(statsM[4], 10) : (card.mq ?? null);
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[grandicase] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    // Indirizzo: "Italia, Emilia Romagna, Bologna, 40132, Via Emilia Ponente, 463."
    const addrM = body.match(/Italia,\s*Emilia Romagna,\s*([^,]+),\s*(\d{5})?,?\s*([^\n.]*)/i);
    const comune = addrM ? addrM[1].trim() : '';
    if (comune && !WHITELIST.includes(comune.toLowerCase())) {
      log(`[grandicase] comune fuori whitelist (${comune}): scarto ${card.id}`);
      return null;
    }
    if (!/RESIDENZIALE/i.test(body)) { log(`[grandicase] non residenziale: scarto ${card.id}`); return null; }
    const featSimple = (label) => {
      const m = body.match(new RegExp(`${label}:\\s*(.+?)(?=\\s+[A-Z][A-Za-z' ]{2,20}:|\\n|$)`));
      return m ? m[1].trim() : '';
    };
    const descM = body.match(/Superfice:\s*\d+\s*Mq\s*\n([\s\S]*?)(?:\nContatta Agente|\nInvia messaggio)/i);
    const desc = (descM ? descM[1] : '').replace(/\n+/g, ' ').trim();
    const locali = statsM ? parseInt(statsM[1], 10) : (card.locali ?? null);
    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: card.titolo || body.split('\n').find((l) => /^[A-ZÀ-Ú ]{6,}$/.test(l.trim()))?.trim() || 'Immobile in vendita',
      comune,
      provincia: 'BO',
      indirizzo: addrM ? addrM[3].trim().replace(/,$/, '') : '',
      prezzo,
      tipologia: card.titolo || '',
      locali,
      camere: statsM ? parseInt(statsM[3], 10) : (card.camere ?? bedroomsFromText(desc, locali)),
      bagni: statsM ? parseInt(statsM[2], 10) : null,
      superficieMq: mq,
      piano: featSimple('Piano Immobile'),
      pianiEdificio: featSimple('Totale piani'),
      cucina: featSimple('Cucina'),
      stato: mapStato(featSimple('Condizioni').replace(/^in\s+/i, '').replace(/buone condizioni/i, 'buono stato')),
      riscaldamento: featSimple('Riscaldamento'),
      balcone: /balcon/i.test(desc) && !/senza balcon/i.test(desc),
      terrazzo: /terrazz/i.test(desc),
      cantina: /cantina/i.test(desc) && !/senza cantina/i.test(desc),
      ape: (body.match(/Classe\s+Energetica[:\s]*([A-G][1-4]?)/i)?.[1] || '').toUpperCase(),
      agenzia: 'Grandi Servizi Immobiliari',
      privato: false,
      descrizione: desc,
      foto: data.foto,
      planimetrie: data.plan,
    };
  },
};