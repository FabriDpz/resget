// Adattatore toscano.it — Blazor Server, Playwright headed.
// Listing: /vendita/immobili-residenziali/comune-<slug> (33 Bologna, 3 San Lazzaro,
// 0 Pianoro al 22/11). Prezzo/mq NON filtrabili server-side → filtro CLIENT-SIDE:
// la listing espone un JSON-LD ItemList di RealEstateListing con offers.price e
// displayLocation → prezzo scartato PRIMA di visitare il dettaglio.
// Paginazione path: /comune-bologna/2 (verificata; nessun anchor, bottoni Blazor).
// Dettaglio: JSON-LD RealEstateListing (type attribute decodificato nel DOM:
// 'application/ld+json'; cerchiamo script[type*="ld"] per robustezza) + sezione
// "Caratteristiche" label/valore nel testo (Superficie, Locali, Bagni, Piano,
// Ascensore, Riscaldamento, Classe energetica, Condizioni immobile…).

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText, zonaFromDescrizione } from '../core/schema.mjs';

const BASE = 'https://www.toscano.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const COMUNI = [
  { slug: 'comune-bologna', name: 'Bologna' },
  { slug: 'comune-san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
  { slug: 'comune-pianoro', name: 'Pianoro' },
];
const WHITELIST = ['bologna', 'san lazzaro di savena', 'pianoro'];

function parseLdScripts() {
  // eseguita nel contesto pagina
  const out = [];
  document.querySelectorAll('script[type*="ld"]').forEach((s) => {
    try {
      const data = JSON.parse(s.textContent);
      for (const b of Array.isArray(data) ? data : [data]) out.push(b);
    } catch { /* JSON-LD malformato */ }
  });
  return out;
}

