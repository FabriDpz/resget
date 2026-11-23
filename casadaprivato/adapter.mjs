// Adattatore casadaprivato.it — Playwright headed (portale P2P, privati senza agenzia).
// Listing: /annunci-vendita/immobili/{comune}-{provincia}/pagina-N (SSR).
//   es. bologna-bologna, pianoro-bologna, san-lazzaro-di-savena-bologna.
//   Card root .item.col-md-12: prezzo .price ("€ 450.000"), titolo h2/h3
//   ("Appartamento da Privato a Bologna, Zona Murri"), feats "5+ locali","90 mq",
//   "2 bagni", tag "Ristrutturato • Climatizzazione • Piano rialzato • Box".
//   Il filtro prezzo è un form ASP.NET WebForms (hidden field hdPrezzoMax) inaffidabile
//   da pilotare → si filtra CLIENT-SIDE (≤ MAX_PREZZO) scorrendo le pagine.
// Dettaglio: /{tipologia}/{slug}-{id}. Sezione "DATI PRINCIPALI" ricchissima:
//   RIFERIMENTO, CONTRATTO, TIPOLOGIA, SUPERFICIE, LOCALI, CAMERE DA LETTO, BAGNI,
//   PIANO, TOTALE PIANI, BOX/POSTO AUTO, CARATTERISTICHE, PREZZO, STATO,
//   ANNO COSTRUZIONE, RISCALDAMENTO, CLIMATIZZAZIONE, "Aggiornato al {data}".
//   Parsing via regex sul testo della sezione (label→valore), robusto ai selettori.
//   Sempre privato (portale P2P). Coordinate assenti → geocode nel runner.
// Anti-bot: fail-closed (policy §8). Cookie Clickio: "Continua senza accettare".

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText, zonaFromDescrizione } from '../core/schema.mjs';
import { detectEstero } from '../core/filters.mjs';

const BASE = 'https://www.casadaprivato.it';
const COMUNI = [
  { slug: 'bologna-bologna', name: 'Bologna' },
  { slug: 'pianoro-bologna', name: 'Pianoro' },
  { slug: 'san-lazzaro-di-savena-bologna', name: 'San Lazzaro di Savena' },
];
const MAX_PREZZO = 160000;

// Prezzo italiano: "€ 238.000" → 238000; "€ 30.000,00" → 30000 (i centesimi
// dopo la virgola NON vanno concatenati). Si prende la parte intera prima della
// virgola e si rimuovono i punti delle migliaia.
function parseNum(s) {
  const clean = String(s || '').replace(/[^\d.,]/g, '');
  if (!clean) return null;
  const intPart = clean.split(',')[0].replace(/\./g, '');
  const n = parseInt(intPart, 10);
  return Number.isNaN(n) ? null : n;
}

// Solo residenziale in VENDITA: whitelist dei segmenti URL abitativi.
// Esclude box/garage, attività commerciali, terreni e affitti.
const RESIDENZIALI = /^\/(appartamenti|attici|case|ville|mansarde|loft|rustici|casali|palazzi|soluzioni-indipendenti)\//i;
function isResidentialSale(href, title, txt) {
  const path = String(href || '').replace(/^https?:\/\/[^/]+/i, '');
  if (!RESIDENZIALI.test(path)) return false;
  if (/affitto|affitasi|locazione|in affitto/i.test(`${path} ${title || ''}`)) return false;
  return true;
}

// Estrae il valore di una label nella sezione DATI PRINCIPALI.
// Formato: "LABEL valore LABEL2 valore2 ...". Il valore è ciò che segue la label
// fino alla label successiva (nota). Usiamo una regex con lookahead sulle label note.
const LABELS = ['RIFERIMENTO', 'CONTRATTO', 'TIPOLOGIA', 'SUPERFICIE', 'LOCALI', 'CAMERE DA LETTO', 'CUCINA', 'BAGNI', 'PIANO', 'TOTALE PIANI', 'BOX/POSTO AUTO', 'CARATTERISTICHE', 'COSTI', 'PREZZO', 'EFFICIENZA ENERGETICA', 'STATO', 'ANNO COSTRUZIONE', 'RISCALDAMENTO', 'CLIMATIZZAZIONE', 'CONTATTA'];
function datiValue(section, label) {
  const idx = section.indexOf(label);
  if (idx < 0) return '';
  const after = section.slice(idx + label.length).trim();
  // trova la prossima label nota
  let end = after.length;
  for (const l of LABELS) {
    if (l === label) continue;
    const i = after.indexOf(l);
    if (i >= 0 && i < end) end = i;
  }
  // ferma anche a "CONTATTA L'INSERZIONISTA" / "Aggiornato al"
  for (const stop of ["CONTATTA", "Aggiornato al", "SEGNALA"]) {
    const i = after.indexOf(stop);
    if (i >= 0 && i < end) end = i;
  }
  return after.slice(0, end).trim();
}

