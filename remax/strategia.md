# Strategia di scraping — RE/MAX

## Filtri nativi — 2026-11-21 (ricognizione browser reale, D9)
- **URL filtrata**: `/vendita-appartamenti/{comune}?prezzo_max=160000&superficie_min=40`
  (pannelli "Fascia di prezzo"/"Superficie", textbox Da/A + Enter). Paginazione `&page=N`.
- **Bologna baseline: 6 annunci, tutti >200k → 0 nel target** (atteso, non un errore).
- **TRAPPOLA 0-risultati**: il sito mostra "Nessun annuncio trovato" + card SUGGERITE
  di altri comuni (es. Santa Croce Camerina 98k). L'adapter ora rileva il messaggio
  e NON raccoglie i suggeriti (prima li avrebbe visitati e scartati solo a valle).
- Probe: `probe-archive/probe-agent-remax.json` (sampleLinks vuoti, documentato);
  `probeChecks` con `minLinks: 0` e `minCards: 0` (listing vuota legittima).
- **Verify LIVE headless 21/11**: pagina raggiungibile, 0 card = conferma che i
  filtri server-side escludono tutto il fuori-budget bolognese (baseline 6, tutti >200k).

## Accesso
- **URL ricerca**: `https://www.remax.it/vendita-appartamenti/{comune}?prezzo_max=160000&superficie_min=40` (bologna, pianoro, san-lazzaro-di-savena; filtrata, vedi sopra).
- **Dettaglio**: sottodomini agenzia multipli (es. `prestige.remax.it`, `remax.it/...`). Link raccolti dal listing.
- **Anti-bot**: headless rilevato (403). **SEMPRE headed**. `gotoResilient` backoff su 403/429. Pause umane.

## Dati (dettaglio)
- **JSON-LD `RealEstateListing`** → prezzo, mq, locali, bagni, indirizzo, agenzia.
- **Coordinate**: assenti → geocode Nominatim (con filtro omònimi `plausible()`).
- **Camere**: non esposte come campo → `bedroomsFromText(desc, locali)` (dichiarate, non verificate).
- **mq anomali**: alcuni annunci hanno superfici errate dalla fonte; il filtro mq a valle scarta i valori implausibili.

## BIG / SMA
- Superset server-side, profili lato script. Esito test: 9 annunci, 0 BIG / 0 SMA (fascia alta, prestigio).

## FLIP
- **RENO**: stato da descrizione; ARV mediane zona.
- **STALE**: date non sempre esposte → score prevalentemente da keyword/ribassi; giorni sul mercato limitati.

## Dedup
- Fonte primaria (agenzia). ID annuncio stabile. In GLOBAL vince su aggregatori.