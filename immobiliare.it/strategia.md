# Strategia di scraping — Immobiliare.it (portale di riferimento)

## Stato
- **Portale legacy già validato** (34 annunci). Codice funzionante in `scrape.mjs` + `site-src/`.
- Requisiti completi in [requisiti-immobilare.md](./requisiti-immobilare.md) (§2 BIG/SMA, §2bis POI, §2quinquies flip, §5–§8 anti-bot).

## Accesso
- Ricerca server-side con superset (≤160k, ≥55m², ≥1 locale) per comune (Bologna, Pianoro, San Lazzaro di Savena).
- Browser Playwright headed, profilo persistente, pause umane, scroll graduale. Cookie banner gestito.
- CAPTCHA/403/429 → STOP graceful, salvataggio parziale, nessun aggiramento.
- **Cooldown D4 allineato al core (23/11/2026)**: lo scraper legacy ora usa
  `core/health.mjs` con id `immobiliare` (la cartella è `immobiliare.it`).
  Un blocco registra cooldown fisso 24h e esce con **exit 3** (prima era exit 2
  senza registrazione → run-all lo riprovava subito, contro la policy D4).
  Run pulito → `recordSuccess` azzera il cooldown. Scritto anche
  `output/run-summary-<stamp>.json` per il report di run-all. `--force` ignora
  il cooldown (solo dopo verifica manuale).
- Storico: 403 al 15° annuncio su 33 nel run del 23/11 12:45 (14 annunci parziali
  salvati, 2 BIG); blocco registrato postumo, cooldown fino al 24/11 ~14:51 UTC.

## Dati (dettaglio)
- JSON-LD + DOM: prezzo, mq, locali, **camere verificate su planimetria**, bagni, piano, stato, APE, coordinate, agenzia, foto, date pubblicazione/modifica.
- POI Overpass + geocode Nominatim (cache condivisa `core/poi-cache.json`).

## BIG / SMA
- **BIG** ≤160k, ≥2 camere reali, ≥2 locali (bilocali solo convertibili).
- **SMA** ≤130k, esattamente 1 camera (monolocale ≥55m² vale 1). Priorità BIG.
- Whitelist comuni, ≤3km dai centri, POI rank ≥35, no aste/nuda proprietà/seminterrati/non residenziale.

## FLIP
- **RENO**: lavori 600€/m², ROI verde ≥20%, ARV da mediane zona.
- **STALE**: score giorni + ribassi + keyword.

## Dedup
- **Fonte primaria, priorità massima** in GLOBAL. Vince su tutti gli altri portali a parità di immobile.
- Il sito single-portal in `site/` resta come vista legacy; il punto d'ingresso principale è il sito unificato root.