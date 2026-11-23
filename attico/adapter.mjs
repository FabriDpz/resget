// Adattatore Attico.it (gruppo Casa.it, ma WAF proprio più permissivo) — Playwright headed.
// Listing FILTRATA (verificata browser reale 22/11 via form "Imposta filtri"):
//   /vendita-residenziale/dimensione-{mqMin}-qualsiasi-per-{prezzoMin}-{prezzoMax}-in-{Luogo}/lista-N
//   ATTENZIONE: /vendita-residenziale/in-{comune}/lista-N (vecchia URL) è una
//   listing NAZIONALE (annunci di Milano!): il segmento location da solo NON
//   filtra. "in-Bologna" (capitalize) = comune; "in-bo,+emilia-romagna" = provincia.
//   Card: .listing-list > li → a[href*="/immobile-"], .title h2 (indirizzo),
//   .zone (quartiere), .optional-zone (tipologia), li.price, li.icon con
//   i.icon-mq / i.icon-locali / i.icon-box, p (descrizione breve).
// Dettaglio: tabella label "Bagni:", "Locali:", "Metri quadri:", "Condizioni:",
//   "Piano:", "Riscaldamento:", "Cantina:", "Giardino:", "Balcone:", "Box:".
// Anti-bot: fail-closed (policy §8). Cookie Didomi: "Continua senza accettare".

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.attico.it';
// Luogo capitalized come generato dal form reale (Bologna verificato; gli altri
// seguono lo stesso pattern). Rete client-side su prezzo/mq sempre attiva.
const COMUNI = [
  { slug: 'in-Bologna', name: 'Bologna' },
  { slug: 'in-Pianoro', name: 'Pianoro' },
  { slug: 'in-San-Lazzaro-di-Savena', name: 'San Lazzaro di Savena' },
];
const MAX_PREZZO = 160000;
const MIN_MQ = 40;