function parseItalianDate(txt) {
  const m = String(txt || '').match(/(\d{1,2})\s+(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\w*\s+(\d{4})/i);
  if (!m) return '';
  const mesi = { gen: '01', feb: '02', mar: '03', apr: '04', mag: '05', giu: '06', lug: '07', ago: '08', set: '09', ott: '10', nov: '11', dic: '12' };
  const mm = mesi[m[2].toLowerCase().slice(0, 3)];
  return `${m[3]}-${mm}-${String(m[1]).padStart(2, '0')}`;
}

export default {
  id: 'casadaprivato',
  name: 'CasaDaPrivato.it',

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      let pageNum = 1;
      const maxPages = 15;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const url = pageNum === 1
          ? `${BASE}/annunci-vendita/immobili/${c.slug}`
          : `${BASE}/annunci-vendita/immobili/${c.slug}/pagina-${pageNum}`;
        const resp = await gotoResilient(page, url, { log, baseWait: 25000 });
        await dismissCookies(page);
        await humanPause(2200, 3800);
        await checkBlocked(page, resp);
        const rows = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.item.col-md-12')];
          return cards.map((card) => {
            const a = card.querySelector('a[href*="-"]');
            const href = a?.href || '';
            const idM = href.match(/-(\d{5,})\/?$/);
            const price = card.querySelector('.price')?.textContent?.trim() || '';
            const titleEl = card.querySelector('h2,h3,[class*="title"]');
            const title = titleEl?.textContent?.trim().replace(/\s+/g, ' ') || '';
            const txt = card.innerText.replace(/\s+/g, ' ');
            return { id: idM ? idM[1] : null, url: href.split('?')[0].split('#')[0], price, title, txt };
          }).filter((r) => r.id && r.url);
        });
        let added = 0;
        let skippedPrice = 0;
        let skippedType = 0;
        let skippedEstero = 0;
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          if (!isResidentialSale(r.url, r.title, r.txt)) { skippedType++; continue; }
          // Immobili all'estero pubblicati sotto il comune italiano (345449:
          // "Capo Verde, Boavista" listato a Bologna) → skip prima del dettaglio.
          if (detectEstero({ url: r.url, titolo: r.title, descrizione: r.txt })) {
            skippedEstero++;
            log(`[casadaprivato] scartato ${r.id}: immobile all'estero`);
            continue;
          }
          const p = parseNum(r.price);
          if (p !== null && p > MAX_PREZZO) { skippedPrice++; continue; }
          // rete mq dalle feats card ("90 mq"): evita dettagli già esclusi dal §2
          const mqM = r.txt.match(/(\d{1,4})\s*mq\b/i);
          if (mqM && parseInt(mqM[1], 10) < 40) { skippedPrice++; continue; }
          cards.push({ id: r.id, url: r.url, area: c.name, price: r.price, title: r.title, txt: r.txt });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[casadaprivato] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}, ${skippedPrice} oltre budget, ${skippedType} non res., ${skippedEstero} estero)`);
        if (rows.length === 0) break;
        const hasNext = await page.evaluate((n) =>
          [...document.querySelectorAll('a[href]')].some((a) => a.href.includes(`pagina-${n + 1}`)), pageNum);
        if (!hasNext) break;
        pageNum++;
        await sleep(rand(2500, 4500));
      }
      await sleep(rand(2000, 3500));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 20000 });
    await dismissCookies(page);
    await humanPause(2000, 3500);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const h1 = document.querySelector('h1')?.textContent?.trim().replace(/\s+/g, ' ') || '';
      const di = body.indexOf('DATI PRINCIPALI');
      const section = di >= 0 ? body.slice(di, di + 1200) : '';
      // descrizione: tra il titolo ripetuto e "DATI PRINCIPALI"
      const descEnd = di >= 0 ? di : body.length;
      const descStart = body.search(/(?:Privato Vende|€\s*[\d.]+)/i);
      const descrizione = descStart >= 0 ? body.slice(descStart, descEnd).replace(/Puoi permetterti.*?Calcola la rata/i, '').replace(/Richiedi mutuo/i, '').trim() : '';
      const aggM = body.match(/Aggiornato al\s+(\d{1,2}\s+\w+\s+\d{4})/i);
      // foto reali
      const fotos = [...document.querySelectorAll('[class*="gallery"] img,[class*="slider"] img,[class*="foto"] img,[class*="carousel"] img')]
        .map((i) => i.src || i.dataset?.src || '').filter((s) => s && !/logo|icon|placeholder|avatar/i.test(s));
      return { h1, section, descrizione: descrizione.slice(0, 3000), aggiornato: aggM?.[1] || '', foto: fotos[0] || '' };
    });
    if (!data.section && !data.h1) return null;

    const s = data.section;
    const superficieMq = parseNum(datiValue(s, 'SUPERFICIE'));
    const localiRaw = datiValue(s, 'LOCALI');
    const locali = /più di\s*5|5\+/i.test(localiRaw) ? 6 : parseNum(localiRaw);
    const camereRaw = datiValue(s, 'CAMERE DA LETTO');
    let camere = parseNum(camereRaw);
    const bagni = parseNum(datiValue(s, 'BAGNI'));
    let prezzo = parseNum(datiValue(s, 'PREZZO')) || parseNum(card.price);
    // Sanity: una vendita residenziale sotto € 15.000 è implausible (di solito
    // affitti mis-label come vendita, es. "€ 1.200,00"/mese) → fail-closed null.
    if (prezzo !== null && prezzo < 15000) prezzo = null;
    const pianoRaw = datiValue(s, 'PIANO');
    const piano = /rialzato/i.test(pianoRaw) ? 'Rialzato' : /terra/i.test(pianoRaw) ? 'Terra' : (/seminterrato|sotterraneo/i.test(pianoRaw) ? 'Seminterrato' : pianoRaw);
    const stato = mapStato(datiValue(s, 'STATO'));
    const riscaldamento = datiValue(s, 'RISCALDAMENTO');
    const anno = datiValue(s, 'ANNO COSTRUZIONE');
    const caratteristiche = datiValue(s, 'CARATTERISTICHE');
    const box = datiValue(s, 'BOX/POSTO AUTO');
    const tipologia = datiValue(s, 'TIPOLOGIA') || card.title?.split(' ')[0] || '';
    // zona: dal titolo "Zona Murri" o dalla descrizione
    const zonaM = (data.h1 || card.title).match(/Zona\s+([A-Za-zÀ-ÿ'\s]+?)(?:\s*[-,]|$)/i);
    const zona = (zonaM ? zonaM[1].trim() : '') || zonaFromDescrizione(data.descrizione) || '';
    if (camere === null) camere = bedroomsFromText(data.descrizione, locali);
    const aggiornatoIl = parseItalianDate(data.aggiornato);

    return {
      id: String(card.id),
      url: card.url,
      area: card.area,
      titolo: data.h1 || `${tipologia || 'Immobile'} in vendita da Privato`,
      comune: card.area,
      provincia: 'Bologna',
      zona,
      indirizzo: '',
      lat: null,
      lon: null,
      prezzo,
      tipologia,
      locali,
      camere,
      bagni,
      superficieMq,
      piano,
      pianiEdificio: parseNum(datiValue(s, 'TOTALE PIANI')),
      ascensore: /ascensore/i.test(caratteristiche) ? 'Sì' : '',
      balcone: /balcon/i.test(caratteristiche) ? 'Sì' : '',
      terrazzo: /terrazz/i.test(caratteristiche) ? 'Sì' : '',
      cantina: /cantin/i.test(caratteristiche) ? 'Sì' : '',
      stato,
      ape: (datiValue(s, 'EFFICIENZA ENERGETICA').match(/\b([A-G][1-4]?)\b/) || [])[1] || '',
      riscaldamento,
      altreCaratteristiche: [caratteristiche, box ? `Box: ${box}` : '', anno ? `Anno: ${anno}` : ''].filter(Boolean).join('; '),
      agenzia: '',
      privato: true,
      aggiornatoIl,
      descrizione: data.descrizione,
      foto: data.foto,
      planimetrie: [],
      isAuction: /all'asta|asta giudiziaria/i.test(`${data.h1} ${s}`),
    };
  },
};