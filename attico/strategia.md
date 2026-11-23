# Strategia di scraping — Attico.it (ATTIVO)

## Stato
- **ATTIVO dal 21/11**, filtri server-side corretti il **22/11 (audit filtri)**.
- ⚠️ **TRAPPOLA SCOPERTA**: `/vendita-residenziale/in-{comune}/lista-N` è una listing **NAZIONALE**
  ( annunci di Milano sotto l'URL "bologna"). Il solo segmento location non filtra.

## Listing filtrata (verificata browser reale 22/11 via form "Imposta filtri")
- Pattern: `/vendita-residenziale/dimensione-{mqMin}-qualsiasi-per-{prezzoMin}-{prezzoMax}-in-{Luogo}/lista-N`
- Usata: `dimensione-40-qualsiasi-per-0-160000-in-Bologna/lista-1` → H1 "Immobili in vendita in Bologna",
  49 card Bologna tutte ≤160k e ≥40 m². Pianoro 1, San Lazzaro 4.
- `in-Bologna` (capitalize) = comune; `in-bo,+emilia-romagna` = provincia.
- Paginazione `lista-N`; query param prezzo (`prezzoMassimo` ecc.) IGNORATI.
- Rete client-side prezzo/mq sulle card sempre attiva (li.price, i.icon-mq).

## Accesso
- WAF proprio (gruppo Casa.it) più permissivo di casa.it. **SEMPRE headed**, profilo persistente,
  pause 2-4.5s, `gotoResilient` backoff. Cookie Didomi: "Continua senza accettare".

## Dati
- Card: a[href*="/immobile-"], .title h2 (indirizzo), .zone, .optional-zone (tipologia), li.price, mq/locali.
- Dettaglio: tabella label ("Metri quadri:", "Locali:", "Bagni:", "Condizioni:", "Piano:", …).
- Camere: `bedroomsFromText`. Coordinate: geocode Nominatim nel runner.

## BIG / SMA / FLIP / Dedup
- Profili lato script + whitelist comuni. Generalista: priorità media in GLOBAL (perde contro le fonti primarie).