function parsePrice(txt) {
  const m = String(txt || '').replace(/\./g, '').match(/(\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}

export default {
  id: 'attico',
  name: 'Attico.it',

  probeChecks: {
    listingUrl: 'https://www.attico.it/vendita-residenziale/dimensione-40-qualsiasi-per-0-160000-in-Bologna/lista-1',
    cardSelectors: ['.listing-list a[href*="/immobile-"]'],
    linkPattern: '\\/immobile-[^/]+-\\d+',
    minLinks: 3,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      let pageNum = 1;
      const maxPages = 25;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const url = `${BASE}/vendita-residenziale/dimensione-${MIN_MQ}-qualsiasi-per-0-${MAX_PREZZO}-${c.slug}/lista-${pageNum}`;
        const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
        await dismissCookies(page);
        await humanPause(2000, 3500);
        await checkBlocked(page, resp);
        const rows = await page.evaluate(() => {
          const list = document.querySelector('.listing-list');
          if (!list) return [];
          return [...list.children].map((li) => {
            const a = li.querySelector('a[href*="/immobile-"]');
            const href = a?.href || '';
            const idM = href.match(/-(\d+)\/?$/);
            const body = li.querySelector('.list-item-body');
            const addr = body?.querySelector('.title h2')?.textContent?.trim() || '';
            const zona = body?.querySelector('.zone')?.textContent?.trim() || '';
            const tipo = body?.querySelector('.optional-zone')?.textContent?.trim() || '';
            const price = body?.querySelector('li.price')?.textContent?.trim() || '';
            let mq = null, locali = null;
            body?.querySelectorAll('li.icon').forEach((x) => {
              const n = parseInt((x.textContent || '').match(/\d+/)?.[0], 10);
              if (x.querySelector('.icon-mq')) mq = n;
              else if (x.querySelector('.icon-locali')) locali = n;
            });
            const desc = body?.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim() || '';
            return { id: idM ? idM[1] : null, url: href.split('?')[0], addr, zona, tipo, price, mq, locali, desc };
          }).filter((r) => r.id && r.url);
        });
        let added = 0;
        let skippedPrice = 0;
        let skippedMq = 0;
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          const p = parsePrice(r.price);
          if (p !== null && p > MAX_PREZZO) { skippedPrice++; continue; }
          if (r.mq !== null && r.mq < MIN_MQ) { skippedMq++; continue; }
          cards.push({ ...r, area: c.name });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[attico] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skippedPrice} oltre budget, ${skippedMq} sotto mq)`);
        if (rows.length === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`lista-${n + 1}`)), pageNum);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(2500, 4500));
      }
      await sleep(rand(2000, 3500));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 18000 });
    await dismissCookies(page);
    await humanPause(2000, 3500);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const title = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      // tabella caratteristiche: coppie label/valore ("Bagni:1", "Condizioni:abitabile")
      const feats = {};
      document.querySelectorAll('dt, .label, [class*="label"], li, span').forEach((el) => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const m = t.match(/^(Aria Condizionata|Stato al Rogito|Bagni|Locali|Metri quadri|Condizioni|Spese Cond\. Mese|Piano|Anno di costruzione|Box|Riscaldamento|Cantina|Giardino|Balcone|MQ Box)\s*:\s*(.+)$/i);
        if (m && !feats[m[1].toLowerCase()]) feats[m[1].toLowerCase()] = m[2].trim();
      });
      const descEl = document.querySelector('[class*="description"], .description-text, #description');
      const descrizione = (descEl?.textContent || '').replace(/\s+/g, ' ').trim();
      const agency = document.querySelector('[class*="agency"] a, [class*="agenzia"] a, .agency-name')?.textContent?.trim() || '';
      const foto = document.querySelector('.slider img, [class*="gallery"] img, picture img')?.src || '';
      return { title, feats, descrizione, agency, foto, body: body.slice(0, 5000) };
    });

    const f = data.feats;
    const desc = data.descrizione || '';
    const mq = parseInt(String(f['metri quadri'] || card.mq || '').match(/\d+/)?.[0], 10) || card.mq || null;
    const locali = parseInt(String(f['locali'] || card.locali || '').match(/\d+/)?.[0], 10) || card.locali || null;
    const bagni = parseInt(String(f['bagni'] || '').match(/\d+/)?.[0], 10) || null;
    const camere = bedroomsFromText(`${data.title} ${desc}`, locali);
    const prezzo = parsePrice(card.price) ?? parsePrice(data.body);
    const pianoRaw = String(f['piano'] || '');
    const piano = /terra/i.test(pianoRaw) ? 'Terra' : pianoRaw;
    const siNo = (v) => /presente|s[iì]|privat|condomin|comun/i.test(String(v || '')) ? 'Sì' : (/assente|^no$/i.test(String(v || '')) ? 'No' : '');
    // zona: dal listing (.zone) è affidabile; sanitizeZona a valle
    const zona = card.zona && !/bologna|pianoro|san lazzaro/i.test(card.zona) ? card.zona : '';

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: data.title || card.addr || 'Immobile in vendita',
      comune: card.area,
      provincia: 'BO',
      zona,
      indirizzo: card.addr || '',
      lat: null,
      lon: null,
      prezzo,
      prezzoMq: '',
      tipologia: card.tipo || (/monolocale/i.test(data.title) ? 'Monolocale' : 'Appartamento'),
      locali,
      camere,
      bagni,
      superficieMq: mq,
      piano,
      ascensore: /ascensore/i.test(data.body) ? (/senza ascensore/i.test(data.body) ? 'No' : 'Sì') : '',
      cucina: '',
      arredato: '',
      balcone: siNo(f['balcone']),
      terrazzo: /terrazz/i.test(desc) ? 'Sì' : '',
      cantina: siNo(f['cantina']),
      stato: mapStato(f['condizioni'] || ''),
      ape: (data.body.match(/Classe Energetica[:\s]*([A-G][1-4]?)\b/i) || [])[1]?.toUpperCase() || '',
      riscaldamento: f['riscaldamento'] || '',
      speseCondominio: f['spese cond. mese'] || '',
      agenzia: data.agency || 'Attico.it',
      privato: false,
      descrizione: desc,
      foto: data.foto || '',
    };
  },
};