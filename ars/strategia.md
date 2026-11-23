# ARS Immobiliare (arsimmobiliare.com) — Directorist

## Listing (parametri verificati dal parent)
Due query SEPARATE (mai combinare address+price):
```
https://arsimmobiliare.com/ricerca/?directory_type=immobili-vendita&price%5B1%5D=160000
https://arsimmobiliare.com/ricerca/?directory_type=immobili-vendita&address=Pianoro
```
- ⚠️ BUG: `address` + `price` insieme → **0 risultati** (bug del sito).
- ⚠️ `address` matcha anche la **descrizione** → falsi positivi (annunci di altri comuni
  che citano Pianoro nel testo). Il comune va confermato sul dettaglio da indirizzo/titolo.
- Query solo-prezzo: portfolio ≤160k **oggi vuoto** → 0 link legittimo.
- Query address=Pianoro: 1 villa oggi.
- Paginazione `&paged=N` (max 8 pagine per query, ritmo D4).

## Dettaglio
`/immobili/<slug>/` — DOM. ⚠️ Il ld+json è **RealEstateAgent dell'agenzia**, NON
dell'annuncio: ignorarlo. Coppie label/valore Directorist + testo.

## Client-side (sul dettaglio)
- comune whitelist (Bologna / Pianoro / San Lazzaro di Savena) da indirizzo/campo città/titolo,
  MAI dalla descrizione libera (falsi positivi di address)
- prezzo ≤ 160.000 € (pre-scarto anche dalla card se il prezzo è esposto)
- mq ≥ 40
- scarto non residenziale (box/cantine/terreni) da titolo/tipologia

## probeChecks
listingUrl `address=Pianoro` (l'unica con link garantiti oggi), `a[href*="/immobili/"]`,
linkPattern `/immobili/<slug>/`, minLinks 1, minCards 0.

## Esito validazione (22/11)
- `node --check` adapter/scrape: OK
- probe live headed (address=Pianoro): **exit 0** (19 anchor, 1 link annuncio)
- mini-raccolta `--max-ads 2`: query prezzo≤160k → 0 (portfolio vuoto, come previsto);
  address=Pianoro → 1 card, dettaglio parsato correttamente
  (**villa 645.000 € / 281 m², Pianoro** → scarto loggato prezzo>160k). 0 annunci salvati:
  comportamento corretto, nessun annuncio nel target oggi.

## Audit filtri nativi (23/11)
- Directorist: filtri server-side verificati nella form GET: `in_cat=41` (Appartamento),
  `custom_field[custom-number]=MIN-MAX` (Superficie mq, 1-1000),
  `custom_field[custom-radio-2]=Da ristrutturare` (stato: Nuovo/Abitabile/Da ristrutturare),
  extra `custom_field[custom-checkbox-2][]` = classe energetica.
- **Adapter aggiornato**: query prezzo ora include `in_cat=41&custom_field[custom-number]=40-1000`
  (meno candidati server-side = meno dettagli visitati = meno token AI a valle).
- Bug noto invariato: MAI `address` insieme a `price` (0 risultati).
- Combinazione prezzo+in_cat+custom-number non ancora testata live insieme: primo run
  da verificare (se 0 risultati inattesi, ritestare senza custom-number).
