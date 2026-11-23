# Strategia — Intesa Sanpaolo Proprietà

**Verdetto (ricognizione 2026-11-15, browser agent-controlled): DEFERRED per CONTENUTO, non per tecnica.**
È il portale **più pulito da scrapeare** tra i differiti, ma in provincia di Bologna
il patrimonio è **esclusivamente non residenziale**: 8 annunci totali, 0 appartamenti.
Adapter scritto e testato: pronto se il patrimonio cambia.

> Corregge la classificazione precedente di questo file ("ASTE, fuori dai criteri
> standard, ricerca solo via form, nessun URL query"): **entrambe errate**.
> È vendita diretta con URL filtrabili in chiaro.

## Cosa vende davvero
Patrimonio **dismesso del gruppo** (ex filiali bancarie, uffici, depositi, magazzini).
Si acquista con **"manifestazione di interesse"**, non con asta giudiziaria.
Il filtro Stato ha 4 voci — *In vendita / In gara / Venduto / Aggiudicato* — dove
"In gara" è una procedura competitiva interna al gruppo, non un'asta del tribunale.
Il prezzo esposto è un **VALORE** di vendita, non una base d'asta.

## Accesso — nessuna login, nessun blocco
- Base: `https://www.proprieta.intesasanpaolo.com/immobili` — SSR, HTTP 200.
- **Nessun WAF, nessuna login, nessun CAPTCHA sulla navigazione.**
- Il reCAPTCHA esiste **solo** sul form "Invia Richiesta" (mai usato dallo scraper).

### URL diretti (la scoperta chiave)
Il form usa **dropdown custom** (`button` + `ul > li`, nessun `<select>`): pilotarlo
è lento e fragile. Ma i **breadcrumb della pagina di dettaglio** espongono gli stessi
filtri in query string. Basta quindi costruire l'URL:

| Parametro | Esempio | Nota |
|---|---|---|
| `?provincia=` | `037` (Bologna) | **codice interno a 3 cifre**, NON ISTAT né nome |
| `?comune=` | `037011` (Casalecchio) | **codice ISTAT a 6 cifre** |
| `?tipologia=` | `29` (Deposito) | id numerico interno |
| `?vista=` | `griglia` \| `elenco` \| `mappa` | |
| `?ordina=` | `last` \| `relevant` \| `price-descending` \| `price-ascending` | |

Combinabili: `?comune=037011&tipologia=29`.
**Trappola**: `?provincia=Bologna` restituisce 0 risultati *senza alcun errore*.

Paginazione nel **path**, non in query: `/immobili/pag-N?comune=037011`. **6 card/pagina**.

Il contatore `MOSTRA I RISULTATI (N)` si aggiorna live ad ogni cambio filtro:
utile per stimare la resa di un filtro **senza** caricare i risultati.

### Codici ISTAT dei comuni target
| Comune | Codice | Annunci | Tipologie |
|---|---|---:|---|
| Bologna | `037006` | 3 | 2 Filiali Bancarie + 1 Ufficio |
| San Lazzaro di Savena | `037054` | 0 | — |
| Casalecchio di Reno | `037011` | 2 | Deposito + Ufficio |
| Castenaso | `037019` | 0 | — |
| Pianoro | `037047` | 0 | — |
| Zola Predosa | `037061` | 0 | — |
| **Totale** | | **5** | **0 residenziali → 0 BIG / 0 SMA** |

Su tutta la provincia (`?provincia=037`): **8 annunci su 2 pagine**, di cui 2 già
marcati **VENDUTO**. Solo 5 comuni hanno patrimonio: Argelato, Bologna, Casalecchio
di Reno, Casalfiumanese, Marzabotto. Nazionale: 850 annunci su 142 pagine.

Le 5 tipologie residenziali rilevanti (Appartamento, Casa indipendente, Porzione di
casa, Villa a Schiera, Terratetto-Terracielo) sono state interrogate su provincia 037:
**tutte `MOSTRA I RISULTATI (0)`**. Dettaglio in [probe/comuni-target.json](./probe/comuni-target.json).

## Selettori

### Listing (usa `<table>`)
- Card: `h2 a[href*="/ID"]` → id con `/\/ID(\d+)/`.
- Risalire al contenitore: loop di ≤6 `parentElement` finché non si trova un `table`.
- Nel `table`: righe **Indirizzo** e **Superficie** (`"96 m²"`).
- Prezzo: `h2` contenente `Prezzo 65.000,00 €`.
- **Badge VENDUTO**: link con testo "Venduto" nella stessa card → da escludere.
- Vuoto: `<p>Nessun immobile corrisponde ai criteri di ricerca</p>`.

### Dettaglio (NON usa `<table>` — parser diverso!)
`https://www.proprieta.intesasanpaolo.com/ID<numero>`
- **Nessun `__NEXT_DATA__`, nessun JSON-LD, nessuna `<table>`.**
- Dati in **coppie di `<p>` fratelli**: `Tipologia` / `Comune` / `Indirizzo` / **`Valore`** / `Superficie`.
  Il prezzo si chiama **VALORE**, non PREZZO.
- `<title>`: `Deposito in vendita a Casalecchio di Reno - rif. IT037011000015`.
  Il **rif. IT…** è un identificativo stabile → utile al **dedup cross-portale**.
- Descrizione sotto `<p>Descrizione</p>`, troncata dal toggle "Leggi di più".
- Brochure PDF su `media.getrix.it` (perizia: dati tecnici assenti dal sito).
- Mappa + POI (Supermercati/Farmacie/Scuole/Ristoranti/Bar/ATM) e calcolo percorso.
- **Non espone locali / camere / bagni / piano** → per un eventuale residenziale le
  camere si ricavano dalla descrizione; senza camere niente BIG/SMA (fail-closed).
- "Torna alla ricerca" è `javascript:window.close()` → **non usarlo per navigare**.

## Gotcha implementativi
1. **Banner iubenda** `#iubenda-cs-banner` intercetta i click → rimuovere via JS
   prima di ogni interazione.
2. Dopo `goto` servono ~2200-3500 ms perché contatore e card si popolino.
3. **Falso positivo CAPTCHA**: il footer di *ogni* pagina recita "Questo sito è
   protetto da reCAPTCHA". Il `checkBlocked` condiviso cerca `/captcha/i` nel testo
   e **abortirebbe ogni dettaglio**. L'adapter usa un `checkPage` locale che
   verifica solo il blocco reale (HTTP 403/429, "accesso negato", iframe challenge,
   assenza dei dati attesi) — resta **fail-closed**, nessun CAPTCHA viene risolto.
4. `innerText` in mojibake nell'ispezione manuale (`€`→`â‚¬`, `m²`→`m`): il parsing
   numerico dell'adapter usa solo cifre/punti/virgole, quindi non ne risente.

## Adapter
- [adapter.mjs](./adapter.mjs) + [scrape.mjs](./scrape.mjs), modello `casadaprivato`.
- `collectListings`: itera i 6 `?comune=<ISTAT>` con paginazione `/immobili/pag-N`;
  scarta venduti, tipologie non residenziali (whitelist) e prezzi > 160k.
- `scrapeDetail`: parser a coppie `<p>` con label **VALORE**; `prezzo < 15000 → null`.
- Esecuzione verificata: `node intesasanpaolo/scrape.mjs --headless --no-poi --no-geocode`
  → **0 annunci, 5 scartati come non residenziali** (coerente con la ricognizione manuale).
- Parser di dettaglio verificato singolarmente su `ID191839614`
  ([probe/test-detail.mjs](./probe/test-detail.mjs)): prezzo 65000, mq 96, indirizzo,
  rif. e brochure estratti correttamente.

## Decisione
**Resta DEFERRED.** Promuoverlo ad ACTIVE aggiungerebbe un portale a resa nulla.
Il motivo del differimento cambia però natura: da "aste fuori criteri" (sbagliato)
a **"scrapeable e pronto, ma patrimonio non residenziale nell'area target"**.
Da riesaminare solo se Intesa dismette patrimonio abitativo a Bologna.

## FLIP
Nessuna valutazione possibile oggi: zero immobili residenziali.
Se in futuro comparissero appartamenti, l'assenza di locali/camere/piano dal sito
renderebbe **obbligatoria la lettura della brochure PDF** prima di stimare il ROI RENO.
