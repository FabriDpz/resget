# Strategia — Flatsearch.it (ATTIVO)

## Correzione del verdetto iniziale
La prima ricognizione aveva classificato il portale **DIFFERITO per "login obbligatorio"**.
**Era sbagliato**: erano stati provati solo URL intuitivi (`/compra`, `/ricerca`, `/annunci`),
che danno 404, e la home mostra un assistente AI che fa pensare a un prodotto chiuso.

La home linka invece **"Annunci per città"** verso i percorsi reali, **tutti pubblici**:
listing e dettaglio si aprono senza autenticazione. `robots.txt` = `User-Agent: * / Allow: /`
(vietati solo `/api/` e `/admin/`). Nessun WAF, nessun CAPTCHA incontrato.

**Resa misurata ≤160.000 € sui 6 comuni target: 344 annunci** — più di tutti gli altri
portali attivi messi insieme. Da qui la promozione a ATTIVO.

| Comune | Annunci ≤160k |
|---|---|
| Bologna | 273 |
| Zola Predosa | 18 |
| Pianoro | 16 |
| San Lazzaro di Savena | 15 |
| Casalecchio di Reno | 14 |
| Castenaso | 8 |
| **Totale** | **344** |

(Senza filtro prezzo Bologna dichiara 4.199 annunci.)

## Cos'è
**Aggregatore di 7 portali** (Subito, Immobiliare.it, Casa.it, Idealista, …).
Ogni annuncio dichiara su quali portali è pubblicato: questo lo rende la fonte
migliore del progetto per il **dedup cross-portale** della sezione GLOBAL.

## URL e filtri
```
Listing   /properties/sale/province-bologna/municipality-<slug>?price_max=160000&surface_min=40&ordering=-updated_at&page=N
Provincia /properties/sale/province-bologna          (elenca i comuni e i loro slug)
Dettaglio /property/<UUID v4>
```

