# Strategia — 1000CASE (1000case.it)

Aggiornato: 2026-11-22 (query REST verificate dal vivo).

## Tecnologia
- SPA React (Vite, bundle `/assets/index-*.js`) su **Supabase PostgREST pubblico**:
  `https://uxpqdfkyzotqnxvquayp.supabase.co/rest/v1/`.
- **Scraper API puro**: listing e dettaglio via fetch Node, nessun browser
  (il page del runner resta inutilizzato; profilo creato ma vuoto).
- apikey = chiave **anon PUBBLICA** embeddata nel bundle JS (non un segreto).
  Header: `apikey: <key>` + `Authorization: Bearer <key>`.

## ⚠️ Grant a livello di colonna (verificato 22/11)
- `select=*` su `properties` → **401** ("permission denied for table properties").
- Colonne leggibili da anon (testate una a una):
  `id, title, location, price, square_meters, property_type, bedrooms,
  bathrooms, description, floor, is_visible, status, contract_type,
  energy_class, condition, rooms, created_at, updated_at`.
- **Negate**: `address`, `latitude`, `longitude` (401). Non esistono:
  `lat, lng, heating, year_built, balcony, elevator` (400).
- L'adapter usa la lista esplicita COLS; se il sito cambia i grant la query
  fallisce con 401 → errore run (non blocco), ispezionare di nuovo le colonne.
- Indirizzo: ricavato dal titolo ("Attico · Via Zaccherini Alvisi 1").
- Coordinate assenti → geocoding core da indirizzo/comune.

## Query (collectListings)
Filtri base: `is_visible=eq.true&status=eq.disponibile&contract_type=eq.vendita`
+ `or=(location.ilike.*bologna*,location.ilike.*pianoro*,location.ilike.*lazzaro*)`
(location testo libero, casing incoerente → **sempre ilike**).
Tre query (≤100 righe ciascuna, oggi ~10 righe totali):
1. `price=lte.160000&square_meters=gte.40` — target pieno
2. `price=is.null&square_meters=gte.40` — trattativa riservata → prezzo null,
   restano "in valutazione" nei filtri core
3. `price=lte.160000&square_meters=is.null` — mq non dichiarato
Dedup per id; comune ricalcolato da location (whitelist); scarto titoli
commerciali (ristorante/negozio/…) quando property_type è null.

## Dettaglio (scrapeDetail)
- Usa `card.apiRow` (nessuna visita browser); senza apiRow rifà la query
  `id=eq.<uuid>`. Ricontrolla is_visible/status/contract_type.
- Media (join embedded non garantito dai grant → query separate):
  - `property_images?property_id=eq.<id>&order=display_order.asc`
    (colonne: url, display_order, caption, media_type, storage_path)
  - `property_floorplans?property_id=eq.<id>&is_public=eq.true`
    (colonne: url, title, display_order, is_public, mime_type)
  - URL storage pubblici: `/storage/v1/object/public/properties/<id>/…`
- `condition` enum tipo `buono_stato` → mapStato; `floor` testo libero
  ("1", "T", "Ultimo piano", "Attico"); `rooms` = locali.
- `aggiornatoIl`/`pubblicatoIl` da updated_at/created_at.

## Valori osservati (22/11)
- ~10 righe vendita whitelist; nessuna ≤160k con mq≥40 (min residenziale 250k);
  3 price null (attico Zaccherini Alvisi 96mq, attico trattative riservate,
  appartamento Via Betti SL 75mq) → raccolti come "in valutazione".

## probeChecks / verify
- listingUrl `https://1000case.it/immobili`, **minLinks 0, minCards 0**:
  la SPA non ha link SSR, il probe live è inconcludente per design e NON deve
  fallire il verify. **La verifica vera è la query REST** (eseguita a ogni run;
  403/429 → BlockedError fail-closed, 401 → errore grant da ispezionare).

## Ritmo
- Pause 2-4s tra le query REST, 1.5-3s tra le query media (D4, volume personale).

## Audit filtri nativi (23/11)
- REST PostgREST: gia' il massimo filtraggio server-side possibile (price lte,
  square_meters gte, rooms/bedrooms gte, property_type eq, condition eq, location ilike).
  Nessun cambiamento necessario.
- L'audit ha riportato 401 sulla anon key, ma **riverifica diretta del parent: HTTP 200**
  (select=id&limit=1 OK). Falso allarme, chiave dell'adapter valida. Se un run futuro
  da' 401 reale: estrarre nuova anon key dal bundle /assets/index-*.js del sito.
- Valori effettivi di property_type/condition da campionare per eventuali filtri eq. aggiuntivi.
