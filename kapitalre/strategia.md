# KapitalRE (immobiliarekapitalre.it) — JetSmartFilters/JetEngine

## Listing (grammatica verificata dal parent)
```
https://immobiliarekapitalre.it/vendita/?jsf=jet-engine:immobili&tax=comune:<ID>&meta=_immobili_prezzo:0,160000
```
ID comuni: **Bologna=204, Pianoro=18, San Lazzaro di Savena=218**.

## ⚠️ Bug verificati (non aggirabili, strategie separate)
- `tax≠204` + `meta` → **sempre 0 risultati**.
- `meta` prezzo + superficie insieme → **0**.
- `pagenum` con `meta` → **0**.

## Strategia per comune
- **Bologna**: `tax=comune:204&meta=_immobili_prezzo:0,160000` → 3 annunci, 1 pagina,
  NESSUNA paginazione (bug pagenum+meta).
- **Pianoro** (`tax=comune:18`) e **San Lazzaro** (`tax=comune:218`): SOLO tax, senza meta;
  paginazione `&pagenum=N` (10/pagina), **max 6 pagine per comune** (D4).
  Filtro prezzo/mq/tipologia **client-side dalle CARD** (le card espongono il prezzo):
  scarto prima di visitare il dettaglio. Se la card non espone il prezzo → visita e filtro sul dettaglio.

## Dettaglio
`/immobili/<codice>/` con codice `t####` / `xt###` / `ct###` — DOM (coppie label/valore + testo).

## Client-side
- prezzo ≤ 160.000 € (card + conferma dettaglio), mq ≥ 40
- comune whitelist: scarto se il campo comune del dettaglio è esplicito e fuori lista
- scarto non residenziale (box/cantine dominano la fascia bassa)

## probeChecks
listingUrl Bologna filtrata (tax=204+meta), linkPattern `/immobili/[a-z]*t?\d+/`,
minLinks 1, minCards 0.

## Codici annuncio (scoperta 22/11)
- `t####` = immobili residenziali/interi; **`xt###` = CESSIONI di attività** (xt307 era un
  chiosco bar a Roveri, categoria "CESSIONI"); **`ct###` = complesso/negozio** (ct903
  "NEGOZIO, zona Corticella"). L'adapter scarta xt/ct direttamente in collectListings.
- ⚠️ La query Bologna tax=204+meta≤160k restituisce 3 annunci MA sono:
  palazzina intera (t9147, prezzo non esposto in card → scarto sul dettaglio),
  chiosco (xt307), negozio (ct903): **0 residenziali nel target oggi**. Il meta prezzo
  sembra applicato in modo lasco dal sito (annunci "su richiesta"/trattativa).

## Esito validazione (22/11)
- `node --check` adapter/scrape: OK
- probe live headed (Bologna filtrata): **exit 0** (141 anchor, link pattern OK, campione t9147)
- mini-raccolta `--max-ads 2` (2 run): primo run salvava xt307 (chiosco 160k/50m²) →
  aggiunto filtro codici xt/ct + keyword attività; secondo run: 0 annunci, tutte le card
  scartate correttamente (Bologna 3, Pianoro 1, San Lazzaro 35 su 4 pagine).
  Parsing dettaglio verificato: prezzo/mq/bagni/piano estratti correttamente da xt307.
- Nessun annuncio residenziale ≤160k nel portfolio oggi: minLinks 1 del probe resta
  soddisfatto dalla query Bologna (3 risultati).