# Strategia di scraping — Tecnocasa

## Filtri nativi — 2026-11-21 (ricognizione browser reale, D9)
- **URL filtrata**: `/annunci/immobili/emilia-romagna/bologna/{comune}.html?max_price=160000&min_surface=40`
  (pannelli Prezzo "Prezzo max" / Superficie "Mq da", textbox + Enter; chips
  "Fino a 160.000 €"/"Da 40 mq" confermati). Valori arbitrari accettati.
- Bologna: 6 card filtrate (vs 15), max 150k, mq min 52. 1 sola pagina → `pag-2.html`
  dà "Oops" (corretto: hasNext dell'adapter non lo richiede).
- **Paginazione**: `/pag-N.html` + query preservata (`…/pag-2.html?max_price=…`).
- **Parametri verificati anche su tecnorete.it** (stessa piattaforma/DB, stessi id).
- Probe: `probe-archive/probe-agent-tecnocasa.json`; `probeChecks` nella factory
  `makeAdapter` → ereditati da tecnorete.
- **Verify LIVE headless 21/11: 2/2 ✅** — 6 card, link tutti `/vendita/…/id.html`,
  stessi id del browser reale. Filtri confermati lato server dal profilo Playwright.

## ⚠️ TRAPPOLA ANTI-FALLBACK — scoperta 2026-11-22 (audit filtri)
- **Quando i risultati filtrati sono ZERO, il server restituisce la lista COMPLETA
  non filtrata** (San Lazzaro: 31 annunci fino a 860k sotto l'URL con max_price!).
  Pianoro: 0 annunci → stesso rischio. È la causa degli annunci fuori budget visti
  nel run del 22/11 (17/21 dettagli visitati fuori target).
- **Guardia nell'adapter**: se >50% delle card con prezzo noto supera il budget,
  la pagina è un fallback → area saltata. Più rete client-side prezzo/mq sulle
  card SEMPRE attiva (scarto prima del dettaglio).
- Regola generale: "0 risultati" su questi siti può significare "tutti i risultati".

## Accesso
- **URL ricerca**: `https://www.tecnocasa.it/annunci/immobili/emilia-romagna/bologna/{comune}.html?max_price=160000&min_surface=40` (filtrata, vedi sopra).
- **Anti-bot**: headless rilevato (403). **SEMPRE headed**. `gotoResilient` backoff. Pause umane.
- **Piattaforma condivisa con Tecnorete** (stesso motore, stesso database).

## Dati (dettaglio)
- **DOM "Caratteristiche"**: coppie label/valore → **Camere da letto: N** esplicito, locali, bagni, mq, piano, stato, APE.
- **Coordinate**: assenti → geocode Nominatim (filtro omònimi).
- Prezzo, indirizzo, agenzia dal DOM.

## BIG / SMA
- Superset server-side, profili lato script. Esito test: 15 annunci, 0 BIG / 0 SMA (molti nuda proprietà / fascia alta).

## FLIP
- **RENO**: stato esplicito nelle Caratteristiche → affidabile.
- **STALE**: date limitate → score da keyword/ribassi.

## Dedup — REGOLA DB CONDIVISO
- **Tecnocasa ≡ Tecnorete**: stesso ID numerico di database (es. 61299751) = stesso immobile, anche con agenzia diversa.
- `core/dedup.mjs` → `sameSharedDbId()`: ID identico + stesso `SHARED_DB_GROUPS` → score 1.00 (supera la penalità agenzia -0.2).
- In GLOBAL le coppie tecnocasa/tecnorete vengono sempre unificate.