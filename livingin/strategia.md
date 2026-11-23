# Living In — strategia di raccolta

## URL listing
- `https://living-in.it/?search-listings=true&ct_city=bologna&ct_price_to=160000&ct_sqft_from=40` → 0
- `https://living-in.it/?search-listings=true&ct_city=pianoro&ct_price_to=160000&ct_sqft_from=40` → 1

## ⚠️ VERIFICATO LIVE 22/11: due assunzioni del brief smentite
1. **JSON-LD malformato**: `JSON.parse` fallisce sul ld+json del dettaglio →
   `detailChecks jsonLdType 'Product'` RIMOSSA (probe exit 2 al primo giro).
   Parsing DOM primario, JSON-LD solo best-effort.
2. **La ricerca non filtra il contratto**: l'unico risultato "Pianoro ≤160k"
   (10442) è un **capannone IN AFFITTO a €1.000/mese**. Scarto client-side:
   AFFITTO (badge/testo), tipologia non residenziale (h1 "Capannoni, …"),
   prezzo≤160k, mq≥40.

- WP ct-listings: `ct_sqft` è in m². **San Lazzaro non esiste tra le città → non interrogarlo.**
- Paginazione WP `/page/N/?<stessi param>`. Dettaglio `/listings/<id>/`.

## Dettaglio (DOM verificato live 22/11)
Riga riassuntiva "`Pianoro, BO €1.000 2 250 m2`" → luogo/prezzo/locali/mq.
h1 = "Tipologia, N Locali". Descrizione dopo "Property ID #…", fine a
"Efficienza Energetica". Classe energetica, "Riscaldamento autonomo" nel body.
Comune dalla riga riassuntiva → whitelist (Monzuno è tra le città: scarto).

## Rischi
- Portfolio minuscolo: oggi 0 annunci vendita nel target → minCards 0, minLinks 1.
- Il filtro città potrebbe essere anch'esso inaffidabile: whitelist sul dettaglio.

## Validazione 22/11
- probe live: 1° giro **exit 2** (JSON-LD Product assente/malformato + card
  selectors di default sul dettaglio); fix probeChecks → 2° giro **exit 0** ✅
- mini-raccolta: 1 card visitata, 0 raccolti — CORRETTO (capannone affitto
  scartato con log). Nessun annuncio residenziale in vendita nel target oggi.
- Nessun blocco.