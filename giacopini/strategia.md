# Paolo Giacopini (paologiacopini.it) — Gestim

## Listing (verificata dal parent)
```
https://paologiacopini.it/p/gli-immobili.html?cf=yes&Motivazione%5B%5D=1&Tipologia%5B%5D=1&Comune=764
```
- `Motivazione[]=1` = vendita, `Tipologia[]=1` = appartamento, `Comune=764` = **Bologna**.
- **Pianoro e San Lazzaro di Savena non sono trattati dall'agenzia** → non interrogati.
- `&Prezzo_a=160000` è verificato funzionante MA oggi darebbe **0 appartamenti** →
  l'adapter usa la query **SENZA Prezzo_a** (3 annunci con Tipologia) e filtra
  client-side sul dettaglio: il probe vede link reali e il radar resta utile se i
  prezzi scendono sotto soglia.
- Nessun campo mq nel form di ricerca → **mq solo client-side**.
- Card: `li.listing`, `div.prezzo_full-grid` (prezzo), `div.codice` (riferimento).

## Dettaglio
`/i/<id>--vendita-<tipo>-<comune>.html` — DOM (coppie label/valore + testo).
Il comune è anche nello slug dell'URL (fallback).

## Client-side
- prezzo ≤ 160.000 € (pre-scarto da card `div.prezzo_full-grid`, conferma sul dettaglio)
- mq ≥ 40 sul dettaglio
- comune whitelist (di fatto solo Bologna: query Comune=764)
- scarto non residenziale da titolo/tipologia

## probeChecks
listingUrl senza Prezzo_a, `li.listing` + `a[href*="/i/"]`, linkPattern `/i/\d+--`,
minLinks 1, minCards 0.

## Esito validazione (22/11)
- `node --check` adapter/scrape: OK
- probe live headed: **exit 0** (3 li.listing, 3 link `/i/<id>--vendita-appartamento-bologna.html`)
- mini-raccolta `--max-ads 2`: 0 annunci salvati — i 3 appartamenti sono tutti sopra
  budget (**220.000 / 280.000 / 345.000 €**), scartati già dalle card.
  Parsing dettaglio verificato direttamente su 9604640: **220.000 € / 70 m² / Bologna,
  trilocale Massarenti** → scarto loggato corretto. Con prezzi ≤160k il radar raccoglie
  senza modifiche (query senza Prezzo_a scelta apposta).

## Audit filtri nativi (23/11)
- Gestim, form GET completa: Prezzo_da/Prezzo_a (testo libero), Tipologia[] (1=Appartamento),
  Comune=764, Zona[] (1=Centro storico, 4=Massarenti, 5=Mazzini, 24=S.Orsola, 10=San Donato).
  Nessun campo mq/vani/stato.
- Adapter gia' ottimale; Prezzo_a omesso intenzionalmente (0 risultati oggi, scelta probe documentata).
