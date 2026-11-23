// Verifica via Nominatim i centri delle frazioni/quartieri in FRAZIONI_NOTE.
// Uso: node core/verify-frazioni.mjs [--refresh]
// 1 req/s (policy Nominatim), User-Agent identificativo. Salta le voci già in
// cache (con --refresh riverifica tutto). Accetta solo place (suburb/quarter/
// hamlet/village/neighbourhood/locality) il cui display_name contiene il comune
// dichiarato e che cade entro 12 km dai centri target. Scrive frazione-cache.json.
import { FRAZIONI_NOTE, setFrazioneCentro, saveFrazioneCache, frazioneCentro } from './frazione-centri.mjs';
import { nearestCenter } from './geo.mjs';

const REFRESH = process.argv.includes('--refresh');
const UA = 'PersonalHousingSearch/1.0 (local research script; contact: local user)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLACE_TYPES = new Set(['suburb', 'quarter', 'hamlet', 'village', 'neighbourhood', 'locality', 'town', 'city_district', 'borough']);

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=it&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'it' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let ok = 0, ko = 0, skip = 0;
for (const [comune, frazioni] of Object.entries(FRAZIONI_NOTE)) {
  for (const f of frazioni) {
    if (!REFRESH && frazioneCentro(f, comune)) { skip++; continue; }
    const q = `${f}, ${comune}, Italia`;
    try {
      const rows = await nominatim(q);
      const hit = rows.find((r) => {
        // SOLO place tipizzati: category=place da sola include auch il fiume
        // Savena e la via Santo Stefano (waterway/highway).
        if (!PLACE_TYPES.has(r.addresstype)) return false;
        // Il comune dichiarato deve comparire nel display_name (evita omonimi
        // in altri comuni).
        if (!new RegExp(`\\b${comune}\\b`, 'i').test(r.display_name)) return false;
        const km = nearestCenter(parseFloat(r.lat), parseFloat(r.lon)).km;
        return km <= 12;
      });
      if (hit) {
        setFrazioneCentro(f, comune, {
          lat: parseFloat(hit.lat), lon: parseFloat(hit.lon),
          fonte: `Nominatim verificato: ${hit.display_name.split(',').slice(0, 3).join(',')} (${hit.addresstype})`,
          verificatoIl: new Date().toISOString().slice(0, 10),
        });
        ok++;
        console.log(`OK   ${f} (${comune}) → ${hit.lat}, ${hit.lon} [${hit.addresstype}]`);
      } else {
        setFrazioneCentro(f, comune, { lat: null, fonte: 'Nominatim: nessun place plausibile', verificatoIl: new Date().toISOString().slice(0, 10) });
        ko++;
        console.log(`KO   ${f} (${comune}): nessun place plausibile (${rows.length} risultati scartati)`);
      }
    } catch (e) {
      ko++;
      console.log(`ERR  ${f} (${comune}): ${e.message}`);
    }
    saveFrazioneCache();
    await sleep(1100);
  }
}
console.log(`\nVerificate: ${ok} OK, ${ko} KO, ${skip} già in cache.`);