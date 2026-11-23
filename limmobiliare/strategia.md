# L'Immobiliare (limmobiliarebologna.it) — RealHomes

## Listing (verificata dal parent)
```
https://limmobiliarebologna.it/ricerca-immobili/?status=vendita&location=bologna
```
- 4 annunci oggi. **NON aggiungere max-price**: a ≤160k in zona restano solo posti auto
  (il filtro server azzererebbe il residenziale utile → prezzo client-side).
- `type=appartamento` opzionale ma non usato (non verificato che non azzeri).
- `location=pianoro` / `location=san-lazzaro-di-savena` → **0 risultati**: NON interrogati
  (documentato; eventuali annunci di quei comuni nel portfolio bolognese passano dalla whitelist).
- ⚠️ Il portfolio globale include **BOLZANO**: filtro comune whitelist obbligatorio
  (card + dettaglio).
- Paginazione `&paged=N` (max 6 pagine, D4).

## Card / Dettaglio
- Card: `span.price ins.property-current-price`, `p.property-address`.
- Dettaglio: `/property/<slug>/<slug>/` — DOM, nessun ld+json. Coppie label/valore
  (`.property-meta` e simili) + testo.

## Client-side
- prezzo ≤ 160.000 € (pre-scarto da card, conferma sul dettaglio)
- mq ≥ 40 sul dettaglio
- comune whitelist (Bologna / Pianoro / San Lazzaro di Savena)
- scarto non residenziale (box/posti auto dominano la fascia bassa)

## probeChecks
listingUrl status=vendita&location=bologna, `a[href*="/property/"]` + `span.price`,
linkPattern `/property/<slug>/`, minLinks 1, minCards 0.

## Note DOM (22/11)
- Il mq è esposto come "**Area 70 MQ**" (numero separato dall'unità): regex dedicata,
  il parseMq standard non lo vedrebbe.
- Prezzo card duplicato ("€165.000 €165.000", ins+del RealHomes): parse Prezzo prende il primo.
- Portfolio Bologna oggi: 2 appartamenti Borgo Panigale a **165.000 €** (70 m², appena
  sopra soglia → scarto corretto), 1 a 280.000 €, 1 posto auto 5.000 €. Bolzano non
  compare nella query location=bologna ma il filtro resta attivo.

## Esito validazione (22/11)
- `node --check` adapter/scrape: OK
- probe live headed: **exit 0** (13 anchor, 8 span.price, 4 link pattern match)
- mini-raccolta `--max-ads 2`: 0 annunci salvati — le 3 card uniche sono tutte fuori
  target (165k×2, posto auto; la 4ª card 280k è duplicato di URL). Parsing dettaglio
  verificato direttamente su /property/appartamento-ristrutturato/:
  **165.000 € / 70 m² / Bologna** estratti correttamente → scarto loggato prezzo>160k.
  Se i prezzi scenderanno sotto 160k il radar li raccoglierà senza modifiche.