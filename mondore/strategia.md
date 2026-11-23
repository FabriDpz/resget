# Mondore — strategia di raccolta

## URL filtrate (server-side, RI-verificate live 22/11)
`https://mondore.it/risultati-ricerca-immobili/?status=vendita&location[]=<comune>&type[]=appartamento&type[]=villa&type[]=attico&type[]=monolocale&type[]=mansarda&type[]=casa-indipendente&max-price=160000&min-area=30`

Comuni: bologna, pianoro, san-lazzaro-di-savena.

## ⚠️ Bug parametri verificato live 22/11 (non documentato nel brief)
- `min-area=40` **insieme** a `max-price` → SEMPRE 0 risultati
  (testato max-price 160000 e 200000: entrambi 0 con min-area=40).
- `min-area=40` da solo → 44 risultati BO (funziona).
- `max-price=160000` da solo → 1 risultato BO.
- `min-area=30` (o 10) + `max-price=160000` → 1 risultato BO ✅
  → **strategia adottata: min-area=30 server-side + filtro CLIENT-SIDE mq≥40 sul dettaglio.**
- Array `type[]` ripetuto accettato dal server (multi-tipologia → stesso
  risultato del solo appartamento, BO 1). type[] obbligatorio: senza, la
  listing include attività/uffici.

Paginazione: `/risultati-ricerca-immobili/page/N/?<stessi param>`.
Link dettaglio: `/immobile/<slug>/` (id = slug, non numerico).

## Dettaglio (DOM verificato live 22/11)
Houzez custom, ld+json solo WebPage. Prezzo in `li.item-price`
"**145.000,00€**" (decimali ,00, simbolo DOPO). "Scheda immobile" con valore
PRIMA dell'etichetta: "Appartamento Tipologia Immobile", "1 Camera da letto",
"1 Bagno", "33 mq", "1960 Anno Costruzione". Sezione Indirizzo:
Via / Comune / Provincia / CAP / **Zona** (es. Massarenti). Descrizione tra
"Descrizione" e "Indirizzo". Piano/riscaldamento/stato dalla descrizione.
Comune dalla sezione Indirizzo o breadcrumb; whitelist.

## Client-side
- mq≥40 OBBLIGATORIO (min-area server-side è 30 per il bug preset).
- prezzo≤160k rete di sicurezza (già server-side).
- Scarto loggato `return null` come tempocasa.

## Rischi
- Portfolio piccolo nel target (BO 1) → minCards 0, minLinks 1.
- Il sito redirige a www.mondore.it: gli href assoluti sono www → id dallo slug stabile.
- Bug min-area potrebbe cambiare con update Houzez: ri-verificare col probe.

## Validazione 22/11
- 5 fetch diagnostici sui parametri ( vedi bug sopra): min-area=30 adottato.
- probe live: **exit 0** (20 anchor, 1 link annuncio match ✅)
- mini-raccolta: 1 card visitata (BO), 0 raccolti — CORRETTO: monolocale
  145.000 € ma **33 m² < 40** scartato client-side con log (prezzo/mq estratti
  correttamente dopo 1 fix parser: formato "145.000,00€").
- Nessun annuncio ≥40 m² ≤160k nel portfolio oggi (BO 1, Pianoro 0, SL 0).
- Nessun blocco.

## Audit filtri nativi (23/11)
- Houzez: form con max-price, min-area (input TESTO LIBERO, non preset!), bedrooms,
  bathrooms, type[], location[], states[], areas[] (zone). search_args base64 decodificato:
  meta_query server price <=160000 NUMERIC + size >=30 applicata davvero.
- L'evidenza HTML suggerisce che min-area=40 potrebbe funzionare anche con max-price
  (il "bug preset" del 22/11 potrebbe essere un artefatto). NON cambiato: il comportamento
  0-risultati era verificato LIVE, l'audit e' solo HTML. Follow-up: ritestare live
  min-area=40+max-price; se OK, alzare da 30 a 40 e togliere la rete client-side.
- `feature[]` include nuova-costruzione ma NON "da ristrutturare": nessun filtro stato utile.
