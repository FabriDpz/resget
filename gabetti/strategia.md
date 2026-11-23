# Gabetti — strategia di raccolta

## URL filtrate (server-side, verificate 22/11)
- `https://www.gabetti.it/vendita/bologna?prezzoMax=160000&mqMin=40` → 10 annunci
- `https://www.gabetti.it/vendita/pianoro?prezzoMax=160000&mqMin=40` → 1 annuncio
- `https://www.gabetti.it/vendita/san-lazzaro-di-savena?prezzoMax=160000&mqMin=40` → 0 (legittimo)

Paginazione: `?page=N&prezzoMax=160000&mqMin=40` (filtri mantenuti).
Link annuncio: `/vendita/<comune>/<tipologia>/<id numerico>` — regex
`/\/vendita\/[^/]+\/[^/]+\/\d+$/` sugli `a[href*="/vendita/"]`.

## Dettaglio (DOM VERIFICATO live 22/11)
Next.js SSR, **NO JSON-LD**: coppie **dt/dd** nelle sezioni Caratteristiche
(Superficie/Locali/Bagni/Camere da letto/Piano) ed Efficienza (Condizioni
dell'immobile/Classe energetica). Prezzo in elemento foglia `150.000 €`
(**importo PRIMA del simbolo €**). Indirizzo dal titolo h1 ("… in Via X, Bologna (BO)").
Comune dal path URL; whitelist applicata subito.
**Il portale mescola tipologie non residenziali (magazzino visto nel probe)**:
scarto per slug tipologia (magazzino/box/garage/cantina/ufficio/negozio/…) in
listing e dettaglio.

## Client-side
Filtri prezzo/mq già server-side; resta solo la rete di sicurezza sul
dettaglio (prezzo≤160000, mq≥40, scarto loggato `return null`).

## Rischi
- DOM-based: un redesign Next.js rompe i regex → probe-verify exit 2, ricognizione Flusso 1.
- 0 risultati a San Lazzaro è legittimo: non alzare minLinks oltre 3 (BO).
- Camere spesso assenti come campo: fallback `bedroomsFromText` (locali-1 conservativo).

## Validazione 22/11
- probe live: **exit 0** (17 card, 9 link match, min 3 ✅)
- mini-raccolta 2 annunci: OK dopo 1 fix parser (prezzo "N €" non "€ N"; dt/dd).
  - 3314591: Bologna, 150.000 €, 53 m², 2 locali, piano Terra, Nuovo, A1
  - 3392707: Bologna, 158.000 €, 40 m², 1 locale, piano Quarto
- geocoding 2/2 OK. Nessun blocco.