# Strategia di scraping — Caasa

## Filtri nativi — 2026-11-21 (ricognizione browser reale, D9)
- **URL filtrata**: `/bologna/bologna/appartamento/in-vendita.html?euro-a=160000&mq-da=40`.
  L'h1 conferma: "superficie maggiore di 40mq … meno di 160000€". 13 pagine, mq min 40.
- `euro-a` = prezzo max (form: Fascia personalizzata → campo "A"); `mq-da` = mq min.
- **TRAPPOLA PAGINAZIONE**: CON i filtri query il vecchio `/page-N.html` dà **404**;
  il sito pagina con **`&page=N`** sulla URL `.html` (letto dai link reali). Adapter
  aggiornato: URL `&page=N` + hasNext su `page=N+1`.
- Il form offre anche "Escludi aste" (radio): non testato via URL, aste filtrate a valle.
- Probe: `probe-archive/probe-agent-caasa.json`; `probeChecks` aggiunti.
- **Verify LIVE headless 21/11: 3/3 ✅** (22 `.result-item`, 18 `ID_`, 141 ClickTag
  sulla listing filtrata) — caasa tollera l'headless; filtri confermati lato server.

## Accesso
- **URL ricerca**: `https://www.caasa.it/bologna/bologna/appartamento/in-vendita.html?euro-a=160000&mq-da=40` (filtrata, vedi sopra).
- **Paginazione**: `&page=N` sulla URL filtrata (il vecchio `/page-N.html` vale solo senza filtri).
- **Aggregatore puro** ("Il motore di ricerca degli immobili in vendita in Italia"): link **ClickTag** che decodificano verso i portali originali (prevalentemente immobiliare.it, qualche trovacasa.it).
- **Anti-bot**: **SEMPRE headed**. `gotoResilient` backoff. Pause umane.

## Dati (card)
- **Card `.result-item` / `[id^="ID_"]`** + **JSON-LD `ItemList`**.
- **realUrl**: decodificato dal ClickTag (`url=`) → link al portale originale.
- Parsing card: prezzo `([\d.]+)\s*€\s*\|`, mq `\|\s*m²\s*(\d+)`, bagni, piano, APE `C\.E\.\s*([A-G])`, agenzia `PROPOSTO DA:`, data (mesi italiani).
- **Camere**: da card → `bedroomsFromText` (dichiarate).
- **Coordinate**: assenti → geocode Nominatim (filtro omònimi). Geocode 18/18 nel test.

## BIG / SMA
- Profili lato script. Esito test: 18 annunci, **0 BIG / 1 SMA** (fascia alta + prezzo-su-richiesta escluso).

## FLIP
- **RENO/STALE**: dati card (stato, età) → score da prezzo/mq, keyword, giorni. POI rank ok.

## Dedup
- Aggregatore: in GLOBAL perde contro la fonte primaria (immobiliare.it). Il realUrl decodificato aiuta il matching per URL/ID.