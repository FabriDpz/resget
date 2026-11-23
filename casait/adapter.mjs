// Adattatore casa.it — Playwright headed.
// Listing: /vendita/residenziale/{comune}/?priceMax=160000&page=N (SSR, link /immobili/{id}/).
//   Il filtro prezzo è SERVER-SIDE solo con "priceMax" (prezzoMax/prezzo_max sono ignorati).
//   La lista è client-rendered (no __NEXT_DATA__): card .csaSrpcard, paginazione ?page=N.
//   I filtri/ordinamento client-side sono bloccati da DataDome (re-fetch fallisce) →
//   si usa solo il filtro prezzo SSR + paginazione, niente interazioni UI.
// Dettaglio: __NEXT_DATA__.props.pageProps.pdp (JSON ricco: coordinate, POI, features).
// Camere da letto: non esposte come campo → dedotte dalla descrizione (regex),
// altrimenti null (verifica planimetria a valle, come immobiliare.it).
// Anti-bot: fail-closed (policy §8). DataDome blocca solo l'analytics, non il contenuto SSR.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato } from '../core/schema.mjs';

const BASE = 'https://www.casa.it';
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'pianoro', name: 'Pianoro' },
  { slug: 'san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
];
const MAX_PREZZO = 160000;

// Estrae un valore "main" grezzo da un item delle featureLists.
function featVal(item) {
  if (!item || !item.values || !item.values.length) return '';
  const v = item.values[0];
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if (v.main != null) return typeof v.main === 'object' ? String(v.main.value ?? '') : String(v.main);
    if (v.value != null) return String(v.value);
  }
  return '';
}
function findFeature(pdp, label) {
  for (const list of pdp.features?.featureLists || []) {
    for (const it of list.items || []) {
      if (it.label?.toLowerCase() === label.toLowerCase()) return featVal(it);
    }
  }
  return '';
}
function findFeatureList(pdp, label) {
  for (const list of pdp.features?.featureLists || []) {
    for (const it of list.items || []) {
      if (it.label?.toLowerCase() === label.toLowerCase()) return (it.values || []).map((v) => (typeof v === 'string' ? v : featVal({ values: [v] })));
    }
  }
  return [];
}

// Deduce le camere da letto dalla descrizione (casa.it non le espone).
function bedroomsFromText(text) {
  const t = String(text || '').toLowerCase();
  const patterns = [
    /(\d+|una|due|tre|quattro|cinque)\s+camer[ae]\s+da\s+letto/,
    /(\d+|una|due|tre)\s+camer[ae]\b/,
    /camera\s+matrimoniale\s+e\s+(\d+|una|due)\s+camer/,
  ];
  const words = { una: 1, due: 2, tre: 3, quattro: 4, cinque: 5 };
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = words[m[1]] ?? parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > 0 && n < 20) return n;
    }
  }
  // "camera matrimoniale" + "cameretta" → 2
  if (/matrimoniale/.test(t) && /cameretta|seconda camera|singola/.test(t)) return 2;
  if (/matrimoniale/.test(t)) return 1;
  return null;
}

