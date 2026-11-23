# Strategia di scraping — Mitula

## Accesso
- **URL ricerca (dal 22/11)**: endpoint **`/find?geoId={id}&operationType=sell&propertyType=apartment&maxPrice=160000&minArea=40`**, generato dal pannello Prezzo del sito e verificato browser reale.
  - geoId: **Bologna=R43172, Pianoro=R43050, San Lazzaro di Savena=R43173** (3 comuni coperti).
  - Bologna: 276→171 con minArea=40; tutti i prezzi ≤160k, mq ≥40. Paginazione `&page=N`.
  - ⚠️ La vecchia URL SEO `-160000-euro` significa "**INTORNO a** 160000" (card fino 179k+): abbandonata.
  - ⚠️ **Fallback**: con 0 risultati esatti il sito mostra "l'abbiamo ampliata" + annunci fuori filtro → guardia sul messaggio (area saltata) + rete client-side sui data-attr card.
- **Aggregatore puro** (piattaforma Lifull/Thribee): rimanda ad altri portali. **Nessun viaggio in dettaglio** — i dati card bastano.
- **Anti-bot**: **SEMPRE headed**. `gotoResilient` backoff. Pause umane.

## Dati (card)
- **`data-listingid`** + attributi card: prezzo, locali, bagni, mq, zona, età annuncio, fonte.
- **JSON-LD `SearchResultsPage`** come conferma.
- **Camere**: da card/descrizione → `bedroomsFromText` (dichiarate).
- **Prezzo null**: "Consultare il prezzo" → `prezzo=null` → **escluso** da BIG/SMA ("budget non verificabile", fix fail-closed).

## BIG / SMA
- Profili lato script sui dati card. Esito test post-fix: 15 annunci, **1 BIG / 4 SMA** (prima del fix prezzo-null erano 7 BIG falsati).

## FLIP
- **RENO/STALE**: dati card limitati (no stato strutturato, no date precise) → score prevalentemente da prezzo/mq e keyword. Valore principale: copertura + dedup.

## Dedup
- **Mitula ≡ Trovit**: stesso DB Lifull/Thribee (`data-listingid` mitula = `data-retis-id` trovit). Dedup per prezzo/mq/zona (ID formato diverso → no regola shared-ID).
- Aggregatore: in GLOBAL perde sempre contro la fonte primaria originale.