**GOTCHA slug:** gli spazi sono `%20`, **non trattini**.
`municipality-casalecchio%20di%20reno` ✅ — `municipality-casalecchio-di-reno` ❌ 404.
L'apostrofo non va encodato (`castello%20d'argile`).

**GOTCHA filtri:** **`price_max` e `surface_min` sono onorati** (`surface_min`
scoperto nell'audit filtri 22/11: Bologna 243→90 con `surface_min=50`).
`priceTo`, `max_price`, `maxPrice`, `prezzoMax`, `price=0-160000`, `priceRange`
vengono ignorati **silenziosamente**: il totale resta invariato e sembra che il
filtro funzioni. Verificare sempre il contatore.

20 card/pagina. Contatore: `Risultati 1-20 di 4199`. `ordering=-updated_at` e `page=N` ok.

## Listing
Link `a[href*="/property/"]`; per ottenere la card completa si risalgono i parent
finché il testo contiene **sia `€` sia `m²`**. Ogni card espone: VENDITA, prezzo,
€/m², giudizio vs media di zona, gerarchia geografica a 3 livelli, m², locali, bagni,
"Aggiornato il GG/MM/AAAA". Header di pagina: annunci totali, portali, prezzo medio, media al m².

## Dettaglio — JSON-LD è la FONTE PRIMARIA
`<script type="application/ld+json">` × 2 blocchi; il secondo ha un `@graph` con 4 nodi:
`Organization`, `WebSite`, **`RealEstateListing`**, `BreadcrumbList`.
**Cercare il nodo per `@type`, non prendere il primo.**

Il nodo `RealEstateListing` fornisce:
- `geo.latitude` / `geo.longitude` — **coordinate reali**
- `offers.price`, `offers.priceCurrency`
- `about.floorSize.value` (m²), `about.numberOfRoomsTotal`, `about.numberOfBathroomsTotal`,
  `about.accommodationCategory`, `about.numberOfBedrooms` (non sempre presente)
- `address.streetAddress`, `addressLocality`, `postalCode`
- `name` (contiene via + quartiere + comune), `description`, `image[]`, `datePosted`

### GOTCHA coordinate — il bug più insidioso
**Mai cercare `lat` con regex libere nell'HTML.** Su questo sito la stringa `lat`
compare dentro **"F-lat-search"** (nome del brand) e la regex cattura numeri casuali,
producendo coordinate **plausibili ma false**, identiche su annunci di quartieri diversi.
Il primo pilota aveva tutte le coordinate uguali per questo motivo.
Si legge **solo il JSON-LD**; se serve una regex, usare word-boundary
(`\b(?:latitude|longitude|lat|lng|lon)\b`).

La mappa Leaflet dichiara *"la posizione indica la zona dell'immobile, non l'indirizzo esatto"*:
precisione di quartiere, **sufficiente per il filtro ≤3 km** dai POI.

### DOM (fallback e campi assenti dal JSON-LD)
Selettori stabili (non gli id React, che sono generati):
- `.meta-card` → `.meta-card__label` / `.meta-card__value`:
  **Superficie, Locali, CAMERE, Bagni, Tipologia, Piano, Classe energetica, Riscaldamento**
  → le **camere sono esposte**, usarle come fallback di `numberOfBedrooms`
- `.property-detail-price` → "€ 123.000"
- `.property-detail-sources` (`<aside class="property-detail-aside">`) →
  `h2` "Pubblicato su N portali" + **`.property-detail-sources__name`** → nomi portali
- "Proposto da `<agenzia>`" (es. "Affiliato Tecnocasa: …"); se assente → **privato** (STALE)
- riga sotto `<h1>`: `"Via della Barca 74 · Bologna, Borgo Panigale-Reno"` → indirizzo · Comune, Quartiere
- "Prezzo al m²", "Media a Bologna", badge Sotto/In linea/Sopra media
- "Aggiornato il GG/MM/AAAA"; sezione "Altre caratteristiche" (Balcone, Ascensore, Arredato, Cantina)
- **contatti NON esposti**: "I contatti dell'inserzionista sono disponibili sul portale di origine"

### Chiave di dedup esatta (IMPLEMENTATA)
I link ai portali d'origine sono tracker:
`/api/property-analytics/<ID numerico>/track?analytic_source=web-app`
dove **l'ID numerico è l'ID dell'annuncio sul portale d'origine**
(es. `668297848` = Subito, `134727351` = Immobiliare.it).

L'adapter estrae le coppie in `idsOrigine: [{portale, id}]` (oltre a `portaliOrigine`,
solo i nomi, utile alla lettura umana). `core/dedup.mjs` le usa così:
- `ORIGIN_ALIASES` mappa il nome display (`Immobiliare.it`, `Casa.it`, `Re/MAX`…) sull'id
  interno del portale (`immobiliare`, `casait`, `remax`…). Portale non mappato ⇒ ignorato.
- `sameOriginId(a,b)` dà **score 1.0** se un aggregatore dichiara l'`id` dell'altro annuncio,
  o se due aggregatori dichiarano lo stesso ID d'origine.
- Un secondo **blocking sugli ID d'origine** (oltre a comune+prezzo) garantisce il match
  anche quando l'aggregatore espone un **prezzo obsoleto o divergente** dal portale diretto:
  è il caso in cui l'euristica prezzo/mq fallirebbe.
- Un ID numerico uguale su portali diversi **senza dichiarazione** resta una coincidenza:
  nessun match (test dedicato).

In `pickWinner` flatsearch è **ultimo** in `SOURCE_PRIORITY`: quando lo stesso immobile
arriva anche dal portale diretto, vince sempre la fonte primaria (dati più freschi e
contatti esposti). Flatsearch resta quindi un *completamento* del catalogo, non un doppione.

Per gli JSON raccolti **prima** dell'introduzione di `idsOrigine` esiste un arricchitore
che rivisita solo le pagine di dettaglio già note, senza riscaricare gli annunci:
```powershell
node flatsearch\enrich-ids.mjs --headless
```

## Trappole dati (tutte verificate sul campo)
1. **NUDA PROPRIETÀ nel mix** → esclusa (2 su 12 nel primo pilota).
2. **Affitti marcati VENDITA** (annuncio a € 1.200) → sanity-check: `prezzo < 15000 ⇒ null`, fail-closed.
3. **UUID diversi per lo stesso immobile** (via della Barca 47 compare due volte con prezzo e mq
   identici) → il dedup interno usa **indirizzo + prezzo + mq**, non l'`id`.
4. **Coordinate false da regex** — vedi sopra.
5. **Mix dominato da monolocali 30-45 m²**: su 344 annunci ≤160k la maggioranza è sotto
   la soglia §2 di 55 m². La card espone i m², quindi si applica un **pre-filtro in
   `collectListings`** per non aprire centinaia di dettagli già destinati all'esclusione.
6. `mapStato` (core/schema.mjs) **ritorna l'input se non riconosce nulla**: passargli solo
   un estratto breve, mai la descrizione intera, altrimenti `stato` = descrizione.

## BIG / SMA / FLIP
Criteri di progetto invariati (§2 requisiti), applicati da `core/filters.mjs`:
- **BIG** ≤160k, ≥2 camere reali, ≥2 locali, bilocali solo se convertibili in trilocali.
- **SMA** ≤130k, esattamente 1 camera, ≥1 locale; monolocale vale come camera **solo se ≥55 m²**.
- Superficie minima **55 m²** per entrambi i profili.
- Whitelist ≤3 km da POI ≥35; esclusi aste, nuda proprietà, seminterrati, non residenziale.
- **RENO** 600 €/m², ROI verde ≥20%. **STALE**: `privato: true` quando manca "Proposto da".

Il portale è particolarmente utile al flip perché espone **€/m² e confronto con la media
di zona già calcolati**, oltre ai portali d'origine (un annuncio su 4 portali da tempo
è un segnale di trattabilità).

## Esecuzione
```powershell
node flatsearch\scrape.mjs --headless --max-ads 400 --no-geocode
```
`--no-geocode` è legittimo: le coordinate arrivano già dal JSON-LD.
I POI servono per il rank di zona (ometterli solo nei piloti con `--no-poi`).

## Anti-bot
Fail-closed (policy §8): nessun CAPTCHA risolto, nessun aggiramento di WAF o login.
`gotoResilient` con backoff su 403/429, poi `BlockedError`. Pausa umana tra le pagine.

## Probe conservati
- `probe/resa-target.mjs` → misura la resa sui 6 comuni (giustifica la promozione)
- `probe/jsonld-dettaglio.mjs` → **schema dati di riferimento** (3 annunci × 2 blocchi)
- `probe/portali-origine.mjs` → pannello "Pubblicato su" con gli ID numerici d'origine
- `probe/struttura-dettaglio.mjs` → HTML `.meta-card` completo
- `probe/recon-filtri.mjs` → documenta gli slug dei comuni e quali query param sono onorati

Rimossi i probe di debug intermedi (`geo-*`, `recon-contenuto`, `recon-listing`,
`recon-filtri2`) e il profilo usa-e-getta `profile-recon`: le loro conclusioni sono
consegnate in questo documento e nel codice dell'adapter.

## Trappole di qualità dati

Tre caratteristiche della fonte che producono falsi positivi se ignorate. Le regole che
le neutralizzano stanno **nel core**, perché riguardano anche altri portali.
Test: `test-qualita-dati.mjs`.

### 1. Le meta-card spesso NON espongono "Camere"

Il dettaglio espone solo **Superficie, Locali, Bagni, Tipologia** (a volte Piano,
Classe energetica, Riscaldamento). **"Camere" manca frequentemente** e il JSON-LD
**non ha `numberOfBedrooms`**. L'unico dato affidabile è la descrizione.

Per questo le camere si leggono con `bedroomsFromText(desc, locali)` (`core/schema.mjs`),
che accetta il plurale (`camere?` con il `\b` finale) e i numerali in lettere. Il fallback
`locali - 1` **gonfia** le camere: è l'ultima risorsa, non la prima. Il campo si chiama
**`camere`**.

### 2. Aste giudiziarie mascherate da vendita ordinaria

**9 aste su 57 annunci**: `21490eb4`, `888d87f2`, `e040a8be`, `d06a81a6`, `3945ab40`,
`185d8f47`, `4b43e762`, `cebe9545`, `3dd71c6e`.

Si riconoscono da **`PVP:`**, `RGE:`, `base d'asta`, `offerta minima di`,
`custode giudiziario`, `decreto di trasferimento` — **non** dalla sola parola "asta".
Il rilevamento è `detectAuction(ad)` in `core/filters.mjs`, condiviso da tutti i portali.
Le aste sono fuori da BIG/SMA, dal pool RENO **e dai comparabili ARV**: i prezzi base
(<50% del valore) abbassano la mediana di zona deprimendo il ROI degli annunci liberi.

