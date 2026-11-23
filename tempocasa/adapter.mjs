// Adattatore tempocasa.it — Playwright.
// Listing: /it/vendita/bologna/{comune} (link /it/vendita/bologna/{comune}/{tipo}/{id}).
// Filtri: NESSUNO esprimibile via URL (probe 21/11, riconfermato 22/11: il form
// è Livewire POST /livewire/update, nessun GET): i dropdown sono JS puro con
// fasce FISSE (150k/170k…, 10/50/60 mq…), la URL non cambia mai e ?prezzo_max=
// viene ignorato → filtro CLIENT-SIDE sulle CARD in raccolta (prezzo/mq esposti)
// + rete sul dettaglio JSON-LD. Scarto prima di aprire il dettaglio.
// Dettaglio: JSON-LD RealEstateListing → mainEntity (Apartment: rooms, baths, mq,
// address) + offers (prezzo, agenzia) + datePublished/dateModified (utili per STALE).

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato } from '../core/schema.mjs';

const BASE = 'https://www.tempocasa.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'pianoro', name: 'Pianoro' },
  { slug: 'san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
];

function findListingNode(ld) {
  for (const block of ld) {
    const nodes = block['@graph'] || [block];
    for (const n of nodes) {
      const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
      if (types.includes('RealEstateListing') || (n.mainEntity && n.offers)) return n;
    }
  }
  return null;
}
function firstVal(x) { return Array.isArray(x) ? x[0] : x; }
function statoFromText(t) {
  t = String(t || '').toLowerCase();
  if (/da ristrutturare|da restaurare|da rimodernare/.test(t)) return 'Da ristrutturare';
  if (/ristrutturat[ao]|pari al nuovo|nuovo/.test(t)) return 'Ottimo / Ristrutturato';
  if (/buono stato|abitabile|buone condizioni/.test(t)) return 'Buono / Abitabile';
  return '';
}
function bedroomsFromText(desc, locali) {
  const t = String(desc || '');
  let m = t.match(/(\d+)\s*(?:camere?\s+da\s+letto|camere\b)/i);
  if (m) return parseInt(m[1], 10);
  const words = { una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, singola: 1, doppia: 2, matrimoniale: 1 };
  m = t.match(/\b(una|due|tre|quattro|cinque|singola|doppia|matrimoniale)\s+camera/i);
  if (m) return words[m[1].toLowerCase()] || null;
  const cnt = (t.match(/camera\s+da\s+letto|camera\s+(?:singola|doppia|matrimoniale)/gi) || []).length;
  if (cnt > 0) return cnt;
  if (locali && locali >= 2) return locali - 1; // stima conservativa: 1 soggiorno
  return null;
}