function parseItalianDate(s) {
  if (!s) return '';
  const months = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
  const m = String(s).toLowerCase().match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (m && months[m[2]]) return `${m[3]}-${String(months[m[2]]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return '';
}

export default {
  id: 'casait',
  name: 'Casa.it',
  // WAF DataDome sensibile: navigazione molto lenta (richiesta utente 16/11).
  pace: { minMs: 20000, reason: 'WAF DataDome: click ogni ≥20s' },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const url = `${BASE}/vendita/residenziale/${c.slug}/?priceMax=${MAX_PREZZO}`;
      log(`[casait] Area ${c.name}: ${url}`);
      let pageNum = 1;
      const maxPages = 12;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const pageUrl = pageNum === 1 ? url : `${url}&page=${pageNum}`;
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 30000 });
        await dismissCookies(page);
        await humanPause(2500, 4000);
        await checkBlocked(page, resp);
        // La lista è client-rendered: attendi le card .csaSrpcard (max ~8s).
        await page.waitForSelector('.csaSrpcard a[href*="/immobili/"]', { timeout: 8000 }).catch(() => {});
        const rows = await page.evaluate(() => {
          const roots = [...document.querySelectorAll('.csaSrpcard')];
          return roots.map((card) => {
            const a = card.querySelector('a[href*="/immobili/"]');
            const href = a?.href || '';
            const id = (href.match(/\/immobili\/(\d+)/) || [])[1] || null;
            const priceEl = [...card.querySelectorAll('*')].find((e) => /^€\s*[\d.]+$/.test((e.textContent || '').trim()));
            const price = priceEl?.textContent?.trim() || '';
            const feats = [...card.querySelectorAll('.csaSrpcard__det__feats__item')].map((e) => (e.textContent || '').trim());
            const title = card.querySelector('.csaSrpcard__det__title')?.textContent?.trim() || '';
            return { id, url: href.split('#')[0].split('?')[0], price, feats, title };
          }).filter((r) => r.id);
        });
        let added = 0;
        let skipped = 0;
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          // rete client-side prezzo/mq PRIMA del dettaglio (pace 20s: ogni
          // dettaglio evitato risparmia ~25s). Feats tipo "90 m²" / "3 locali".
          const p = parseInt(String(r.price).replace(/[^\d]/g, ''), 10) || null;
          if (p !== null && p > MAX_PREZZO) { skipped++; continue; }
          const mqFeat = r.feats.map((f) => f.match(/(\d{1,4})\s*m²/i)).find(Boolean);
          if (mqFeat && parseInt(mqFeat[1], 10) < 40) { skipped++; continue; }
          cards.push({ id: r.id, url: `${BASE}/immobili/${r.id}/`, area: c.name, price: r.price, feats: r.feats, title: r.title });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[casait] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} fuori filtro)`);
        if (rows.length === 0) break;
        // Paginazione SSR: cerca link "page=N+1"
        const hasNext = await page.evaluate((n) => {
          return [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`page=${n + 1}`));
        }, pageNum);
        if (!hasNext) break;
        pageNum++;
        await humanPause(20000, 25000);
      }
      await humanPause(20000, 25000);
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 25000 });
    await dismissCookies(page);
    await humanPause(2000, 3500);
    await checkBlocked(page, resp);
    const pdp = await page.evaluate(() => {
      const nd = document.getElementById('__NEXT_DATA__');
      if (!nd) return null;
      try { return JSON.parse(nd.textContent).props?.pageProps?.pdp || null; } catch { return null; }
    });
    if (!pdp || !pdp.id) {
      // Annuncio rimosso o pagina non valida
      return null;
    }
    const addr = pdp.address || {};
    const desc = pdp.description?.it?.text || pdp.description?.text || (typeof pdp.description === 'string' ? pdp.description : '');
    const altre = findFeatureList(pdp, 'Altre caratteristiche').join(', ');
    const condizioni = findFeature(pdp, 'Condizioni immobile');
    const camere = bedroomsFromText(desc) ?? bedroomsFromText(pdp.propertyType?.label);
    const gallery = pdp.media?.gallery || [];
    const foto = gallery[0]?.mediaid ? `https://images.casa.it${gallery[0].mediaid}` : '';
    const planimetrie = gallery
      .filter((g) => /planimetr|floor/i.test(`${g.alt || ''} ${g.type || ''}`))
      .map((g) => ({ url: g.mediaid ? `https://images.casa.it${g.mediaid}` : '', caption: g.alt || 'Planimetria' }));

    return {
      id: String(pdp.id),
      url: card.url,
      area: card.area,
      titolo: `${pdp.propertyType?.label || 'Immobile'} in vendita ${addr.zone ? '— ' + addr.zone : ''}`.trim(),
      comune: addr.town || '',
      provincia: addr.provinceFull || addr.province || '',
      zona: addr.zone || addr.block || '',
      indirizzo: addr.street || '',
      lat: addr.lat ?? null,
      lon: addr.lon ?? null,
      prezzo: pdp.price?.value ?? null,
      tipologia: pdp.propertyType?.label || '',
      locali: pdp.rooms?.value ?? null,
      camere,
      bagni: pdp.mainFeatures?.baths ?? (parseInt(findFeature(pdp, 'Bagni'), 10) || null),
      superficieMq: pdp.size?.value ?? null,
      piano: findFeature(pdp, 'Piano'),
      ascensore: findFeature(pdp, 'Ascensore'),
      balcone: /balcon/i.test(altre) ? 'Sì' : '',
      cantina: /cantin/i.test(altre) ? 'Sì' : '',
      terrazzo: /terrazz/i.test(altre) ? 'Sì' : '',
      stato: mapStato(condizioni),
      ape: pdp.energyClass?.class || findFeature(pdp, 'Classe energetica'),
      riscaldamento: findFeature(pdp, 'Riscaldamento'),
      speseCondominio: findFeature(pdp, 'Spese condominiali'),
      altreCaratteristiche: altre,
      agenzia: pdp.publisher?.publisherName || '',
      privato: pdp.publisher?.publisherType === 'Private',
      aggiornatoIl: parseItalianDate(pdp.modified),
      descrizione: desc,
      foto,
      planimetrie,
      isAuction: !!pdp.isAuction,
    };
  },
};