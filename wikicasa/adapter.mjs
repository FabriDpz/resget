// Adattatore wikicasa.it — Playwright. (casaclick.it è un alias: stesso sito.)
// Listing: /vendita-case/{comune}/prezzo-fino-a-160000/ (path SEO).
//   ⚠️ VERIFICA BROWSER REALE 22/11: le query ?PrezzoMassimo&SuperficieMinima
//   sono IGNORATE dal server ANCHE quando generate dal form "Filtri" del sito
//   (URL cosmetica; reload completo → stessi risultati non filtrati).
//   Il path SEO prezzo-fino-a-160000 è l'UNICO filtro server-side verificato
//   (H1 "Case fino a 160.000 euro", prezzi correnti tutti ≤160k; i prezzi sopra
//   soglia visibili nel DOM sono prezzi BARRATI pre-ribasso, non correnti).
//   Nessun path SEO per la superficie → filtro mq CLIENT-SIDE sulle card.
//   Paginazione ?p=N sul path SEO (link verificati in pagina).
// Dettaglio: JSON-LD @graph con nodo RealEstateListing → mainEntity (camere, geo,
// indirizzo, mq) + offers (prezzo, agenzia). Stato/descrizione dal testo.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, zonaFromDescrizione } from '../core/schema.mjs';

const BASE = 'https://www.wikicasa.it';
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
      if (types.includes('RealEstateListing') || types.includes('Product')) {
        if (n.mainEntity || n.offers) return n;
      }
    }
  }
  return null;
}
function firstVal(x) { return Array.isArray(x) ? x[0] : x; }

function statoFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/da ristrutturare|da restaurare|da rimodernare|da sistemare/.test(t)) return 'Da ristrutturare';
  if (/ristrutturat[ao]|pari al nuovo|nuovo|recente costruzione/.test(t)) return 'Ottimo / Ristrutturato';
  if (/buono stato|abitabile|buone condizioni|discreto/.test(t)) return 'Buono / Abitabile';
  return '';
}

