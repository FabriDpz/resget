# Strategia — Toscano (toscano.it)

Aggiornato: 2026-11-22 (probe live Playwright headed, DOM verificato).

## Tecnologia
- **Blazor Server** (markup con commenti `<!--!-->`). SSR completo al primo load:
  listing e dettaglio leggibili senza attendere il circuito SignalR.
- JSON-LD presente sia in listing (`ItemList` di `RealEstateListing`) sia in
  dettaglio (`RealEstateListing` con `displayLocation/Place/PostalAddress`,
  `offers/Offer` con `price` stringa e `seller/RealEstateAgent`).
- ⚠️ Nel sorgente HTML il type attribute è escapato (`application/ld&#x2B;json`);
  nel DOM Playwright è decodificato a `application/ld+json` (verificato).
  L'adapter usa `script[type*="ld"]` per robustezza.

## Listing
- URL: `https://www.toscano.it/vendita/immobili-residenziali/comune-<slug>`
  - `comune-bologna`: 33 immobili (22/11), 20/pagina
  - `comune-san-lazzaro-di-savena`: 3 immobili
  - `comune-pianoro`: 0 immobili (1 fetch di conferma per run, legittimo)
- Paginazione: path `/comune-bologna/2` (verificata dal parent). Nessun anchor
  di paginazione nel DOM (bottoni Blazor): l'adapter tenta la pagina successiva
  finché la pagina corrente è piena (20 card).
- Prezzo/mq **non filtrabili server-side** → filtro client:
  il JSON-LD ItemList della listing espone `offers.price` per ogni card →
  scarto `prezzo > 160000` **prima** di visitare il dettaglio.
- Card DOM: `div.card.plp_card`, link `a[href*="/comune-"]`,
  pattern dettaglio `/comune-<comune>/<id>-<slug>`.

## Dettaglio
- JSON-LD `RealEstateListing`: name (con rif.), image, displayLocation.address
  (streetAddress, addressLocality), offers.price/seller.
- Sezione **Caratteristiche** come coppie label/valore nel testo:
  Superficie, Locali, Bagni, Piano, Ascensore, Riscaldamento, Classe energetica
  (`G 287 Kwh/mq anno`), Posto auto / Box, Stato immobile (libero/occupato),
  Condizioni immobile (→ mapStato), Spese condominio (`100 €/mese`), Composizione.
- Zona: "Il quartiere <nome>" (sezione mappa/OMI) → fallback zonaFromDescrizione.
- Fallback DOM se JSON-LD assente: prezzo da "Prezzo immobile € …".
- Rete client finale: prezzo ≤160k, mq ≥40, whitelist comuni.

## Anti-bot / ritmo
- Nessun blocco riscontrato al 22/11. Cookie banner proprio ("Rifiuta tutto"
  matched da dismissCookies). Ritmo D4: pause 2-4s, ≤5 pagine/comune.
- Fail-closed su 403/CAPTCHA (checkBlocked/gotoResilient), mai aggirare.

## probeChecks
- listingUrl `comune-bologna`, linkPattern `/comune-[^/]+/\d+-`, minLinks 5,
  detailChecks jsonLdType `RealEstateListing`. Verifica live: exit 0 (22/11).

## Audit filtri nativi (23/11)
- Blazor Server: zero form/input nell'HTML (717KB), filtri solo via circuit JS ("Piu' filtri").
  Nessuna URL GET filtrata costruibile. Strategia attuale (listing + reti client-side) corretta.
