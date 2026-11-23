# Strategia di scraping — Tecnorete

## Filtri nativi — 2026-11-21 (ricognizione browser reale, D9)
- **URL filtrata**: `…/{comune}.html?max_price=160000&min_surface=40` — parametri
  **verificati direttamente su tecnorete.it** (stessa piattaforma/DB di tecnocasa,
  identici id annuncio): chips attivi, 6 card, 0 over-160k, mq tutti ≥40.
- Ereditati dalla factory `makeAdapter` di tecnocasa (listingUrl, probeChecks, paginazione).
- Probe: `probe-archive/probe-agent-tecnorete.json`.
- **Verify LIVE headless 21/11: 2/2 ✅** — 6 card, stessi id di tecnocasa (DB condiviso).

## Accesso
- **URL ricerca**: `https://www.tecnorete.it/annunci/immobili/emilia-romagna/bologna/{comune}.html?max_price=160000&min_surface=40` (filtrata, vedi sopra).
- **Stessa piattaforma di Tecnocasa** (adapter generato con `makeAdapter({ id:'tecnorete', base:'https://www.tecnorete.it' })`).
- **Anti-bot**: headless rilevato (403). **SEMPRE headed**. `gotoResilient` backoff. Pause umane.

## Dati (dettaglio)
- Identici a Tecnocasa: DOM "Caratteristiche" con **Camere da letto: N** esplicito, locali, bagni, mq, piano, stato, APE.
- Coordinate assenti → geocode Nominatim (filtro omònimi).

## BIG / SMA
- Superset server-side, profili lato script. Esito test: 12 annunci, 0 BIG / 0 SMA.

## FLIP
- **RENO**: stato esplicito → affidabile. **STALE**: score da keyword/ribassi.

## Dedup — REGOLA DB CONDIVISO
- **Tecnorete ≡ Tecnocasa**: stesso ID numerico = stesso immobile. `sameSharedDbId()` in `core/dedup.mjs` unifica le coppie (score 1.00).
- Evita duplicati cross-portale dello stesso annuncio di rete.