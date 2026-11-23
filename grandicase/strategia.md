# Strategia — Grandi Case (grandicasebologna.it)

Aggiornato: 2026-11-22 (probe live Playwright headed, DOM verificato).

## Tecnologia
- Joomla + **RealEstateManager** (com_realestatemanager). SSR completo.
- Portfolio minuscolo: **7 annunci** al 22/11 (1 commerciale 129k, 6 residenziali
  da 179k in su). La ricerca del componente è inaffidabile → **nessun filtro
  server**: si legge la listing completa in pagina unica.

## Listing
- URL unica: `https://grandicasebologna.it/tutte-le-proposte/tutte-le-proposte/785/all_houses`
- Card: `#gallery_rem` → wrapper con:
  - `.okno_R`: `.rem_listing_status` (RESIDENZIALE/COMMERCIALE), `.col_rent` ("In vendita")
  - `.texthouse`: `.titlehouse a` (titolo + href), `.row_text` con `.col_text_1`
    label / `.col_text_2` valore (Mq via `i.fa-expand`, Locali, Camere)
  - `.rem_house_viewlist`: `.price` ("EUR 440.000")
- Link dettaglio: `/tutte-le-proposte/tutte-le-proposte/785/view/<cat>-<nome>/<id>/<tipo>`
  → id numerico = penultimo segmento.
- Scarto in raccolta: non "In vendita", non RESIDENZIALE, prezzo > 160000.
  **Oggi 0 target: legittimo** (minLinks 3 sul totale, minCards 0 nel target).

## Dettaglio
- DOM puro, **nessun ld+json**.
- Prezzo `EUR 179.000` in testa; indirizzo riga
  `Italia, Emilia Romagna, Bologna, 40132, Via Emilia Ponente, 463.`
- Caratteristiche in riga unica: `Categoria: … Tipologia annuncio: … ID Proprietà: …
  Motivazione: … Totale piani: … Condizioni: … Piano Immobile: … Cucina: …
  Disponibilita': … Riscaldamento: … Planimetria: Scarica planimetria`.
- Stats: `Locali: 3  Bagni: 1  Camere: 2  Superfice: 65 Mq`
  (⚠️ typo del sito: **Superfice**, non Superficie).
- Planimetria: anchor "Scarica planimetria".
- Cookie banner Joomla: "Ok, accetto!" / "Disattiva" → dismiss dedicato
  nell'adapter (preferisce Disattiva); dismissCookies core non li matcha.

## Anti-bot / ritmo
- Nessun blocco al 22/11. Pagina unica + 1 dettaglio per annuncio target:
  volumi minimi. Fail-closed D4.

## probeChecks
- listingUrl all_houses, cardSelectors `#gallery_rem .texthouse`,
  linkPattern `/view/`, minLinks 3, minCards 0. Verifica live: exit 0 (22/11).

## Audit filtri nativi (23/11) ? SCOPERTA
- La ricerca GET esiste: `/tutte-le-proposte/tutte-le-proposte/785/search?option=com_realestatemanager&task=search&Itemid=785`
  con `listing_type=2` (acquisto), `listing_status=1` (residenziale), `catid`
  (49=Bilocale, 48=Trilocale, 50=Mono, 47=Attico, 57=Quadrilocale), `pricefrom2/priceto2`.
  HTTP 200 verificato. Contraddice in parte il vecchio commento "ricerca inaffidabile".
- NON ancora adottata: contenuto risultati non confermato dal fetch raw (0 link /view/:
  portfolio oggi parte da 179k -> 0 target legittimo, oppure rendering JS).
  Follow-up: prova col browser del runner prima di sostituire lo scan completo.
- Nessun filtro mq/locali server-side (Bedrooms/Bathrooms solo hidden flag).
