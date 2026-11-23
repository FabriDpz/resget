# Strategia di scraping — Trovit

## Filtri nativi — CORREZIONE 2026-11-22 (ricognizione browser reale)
- ⚠️ La URL SEO `-160000-euro` è "**INTORNO a** 160.000 €" (confermato dal title
  "297 immobili … intorno 160.000 €"): NON è un max → abbandonata.
- **Filtro VERO: endpoint `/find`** della piattaforma Lifull (stesso DB di Mitula,
  **geoId condivisi**):
  `/find?geoId={id}&operationType=sell&propertyType=apartment&maxPrice=160000&minArea=40`
  - geoId verificati: **Bologna=R43172, Pianoro=R43050, San Lazzaro=R43173**
    (3 comuni coperti; prima solo Bologna).
  - ⚠️ Il geoId composito `mitula-IT-poblacion-…#R43173` generato dal form Mitula
    NON funziona su trovit (42797 risultati = nazionale): usare la forma semplice.
  - ⚠️ `freeText=bologna` matcha la **PROVINCIA** (annunci di Monterenzio!): mai
    usare freeText, sempre geoId.
  - Paginazione `&page=N`. Prezzi >160k visibili nelle card = **barrati pre-ribasso**
    (il primo prezzo della card è il corrente).
- Rete client-side prezzo/mq sulle card sempre attiva.
- `probeChecks` con `stripQuery: false` (link thribee nella query `detailPageUrl=`).
  Verify `--live` headed 22/11: **3/3 OK**.

## Accesso
- **URL ricerca**: `https://case.trovit.it/find?geoId={R43172|R43050|R43173}&operationType=sell&propertyType=apartment&maxPrice=160000&minArea=40`.
- **Aggregatore puro** (piattaforma Lifull/Thribee, **stesso DB di Mitula**): rimanda ad altri portali. **Nessun viaggio in dettaglio** — dati card sufficienti.
- **Anti-bot**: **SEMPRE headed**. `gotoResilient` backoff. Pause umane.

## Dati (card)
- **`data-retis-id`** (= `data-listingid` di Mitula) + attributi card: prezzo, locali, bagni, mq, zona, età, fonte.
- **JSON-LD `SearchResultsPage`** come conferma.
- **Camere**: da card → `bedroomsFromText` (dichiarate).
- **Prezzo null**: "Consultare il prezzo" → `prezzo=null` → **escluso** da BIG/SMA (fix fail-closed).

## BIG / SMA
- Profili lato script sui dati card. Esito test post-fix: 15 annunci, **0 BIG / 0 SMA** (prima del fix prezzo-null erano 9 BIG falsati da "Consultare il prezzo").

## FLIP
- **RENO/STALE**: dati card limitati → score da prezzo/mq e keyword. Valore principale: copertura + dedup cross-portale.

## Dedup
- **Trovit ≡ Mitula**: stesso DB. Dedup per prezzo/mq/zona.
- Aggregatore: in GLOBAL perde contro la fonte primaria. Molti annunci Trovit sono duplicati di immobiliare.it/agenzie.