export default {
  id: 'wikicasa',
  name: 'Wikicasa',

  // Asserzioni verificabili da core/probe-verify.mjs (architettura ibrida D9).
  probeChecks: {
    listingUrl: 'https://www.wikicasa.it/vendita-case/bologna/prezzo-fino-a-160000/',
    cardSelectors: ['a[href*="/annuncio/"]'],
    linkPattern: '\\/annuncio\\/\\d+$',
    minLinks: 5,
    detailChecks: { jsonLdType: 'RealEstateListing' },
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const url = `${BASE}/vendita-case/${c.slug}/prezzo-fino-a-160000/`;
      log(`[wikicasa] Area ${c.name}: ${url}`);
      let pageNum = 1;
      const maxPages = 12;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const pageUrl = pageNum === 1 ? url : `${url}?p=${pageNum}`;
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 30000 });
        await dismissCookies(page);
        await humanPause(2500, 4000);
        await checkBlocked(page, resp);
        // Card con prezzo CORRENTE e mq: la card contiene "€ 139.000" (corrente)
        // e "142.000 €-2,1%" (barrato pre-ribasso). Il corrente ha "€" PRIMA.
        const rows = await page.evaluate(() => {
          const out = [];
          const seenHref = new Set();
          for (const a of document.querySelectorAll('a[href*="/annuncio/"]')) {
            const h = a.href.split('#')[0].split('?')[0];
            if (!/\/annuncio\/\d+$/.test(h) || seenHref.has(h)) continue;
            seenHref.add(h);
            // risali al contenitore card (article o antenato con prezzo+mq)
            let el = a, card = null;
            for (let i = 0; i < 8 && el; i++) {
              el = el.parentElement;
              if (el && /€/.test(el.textContent || '') && /m\s*2|m²/.test((el.textContent || '').replace(/\s+/g, ' '))) { card = el; break; }
            }
            const txt = card ? (card.textContent || '').replace(/\s+/g, ' ') : '';
            const cur = txt.match(/€\s*([\d.]{4,})/); // prezzo corrente: € prima del numero
            const mqM = txt.match(/(\d{1,4})\s*m\s*2\b/) || txt.match(/(\d{1,4})\s*m²/);
            out.push({
              url: h,
              price: cur ? parseInt(cur[1].replace(/\./g, ''), 10) : null,
              mq: mqM ? parseInt(mqM[1], 10) : null,
            });
          }
          return out;
        });
        let added = 0;
        let skipped = 0;
        for (const r of rows) {
          const id = r.url.match(/\/annuncio\/(\d+)/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          // rete client-side: prezzo corrente > budget o mq < 40 → scarta PRIMA del dettaglio
          if (r.price !== null && r.price > 160000) { skipped++; continue; }
          if (r.mq !== null && r.mq < 40) { skipped++; continue; }
          cards.push({ id, url: r.url, area: c.name });
          added++;
        }
        log(`[wikicasa] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} fuori filtro)`);
        if (rows.length === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => /[?&]p=/.test(a.href) && a.href.includes(`p=${n + 1}`)), pageNum);
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
      const ld = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try { ld.push(JSON.parse(s.textContent)); } catch { /* */ }
      });
      return { ld, bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ') };
    });
    const node = findListingNode(data.ld);
    if (!node) return null;
    const me = node.mainEntity || {};
    const offers = node.offers || {};
    const addr = me.address || {};
    const geo = me.geo || {};
    const desc = node.description || '';
    const body = data.bodyText;

    // Zona: dal breadcrumb/titolo ("Case a Mazzini, Fossolo, Savena Wikicasa").
    // Vincolata a <=60 char e a sole lettere/spazi/virgole: evita di inglobare
    // l'intero body quando "Case a" compare nella descrizione lontano dal titolo.
    const zonaM = body.match(/Case a ([A-Za-zàèéìòù' ,]{3,60}?)\s+Wikicasa/);
    const zona = (zonaM ? zonaM[1].trim() : '') || zonaFromDescrizione(desc);
    // Bagni dal body ("1Bagno" / "2Bagni")
    const bagniM = body.match(/(\d+)\s*Bagno/i);
    // Piano dalla descrizione
    // Entrambi gli ordini: "al terzo piano" E "piano interrato" (6982c5d5:
    // "piano interrato" non matchava → campo piano vuoto → SMA promosso).
    const ordPiano = 'primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo|ultimo|terra|rialzato|seminterrato|interrato';
    const pianoM = desc.match(new RegExp(`(?:al\\s+)?(${ordPiano})\\s+piano`, 'i'))
      || desc.match(new RegExp(`\\bpiano\\s+(${ordPiano})\\b`, 'i'));
    const apeM = body.match(/Classe\s+Energetica\s*([A-G][1-4]?)/i) || desc.match(/classe\s+energetica\s*([A-G][1-4]?)/i);
    const foto = firstVal(node.image) || '';
    const planM = /planimetr/i.test(body);

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: node.name || `${firstVal(me['@type']) || 'Immobile'} in vendita`,
      comune: addr.addressLocality || '',
      provincia: addr.addressRegion || '',
      zona,
      indirizzo: addr.streetAddress || '',
      lat: geo.latitude ?? null,
      lon: geo.longitude ?? null,
      prezzo: offers.price ?? null,
      tipologia: firstVal(me['@type']) === 'SingleFamilyResidence' ? 'Appartamento' : (firstVal(me['@type']) || ''),
      locali: me.numberOfRooms ?? null,
      camere: me.numberOfBedrooms ?? null,
      bagni: me.numberOfBathroomsTotal ?? (bagniM ? parseInt(bagniM[1], 10) : null),
      superficieMq: me.floorSize?.value ?? null,
      piano: pianoM ? pianoM[1] : '',
      stato: mapStato(statoFromText(desc)),
      ape: apeM ? apeM[1].toUpperCase() : '',
      agenzia: offers.seller?.name || offers.offeredBy?.name || '',
      privato: !offers.seller && !offers.offeredBy,
      descrizione: desc,
      foto: typeof foto === 'string' ? foto : (foto?.url || foto?.contentUrl || ''),
      planimetrie: planM ? [{ url: '', caption: 'Planimetria presente (verifica visiva)' }] : [],
    };
  },
};