// Adattatore reportimmobiliare.it — WP tema Realty, Playwright headed.
// ⚠️ TLS legacy: fetch/curl falliscono, Chromium funziona → SEMPRE il browser
// del runner, nessuna richiesta HTTP diretta.
// Listing: /property-status/residenziale-vendita/ + /page/2/…/page/5/ (~10 card,
// 46 immobili al 22/11). NESSUN filtro server-side: prezzo e comune scartati
// CLIENT-SIDE dalle card (portfolio include Milano/Monza/Castel Maggiore).
// Card: div.property-item → h3.title, h4.address, .price-tag '€440.000',
// span.type / span.status, .property-meta .meta-data (data-original-title:
// Dimensioni/Locali/Camere da letto/Bagni). Badge VENDUTO nel markup.
// Dettaglio /property/<slug>/: DOM (#property-content p, #property-features li
// con a.inactive = accessorio ASSENTE), meta in testa, ld+json solo Yoast
// (WebPage/BreadcrumbList: datePublished utile, niente dati immobile).

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText, zonaFromDescrizione } from '../core/schema.mjs';

const BASE = 'https://reportimmobiliare.it';
const LISTING = `${BASE}/property-status/residenziale-vendita/`;
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const WHITELIST = ['bologna', 'san lazzaro di savena', 'pianoro'];

