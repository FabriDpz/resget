// Adattatore flatsearch.it — Playwright headed (AGGREGATORE pubblico, 7 portali).
//
// SCOPERTA (probe/): la classificazione iniziale "solo home con assistente AI, login
// obbligatorio" era FALSA. Gli URL intuitivi (/compra, /ricerca, /annunci) danno 404,
// ma la home linka "Annunci per città" verso i percorsi reali, tutti pubblici.
// robots.txt = "Allow: /" (vietati solo /api/ e /admin/). Nessun WAF osservato.
//
// Listing: /properties/sale/province-bologna/municipality-<slug>?price_max=160000&surface_min=40&page=N
//   GOTCHA slug: gli spazi sono %20, NON trattini ("casalecchio%20di%20reno");
//   "casalecchio-di-reno" → 404. Slug ricavati dalla pagina provincia (probe/recon-filtri.json).
//   GOTCHA filtri: price_max E surface_min sono onorati (surface_min verificato
//   22/11: Bologna 243→90 con surface_min=50). priceTo/max_price/prezzoMax/priceRange
//   vengono ignorati SILENZIOSAMENTE (il totale resta invariato) → non fidarsi dei nomi intuitivi.
//   20 card/pagina; contatore "Risultati 1-20 di 4199".
//   Resa ≤160k sui 6 comuni target: 344 annunci (Bologna 273) — il più ricco del progetto.
//
// Dettaglio: /property/<UUID>. Selettori stabili (NON gli id React, che sono generati):
//   .meta-card__label / .meta-card__value → Superficie, Locali, CAMERE, Bagni,
//     Tipologia, Piano, Classe energetica, Riscaldamento
//   .property-detail-sources__name → portali d'origine (Subito, Immobiliare.it, …)
//     → campo portaliOrigine, utilissimo al dedup cross-portale in GLOBAL
//   .property-detail-agency / "Proposto da" → agenzia (contatti NON esposti)
//   JSON-LD @graph → nodo "RealEstateListing" con geo.latitude/longitude REALI,
//     offers.price, about.floorSize/numberOfRoomsTotal/numberOfBathroomsTotal,
//     address.streetAddress/addressLocality/postalCode, datePosted.
//     FONTE PRIMARIA: più stabile del DOM. (Il @graph contiene anche Organization
//     e WebSite: va cercato il nodo per @type, non preso il primo.)
//   GOTCHA coordinate: NON cercare "lat" con regex libere nell'HTML — matchano
//     "F-lat-search" e numeri casuali, producendo posizioni plausibili ma FALSE.
//     Si legge solo il JSON-LD. La mappa dichiara "zona, non indirizzo esatto":
//     la precisione è di quartiere, sufficiente per il filtro ≤3 km.
//
// Trappole dati verificate sul campo:
//   - NUDA PROPRIETÀ presente nel mix → esclusa (criteri progetto)
//   - affitti mis-label come VENDITA a € 1.200 → sanity prezzo < 15000 ⇒ null (fail-closed)
//   - lo stesso immobile ha UUID DIVERSI (via della Barca 47 compare 2 volte) → il dedup
//     interno si basa su indirizzo+prezzo+mq, non sull'id
//   - il mix ≤160k è dominato da monolocali 30-45 m²: pre-filtro sui m² della card
//     (la card li espone) per non aprire centinaia di dettagli già esclusi dal §2.
//
// Anti-bot: fail-closed (policy §8), nessun CAPTCHA incontrato.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText, zonaFromDescrizione } from '../core/schema.mjs';
import { detectAuction } from '../core/filters.mjs';
import { comuneContraddetto } from '../core/geo.mjs';

const BASE = 'https://flatsearch.it';
const PROVINCIA = 'province-bologna';
const MAX_PREZZO = 160000;

// Slug VERIFICATI dalla pagina provincia: spazi come %20, non trattini.
const COMUNI = [
  { slug: 'bologna', name: 'Bologna' },
  { slug: 'san%20lazzaro%20di%20savena', name: 'San Lazzaro di Savena' },
  { slug: 'casalecchio%20di%20reno', name: 'Casalecchio di Reno' },
  { slug: 'castenaso', name: 'Castenaso' },
  { slug: 'pianoro', name: 'Pianoro' },
  { slug: 'zola%20predosa', name: 'Zola Predosa' },
];

function parseNum(s) {
  const clean = String(s || '').replace(/[^\d.,]/g, '');
  if (!clean) return null;
  const intPart = clean.split(',')[0].replace(/\./g, '');
  const n = parseInt(intPart, 10);
  return Number.isNaN(n) ? null : n;
}