### 3. Il JSON-LD può essere coerente ma FALSO (geocoding omonimo)

`d436f14a-b314-46e5-8f70-dc97f4dc9e88`: JSON-LD `Bologna / 40132 /
44.5184749,11.2643704` — tutto internamente coerente — ma la descrizione dice
**"Via Alcide De Gasperi a Cento"** (provincia di Ferrara). L'aggregatore ha geocodificato
l'omonimia.

**Regola: la descrizione batte il JSON-LD sul luogo.** `comuneContraddetto(ad)` in
`core/geo.mjs` confronta il testo con 29 `COMUNI_FUORI`, **frase per frase**, escludendo
le frasi che parlano dell'agenzia ("Agenzia con sede a Modena" non è il luogo
dell'immobile). Restituisce il comune con l'iniziale maiuscola.

### Nota architetturale

Le esclusioni hanno **due punti di ingresso indipendenti**: `applyFilters` (profili
BIG/SMA) e `analyzeReno` (pool RENO), che non legge `applyProfiles`. Un fix in uno **non
si propaga all'altro**: ogni nuova esclusione va aggiunta in **entrambi**.

## Altri dettagli tecnici confermati

- Listing: `/properties/sale/province-bologna/municipality-<slug>?price_max=160000&page=N`.
  Gli slug usano **`%20`, non trattini**. **Solo `price_max` ? onorato**: gli altri nomi
  di parametro sono ignorati **silenziosamente** (nessun errore, risultati non filtrati).
- JSON-LD `@graph`: cercare il nodo con `@type === 'RealEstateListing'`, **non prendere
  il primo** elemento del grafo.
- **Mai cercare "lat" con regex libere nell'HTML**: matcha il nome del sito "F-lat-search".
- `.property-detail-sources__link` ? `/api/property-analytics/<ID>/track?analytic_source=web-app`:
  quell'ID ? l'annuncio **sul portale d'origine** (vedi `enrich-ids.mjs` e il dedup).