export default {
  id: 'toscano',
  name: 'Toscano',

  probeChecks: {
    listingUrl: 'https://www.toscano.it/vendita/immobili-residenziali/comune-bologna',
    cardSelectors: ['.plp_card', 'a[href*="/comune-"]'],
    linkPattern: '\\/comune-[^/]+\\/\\d+-',
    minLinks: 5,
    detailChecks: { cardSelectors: [], jsonLdType: 'RealEstateListing' },
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      let pageNum = 1;
      const maxPages = 5; // 33 immobili Bologna = 2 pagine: margine senza eccessi
      while (pageNum <= maxPages && cards.length < maxAds) {
        const url = `${BASE}/vendita/immobili-residenziali/${c.slug}${pageNum > 1 ? `/${pageNum}` : ''}`;
        const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
        await dismissCookies(page);
        await humanPause(2200, 4000);
        await checkBlocked(page, resp);
        const rows = await page.evaluate(() => {
          const ld = [];
          document.querySelectorAll('script[type*="ld"]').forEach((s) => {
            try {
              const d = JSON.parse(s.textContent);
              for (const b of Array.isArray(d) ? d : [d]) ld.push(b);
            } catch { /* */ }
          });
          const byUrl = new Map();
          const priceByUrl = new Map();
          for (const b of ld) {
            const items = b['@type'] === 'ItemList' ? (b.itemListElement || []) : [b];
            for (const it of items) {
              if (!it || !it.url) continue;
              const u = it.url.split('?')[0];
              const p = it.offers?.price != null ? Number(it.offers.price) : null;
              // -1 = sentinel "trattativa riservata" del portale.
              const pv = p != null && p > 0 ? p : null;
              if (pv != null) priceByUrl.set(u, pv);
              byUrl.set(u, {
                prezzo: pv,
                titolo: it.name || '',
                indirizzo: it.displayLocation?.address?.streetAddress || '',
              });
            }
          }
          // Fallback prezzo dalle card DOM (il JSON-LD ItemList può essere parziale).
          document.querySelectorAll('.plp_card').forEach((el) => {
            const a = el.querySelector('a[href*="/comune-"]');
            if (!a) return;
            const u = (a.href || '').split('#')[0].split('?')[0];
            if (priceByUrl.has(u)) return;
            const m = (el.innerText || '').match(/€\s*([\d.]{5,})/);
            if (m) priceByUrl.set(u, parseInt(m[1].replace(/\./g, ''), 10));
          });
          const out = [];
          const seenH = new Set();
          document.querySelectorAll('a[href]').forEach((a) => {
            const h = (a.href || '').split('#')[0].split('?')[0];
            if (!/\/comune-[^/]+\/\d+-/.test(h) || seenH.has(h)) return;
            seenH.add(h);
            const meta = byUrl.get(h) || {};
            out.push({ url: h, id: h.match(/\/(\d+)-/)?.[1] || null, ...meta, prezzo: priceByUrl.get(h) ?? meta.prezzo ?? null });
          });
          return out;
        });
        let added = 0, skipped = 0;
        for (const r of rows) {
          if (!r.id || seen.has(r.id)) continue;
          seen.add(r.id);
          if (r.prezzo != null && r.prezzo > MAX_PREZZO) { skipped++; continue; }
          cards.push({ id: r.id, url: r.url, area: c.name, prezzo: r.prezzo ?? null, titolo: r.titolo || '', indirizzo: r.indirizzo || '' });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[toscano] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} oltre budget)`);
        if (rows.length === 0 || added + skipped === 0) break;
        // nessuna paginazione via anchor: si tenta la pagina successiva finché
        // compaiono annunci nuovi (la pagina oltre l'ultima ripete/è vuota).
        if (added + skipped < 20) break; // pagina non piena → ultima
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
    await humanPause(2000, 3800);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const ld = [];
      document.querySelectorAll('script[type*="ld"]').forEach((s) => {
        try {
          const d = JSON.parse(s.textContent);
          for (const b of Array.isArray(d) ? d : [d]) ld.push(b);
        } catch { /* */ }
      });
      const bodyText = (document.body?.innerText || '').replace(/\r/g, '');
      const plan = [...document.querySelectorAll('img')]
        .filter((i) => /planimetr/i.test((i.src || '') + ' ' + (i.alt || '')))
        .map((i) => ({ url: i.src, caption: i.alt || 'Planimetria' }));
      return { ld, bodyText, plan };
    });
    let node = null;
    for (const b of data.ld) {
      const nodes = b['@graph'] || [b];
      for (const n of nodes) {
        const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
        if (types.includes('RealEstateListing')) { node = n; break; }
      }
      if (node) break;
    }
    const body = data.bodyText;
    // Fallback DOM se JSON-LD assente: prezzo dal testo "Prezzo immobile € …".
    const priceM = body.match(/Prezzo immobile\s*€\s*([\d.]+)/i) || body.match(/€\s*([\d.]{5,})/);
    const rawPrezzo = node?.offers?.price != null ? Number(node.offers.price)
      : (priceM ? parseInt(priceM[1].replace(/\./g, ''), 10) : null);
    const prezzo = rawPrezzo != null && rawPrezzo > 0 ? rawPrezzo : null; // -1 = trattativa riservata
    // Sezione Caratteristiche: coppie label\nvalore nel testo.
    const feat = (label) => {
      const m = body.match(new RegExp(`\\n${label}\\n([^\\n]+)`, 'i'));
      return m ? m[1].trim() : '';
    };
    const mqM = (feat('Superficie') || body).match(/(\d+)\s*m/i);
    const mq = mqM ? parseInt(mqM[1], 10) : null;
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[toscano] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const addr = node?.displayLocation?.address || {};
    const comune = addr.addressLocality || card.area || '';
    if (comune && !WHITELIST.includes(comune.toLowerCase())) {
      log(`[toscano] comune fuori whitelist (${comune}): scarto ${card.id}`);
      return null;
    }
    const locali = parseInt(feat('Locali'), 10) || null;
    const bagni = parseInt(feat('Bagni'), 10) || null; // 0 = non dichiarato
    const descM = body.match(/Descrizione\n([\s\S]*?)(?:\nCaratteristiche|\nPosizione)/);
    const desc = (descM ? descM[1] : '').replace(/\n+/g, ' ').trim();
    const apeM = (feat('Classe energetica') || '').match(/^([A-G][1-4]?)/i);
    const quartiereM = body.match(/Il quartiere ([^\n]{3,50})/);
    const speseM = (feat('Spese condominio') || '').match(/([\d.]+)\s*€\s*\/\s*mese/i);
    const boxFeat = feat('Posto auto / Box');
    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: node?.name || card.titolo || 'Immobile in vendita',
      comune,
      provincia: 'BO',
      zona: quartiereM ? quartiereM[1].trim() : zonaFromDescrizione(desc),
      indirizzo: addr.streetAddress || card.indirizzo || '',
      prezzo,
      tipologia: 'Appartamento',
      locali,
      camere: bedroomsFromText(desc, locali),
      bagni,
      superficieMq: mq,
      piano: feat('Piano'),
      ascensore: /^(s[iì]|presente)/i.test(feat('Ascensore')) ? 'Sì' : (/^no/i.test(feat('Ascensore')) ? 'No' : ''),
      balcone: /balcon/i.test(desc) && !/senza balcon/i.test(desc),
      cantina: /^Altro\nCantina/im.test(body) || (/cantina/i.test(desc) && !/senza cantina/i.test(desc)),
      stato: mapStato(feat('Condizioni immobile')),
      ape: apeM ? apeM[1].toUpperCase() : '',
      riscaldamento: feat('Riscaldamento'),
      speseCondominio: speseM ? `${speseM[1]} €/mese` : feat('Spese condominio'),
      altreCaratteristiche: boxFeat && !/^no/i.test(boxFeat) ? `Posto auto/Box: ${boxFeat}` : '',
      agenzia: node?.offers?.seller?.name || 'Toscano',
      privato: false,
      descrizione: desc,
      foto: typeof node?.image === 'string' ? node.image : '',
      planimetrie: data.plan,
    };
  },
};