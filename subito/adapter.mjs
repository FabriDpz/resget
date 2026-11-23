// Adattatore Subito.it — Playwright (headed, profilo persistente), LIST-ONLY.
// Tutti i dati strutturati sono in __NEXT_DATA__.props.pageProps.initialState.items.originalList:
//   subject, body, features{/size,/room,/bathrooms,/building_condition,/energy_class,
//   /price,/floor,/elevator,/heating,/garden,/balcony,/air_conditioning,/furnished},
//   geo{region,city,town}, advertiser{name,type,company}, urls.default, date.
// URL ricerca: /annunci-emilia-romagna/vendita/appartamenti/bologna/?pe=160000&szs=40
//   Filtri NATIVI verificati (probe 21/11): pe=prezzo MAX (ps è il MIN: trappola!),
//   szs=mq minimi. Paginazione &o=N. 484 risultati vs 1379 senza filtri.
//   (il vecchio /annunci-bologna/... era 404: il segmento è la REGIONE, non la provincia).
// La lista copre tutta la provincia → filtro per comune (Bologna/Pianoro/San Lazzaro).
// Nessun dettaglio necessario: scrapeDetail ritorna i dati già raccolti (gentile col sito).
// Anti-bot: fail-closed (policy §8), nessun aggiramento.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText, zonaFromDescrizione } from '../core/schema.mjs';
import { detectAffitto } from '../core/filters.mjs';

const BASE = 'https://www.subito.it';
// Ricerca provinciale (Emilia-Romagna / provincia di Bologna): include tutti i comuni.
const SEARCH = '/annunci-emilia-romagna/vendita/appartamenti/bologna/?pe=160000&szs=40';
const COMUNI_OK = new Set(['bologna', 'pianoro', 'san lazzaro di savena']);

function featVal(features, key) {
  const f = features?.[key];
  if (!f) return '';
  const v = (f.values || [])[0];
  return v ? String(v.value ?? v.key ?? '').trim() : '';
}
function parsePrice(txt) {
  const m = String(txt || '').replace(/\./g, '').match(/(\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}
function parseIntOrNull(txt) {
  const m = String(txt || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
function siNo(txt) {
  const s = String(txt || '').toLowerCase();
  if (/^s[iì]|presente|c'è|box|posto/.test(s)) return 'Sì';
  if (/^no|assente/.test(s)) return 'No';
  return '';
}

export default {
  id: 'subito',
  name: 'Subito.it',

  // Dati da __NEXT_DATA__, non dal DOM: l'asserzione chiave è hasNextData.
  probeChecks: {
    listingUrl: 'https://www.subito.it/annunci-emilia-romagna/vendita/appartamenti/bologna/?pe=160000&szs=40',
    cardSelectors: ['a[href$=".htm"]'],
    nextData: true,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    let pageNum = 1;
    const maxPages = 12;
    while (pageNum <= maxPages && cards.length < maxAds) {
      const url = pageNum === 1 ? `${BASE}${SEARCH}` : `${BASE}${SEARCH}&o=${pageNum}`;
      const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
      await dismissCookies(page);
      await humanPause(2000, 3500);
      await checkBlocked(page, resp);
      const items = await page.evaluate(() => {
        const nd = document.querySelector('#__NEXT_DATA__');
        if (!nd) return null;
        try {
          const j = JSON.parse(nd.textContent);
          return j.props?.pageProps?.initialState?.items?.originalList || [];
        } catch { return []; }
      });
      if (!items) { log('[subito] __NEXT_DATA__ assente: possibile blocco. STOP.'); break; }
      let added = 0;
      for (const it of items) {
        const town = String(it.geo?.town?.value || '').toLowerCase();
        if (!COMUNI_OK.has(town)) continue;
        const urn = String(it.urn || '');
        const idM = urn.match(/list:(\d+)/) || urn.match(/ad:([a-z0-9-]+)/);
        const id = idM ? idM[1] : urn;
        if (!id || seen.has(id)) continue;
        const f = it.features || {};
        const size = parseIntOrNull(featVal(f, '/size'));
        const locali = parseIntOrNull(featVal(f, '/room'));
        const bagni = parseIntOrNull(featVal(f, '/bathrooms'));
        const priceTxt = featVal(f, '/price');
        const prezzo = parsePrice(priceTxt);
        const buildingCond = featVal(f, '/building_condition');
        const energy = featVal(f, '/energy_class');
        const floorTxt = featVal(f, '/floor');
        const heating = featVal(f, '/heating');
        const desc = String(it.body || '').replace(/\s+/g, ' ').trim();
        const titolo = String(it.subject || '').trim();
        const adv = it.advertiser || {};
        const privato = adv.type === 1 || adv.company === false;
        // Subito mescola affitti nella ricerca vendita (canoni 300-950 €):
        // pe=160000 li lascia passare perché sotto il max. Gli affitti da
        // AGENZIA si scartano qui; quelli da PRIVATO si tengono come possibili
        // lead off-market (regola utente 23/11: "interessato a vendere?").
        // Il filtro a valle (detectAffitto) li esclude da BIG/SMA standard.
        const affitto = detectAffitto({ titolo, descrizione: desc, prezzo });
        if (affitto && !privato) { seen.add(id); continue; }
        if (!affitto && prezzo !== null && prezzo > 160000) { seen.add(id); continue; }
        if (size !== null && size < 40) { seen.add(id); continue; }
        const comune = it.geo?.town?.value || '';
        const zona = zonaFromDescrizione(desc);
        const date = String(it.date || '').slice(0, 10);
        const camerasTxt = bedroomsFromText(`${titolo} ${desc}`, locali);
        seen.add(id);
        cards.push({
          id,
          url: it.urls?.default || `${BASE}/appartamenti/${id}.htm`,
          area: comune,
          data: {
            id,
            url: it.urls?.default || '',
            area: comune,
            titolo: titolo || 'Immobile in vendita',
            comune,
            provincia: 'BO',
            zona,
            indirizzo: '',
            lat: null,
            lon: null,
            prezzo,
            prezzoMq: '',
            tipologia: /monolocale/i.test(titolo) ? 'Monolocale' : (/villa/i.test(titolo) ? 'Villa' : 'Appartamento'),
            locali,
            camere: camerasTxt,
            bagni,
            superficieMq: size,
            piano: floorTxt ? (/terra/i.test(floorTxt) ? 'Terra' : floorTxt) : '',
            ascensore: siNo(featVal(f, '/elevator')),
            cucina: '',
            arredato: siNo(featVal(f, '/furnished')),
            balcone: siNo(featVal(f, '/balcony')),
            terrazzo: /terrazz/i.test(desc) ? 'Sì' : '',
            cantina: /cantina/i.test(desc) ? 'Sì' : '',
            stato: mapStato(buildingCond),
            ape: /^[A-G][1-4]?$/i.test(energy) ? energy.toUpperCase() : '',
            riscaldamento: heating,
            agenzia: privato ? '' : (adv.name || 'Subito.it'),
            privato,
            aggiornatoIl: date,
            pubblicatoIl: date,
            descrizione: desc,
            foto: (it.images && it.images[0]?.urls?.small) || (it.images && it.images[0]?.uri) || '',
          },
        });
        added++;
        if (cards.length >= maxAds) break;
      }
      log(`[subito] pag ${pageNum}: +${added} (tot ${cards.length})`);
      if (items.length === 0) break;
      pageNum++;
      await sleep(rand(3000, 5000));
    }
    return cards;
  },

  // List-only: i dati sono già completi dalla lista. Nessuna navigazione extra.
  async scrapeDetail(page, card) {
    return card.data || null;
  },
};