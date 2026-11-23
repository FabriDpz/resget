# Strategia di scraping — Casa.it (DIFFERITO: WAF DataDome)

## Stato
- **Adattatore pronto** (`adapter.mjs` + `scrape.mjs`) ma **portale non accessibile**: WAF **DataDome persistente** anche in headed (403 dopo 5 min di backoff). Diverso dal rate-limit transitorio di wikicasa/tempocasa.
- **Nessun aggiramento** del challenge (policy fail-closed). Run rimandato a quando il portale sarà accessibile (profilo utente con sessione manuale, o raffreddamento IP).

## Accesso (quando disponibile)
- **URL ricerca**: `https://www.casa.it/vendita/residenziale/{comune}?prezzoMax=160000` (bologna, pianoro, san-lazzaro-di-savena).
- **Anti-bot**: DataDome. Pause molto lunghe (≥30–60s tra listing, ≥15s tra dettagli), backoff esponenziale sul 403; se persiste STOP graceful.

## Dati (dettaglio) — schema ricchissimo
- **`__NEXT_DATA__.pdp`**: JSON completo con `address.lat/lon` (coordinate native ✅), mq, locali, bagni, prezzo, stato, APE, foto, **POI già integrati** nella fonte.
- **Camere**: dedotte da descrizione (`bedroomsFromText`).

## BIG / SMA / FLIP
- Profili lato script identici agli altri portali. Coordinate native + POI integrati → arricchimento minimo.
- **RENO**: stato strutturato affidabile. **STALE**: date da `__NEXT_DATA__`.

## Dedup
- Fonte primaria ad alta priorità (subito dopo immobiliare.it/idealista). In GLOBAL vince su aggregatori.