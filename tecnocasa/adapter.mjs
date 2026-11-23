// Adattatore tecnocasa.it — Playwright (stessa piattaforma/DB di tecnorete.it).
// Listing: /annunci/immobili/emilia-romagna/bologna/{comune}.html?max_price=160000&min_surface=40
//   Filtri NATIVI via query (probe 21/11 su ENTRAMBI i domini: pannelli Prezzo
//   "Prezzo max" e Superficie "Mq da" + Enter generano questi parametri; chips
//   "Fino a 160.000 €"/"Da 40 mq" confermati). Paginazione /pag-N.html + query.
//   ⚠️ TRAPPOLA ANTI-FALLBACK (verifica 22/11): quando i risultati filtrati sono
//   ZERO il server restituisce la lista COMPLETA non filtrata (San Lazzaro:
//   31 annunci fino a 860k!). Guardia: se le card superano prezzo/mq oltre una
//   soglia di tolleranza, la pagina è un fallback → scarto pagina intera.
//   In più rete client-side prezzo/mq sulle card SEMPRE attiva.
// Dettaglio: DOM "Caratteristiche" (Piano, Balconi, Camere da letto ESPLICITO,
// Arredamento) + "Costi" (Prezzo, Spese annue) + head (locali, Mq, bagni).

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato } from '../core/schema.mjs';

const BASE_DEFAULT = 'https://www.tecnocasa.it';
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'pianoro', name: 'Pianoro' },
  { slug: 'san-lazzaro-di-savena', name: 'San Lazzaro di Savena' },
];

