# Strategia di scraping — Bakeca

## Filtri nativi — 2026-11-21 (ricognizione browser reale, D9)
- **URL filtrata**: `/annunci/vendita-case/mqcaseinvendita/40-0/prezzoimmobile/0-160000/`.
- I filtri viaggiano come **slug di path `{campo}/{min}-{max}/`**, NON query string:
  il server **ignora qualsiasi `?param=`** (verificato). Slug scoperti pilotando i
  select nativi nel browser reale in foreground (i popup `<select>` sono OS-rendered).
- 141 annunci vs 519 senza filtri (−73%); 0 over-160k su 2 pagine verificate.
- **Paginazione**: `page/N/` in coda agli slug (invariata).
- Le card premium fuori area restano: il filtro comune al dettaglio le scarta (invariato).
- Probe: `probe-archive/probe-agent-bakeca.json`; `probeChecks` aggiunti all'adapter.
  Verify da archivio: OK. Il probe `--live --headless` del 21/11 ha preso 403 (headless
  rilevato, SEMPRE headed) → cooldown 24h, retry headed dopo scadenza.

## Accesso
- **URL ricerca**: `https://bologna.bakeca.it/annunci/vendita-case/mqcaseinvendita/40-0/prezzoimmobile/0-160000/` (filtrata, vedi sopra; non filtrata: `/annunci/vendita-case/`).
- **Attenzione**: il sottodominio `bologna.bakeca.it` copre **TUTTA la provincia** (Argelato, Camugnano, Calderara, ecc.). La whitelist comuni a valle scarta i fuori-target.
- **Paginazione**: `/page/N/`.
- **Anti-bot**: **SEMPRE headed**. `gotoResilient` backoff. Pause umane.

## Dati (dettaglio)
- **JSON-LD `Product`**: prezzo, titolo, descrizione, foto, venditore.
- **Camere**: da descrizione → `bedroomsFromText` (dichiarate).
- **Coordinate**: assenti → geocode Nominatim (filtro omònimi).
- **Privato vs agenzia**: distinti (campo `privato`). Interessante per STALE (no provvigione).
- **Aste**: catturate con campo `isAuction` → escluse da BIG/SMA standard.

## BIG / SMA
- Superset server-side, profili lato script + whitelist comuni. Esito test: 12 annunci, 0 BIG / 0 SMA (molti fuori comuni target).

## FLIP
- **RENO**: stato da descrizione.
- **STALE**: privati = margine negoziale più alto (no provvigione); date/età annuncio da card.

## Dedup
- Fonte P2P/minore. In GLOBAL perde contro le fonti primarie a parità di immobile.