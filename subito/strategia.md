# Strategia di scraping — Subito.it

## Filtri nativi — 2026-11-21 (ricognizione browser reale, D9)
- **URL filtrata**: `/annunci-emilia-romagna/vendita/appartamenti/bologna/?pe=160000&szs=40`.
- **`pe` = prezzo MASSIMO, `ps` = prezzo MINIMO (trappola!), `szs` = mq minimi.**
- 484 risultati vs 1379 senza filtri (−65%). `__NEXT_DATA__` invariato; paginazione `&o=N`.
- Probe: `probe-archive/probe-agent-subito.json`; `probeChecks` con asserzione `nextData: true`.
- Verify da archivio: OK. Live headless 21/11: 45 card ✅ (i filtri reggono lato server);
  `__NEXT_DATA__` non misurato dal probe Playwright → inconcludente (verificato nel
  browser reale; l'adapter comunque fa STOP graceful se assente).
- detectAuction client-side invariato (le aste restano filtrate a valle).

## Stato
- **ATTIVO**: URL corretta con slug regione `/annunci-emilia-romagna/vendita/appartamenti/bologna/` (il vecchio `/annunci-bologna/...` dava 404). Dati da `__NEXT_DATA__`.
- Portale P2P/generalista ad alto valore per STALE (privati, no provvigione).

## Accesso
- **URL ricerca**: `https://www.subito.it/annunci-emilia-romagna/vendita/appartamenti/bologna/?pe=160000&szs=40` (filtrata, vedi sopra).
- **Anti-bot**: **SEMPRE headed**, profilo persistente, pause lunghe, backoff. Nessun aggiramento.

## Dati (attesi)
- `__NEXT_DATA__` JSON: prezzo, mq, locali, descrizione, foto, venditore (privato/agenzia), data pubblicazione.
- Camere da descrizione (`bedroomsFromText`). Coordinate assenti → geocode Nominatim.

## BIG / SMA / FLIP
- Profili lato script + whitelist comuni. **STALE**: punto di forza (privati, età annuncio, ribassi). **RENO**: stato da descrizione.
- **Affitti da privato (23/11)**: NON scartati in collectListings — restano esclusi da BIG/SMA (`detectAffitto`) ma alimentano la sezione **Lead privati** del sito se in scope con gli altri filtri (`leadAffittoPrivato`, regola utente: contatto manuale per interesse alla vendita). Affitti da agenzia scartati a monte come prima.

## Dedup
- Fonte P2P ma ad alta priorità (subito dopo i generalisti). In GLOBAL vince su aggregatori.