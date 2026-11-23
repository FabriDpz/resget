# Professionecasa (Bologna San Vitale) — strategia di raccolta

## URL listing
`https://www.professionecasa.it/agenzia/bologna-san-vitale?contratto=vendita&uso=abitativo&prezzomassimo=160000&mqmin=40`

## ⚠️ VERIFICATO LIVE 22/11: i filtri prezzo/mq sono IGNORATI dal server
La listing con `prezzomassimo=160000&mqmin=40` mostra comunque annunci da
280.000 € e 870.000 €. Il brief diceva "1 risultato verificato": in realtà sono
3 card, di cui nessuna nel target. **Filtri CLIENT-SIDE sulla card in raccolta**
(prezzo ≤160k, mq ≥40, modello attico) + rete sul dettaglio.

- `uso=abitativo` NON esclude magazzini etichettati "appartamento": l'annuncio
  3194071 (60k, 115 m²) è un **magazzino C2** → scarto non-residenziale via
  regex su testo card/descrizione (`magazzino|C2|box auto in vendita|…`).
- L'agenzia copre anche San Lazzaro: comune dal path del dettaglio
  (`/<tipo>/vendita/<comune>/<id>`) → whitelist BO/Pianoro/San Lazzaro.
- Paginazione `&pagina=N`.

## Dettaglio (DOM verificato live 22/11)
ASP.NET, ld+json solo `WebSite`. **h1 = brand**, titolo annuncio in h2
("Appartamento in vendita a Bologna"). Prezzo in elemento foglia `€60.000`.
Dati in testo: "Tipologia: Appartamento Superficie 115 mq Locali 2 Bagni 1".
Descrizione dopo "INFORMAZIONI GENERALI". Indirizzo in testa
("VIA …, N - BOLOGNA (BO)").

## Rischi
- Portfolio molto piccolo e (22/11) 0 annunci nel target: listing vuota
  legittima → minCards 0, minLinks 1 (i link ci sono anche fuori budget).
- Una sola agenzia interrogata: copertura limitata alla zona San Vitale.
- Se in futuro i filtri server tornassero a funzionare, i filtri client-side
  restano innocui (doppia rete).

## Validazione 22/11
- probe live: **exit 0** (4 card, 3 link match, min 1 ✅)
- mini-raccolta: 0 annunci raccolti — CORRETTO: 2 scartati oltre budget
  (280k, 870k), 1 scartato non residenziale (magazzino C2 60k).
  Nessun annuncio nel target oggi; parser dettaglio verificato sul C2 prima
  dello scarto (prezzo/mq/locali/bagni/piano estratti correttamente).
- Nessun blocco.