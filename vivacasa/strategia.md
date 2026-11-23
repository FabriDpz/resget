# Viva Casa (vivacasaimmobiliare.it) — Houzez

## Listing (ricognizione live 22/11 — corregge il brief del parent)
```
https://www.vivacasaimmobiliare.it/immobili-in-vendita/
```
- ⚠️ La query `/ricerca-avanzata/?status[]=vendita&location[]=bologna&type[]=appartamento&max-price=160000&min-area=40`
  restituisce **"0 Result Found"** (verificato anche con max-price=200000 e senza filtri prezzo/mq: 1 risultato spurio).
  I 6 link `/immobile/` visibili su quella pagina sono il widget laterale **"IMMOBILI RECENTI"**, non risultati
  (contengono anche annunci in AFFITTO, es. bilocale Castiglione € 980/mese).
- La pagina reale del menu "IN VENDITA" è **/immobili-in-vendita/**: 8 annunci, pagina unica, senza paginazione.
  Card: `.item-listing-wrap` → `li.item-price` (prezzo), titolo h2/h3/h4, indirizzo completo
  ("…, Bologna, Emilia-Romagna, 40124, Italia"), mq (`N m²`), tipologia prima di "Dettagli".
- Il portfolio include **Budrio, Zola Predosa, Castenaso** (fuori whitelist) → scarto sulle card dall'indirizzo.
  Pianoro presente (2 quadrilocali Rastignano); San Lazzaro assente oggi.

## Dettaglio
`/immobile/<slug>/` — DOM puro, nessun ld+json utile. Sezione DETTAGLI con coppie
label/valore (`Rif. Immobile:`, `Prezzo:`, `Dimensione:`, `Locali:`, `Bagno:`,
`Tipologia:`, `Condizione:`, `Piano:`, `Ascensore:`, `Balconi:`) estratte da `li`.
Prezzo anche in `li.item-price` sotto l'h1. Stato da "Condizione" (attenzione al typo
del sito "Ristruttuarato" → mapStato lo riconosce via /ristrutturat/).

## Client-side (tutto, il server non filtra in modo affidabile)
- Sulle CARD: prezzo ≤ 160.000 € (`li.item-price`), tipologia residenziale, mq ≥ 40,
  comune whitelist dall'indirizzo completo. ⚠️ Il testo indirizzo contiene "Bologna"
  come PROVINCIA: il comune è il token prima di ", Bologna," (Bug corretto 22/11:
  un bilocale di Budrio veniva classificato Bologna).
- Sul DETTAGLIO: conferma prezzo/mq, comune autoritativo dall'indirizzo, scarto affitti.
- ⚠️ I mq nelle card Houzez sono inaffidabili (quadrilocale 345k → "1100 m²",
  Rastignano → "2221 m²": sembra un campo land area). Usati solo come hint; il filtro
  mq serio è sulla "Dimensione:" del dettaglio.

## probeChecks
listingUrl `/immobili-in-vendita/`, card `.item-listing-wrap` + `a[href*="/immobile/"]`,
linkPattern `/immobile/<slug>/`, minLinks 1, minCards 0.

## Bug noti / limiti
- Query ricerca-avanzata con status[]/max-price/min-area → 0 risultati (vedi sopra): NON usarla.
- Il widget "IMMOBILI RECENTI" nelle pagine dettaglio/ricerca inquina qualsiasi conteggio
  di link `/immobile/`: contare solo `.item-listing-wrap` o filtrare per contesto.
- Portfolio minuscolo (8 annunci in vendita): oggi **0 annunci nel target**
  (Bologna ≤160k solo box/cantina; residenziale sotto soglia solo a Budrio, fuori whitelist).
  minLinks 1 sul probe resta valido perché la listing piena ha sempre link.

## Esito validazione (22/11)
- `node --check` adapter/scrape: OK
- probe live headed: **exit 0** (8 card, link pattern OK)
- mini-raccolta `--max-ads 2`: 0 annunci salvati, 8 card scartate correttamente
  (prezzo/tipologia/comune). Parsing dettaglio verificato su 2 annunci di debug
  (prezzo 345.000 €/100 m² e 980 €/mese affitto correttamente riconosciuti).

## Audit filtri nativi (23/11)
- Houzez con ricerca avanzata ROTTA: "0 Result Found" anche con preset validi
  (max-price=200000&min-area=40); i 3 link /immobile/ residui sono widget "immobili recenti".
- Espone condizione (Nuovo/Da ristrutturare/...) ma name custom con suffisso timestamp,
  usabile solo dopo fix della ricerca lato sito. Listing /immobili-in-vendita/ + client-side resta corretto.