function parseItalianDate(txt) {
  const m = String(txt || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// Esclusioni dai criteri di progetto: aste, nuda proprietà, affitti.
// Il rilevamento aste è centralizzato in core/filters.mjs (detectAuction): il
// pattern debole "all'asta|asta giudiziaria" ne lasciava passare 9 su 67 qui,
// di cui 5 promosse BIG/SMA. Vedi DECISIONI.md.
function isEscluso(txt) {
  const s = String(txt || '');
  if (/nuda\s+propriet/i.test(s)) return 'nuda proprietà';
  if (detectAuction({ titolo: s })) return 'asta';
  if (/\baffitto\b|in\s+locazione|canone\s+mensile/i.test(s)) return 'affitto';
  return '';
}

const NON_RESIDENZIALI = /box\s*auto|garage|posto\s*auto|capannone|negozio|ufficio\s*\/|terreno|magazzino|licenza|attività\s+commerciale|immobile\s+commerciale/i;

// Camere dalla tipologia quando il campo non è esposto: la nomenclatura italiana
// conta i vani (trilocale = soggiorno + 2 camere). Monolocale = 1 solo se ≥55 m².
function camereDaTipologia(tipologia, locali, mq) {
  const t = String(tipologia || '').toLowerCase();
  const m = t.match(/^(mono|bi|tri|quadri|penta|esa|pluri)\s*locale/);
  if (m) {
    const vani = { mono: 1, bi: 2, tri: 3, quadri: 4, penta: 5, esa: 6, pluri: 6 }[m[1]];
    if (m[1] === 'mono') return (mq || 0) >= 55 ? 1 : 0;
    return Math.max(1, vani - 1);
  }
  if (locali && locali > 0) return Math.max(1, locali - 1);
  return null;
}

export default {
  id: 'flatsearch',
  name: 'Flatsearch.it',

  probeChecks: {
    listingUrl: 'https://www.flatsearch.it/properties/sale/province-bologna/municipality-bologna?price_max=160000&surface_min=40&ordering=-updated_at',
    cardSelectors: ['a[href*="/property/"]'],
    linkPattern: '\\/property\\/[0-9a-f-]{36}',
    minLinks: 5,
    detailChecks: { jsonLdType: 'RealEstateListing' },
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      let pageNum = 1;
      const maxPages = 20;
      let declaredTotal = null;
      while (pageNum <= maxPages && cards.length < maxAds) {
        const url = `${BASE}/properties/sale/${PROVINCIA}/municipality-${c.slug}?price_max=${MAX_PREZZO}&surface_min=40&ordering=-updated_at${pageNum > 1 ? `&page=${pageNum}` : ''}`;
        const resp = await gotoResilient(page, url, { log, baseWait: 25000 });
        await dismissCookies(page);
        await humanPause(2000, 3400);
        await checkBlocked(page, resp);

        const rows = await page.evaluate(() => {
          const out = [];
          const seenIds = new Set();
          for (const a of document.querySelectorAll('a[href*="/property/"]')) {
            const href = a.getAttribute('href') || '';
            const id = (href.match(/\/property\/([0-9a-f-]{36})/) || [])[1];
            if (!id || seenIds.has(id)) continue;
            // risalgo al contenitore che ha prezzo E m² (la card completa)
            let box = a;
            for (let i = 0; i < 8 && box.parentElement; i++) {
              box = box.parentElement;
              const t = box.innerText || '';
              if (/€/.test(t) && /m²/.test(t)) break;
            }
            const txt = (box.innerText || '').replace(/\s+/g, ' ');
            if (!/€/.test(txt)) continue;
            seenIds.add(id);
            const title = box.querySelector('h3')?.textContent?.replace(/\s+/g, ' ').trim() || '';
            out.push({ id, txt: txt.slice(0, 400), title });
          }
          const counter = (document.body.innerText.match(/Risultati\s*[\d.-]+\s*di\s*([\d.]+)/i) || [])[1] || '';
          return { out, counter, empty: /nessun\s+(?:annuncio|risultato)/i.test(document.body.innerText) };
        });

        if (rows.counter) declaredTotal = parseNum(rows.counter);
        let added = 0, skipPrice = 0, skipExcl = 0, skipType = 0, skipMq = 0;
        for (const r of rows.out) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          const price = parseNum((r.txt.match(/€\s?([\d.]+)/) || [])[1]);
          // fail-closed: prezzo assente o implausibile per una vendita ⇒ fuori
          if (price === null || price < 15000) { skipPrice++; continue; }
          if (price > MAX_PREZZO) { skipPrice++; continue; }
          const why = isEscluso(`${r.title} ${r.txt}`);
          if (why) { skipExcl++; continue; }
          if (NON_RESIDENZIALI.test(r.title)) { skipType++; continue; }
          // Pre-filtro §2: superficie minima 55 m² per entrambi i profili. La card
          // espone i m², quindi si evita di aprire il dettaglio di annunci che
          // applyFilters scarterebbe comunque (la maggioranza su questo portale).
          const mqCard = parseNum((r.txt.match(/([\d.,]+)\s*m²/) || [])[1]);
          if (mqCard !== null && mqCard < 55) { skipMq++; continue; }
          cards.push({
            id: r.id,
            url: `${BASE}/property/${r.id}`,
            area: c.name,
            price: String(price),
            title: r.title,
            txt: r.txt,
          });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[flatsearch] ${c.name} pag ${pageNum}: +${added} (tot ${cards.length}/${declaredTotal ?? '?'}, ${skipPrice} prezzo, ${skipMq} <55m², ${skipExcl} esclusi, ${skipType} non res.)`);
        if (rows.out.length === 0 || rows.empty) break;
        // ci si ferma quando il contatore dichiara di aver visto tutto
        if (declaredTotal !== null && pageNum * 20 >= declaredTotal) break;
        pageNum++;
        await sleep(rand(2200, 4000));
      }
      await sleep(rand(1800, 3200));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 20000 });
    await dismissCookies(page);
    await humanPause(1800, 3000);
    await checkBlocked(page, resp);

    const data = await page.evaluate(() => {
      const specs = {};
      for (const li of document.querySelectorAll('.meta-card')) {
        const l = li.querySelector('.meta-card__label')?.textContent?.trim();
        const v = li.querySelector('.meta-card__value')?.textContent?.trim();
        if (l) specs[l.toLowerCase()] = v || '';
      }
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const h1 = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      // riga indirizzo sotto l'h1: "Via della Barca 74 · Bologna, Borgo Panigale-Reno"
      const sub = document.querySelector('h1')?.nextElementSibling?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const descrizione = (() => {
        const i = body.indexOf('Descrizione');
        if (i < 0) return '';
        const rest = body.slice(i + 'Descrizione'.length);
        const stop = rest.search(/Dove si trova|Pubblicato su|Proposto da|Altri immobili|Mostra di più|I contatti/i);
        return (stop >= 0 ? rest.slice(0, stop) : rest).trim();
      })();
      const altre = (() => {
        const i = body.indexOf('Altre caratteristiche');
        if (i < 0) return '';
        const rest = body.slice(i + 'Altre caratteristiche'.length);
        const stop = rest.search(/Descrizione|Dove si trova|Pubblicato su/i);
        return (stop >= 0 ? rest.slice(0, stop) : rest.slice(0, 300)).trim();
      })();
      const portali = [...document.querySelectorAll('.property-detail-sources__name')].map((e) => e.textContent.trim()).filter(Boolean);
      // Coppie portale→ID d'origine: i link sono tracker /api/property-analytics/<ID>/track
      // e l'ID numerico è l'id dell'annuncio SUL portale d'origine (chiave di dedup esatta).
      const origini = [...document.querySelectorAll('.property-detail-sources__link')].map((a) => {
        const nome = a.querySelector('.property-detail-sources__name')?.textContent?.trim() || '';
        const oid = ((a.getAttribute('href') || '').match(/property-analytics\/(\d+)\/track/) || [])[1] || '';
        return nome && oid ? { portale: nome, id: oid } : null;
      }).filter(Boolean);
      const agenzia = (() => {
        const el = document.querySelector('[class*="agency"]');
        if (el) return el.textContent.replace(/\s+/g, ' ').replace(/^Proposto da\s*/i, '').trim();
        const m = body.match(/Proposto da\s+(.{3,90}?)\s*(?:Aggiornato il|Altri immobili|$)/i);
        return m ? m[1].trim() : '';
      })();
      const prezzoTxt = document.querySelector('.property-detail-price')?.textContent || '';
      const prezzoMq = (body.match(/Prezzo al m²\s*€\s*([\d.]+)/i) || [])[1] || '';
      const aggiornato = (body.match(/Aggiornato il\s+([\d/]+)/i) || [])[1] || '';
      // JSON-LD: nel @graph va cercato il nodo RealEstateListing (non il primo nodo)
      let ld = null;
      for (const b of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(b.textContent);
          for (const n of (j['@graph'] || [j])) {
            if (n && n['@type'] === 'RealEstateListing') ld = n;
          }
        } catch { /* blocco malformato: si ignora */ }
      }
      const about = ld?.about || {};
      const addr = about.address || ld?.address || {};
      const jsonld = ld ? {
        name: ld.name || '',
        description: ld.description || '',
        image: Array.isArray(ld.image) ? ld.image[0] : (ld.image || ''),
        datePosted: ld.datePosted || '',
        categoria: about.accommodationCategory || '',
        mq: about.floorSize?.value ?? null,
        locali: about.numberOfRoomsTotal ?? null,
        camere: about.numberOfBedrooms ?? null,
        bagni: about.numberOfBathroomsTotal ?? null,
        street: addr.streetAddress || '',
        locality: addr.addressLocality || '',
        cap: addr.postalCode || '',
        lat: ld.geo?.latitude ?? null,
        lon: ld.geo?.longitude ?? null,
        price: ld.offers?.price ?? null,
      } : null;
      const foto = jsonld?.image || [...document.querySelectorAll('img')].map((i) => i.src || '')
        .find((s) => /http/.test(s) && !/logo|icon|avatar|placeholder|leaflet|tile/i.test(s)) || '';
      return { h1, sub, specs, descrizione: descrizione.slice(0, 4000), altre, portali, origini, agenzia, prezzoTxt, prezzoMq, aggiornato, jsonld, foto, body: body.slice(0, 1500) };
    });

    if (!data.h1 && !Object.keys(data.specs).length) return null;

    const ld = data.jsonld || {};
    const s = data.specs;
    const superficieMq = parseNum(s['superficie']) ?? (ld.mq != null ? Number(ld.mq) : null);
    const localiRaw = s['locali'] || '';
    const locali = /5\+|più di\s*5/i.test(localiRaw) ? 6 : (parseNum(localiRaw) ?? (ld.locali != null ? Number(ld.locali) : null));
    let camere = parseNum(s['camere']) ?? (ld.camere != null ? Number(ld.camere) : null);
    const bagni = parseNum(s['bagni']) ?? (ld.bagni != null ? Number(ld.bagni) : null);
    let prezzo = parseNum(data.prezzoTxt) || (ld.price != null ? Number(ld.price) : null) || parseNum(card.price);
    if (prezzo !== null && prezzo < 15000) prezzo = null; // affitto travestito da vendita
    const tipologia = s['tipologia'] || ld.categoria || (data.h1 || '').split(' ')[0] || '';
    // il JSON-LD porta la descrizione integrale solo a volte: si usa la più lunga
    const descrizione = (ld.description || '').length > data.descrizione.length ? ld.description : data.descrizione;

    const why = isEscluso(`${data.h1} ${descrizione}`);
    if (why) {
      log(`[flatsearch] scartato ${card.id}: ${why}`);
      return null;
    }
    if (NON_RESIDENZIALI.test(`${tipologia} ${data.h1}`) && !/appartament|casa|villa|attico|loft|mansarda|rustico/i.test(tipologia)) return null;

    if (camere === null) camere = bedroomsFromText(descrizione, locali);
    if (camere === null || camere === undefined) camere = camereDaTipologia(tipologia || data.h1, locali, superficieMq);
    // GOTCHA verificato: flatsearch NON espone quasi mai il campo "Camere" e il
    // fallback `locali - 1` gonfia il dato quando i locali contano anche cucina
    // abitabile, pranzo e ripostigli (7 locali → 6 camere, ma la descrizione dice
    // "tre camere"). Il numero dichiarato nel testo dell'inserzionista è la fonte
    // più affidabile: quando esiste e diverge, vince lui.
    const camereTesto = bedroomsFromText(descrizione, null);
    if (camereTesto != null && camere !== camereTesto) {
      log(`[flatsearch] ${card.id}: camere ${camere ?? '?'} → ${camereTesto} (dichiarate in descrizione)`);
      camere = camereTesto;
    }

    // zona: la riga sotto l'h1 è "indirizzo · Comune, Quartiere[, Sottozona]"
    let zona = '';
    let indirizzo = ld.street || '';
    const subM = data.sub.match(/^(.*?)\s*·\s*(.*)$/);
    if (subM) {
      if (!indirizzo) indirizzo = subM[1].trim();
      const parti = subM[2].split(',').map((x) => x.trim()).filter(Boolean);
      zona = parti.slice(1).join(', '); // salta il comune
    }
    // fallback: il titolo stesso è "Tipologia in Via X, Zona, Comune"
    if (!zona) {
      const tm = (data.h1 || '').match(/,\s*([^,]+),\s*[^,]+$/);
      if (tm && !/^\d|via|viale|piazza|vicolo|borgo\s+\w+\s+\d/i.test(tm[1].trim())) zona = tm[1].trim();
    }
    if (!zona) zona = zonaFromDescrizione(descrizione) || '';

    const pianoRaw = s['piano'] || '';
    const piano = /seminterrato|sotterraneo/i.test(pianoRaw) ? 'Seminterrato'
      : /terra/i.test(pianoRaw) ? 'Terra'
      : /rialzato/i.test(pianoRaw) ? 'Rialzato'
      : pianoRaw;
    // Seminterrato: anche dal testo, non solo dal meta-field (6982c5d5 origin
    // Wikicasa: "piano interrato" solo in descrizione → meta-field assente →
    // salvato e promosso SMA). "piano interrato" esplicito, mai "box interrato".
    const semiTesto = /\bpiano\s+(?:semi[-\s]?interrato|interrato|sotterraneo)\b|\b(?:semi[-\s]?interrato|sotterraneo)\s+piano\b/i.test(descrizione);
    if (/seminterrato|sotterraneo/i.test(pianoRaw) || semiTesto) {
      log(`[flatsearch] scartato ${card.id}: seminterrato`);
      return null; // criterio progetto
    }

    const altre = data.altre;
    const comune = ld.locality || card.area;
    // GOTCHA verificato sul campo: un annuncio con JSON-LD "Bologna, CAP 40132" e
    // coordinate bolognesi aveva in descrizione "in Via Alcide De Gasperi a Cento"
    // (Cento è in provincia di Ferrara). L'aggregatore geocodifica l'indirizzo
    // omonimo nel comune sbagliato: il dato strutturato è coerente ma FALSO, e
    // produceva il miglior ROI del progetto (61,5%). Se la descrizione nomina
    // esplicitamente un comune FUORI dalla whitelist, l'annuncio è inaffidabile
    // → si scarta (fail-closed) invece di correggere a mano.
    const fuoriComune = comuneContraddetto({ descrizione, comune });
    if (fuoriComune) {
      log(`[flatsearch] scartato ${card.id}: descrizione indica "${fuoriComune}", fuori dai comuni target (JSON-LD: ${comune})`);
      return null;
    }
    // mapStato ritorna il testo in ingresso se non riconosce nulla: gli si passa
    // solo un estratto breve, altrimenti lo "stato" diventa l'intera descrizione.
    const stato = (() => {
      const m = descrizione.match(/\b(da ristrutturare|ristrutturat\w*|ottimo stato|buono stato|abitabile|nuovo|in costruzione|da demolire|pessimo stato|discreto)\b/i);
      return m ? mapStato(m[1]) : '';
    })();

    return {
      id: String(card.id),
      url: card.url,
      area: comune,
      titolo: data.h1 || `${tipologia || 'Immobile'} in vendita a ${comune}`,
      comune,
      provincia: 'Bologna',
      zona,
      indirizzo,
      lat: ld.lat != null ? Number(ld.lat) : null,
      lon: ld.lon != null ? Number(ld.lon) : null,
      prezzo,
      tipologia,
      locali,
      camere,
      bagni,
      superficieMq,
      piano,
      pianiEdificio: null,
      ascensore: /ascensore/i.test(altre) ? 'Sì' : '',
      balcone: /balcon/i.test(altre) ? 'Sì' : '',
      terrazzo: /terrazz/i.test(altre) ? 'Sì' : '',
      cantina: /cantin/i.test(altre) ? 'Sì' : '',
      stato,
      ape: (String(s['classe energetica'] || '').match(/\b([A-G][1-4]?)\b/) || [])[1] || '',
      riscaldamento: s['riscaldamento'] || '',
      altreCaratteristiche: [altre, data.prezzoMq ? `Prezzo/m²: € ${data.prezzoMq}` : '', ld.cap ? `CAP: ${ld.cap}` : ''].filter(Boolean).join('; '),
      agenzia: data.agenzia,
      privato: !data.agenzia,
      aggiornatoIl: parseItalianDate(data.aggiornato) || ld.datePosted || '',
      descrizione,
      foto: data.foto,
      planimetrie: [],
      // Le aste sono scartate a monte da isEscluso/detectAuction: qui il valore è
      // sempre false, ma si calcola comunque per non dichiarare una costante falsa.
      isAuction: Boolean(detectAuction({ titolo: data.titolo, descrizione })),
      // metadato proprio dell'aggregatore: su quali portali è pubblicato lo stesso annuncio
      portaliOrigine: data.portali,
      // [{portale, id}] con l'ID dell'annuncio sul portale d'origine → dedup esatta in GLOBAL
      idsOrigine: data.origini,
    };
  },
};