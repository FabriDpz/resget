# Abitare Bologna (abitarebologna.it) — PHP custom

## Listing (verificata dal parent)
```
https://www.abitarebologna.it/immobili.php?op=vendita&tip=Residenziale&loc=Bologna&mq=40%7C999999999999999&prezzo1=0%7C160000&start=0
```
- ⚠️ **CRITICO**: le chiavi `mq` e `prezzo1` vanno **SEMPRE** incluse in ogni query
  (pipe codificata `%7C`, valori arbitrari accettati), altrimenti il server risponde
  con una pagina rotta da **538 byte**.
- `tip=Residenziale`: filtro tipologia server-side (esclude box/cantine).
- `loc=San+Lazzaro+di+Savena`: 0 annunci oggi, interrogata comunque.
- **Pianoro non è nel select** del sito → skip documentato.
- Paginazione a offset: `&start=10,20,…` (10/pagina, max 6 pagine per query, D4).

## Dettaglio
`scheda.php?q=<slug>&rif=<codice>` — DOM. ⚠️ La **query string è l'identità
dell'annuncio** (`rif` = codice): mai stripparla (probe `stripQuery: false`).
ld+json presente ma è solo **LocalBusiness** dell'agenzia → ignorato.

## Client-side
- prezzo ≤ 160.000 € e mq ≥ 40: doppia rete su card (se esposti) e dettaglio
  (il server filtra già, ma i preset possono essere laschi)
- comune whitelist; scarto non residenziale residuo da titolo/tipologia

## probeChecks
listingUrl Bologna con `prezzo1=0%7C200000` (**5 risultati, più stabile per il probe**;
il collectListings usa 160000), linkPattern `scheda\.php\?`, stripQuery false,
minLinks 1, minCards 0.

## ⚠️ Bug dati del portale (scoperti 22/11)
- La query `op=vendita` **mescola annunci in AFFITTO**: rif 0002687A "Appartamento su
  2 livelli" è esposto a **€ 1.200,00** ma la descrizione dice "LOCAZIONE RIVOLTA A
  LAVORATORI REFERENZIATI EURO 1200,00". L'adapter scarta: prezzo <10.000 € o keyword
  affitto (locazione/affittasi/canone/mese).
- **€ 0,00 = trattative riservate** (villa 0002VILLA, Castiglione, 300 mq): prezzo
  non determinato → scarto prudenziale (mai salvare 0 o cifre spurie).
- Conseguenza: la query ≤160k oggi dà 2 risultati MA sono 1 affitto + 1 trattativa
  riservata → **0 annunci reali in vendita ≤160k**. Il primo annuncio vero è
  0002951B a **185.000 € / 77 m²** (visibile nella query probe ≤200k, parsing verificato).

## Esito validazione (22/11)
- `node --check` adapter/scrape: OK
- probe live headed (≤200k): **exit 0** (8 anchor scheda.php, 4 campioni con query preservata)
- mini-raccolta `--max-ads 2` (3 run iterativi): primo run salvava prezzi spurii
  (1200 €/2 €) → aggiunti parsePrezzoBody (soglia 10k), filtro affitti, scarto
  prezzo-non-determinato. Run finale: 2 card visitate, entrambe scartate con log
  corretto. Parsing vendita reale verificato su 0002951B (185.000 €/77 m²/Bologna →
  scarto prezzo>160k, comportamento atteso).