function parsePrice(txt) {
  const m = String(txt || '').replace(/\./g, '').match(/(\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}

// Comune dal titolo/slug/descrizione: i titoli sono "BOLOGNA – VIA PUNTA",
// "SAN LAZZARO", "VIA MARCHETTI" (quartiere bolognese). Ritorna null se ignoto.
function comuneFrom(titolo, slug, testo) {
  const t = `${titolo || ''} ${slug || ''}`.toLowerCase();
  if (/san[\s-]?lazzaro/.test(t)) return 'San Lazzaro di Savena';
  if (/pianoro/.test(t)) return 'Pianoro';
  if (/bologna/.test(t)) return 'Bologna';
  const d = String(testo || '').toLowerCase();
  if (/san lazzaro/.test(d)) return 'San Lazzaro di Savena';
  if (/\bpianoro\b/.test(d)) return 'Pianoro';
  if (/\bbologna\b|borgo panigale/.test(d)) return 'Bologna';
  return null;
}
// Comuni esplicitamente fuori whitelist nel titolo/slug: scarto immediato.
function fuoriWhitelist(titolo, slug) {
  const t = `${titolo || ''} ${slug || ''}`.toLowerCase();
  return /milano|monza|castel maggiore|casalecchio|tiziano|cant[uù]|imola|anzola|granarolo|zola predosa|san giovanni in persiceto|san giorgio|budrio|castenaso|crespellano|valsamoggia|bazzano|sasso marconi|calderara|minerbio|argelato|pian di macina|marzabotto|vergato|loiano|monghidoro|castiglione|camugnano|grizzana|san benedetto|savigno|molino del piano/.test(t)
    && !/bologna|san[\s-]?lazzaro|pianoro/.test(t);
}

export default {
  id: 'reportimmobiliare',
  name: 'Report Immobiliare',

  probeChecks: {
    listingUrl: LISTING,
    cardSelectors: ['.property-item'],
    linkPattern: '\\/property\\/[^/]+\\/',
    minLinks: 5,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    let pageNum = 1;
    const maxPages = 6; // 5 pagine al 22/11: margine minimo
    while (pageNum <= maxPages && cards.length < maxAds) {
      const url = pageNum === 1 ? LISTING : `${LISTING}page/${pageNum}/`;
      const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
      await dismissCookies(page);
      await humanPause(2200, 4000);
      await checkBlocked(page, resp);
      const rows = await page.evaluate(() => {
        return [...document.querySelectorAll('.property-item')].map((el) => {
          const a = el.querySelector('a[href*="/property/"]');
          const url = a ? a.href.split('#')[0].split('?')[0] : '';
          const meta = {};
          el.querySelectorAll('.meta-data').forEach((m) => {
            const k = m.getAttribute('data-original-title') || m.getAttribute('title') || '';
            meta[k] = m.textContent.trim();
          });
          return {
            url,
            titolo: el.querySelector('h3.title')?.textContent?.trim() || '',
            address: el.querySelector('h4.address')?.textContent?.trim() || '',
            tipo: el.querySelector('span.type')?.textContent?.trim() || '',
            status: el.querySelector('span.status, .property-status')?.textContent?.trim() || '',
            price: el.querySelector('.price-tag')?.textContent?.trim() || '',
            venduto: /venduto/i.test(el.querySelector('.property-statuses, .property-labels, .status-labels')?.textContent || '') || /\bVENDUTO\b/.test(el.textContent || ''),
            excerpt: el.querySelector('.property-excerpt p')?.textContent?.trim() || '',
            meta,
          };
        }).filter((r) => /\/property\/[^/]+\/?$/.test(r.url));
      });
      let added = 0, skipped = 0;
      for (const r of rows) {
        const slug = r.url.match(/\/property\/([^/]+)\/?$/)?.[1] || '';
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        const p = parsePrice(r.price);
        const comune = comuneFrom(r.titolo, slug, r.excerpt);
        if (r.venduto || (p != null && p > MAX_PREZZO) || (!comune && fuoriWhitelist(r.titolo, slug)) || (comune && !WHITELIST.includes(comune.toLowerCase()))) {
          skipped++;
          continue;
        }
        cards.push({
          id: slug, url: r.url, area: comune || 'Bologna?', comune,
          titolo: r.titolo, address: r.address, tipo: r.tipo, prezzo: p,
          mq: parseInt(r.meta['Dimensioni'], 10) || null,
          locali: parseInt(r.meta['Locali'], 10) || null,
          camere: parseInt(r.meta['Camere da letto'], 10) || null,
          bagni: parseInt(r.meta['Bagni'], 10) || null,
        });
        added++;
        if (cards.length >= maxAds) break;
      }
      log(`[reportimmobiliare] pag ${pageNum}: ${rows.length} card, +${added} (tot ${cards.length}, ${skipped} scartati prezzo/comune/venduto)`);
      if (rows.length === 0) break;
      const hasNext = await page.evaluate((n) => [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`/page/${n + 1}/`)), pageNum);
      if (!hasNext) break;
      pageNum++;
      await sleep(rand(2500, 4500));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 20000 });
    await dismissCookies(page);
    await humanPause(2000, 3800);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const main = document.getElementById('main-content') || document.body;
      const bodyText = (main.innerText || '').replace(/\r/g, '');
      const desc = [...document.querySelectorAll('#property-content p')].map((p) => p.textContent.trim()).filter(Boolean).join('\n');
      const features = {};
      document.querySelectorAll('#property-features li').forEach((li) => {
        const a = li.querySelector('a');
        if (!a) return;
        features[a.textContent.trim()] = !a.classList.contains('inactive');
      });
      const meta = {};
      document.querySelectorAll('.property-meta .meta-data').forEach((m) => {
        const k = m.getAttribute('data-original-title') || m.getAttribute('title') || '';
        meta[k] = m.textContent.trim();
      });
      let datePublished = '';
      document.querySelectorAll('script[type*="ld"]').forEach((s) => {
        try {
          const d = JSON.parse(s.textContent);
          for (const b of Array.isArray(d) ? d : [d]) {
            for (const n of (b['@graph'] || [b])) {
              if (n['@type'] === 'WebPage' && n.datePublished) datePublished = String(n.datePublished).slice(0, 10);
            }
          }
        } catch { /* */ }
      });
      const foto = document.querySelector('#property-content img, .property-slider img, .flexslider img, .wp-post-image')?.src || '';
      const plan = [...main.querySelectorAll('a[href], img')]
        .filter((e) => /planimetr/i.test((e.href || e.src || '') + ' ' + (e.textContent || e.alt || '')))
        .map((e) => ({ url: e.href || e.src, caption: e.textContent?.trim() || 'Planimetria' }));
      // Solo il prezzo dell'annuncio (mai i .price-tag di "IMMOBILI SIMILI").
      const prezzoTxt = main.querySelector?.('.price-tag')?.textContent || '';
      const headTxt = bodyText.split(/IMMOBILI SIMILI/i)[0].slice(0, 900);
      const titolo = document.querySelector('h1')?.textContent?.trim() || '';
      const venduto = /\bVENDUTO\b/.test(headTxt);
      return { bodyText: bodyText.slice(0, 8000), headTxt, desc, features, meta, datePublished, foto, plan, prezzoTxt, titolo, venduto };
    });
    if (data.venduto) { log(`[reportimmobiliare] VENDUTO: scarto ${card.id}`); return null; }
    // "Prezzo su Richiesta" → null (in valutazione); mai fallback su card/prezzo simile.
    const prezzo = /richiesta/i.test(data.prezzoTxt) ? null : (parsePrice(data.prezzoTxt) ?? null);
    const mq = parseInt(data.meta['Dimensioni'], 10) || card.mq || null;
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[reportimmobiliare] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const comune = card.comune || comuneFrom(data.titolo || card.titolo, card.id, data.desc);
    if (!comune || !WHITELIST.includes(comune.toLowerCase())) {
      log(`[reportimmobiliare] comune ignoto/fuori whitelist (${comune || '?'}): scarto ${card.id}`);
      return null;
    }
    const f = data.features;
    const featOn = (re) => Object.keys(f).some((k) => re.test(k) && f[k]);
    const featVal = (re) => Object.keys(f).find((k) => re.test(k) && f[k]) || '';
    const locali = parseInt(data.meta['Locali'], 10) || card.locali || null;
    const risc = featVal(/riscaldamento/i);
    return {
      id: card.id,
      url: card.url,
      area: comune,
      titolo: data.titolo || card.titolo,
      comune,
      provincia: 'BO',
      zona: zonaFromDescrizione(data.desc),
      indirizzo: card.address || '',
      prezzo,
      tipologia: card.tipo || 'Appartamento',
      locali,
      camere: parseInt(data.meta['Camere da letto'], 10) || card.camere || bedroomsFromText(data.desc, locali),
      bagni: parseInt(data.meta['Bagni'], 10) || card.bagni || null,
      superficieMq: mq,
      piano: (data.desc.match(/piano\s+(terra|rialzato|primo|secondo|terzo|quarto|quinto|ultimo|intermedio)/i)?.[1]) || '',
      ascensore: 'Ascensore' in f ? (f['Ascensore'] ? 'Sì' : 'No') : '',
      cucina: featOn(/cucina abitabile/i) ? 'Abitabile' : (featOn(/angolo cottura|cucina a vista/i) ? 'Angolo cottura' : ''),
      balcone: f['Balcone'] ?? /balcon/i.test(data.desc),
      terrazzo: f['Terrazzo'] ?? /terrazz/i.test(data.desc),
      cantina: f['Cantina'] ?? /cantina/i.test(data.desc),
      stato: mapStato(data.desc.match(/(ottime condizioni|buone condizioni|ristrutturat[ao]|da ristrutturare|pari al nuovo|nuova costruzione)/i)?.[1] || ''),
      riscaldamento: risc ? risc.replace(/^Riscaldamento\s*/i, '') : '',
      altreCaratteristiche: Object.keys(f).filter((k) => f[k]).join(', '),
      ape: (data.bodyText.match(/Classe\s+Energetica[:\s]*([A-G][1-4]?)/i)?.[1] || '').toUpperCase(),
      agenzia: 'Report Immobiliare',
      privato: false,
      descrizione: data.desc,
      foto: data.foto,
      planimetrie: data.plan,
      pubblicatoIl: data.datePublished,
    };
  },
};