# Strategia — Casadaprivato.it (DIFFERITO: URL ricerca non scoperti)

## Stato
- Home con form di ricerca; URL ricerca non scoperti (`/annunci-vendita/...` → 404). Da esplorare via form (round 3).
- Portale P2P (privati) → interessante per STALE (no provvigione).

## Accesso (da verificare)
- Compilare il form di ricerca dalla home headed (comune Bologna, vendita) e catturare l'URL risultante.
- **Anti-bot**: **SEMPRE headed**, profilo persistente, pause, backoff. Nessun aggiramento.

## Dati (attesi)
- DOM/JSON-LD: prezzo, mq, locali, descrizione, foto, venditore privato. Camere da descrizione. Coordinate da geocode.

## BIG / SMA / FLIP
- Profili lato script + whitelist comuni. **STALE**: punto di forza (privati). **RENO**: stato da descrizione.

## Dedup
- Fonte P2P minore: in GLOBAL perde contro le fonti primarie.