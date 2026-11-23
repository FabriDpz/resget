// Adattatore 1000case.it — SCRAPER API PURO (Supabase PostgREST pubblico).
// La SPA React legge da https://uxpqdfkyzotqnxvquayp.supabase.co/rest/v1/.
// La apikey è la chiave anon PUBBLICA embeddata nel bundle JS del sito
// (/assets/index-*.js), NON un segreto. Niente browser per listing/dettaglio:
// fetch Node (18+). Il page del runner resta inutilizzato.
// ⚠️ select=* è NEGATO dai grant a livello di colonna (verificato 22/11):
// anon può leggere solo la lista COLONNE sotto; 'address', 'latitude',
// 'longitude' sono negate (401). L'adapter usa la lista esplicita.
// location testo libero con casing incoerente → sempre ilike.
// price nullable (trattativa riservata): query con price=lte.160000 +
// seconda query price=is.null per non perdere i "in valutazione".

import { sleep, rand, BlockedError } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const REST = 'https://uxpqdfkyzotqnxvquayp.supabase.co/rest/v1';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4cHFkZmt5em90cW54dnF1YXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMjgyNDIsImV4cCI6MjA5MzgwNDI0Mn0.n6Ou_FCJBekFYfPrGu-QP2AT4S8QkYBDM-ffbmkL7WA';
const HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const COLS = 'id,title,location,price,square_meters,property_type,bedrooms,bathrooms,description,floor,is_visible,status,contract_type,energy_class,condition,rooms,created_at,updated_at';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const LOC_FILTER = 'or=(location.ilike.*bologna*,location.ilike.*pianoro*,location.ilike.*lazzaro*)';
const BASE_FILTER = 'is_visible=eq.true&status=eq.disponibile&contract_type=eq.vendita';

async function restQuery(path, { log }) {
  const r = await fetch(`${REST}/${path}`, { headers: HEADERS });
  if (r.status === 403 || r.status === 429) {
    throw new BlockedError(`HTTP ${r.status} da Supabase PostgREST (1000case)`);
  }
  if (!r.ok) throw new Error(`REST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function comuneFromLocation(loc) {
  const l = String(loc || '').toLowerCase();
  if (/lazzaro/.test(l)) return 'San Lazzaro di Savena';
  if (/pianoro/.test(l)) return 'Pianoro';
  if (/bologna/.test(l)) return 'Bologna';
  return null;
}

export default {
  id: 'millecase',
  name: '1000CASE',

  // La SPA non ha link SSR: il probe live sulla listing è inconcludente per
  // design (minLinks/minCards 0). La verifica vera è la query REST, che il
  // collector esegue a ogni run (fail-closed su 401/403).
  probeChecks: {
    listingUrl: 'https://1000case.it/immobili',
    minLinks: 0,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds }) {
    const rows = [];
    // 1) target pieno: prezzo ≤160k e mq ≥40
    rows.push(...await restQuery(`properties?select=${COLS}&${BASE_FILTER}&${LOC_FILTER}&price=lte.${MAX_PREZZO}&square_meters=gte.${MIN_MQ}&limit=100`, { log }));
    await sleep(rand(2000, 4000));
    // 2) trattativa riservata (price null): restano "in valutazione" nei filtri
    rows.push(...await restQuery(`properties?select=${COLS}&${BASE_FILTER}&${LOC_FILTER}&price=is.null&square_meters=gte.${MIN_MQ}&limit=100`, { log }));
    await sleep(rand(2000, 4000));
    // 3) mq non dichiarato ma prezzo nel target (mq verificato/scartato se noto)
    rows.push(...await restQuery(`properties?select=${COLS}&${BASE_FILTER}&${LOC_FILTER}&price=lte.${MAX_PREZZO}&square_meters=is.null&limit=100`, { log }));
    const seen = new Set();
    const cards = [];
    let skipped = 0;
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const comune = comuneFromLocation(r.location);
      // ilike può matchare sottostringhe spurie ("Bolognina" ok, altro no)
      if (!comune) { skipped++; continue; }
      // escludi attività commerciali (property_type null + titolo commerciale)
      if (/ristorante|negozio|locale commerciale|ufficio|capannone|attività/i.test(r.title || '') && !/appartamento|attico|casa|villa/i.test(r.title || '')) {
        skipped++; log(`[millecase] non residenziale: scarto ${r.id} (${r.title})`); continue;
      }
      cards.push({ id: r.id, url: `https://1000case.it/immobili/${r.id}`, area: comune, apiRow: r });
      if (cards.length >= maxAds) break;
    }
    log(`[millecase] REST: ${rows.length} righe, +${cards.length} nel target (${skipped} scartati)`);
    return cards;
  },

  async scrapeDetail(page, card, { log }) {
    let row = card.apiRow;
    if (!row) {
      const res = await restQuery(`properties?select=${COLS}&id=eq.${card.id}&limit=1`, { log });
      row = res[0];
      if (!row) return null;
    }
    if (!row.is_visible || row.status !== 'disponibile' || row.contract_type !== 'vendita') {
      log(`[millecase] non più disponibile/vendita: scarto ${card.id}`);
      return null;
    }
    const prezzo = row.price != null ? Number(row.price) : null;
    const mq = row.square_meters != null ? Number(row.square_meters) : null;
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[millecase] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    const comune = comuneFromLocation(row.location);
    if (!comune) { log(`[millecase] location fuori whitelist (${row.location}): scarto ${card.id}`); return null; }
    // foto e planimetrie: join separati (embedded select non garantito dai grant)
    let foto = '', planimetrie = [];
    try {
      await sleep(rand(1500, 3000));
      const imgs = await restQuery(`property_images?select=url,display_order,caption,media_type&property_id=eq.${card.id}&order=display_order.asc&limit=50`, { log });
      foto = imgs.find((i) => i.media_type !== 'floorplan')?.url || imgs[0]?.url || '';
      await sleep(rand(1500, 3000));
      const plans = await restQuery(`property_floorplans?select=url,title,display_order,is_public&property_id=eq.${card.id}&is_public=eq.true&order=display_order.asc&limit=20`, { log });
      planimetrie = plans.map((p) => ({ url: p.url, caption: p.title || 'Planimetria' }));
    } catch (e) { log(`[millecase] media parziali: ${e.message}`); }
    const locali = row.rooms != null ? Number(row.rooms) : null;
    const titolo = String(row.title || '').trim();
    // indirizzo dal titolo "Attico · Via Zaccherini Alvisi 1"
    const indirizzo = titolo.includes('·') ? titolo.split('·').slice(1).join('·').trim() : '';
    return {
      id: card.id,
      url: card.url,
      area: comune,
      titolo: titolo || 'Immobile in vendita',
      comune,
      provincia: 'BO',
      indirizzo,
      prezzo,
      tipologia: row.property_type || '',
      locali,
      camere: row.bedrooms != null ? Number(row.bedrooms) : bedroomsFromText(row.description, locali),
      bagni: row.bathrooms != null ? Number(row.bathrooms) : null,
      superficieMq: mq,
      piano: String(row.floor ?? ''),
      stato: mapStato(String(row.condition || '').replace(/_/g, ' ')),
      ape: String(row.energy_class || '').toUpperCase(),
      agenzia: '1000CASE',
      privato: false,
      descrizione: row.description || '',
      foto,
      planimetrie,
      pubblicatoIl: row.created_at ? String(row.created_at).slice(0, 10) : '',
      aggiornatoIl: row.updated_at ? String(row.updated_at).slice(0, 10) : '',
    };
  },
};