export default {
  id: 'tempocasa',
  name: 'Tempocasa',

  // Nessun filtro URL possibile (JS-only): la listing resta quella piena.
  probeChecks: {
    listingUrl: 'https://www.tempocasa.it/it/vendita/bologna/bologna',
    cardSelectors: ['a[href*="/it/vendita/"]'],
    linkPattern: '\\/it\\/vendita\\/[^/]+\\/[^/]+\\/[^/]+\\/\\d+$',
    minLinks: 5,
    detailChecks: { jsonLdType: 'RealEstateListing' },
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const url = `${BASE}/it/vendita/bologna/${c.slug}`;
      log(`[tempocasa] Area ${c.name}: ${url}`);
      let pageNum = 1;
      const maxPages = 12;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const pageUrl = pageNum === 1 ? url : `${url}?page=${pageNum}`;
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 25000 });
        await dismissCookies(page);
        await humanPause(2200, 3800);
        await checkBlocked(page, resp);
        const rows = await page.evaluate(() => {
          const out = [];
          const seenHref = new Set();
          for (const a of document.querySelectorAll('a[href*="/it/vendita/"]')) {
            const h = a.href.split('#')[0].split('?')[0];
            if (!/\/it\/vendita\/[^/]+\/[^/]+\/[^/]+\/\d+$/.test(h) || seenHref.has(h)) continue;
            seenHref.add(h);
            let el = a, card = null;
            for (let i = 0; i < 8 && el; i++) {
              el = el.parentElement;
              const t = el ? (el.textContent || '') : '';
              if (el && /€/.test(t) && t.length < 3000) { card = el; break; }
            }
            const txt = card ? (card.textContent || '').replace(/\s+/g, ' ') : '';
            const pm = txt.match(/€\s*([\d.]{4,})/) || txt.match(/([\d.]{4,})\s*€/);
            const mm = txt.match(/(\d{1,4})\s*(?:m²|mq)\b/i);
            out.push({
              url: h,
              price: pm ? parseInt(pm[1].replace(/\./g, ''), 10) : null,
              mq: mm ? parseInt(mm[1], 10) : null,
            });
          }
          return out;
        });
        let added = 0;
        let skipped = 0;
        for (const r of rows) {
          const id = r.url.match(/\/(\d+)$/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (r.price !== null && r.price > MAX_PREZZO) { skipped++; continue; }
          if (r.mq !== null && r.mq < MIN_MQ) { skipped++; continue; }
          cards.push({ id, url: r.url, area: c.name });
          added++;
        }
        log(`[tempocasa] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} fuori filtro)`);
        if (rows.length === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`page=${n + 1}`)), pageNum);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(2500, 4500));
      }
      await sleep(rand(2000, 4000));
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
      const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');
      // Sezione "Dettagli" con coppie label/valore (Camere da letto, Cucina, Piano...)
      const detIdx = bodyText.search(/Dettagli\s+Locali/i);
      const dettagli = detIdx >= 0 ? bodyText.slice(detIdx, detIdx + 400) : '';
      return { ld, bodyText, dettagli };
    });
    const node = findListingNode(data.ld);
    if (!node) return null;
    const me = node.mainEntity || {};
    const offers = node.offers || {};
    // Rete client-side: il portale non offre filtri via URL.
    const prezzo0 = offers.price ?? null;
    const mq0 = me.floorSize?.value ?? null;
    if ((prezzo0 != null && prezzo0 > MAX_PREZZO) || (mq0 != null && mq0 < MIN_MQ)) {
      log(`[tempocasa] fuori target (${prezzo0 ?? '?'} €, ${mq0 ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const addr = me.address || {};
    const desc = node.description || '';
    const body = data.bodyText;
    const det = data.dettagli;
    const locali = me.numberOfRooms ?? null;
    // Camere da letto ESPLICITO nella sezione Dettagli
    const camDet = det.match(/Camere da letto\s+(\d+)/i);
    const camere = camDet ? parseInt(camDet[1], 10) : bedroomsFromText(desc, locali);
    // Cucina / balcone / cantina dai Dettagli
    const cucinaM = det.match(/Cucina\s+([A-Za-zàèéìòù]+)/i);
    const balconeM = det.match(/Balconi\s+(\d+)/i);
    const cantinaM = /Cantina\s+Si/i.test(det);
    // Classe energetica da amenityFeature
    let ape = '';
    for (const a of (me.amenityFeature || [])) {
      if (/energetic/i.test(a.name || '') && a.value) ape = String(a.value);
    }
    const apeM = body.match(/Classe\s+Energetica[:\s]*([A-G][1-4]?)/i);
    if (!ape && apeM) ape = apeM[1];
    // Piano dalla descrizione ("piano intermedio", "secondo piano", "piano terra")
    const pianoM = desc.match(/piano\s+(intermedio|terra|rialzato|seminterrato|interrato|ultimo|primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo)/i)
      || desc.match(/(primo|secondo|terzo|quarto|quinto|sesto|settimo|ultimo)\s+piano/i);
    const ascensore = /ascensore/i.test(desc) && !/senza ascensore|no ascensore/i.test(desc);
    // Zona dalla descrizione ("zona residenziale", "zona Mazzini")
    const zonaM = desc.match(/zona\s+([A-Za-zàèéìòù' ]{3,30}?)(?:,|\.|\.| più| comoda| in)/i);
    const foto = firstVal(node.image) || '';

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: node.name || 'Immobile in vendita',
      comune: addr.addressLocality || '',
      provincia: 'BO',
      zona: zonaM ? zonaM[1].trim() : '',
      indirizzo: addr.streetAddress || '',
      lat: me.geo?.latitude ?? null,
      lon: me.geo?.longitude ?? null,
      prezzo: offers.price ?? null,
      tipologia: firstVal(me['@type']) || 'Appartamento',
      locali,
      camere,
      bagni: me.numberOfBathroomsTotal ?? null,
      superficieMq: me.floorSize?.value ?? null,
      piano: pianoM ? pianoM[1] : '',
      ascensore,
      cucina: cucinaM ? cucinaM[1] : '',
      balcone: balconeM ? parseInt(balconeM[1], 10) > 0 : /balcon/i.test(desc),
      cantina: cantinaM,
      stato: mapStato(statoFromText(desc)),
      ape: String(ape).toUpperCase(),
      agenzia: offers.seller?.name || 'Tempocasa',
      privato: false,
      descrizione: desc,
      foto: typeof foto === 'string' ? foto : (foto?.url || ''),
      dataPubblicazione: node.datePublished || null,
      dataModifica: node.dateModified || null,
    };
  },
};