function parseNum(s) { const n = parseInt(String(s).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; }
function statoFromText(t) {
  t = String(t || '').toLowerCase();
  if (/da ristrutturare|da restaurare|da rimodernare/.test(t)) return 'Da ristrutturare';
  if (/ristrutturazion[ei]|ristrutturat[ao]|pari al nuovo|nuovo|perfetto stato/.test(t)) return 'Ottimo / Ristrutturato';
  if (/buono stato|abitabile|buone condizioni|discreto/.test(t)) return 'Buono / Abitabile';
  return '';
}
// Estrae il valore dopo un'etichetta "Label:\nvalore" nel testo caratteristiche
function labelVal(text, label) {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*\\n?\\s*([^\\n]+)', 'i');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

export function makeAdapter({ id = 'tecnocasa', name = 'Tecnocasa', base = BASE_DEFAULT } = {}) {
  const BASE = base;
  return {
  id,
  name,

  probeChecks: {
    listingUrl: `${BASE}/annunci/immobili/emilia-romagna/bologna/bologna.html?max_price=160000&min_surface=40`,
    cardSelectors: ['a[href*="/vendita/"]'],
    linkPattern: '\\/vendita\\/[^/]+\\/[^/]+\\/[^/]+\\/\\d+\\.html$',
    minLinks: 3,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const url = `${BASE}/annunci/immobili/emilia-romagna/bologna/${c.slug}.html?max_price=160000&min_surface=40`;
      log(`[${id}] Area ${c.name}: ${url}`);
      let pageNum = 1;
      const maxPages = 12;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const pageUrl = pageNum === 1 ? url : url.replace(/\.html\?/, `/pag-${pageNum}.html?`);
        const resp = await gotoResilient(page, pageUrl, { log, baseWait: 25000 });
        await dismissCookies(page);
        await humanPause(2200, 3800);
        await checkBlocked(page, resp);
        const rows = await page.evaluate(() => {
          const out = [];
          const seenHref = new Set();
          for (const a of document.querySelectorAll('a[href*="/vendita/"]')) {
            const h = a.href.split('#')[0].split('?')[0];
            if (!/\/vendita\/[^/]+\/[^/]+\/[^/]+\/\d+\.html$/.test(h) || seenHref.has(h)) continue;
            seenHref.add(h);
            // contenitore card: antenato che contiene un prezzo €
            let el = a, card = null;
            for (let i = 0; i < 8 && el; i++) {
              el = el.parentElement;
              if (el && /€/.test(el.textContent || '') && (el.textContent || '').length < 3000) { card = el; break; }
            }
            const txt = card ? (card.textContent || '').replace(/\s+/g, ' ') : '';
            const pm = txt.match(/€\s*([\d.]{4,})/);
            const mm = txt.match(/(\d{1,4})\s*(?:m²|mq)\b/i);
            out.push({
              url: h,
              price: pm ? parseInt(pm[1].replace(/\./g, ''), 10) : null,
              mq: mm ? parseInt(mm[1], 10) : null,
            });
          }
          return out;
        });
        // Guardia anti-fallback: se la maggioranza delle card con prezzo noto è
        // oltre budget, il server ha ignorato i filtri (fallback zero-risultati).
        const withPrice = rows.filter((r) => r.price !== null);
        const over = withPrice.filter((r) => r.price > 160000).length;
        if (withPrice.length >= 3 && over / withPrice.length > 0.5) {
          log(`[${id}] ${c.name} pag ${pageNum}: FALLBACK non filtrato rilevato (${over}/${withPrice.length} oltre budget) → area saltata`);
          break;
        }
        let added = 0;
        let skipped = 0;
        for (const r of rows) {
          const id = r.url.match(/\/(\d+)\.html$/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (r.price !== null && r.price > 160000) { skipped++; continue; }
          if (r.mq !== null && r.mq < 40) { skipped++; continue; }
          cards.push({ id, url: r.url, area: c.name });
          added++;
        }
        log(`[${id}] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skipped} fuori filtro)`);
        if (rows.length === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => /pag-/.test(a.href) && a.href.includes(`pag-${n + 1}`)), pageNum);
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
      const bodyText = (document.body?.innerText || '');
      const flat = bodyText.replace(/\s+/g, ' ');
      const foto = document.querySelector('meta[property="og:image"]')?.content || '';
      return { bodyText, flat, foto };
    });
    const raw = data.bodyText;
    const flat = data.flat;
    // Caratteristiche (testo con newline preservati per labelVal)
    const pianoRaw = labelVal(raw, 'Piano');
    const camereRaw = labelVal(raw, 'Camere da letto');
    const balconiRaw = labelVal(raw, 'Balconi');
    const arredamento = labelVal(raw, 'Arredamento');
    const condizionamento = labelVal(raw, 'Condizionamento');
    const riscaldamento = labelVal(raw, 'Riscaldamento');
    // Costi
    const prezzoM = flat.match(/Prezzo:\s*€\s*([\d.]+)/i) || flat.match(/€\s*([\d.]+)/);
    const speseM = flat.match(/Spese annue:\s*€\s*([\d.]+)/i);
    // Head: "4 locali 90 Mq 1 bagno"
    const locali = parseNum(flat.match(/(\d+)\s*local[ie]/i)?.[1]);
    const mq = parseNum(flat.match(/(\d+)\s*Mq/i)?.[1]);
    const bagni = parseNum(flat.match(/(\d+)\s*bagn[io]/i)?.[1]);
    const apeM = flat.match(/Classe\s+Energetica[:\s]*([A-G][1-4]?)/i) || raw.match(/Classe Energetica\s*\n?\s*([A-G][1-4]?)/i);
    // Descrizione e zona
    const descIdx = raw.search(/Descrizione/i);
    const desc = descIdx >= 0 ? raw.slice(descIdx + 11, descIdx + 2500).replace(/\s+/g, ' ').trim() : '';
    const zonaM = desc.match(/^(?:Zona|Quartiere)\s+([A-Za-zàèéìòù' ]{3,30}?)(?:\s*[-–]|\s+(?:in|adiac|presso|nei|via)\b|,|\.)/i)
      || desc.match(/\b(?:Quartiere|Zona)\s+([A-Z][A-Za-zàèéìòù' ]{2,24}?)(?:\s*[-–,.]|\s+(?:in|adiac|presso|nei)\b)/);
    const indirizzoM = desc.match(/(?:Via|Viale|Piazza|Vicolo|Largo|Corso)\s+[A-Z][A-Za-zàèéìòù' ]{2,38}(?:\s+\d+)?/i);
    const titoloM = flat.match(/(Appartamento|Attico|Loft|Villa|Villetta|Casa|Monolocale|Bilocale|Trilocale|Quadrilocale)[^.]{0,60}in vendita/i);

    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: titoloM ? titoloM[0] : 'Immobile in vendita',
      comune: card.area,
      provincia: 'BO',
      zona: zonaM ? zonaM[1].trim() : '',
      indirizzo: indirizzoM ? indirizzoM[0] : '',
      lat: null,
      lon: null,
      prezzo: prezzoM ? parseNum(prezzoM[1]) : null,
      tipologia: 'Appartamento',
      locali,
      camere: parseNum(camereRaw),
      bagni,
      superficieMq: mq,
      piano: pianoRaw,
      balcone: parseNum(balconiRaw) > 0,
      arredato: /presente|parziale|completo/i.test(arredamento),
      stato: mapStato(statoFromText(desc)),
      ape: apeM ? apeM[1].toUpperCase() : '',
      riscaldamento,
      speseCondominio: speseM ? parseNum(speseM[1]) : null,
      altreCaratteristiche: [condizionamento && `Condizionamento: ${condizionamento}`, arredamento && `Arredamento: ${arredamento}`].filter(Boolean).join('; '),
      agenzia: name,
      privato: false,
      descrizione: desc,
      foto: data.foto,
    };
  },
  };
}

export default makeAdapter();