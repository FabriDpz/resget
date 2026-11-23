# Requisiti — Scraping Immobiliare.it e architettura multi-portale

> Requisiti raccolti nella sessione del 14/11/2026, mantenuti aggiornati.
> Cartella di lavoro: `C:\AI\radar-new\immobiliare.it` (portale di riferimento).
>
> **Questo documento è la fonte di verità dei requisiti.** Le regole immobiliari
> (§2, §2bis, §2ter, §2quater, §2quinquies) e di processo (§5–§8) sono
> **indipendenti dal sito** e implementate nel modulo condiviso `core/`:
> per applicare lo scraping ad altri portali si riusano tali sezioni e si
> riscrive solo l'adattatore specifico (§4, §9, §10).
>
> **Architettura multi-portale (aggiunta 15/11/2026):** 25 portali censiti,
> ciascuno con cartella propria e `strategia.md`. Il modulo `core/` centralizza
> criteri BIG/SMA, POI, FLIP e **deduplicazione cross-portale**. Il sito unificato
> (`build-site.mjs` → `site/`) presenta una sezione **GLOBAL** con gli annunci
> deduplicati e le statistiche flip. Vedi [DECISIONI.md](../DECISIONI.md) per le
> decisioni automatiche e lo stato dei portali.

## 1. Obiettivo

Scaricare i dati degli annunci di vendita di Immobiliare.it e rappresentarli in
una **webapp statica locale** (unica interfaccia di analisi; l'export Excel è
stato abbandonato su richiesta dell'utente),
partendo dalla ricerca salvata dell'utente e visitando **ogni singolo annuncio**,
con comportamento da utente normale (browser reale, ritmo umano), automatizzabile
con un comando unico e credenziali in variabili d'ambiente.

## 2. Criteri di ricerca (immobili) — due profili: BIG e SMA

Due ricerche indipendenti con gli stessi vincoli qualitativi; differiscono solo
per **budget**, **camere da letto** e **locali minimi** (scelte confermate
dall'utente). Un annuncio viene valutato rispetto a **entrambi** i profili.

| Criterio | BIG | SMA |
|---|---|---|
| Contratto | Vendita (`idContratto=1`) | = BIG |
| Categoria | Case / Appartamenti (`idCategoria=1`) | = BIG |
| Budget massimo | **€ 160.000** | **€ 130.000** |
| Camere da letto | **minimo 2 camere reali, verificate sulla planimetria** (§2ter) | **esattamente 1 camera reale, verificata sulla planimetria** (§2ter); in un monolocale il vano unico vale come camera **solo se ≥55 m² e la superficie è dichiarata** |
| Locali minimi | 2 (bilocali solo se convertibili, §2bis) | **1 — anche monolocali ≥55 m²** |
| Tipo proprietà | Piena proprietà (`ownershipTypes[0]=1`) | = BIG |
| Stato immobile | Buono stato / abitabile oppure da ristrutturare | = BIG |
| Superficie minima | 55 m² (`superficieMinima=55`) | = BIG |
| ↳ implementazione | `minSuperficie: 55` su entrambi i profili in `core/filters.mjs`. Se la superficie **non è dichiarata** l'annuncio non è escluso per la soglia (dato mancante ≠ violazione accertata), ma il monolocale non viene contato come camera. Test: `test-superficie.mjs`. | = BIG |
| Bagni | almeno 1 (`bagni=1`) | = BIG |
| Aste | escluse (`noAste=1`) | = BIG |
| Piano | **esclusi seminterrati** (filtro sul campo "Piano" del dettaglio) | = BIG |
| Destinazione d'uso | **solo residenziale (appartamenti/case)** — esclusi uffici/studi (A/10), negozi (C/1), magazzini (C/2), laboratori (C/3), ecc. | = BIG |
| Nuda proprietà | **esclusa** (piena proprietà richiesta) | = BIG |
| Immobili locati | **ammessi** (anche se affittati/non liberi: nessun filtro sull'occupazione; scelta esplicita dell'utente) | = BIG |
| Comune | **solo Bologna, San Lazzaro di Savena, Pianoro** (whitelist sul campo "comune" del dettaglio) | = BIG |
| Distanza dai centri abitati | **≤ 3 km in linea d'aria** dal centro abitato più vicino (`--max-km`) | = BIG |
| Rank POI (vicinanza servizi) | **≥ 35/100** (§2quater, `--min-poi`) | = BIG |

**Priorità BIG** (scelta esplicita dell'utente): un annuncio **Selezionato BIG
non compare nella vista SMA**. Il pool SMA è l'insieme degli annunci target NON
selezionati dal BIG, valutati con i criteri SMA. Partizione risultante:
`Selezionati BIG + Selezionati SMA + Esclusi SMA = tutti gli annunci target`.
Nel JSON entrambi gli esiti sono comunque calcolati e salvati.

## 2bis. Regole di filtro trasversali (valide su QUALSIASI sito)

Queste regole vanno applicate **sul dettaglio di ogni annuncio**, non solo sui
filtri di ricerca del sito: i portali spesso etichettano male gli annunci
(es. "appartamento" che in realtà è un ufficio accatastato A/10, o "intera
proprietà" con nuda proprietà dichiarata solo in descrizione).

1. **Solo uso residenziale.** Escludere se:
   - la tipologia dichiarata è ufficio/studio/negozio/capannone/laboratorio/magazzino;
   - la descrizione contiene frasi riferite **all'unità in vendita** come
     "accatastato ufficio", "licenziata ad uso ufficio", "studio professionale",
     "categoria catastale A/10, B/…, C/1, C/2, C/3, D/…, E/…", "cambio d'uso";
   - **eccezioni (non escludere)**: la parola "ufficio" nei contatti dell'agenzia
     ("Ufficio TEMPOCASA…", "appuntamenti in ufficio"), un singolo vano accessorio
     ("vano ufficio", cantina/box accatastati C/…, vano di deposito), categorie
     residenziali A/1–A/9 e A/11.
2. **Nuda proprietà esclusa** anche se dichiarata solo nella descrizione
   (regex `nuda proprietà` su tipologia + descrizione).
3. **Seminterrati/interrati esclusi** dal campo Piano strutturato (non dalla
   descrizione: una cantina al seminterrato non squalifica l'appartamento).
4. **Bilocali (solo profilo BIG)**: solo se convertibili in trilocali (regola
   §2), con motivazione. Per SMA i bilocali con 1 camera reale sono l'obiettivo
   della ricerca: nessuna regola di convertibilità.
5. **Camere da letto reali verificate sulla planimetria** (§2ter): BIG richiede
   **≥ 2**, SMA **esattamente 1**. Il numero dichiarato dall'annuncio può essere
   gonfiato (es. trilocale dichiarato con 2 camere che in planimetria ne ha
   1 sola). Il dato verificato prevale sempre su quello dichiarato.
6. Ogni esclusione riporta la **motivazione testuale** (con citazione della frase
   rilevata quando il filtro deriva dalla descrizione).
7. Quando i filtri cambiano, si **riapplicano ai dati già raccolti** (JSON) senza
   ri-scraping, rigenerando JSON e sito (`--reapply-filters --resume <json>`).
8. **Whitelist comuni**: accettare solo annunci il cui campo strutturato "comune"
   è esattamente Bologna, San Lazzaro di Savena o Pianoro. I poligoni di ricerca
   dei portali sbordano nei comuni limitrofi (Castenaso, Bentivoglio, Ozzano…):
   il filtro va applicato sull'annuncio, non fidarsi dell'area di ricerca.
9. **Vicinanza ai centri abitati**: l'annuncio deve trovarsi entro **3 km in linea
   d'aria** (haversine) da almeno un centro abitato di riferimento (capoluogo o
   frazione principale abitata). Serve a scartare case isolate in campagna
   (es. Tazzola, Livergnano) pur restando nel comune giusto.
   - Coordinate annuncio: dal JSON del dettaglio (`location.latitude/longitude`);
     per JSON già raccolti senza coordinate: `--enrich` (rivisita le pagine) oppure
     `node geocode-nominatim.mjs <json>` (geocoding indirizzo→via→microzona su
     OpenStreetMap, max 1 req/s; accetta solo risultati a livello via/località,
     mai il centroide del comune).
     Se le coordinate restano mancanti, l'annuncio è escluso come "distanza non
     verificabile".
   - Elenco centri di riferimento (verificati su OpenStreetMap/Nominatim):
     Bologna centro, Borgo Panigale, Santa Viola, Corticella,
     San Lazzaro di Savena, Idice, Cicogna,
     Pianoro, Pianoro Vecchio, Rastignano, Carteria di Sesto.
   - Le località isolate NON sono centri di riferimento.
   - Nel sito: centro abitato più vicino e distanza in km nel dettaglio annuncio.

### Regola bilocali / trilocali (solo profilo BIG)

- Escludere i **bilocali** (2 locali) **a meno che** non siano **convertibili in trilocali**.
- La convertibilità si valuta da descrizione e caratteristiche (es. soggiorno ampio,
  cucina abitabile separata, possibilità di ricavare una seconda camera, diciture
  esplicite "possibilità terza camera", "trasformabile in trilocale", ecc.).
- I bilocali convertibili vanno marcati con flag e motivazione; quelli non convertibili esclusi.
- Trilocali e superiori: inclusi se rispettano gli altri criteri.
- **SMA**: la regola non si applica. Un bilocale con 1 camera reale verificata
  (e prezzo ≤130k) è un candidato SMA; un monolocale ≥55 m² vale come 1 camera
  (vano unico). Immobili con 2+ camere reali sono esclusi da SMA ("esattamente 1").

## 2ter. Verifica delle camere da letto sulla planimetria (valida su QUALSIASI sito)

Il numero di camere dichiarato dall'annuncio **non è affidabile**: un "trilocale"
può avere in realtà **1 sola camera da letto** (le altre stanze sono soggiorno,
cucina, studio). Caso guida: annuncio `132011714`, dichiarato trilocale con
2 camere, ma la planimetria mostra **1 sola camera** → escluso.

**Regola**: per ogni annuncio si verifica il numero **reale** di camere da letto
guardando la **planimetria**, e quel dato prevale sul numero dichiarato.

1. **Fonte della planimetria** (in ordine di priorità):
   - campo strutturato `multimedia.floorplans[]` del dettaglio (URL + caption);
   - in mancanza, **foto con caption "Planimetria"** tra `multimedia.photos[]`
     (alcuni annunci la caricano come foto, non come floorplan);
   - se la planimetria mostra **solo un piano** (es. piano terra senza camere),
     le camere degli altri piani si confermano dalle **foto captionate
     "Camera da letto"** (camere distinte = letti/arredi/soffitti diversi).
2. **Conteggio visivo**: si contano le stanze da letto effettive (letto matrimoniale
   o singolo, oppure stanza etichettata "camera"). **Non** si contano: soggiorno,
   cucina, tinello, studio/ufficio, ripostiglio, cantina, bagno, soppalco non
   abitabile. Le planimetrie "render 3D" e i progetti valgono quanto quelle tecniche.
3. **Esito**:
   - se le camere reali verificate sono **< del minimo** (default 2) → **escluso**,
     con motivazione `Planimetria: N camera/e da letto reali (dichiarate M, min K)`;
   - se la planimetria rivela un **uso non residenziale** (uffici, negozio, studio
     professionale: 0 camere) → escluso anche per uso (§2bis.1);
   - se la planimetria è etichettata **seminterrato** → escluso (§2bis.3).
4. **Planimetria assente**: se non c'è né floorplan né foto-planimetria, il numero
   camere **non è verificabile**: si usa il dato dichiarato e si annota
   "Planimetria non disponibile" (nessuna esclusione automatica per questo motivo).
5. **Campi dati aggiuntivi** per ogni annuncio:
   - `planimetriaUrl`: URL della planimetria usata per la verifica (o vuoto);
   - `camerePlanimetria`: numero di camere reali verificato (null se non verificabile);
   - `notaPlanimetria`: nota testuale della verifica (stanze viste, piano, eventuali
     foto di supporto, oppure "non disponibile").
6. **Campi dedicati visibili nel sito**: camere da planimetria, nota
   planimetria e immagine della planimetria nel dettaglio annuncio, accanto
   alle "Camere da letto" dichiarate (colonna della tabella).
7. **Come si esegue la verifica**: il conteggio visivo è fatto dall'assistente
   (host/AI) che guarda le immagini scaricate dal CDN del portale — **nessun
   servizio esterno a pagamento, nessuna API di vision di terze parti**. Le
   immagini delle planimetrie sono pubbliche e scaricabili direttamente dal CDN
   (che non applica i blocchi anti-bot delle pagine HTML). Il risultato della
   verifica è persistito nel JSON (`camerePlanimetria`/`notaPlanimetria`) così che
   `--reapply-filters` lo riusi senza dover riguardare le immagini.

## 2quater. POI e rank di vicinanza (OpenStreetMap — valido su QUALSIASI sito)

Per ogni immobile si censisce la distanza dai principali punti di interesse
(POI) e si calcola un **rank di vicinanza 0–100**, usato sia come informazione
sia come filtro (**rank minimo 35**, etichetta "Discreto"; `--min-poi`).

1. **Fonte dati**: OpenStreetMap via **Overpass API** (gratuita, senza chiave).
   Una sola query sul bounding box dei comuni target + buffer 3 km — MAI una
   query per annuncio. User-Agent identificativo, timeout 120 s, retry con
   backoff su 429/504, endpoint di fallback. **Cache locale obbligatoria**
   (`output/poi-cache.json`, TTL 30 giorni, `--refresh` per forzare).
2. **Tassonomia** (8 categorie pesate, configurabile in `poi-config.mjs`):
   | Categoria | Tag OSM | Peso |
   |---|---|---|
   | Trasporto pubblico | `railway=station/halt/tram_stop`, `highway=bus_stop`, `public_transport=station` | 3 |
   | Spesa alimentare | `shop=supermarket/convenience` | 3 |
   | Scuola | `amenity=school/kindergarten` | 3 |
   | Salute | `amenity=pharmacy/hospital/clinic/doctors` | 2 |
   | Verde e sport | `leisure=park/fitness_centre/sports_centre` | 1 |
   | Ristorazione e bar | `amenity=cafe/restaurant` | 1 |
   | Servizi | `amenity=bank/post_office`, `shop=mall` | 1 |
   | Cultura e tempo libero | `amenity=library/cinema/theatre` | 1 |
   Le fermate bus sono **incluse** (scelta esplicita dell'utente): i rank degli
   immobili urbani tendono quindi ad essere alti; il rank discrimina soprattutto
   le località isolate.
3. **Distanza**: linea d'aria (haversine), coerente con il filtro §2bis.4.
   LIMITE NOTO: non è il percorso reale (fiumi/colline possono allungarlo);
   accettabile per un rank comparativo tra immobili.
4. **Punteggio categoria**: 100 se il POI più vicino è ≤ 300 m, decadimento
   lineare fino a 0 a 2 km. Per ogni categoria si registra distanza (m) e nome
   del POI più vicino.
5. **Rank** = media pesata dei punteggi categoria (pesi della tabella), 0–100.
   Etichette: **Ottimo ≥ 75 / Buono ≥ 55 / Discreto ≥ 35 / Scarso < 35**.
6. **Filtro**: rank < 35 → escluso con motivazione
   "Rank POI insufficiente: X/100 (minimo 35)". Il filtro è attivo solo quando
   il campo `poi` è presente nel JSON (run senza censimento POI invariati).
   Annunci senza coordinate: POI non calcolabile (già esclusi per distanza
   non verificabile).
7. **Persistenza**: campo `poi` per annuncio nel JSON (distanze, nomi, punteggi,
   rank, etichetta) → rielaborabile offline con `--reapply-filters`.
8. **Esecuzione**: `node poi.mjs --resume output\annunci-….json [--refresh]`
   → calcola il rank, aggiorna il JSON e rigenera il sito.

## 2quinquies. Analisi FLIP: RENO e STALE (valide su QUALSIASI sito)

Oltre alla selezione per residenza (BIG/SMA), ogni annuncio dei comuni target
riceve un'analisi di opportunità **flip** (compra → valorizza → rivendi),
indipendente dagli esiti BIG/SMA. Parametri economici e override in
`flip-config.mjs`; logica in `flip.mjs`; risultato nel campo `flip` del JSON
(`flip.reno` + `flip.stale`). **Tutti i margini sono stime indicative, non perizie.**

### FLIP RENO (ristruttura e rivendi)

1. **Pool candidati**: stato "Da ristrutturare"; in più "Buono/Abitabile"
   (e affini) SOLO se il prezzo/m² è scontato ≥ **15%** vs il valore di zona
   (scelta utente). Esclusi a priori: seminterrati, nuda proprietà,
   "da demolire"/cattivo stato, uso non residenziale (stessa detection dei
   filtri §2bis).
2. **ARV (valore dopo i lavori, €/m²)**, catena di priorità:
   override manuale di sottozona → override comunale → mediana dei comparabili
   "buono stato" della sottozona (≥3) → mediana comunale buono stato (≥3) →
   mediana della sottozona tutti-gli-stati → mediana comunale → non stimabile.
   Sottozona = parte dopo l'ultimo "/" del campo zona. Gli override iniziali
   derivano dalle mediane del dataset e dalle quotazioni OMI indicative:
   **vanno affinati dall'utente con dati reali** (fonte ARV sempre tracciata).
3. **Costi**: lavori 600 €/m² (ristrutturazione) o 150 €/m² (restyling per il
   buono stato); imposta di registro 9% su valore catastale stimato
   (500 €/m² × superficie, min. 1.000 €); notaio 2.500 €; agenzia 3% del prezzo;
   holding + rivendita 1.500 €.
4. **Conto economico**: capitale = prezzo + lavori + costi accessori;
   margine lordo = ARV totale − capitale; plusvalenza 26% sul lordo (se > 0);
   margine netto = lordo − plusvalenza; **ROI netto = netto / capitale**.
5. **Semaforo**: VERDE ROI ≥ 20%, GIALLO ≥ 10%, ROSSO sotto.
6. **Offerta massima**: prezzo d'acquisto che garantisce ROI netto ≥ 20%
   a parità di ARV e costi (formula inversa, arrotondata ai 1.000 €).
   È il numero operativo per la trattativa.

### FLIP STALE (annunci fermi, venditori motivati)

1. **Score 0–100** = giorni online (max 40 pt, lineare fino a 180 giorni,
   da `pubblicatoIl`) + ribassi prezzo osservati (15 pt/ribasso, max 30) +
   keyword da venditore motivato nel titolo/descrizione (10 pt/keyword, max 30:
   trattabile, urgente, successione, erede, trasferimento, libero subito,
   occasione, ribassato, da vedere, vendita rapida).
2. **Storico prezzi obbligatorio**: `output/prezzi-storico.json`
   ({id: [{data, prezzo}]}), aggiornato a ogni run/scraping/reapply; una voce
   per giorno, registrati solo i cambi. I ribassi si vedono solo rieseguendo
   lo scraping nel tempo (il sito non espone lo storico).
3. **Fasce di negoziabilità**: Alto ≥ 60, Medio ≥ 35, Basso sotto.
4. **Prezzo target suggerito**: sconto sul richiesto del 18% (Alto),
   10% (Medio), 5% (Basso), arrotondato ai 1.000 €. Punto di partenza
   per l'offerta, non un valore di perizia.
5. Lo score STALE è calcolato per TUTTI gli annunci target (anche non
   candidati RENO): un annuncio fermo può essere un affare a prescindere
   dai lavori.

## 3. Area geografica

1. **Bologna**: area disegnata dall'utente nella ricerca salvata (poligono `vrt`, vedi §4).
2. **Pianoro** (comune) — da aggiungere.
3. **San Lazzaro di Savena** (comune) — da aggiungere.

Unire i risultati delle tre aree e **deduplicare per ID annuncio**.

## 4. Ricerca salvata di partenza

L'utente ha una ricerca salvata sul proprio account (salvata il 29/10/2026,
"Avvisi Immediati" attivi, id ricerca `183235176`). URL completo:

```text
https://www.immobiliare.it/search-list/?idCategoria=1&idContratto=1&idNazione=IT&prezzoMassimo=160000&stato=5&bagni=1&superficieMinima=55&localiMinimo=2&tipoProprieta=1&noAste=1&pag=1&vrt=44.519129%2C11.229828%3B44.523463%2C11.251906%3B44.509516%2C11.257427%3B44.510116%2C11.267407%3B44.497753%2C11.269748%3B44.482524%2C11.258946%3B44.47815%2C11.287022%3B44.445016%2C11.294923%3B44.436448%2C11.308169%3B44.420691%2C11.310881%3B44.413699%2C11.293766%3B44.400256%2C11.30766%3B44.395161%2C11.301711%3B44.402707%2C11.276586%3B44.391475%2C11.265938%3B44.391107%2C11.300454%3B44.374176%2C11.301676%3B44.362932%2C11.287037%3B44.365856%2C11.306805%3B44.385201%2C11.310101%3B44.388501%2C11.319999%3B44.340158%2C11.320347%3B44.338203%2C11.33539%3B44.351075%2C11.339726%3B44.35307%2C11.350413%3B44.366377%2C11.344044%3B44.377596%2C11.365422%3B44.389486%2C11.35941%3B44.395125%2C11.394233%3B44.414891%2C11.395858%3B44.419917%2C11.414876%3B44.434177%2C11.40716%3B44.446221%2C11.415161%3B44.424077%2C11.438552%3B44.44513%2C11.473624%3B44.461404%2C11.464522%3B44.465211%2C11.471944%3B44.425302%2C11.615819%3B44.465874%2C11.493371%3B44.482222%2C11.483221%3B44.5027%2C11.491507%3B44.527779%2C11.457688%3B44.545155%2C11.453325%3B44.547944%2C11.439928%3B44.559666%2C11.432258%3B44.553702%2C11.420047%3B44.566882%2C11.412304%3B44.56859%2C11.395973%3B44.574941%2C11.391446%3B44.583365%2C11.404141%3B44.632007%2C11.426198%3B44.565632%2C11.381013%3B44.556303%2C11.336398%3B44.543785%2C11.334582%3B44.531244%2C11.31484%3B44.54106%2C11.307288%3B44.531185%2C11.293092%3B44.531966%2C11.261488%3B44.519129%2C11.229828&id=183235176&imm_source=bookmarkricerche
```

Parametri effettivi dopo il redirect del sito:
`idContratto=1&idCategoria=1&prezzoMassimo=160000&superficieMinima=55&localiMinimo=2&bathrooms[0]=1&ownershipTypes[0]=1&noAste=1&__lang=it` + `vrt`.

**Raccolta come superset BIG+SMA**: lo script usa gli stessi URL ma con
`localiMinimo=1` (anziché 2) per includere anche i monolocali ≥55 m² candidati
SMA; il budget resta 160k (il tetto più alto, BIG). I criteri per profilo
(§2: prezzo, camere, locali) sono applicati **lato script sul dettaglio di ogni
annuncio**, non delegati ai parametri URL — la fonte di verità è questo documento.
La ricerca salvata dell'utente sul sito resta quella originale (localiMinimo=2).

Al momento della sessione: **27 risultati su 2 pagine** (25 annunci in pagina 1).
Il numero varierà nel tempo; lo script deve gestire il paging dinamicamente.
Il titolo della ricerca ("Case con 1 bagno…") riflette il filtro bagni=1.

## 5. Dati da estrarre — entrando in OGNI annuncio

Per ogni annuncio aprire la pagina di dettaglio (`https://www.immobiliare.it/annunci/<id>/`)
ed estrarre tutte le sezioni:

### 5.1 Caratteristiche
Tipologia (es. "Trilocale | Intera proprietà | Classe immobile media"), Contratto,
Piano, Piani edificio, Ascensore, Superficie, Locali, **Camere da letto**, Cucina,
Bagni, Arredato, Balcone, Terrazzo, Riscaldamento.

### 5.2 Altre caratteristiche (chip/tag)
Es. "Esposizione doppia", "Infissi esterni in doppio vetro / PVC",
"Impianto tv centralizzato", cantina, ecc.

### 5.3 Dettaglio superficie (per ogni unità: Abitazione, Box, ecc.)
Piano, Superficie (m²), Coefficiente (%), Tipo superficie (Principale/Accessoria),
Sup. commerciale (m²).

### 5.4 Informazioni sul prezzo
Prezzo (€), Prezzo al m² (€/m²).

### 5.5 Dettaglio dei costi
Spese condominio (es. "Nessuna spesa condominiale" o importo).

### 5.6 Efficienza energetica
Stato immobile (es. "Da ristrutturare", "Buono / Abitabile"), Riscaldamento,
Certificazione energetica (classe APE, es. "Esente", "G", ecc.).

### 5.7 Altro
- Titolo annuncio e indirizzo/zona (comune, macrozona, microzona)
- **Coordinate lat/lon** (`location.latitude/longitude`) → centro abitato più
  vicino e distanza in km (dettaglio annuncio nel sito)
- Descrizione completa (testo integrale)
- Agenzia / inserzionista (nome)
- ID annuncio, URL, data aggiornamento annuncio, data di scraping
- URL della prima foto (opzionale)
- **Planimetria**: URL (`planimetriaUrl`), camere reali verificate
  (`camerePlanimetria`) e nota di verifica (`notaPlanimetria`) — vedi §2ter

## 6. Output

> L'export Excel è stato **abbandonato su richiesta dell'utente**: la webapp è
> l'unica rappresentazione dei dati. Il JSON resta il formato dati/backup.

- **Webapp statica locale — unica interfaccia di analisi**
  (`site/index.html`, doppio clic, nessun server):
  - Dashboard con KPI cliccabili; viste **BIG / SMA / FLIP RENO / FLIP STALE /
    Tutti gli annunci target**.
  - Menu a sinistra multi-portale: Immobiliare.it attivo; Idealista e Casa.it
    segnaposto "in arrivo" (per future fonti dati).
  - Ricerca testuale, filtri zona/stato + filtro specifico per vista
    (Esito BIG, Esito SMA, Semaforo RENO, Negoziabilità STALE), ordinamento
    per colonna, righe espandibili con **dettaglio completo** (foto,
    planimetria + verifica camere, POI, conto economico RENO, breakdown score
    STALE, caratteristiche, descrizione, link all'annuncio
    `https://www.immobiliare.it/annunci/<id>/`).
  - **Export CSV** della vista corrente (righe filtrate e ordinate, colonne
    visibili + link annuncio; separatore `;` e BOM UTF-8, apribile in
    Excel/LibreOffice): sostituisce la funzione tabellare del vecchio xlsx
    senza reintrodurre l'Excel nella pipeline.
  - Generato da `build-site.mjs` (sorgenti in `site-src/`, dati incorporati in
    `site/data.js` per funzionare da `file://`). Rigenerato automaticamente a
    fine di ogni run/reapply/enrich/rebuild-site.
- **Vista BIG**: tutti gli annunci dei 3 comuni target con colonna Esito BIG
  (Selezionato/Escluso) e motivazione; ordinamento di default €/m² crescente.
  I bilocali convertibili in trilocali sono Selezionati (§2bis).
- **Vista SMA**: pool SMA = annunci target NON selezionati dal BIG (priorità
  BIG, scelta dell'utente), con Esito SMA (≤130k, esattamente 1 camera reale,
  anche monolocali ≥55 m²) e motivazione SMA. Il campo "Convertibile in
  trilocale" (concetto solo BIG) è mostrato solo nel dettaglio dove rilevante.
- **Partizioni**: Selezionati BIG + Esclusi BIG = tutti gli annunci dei 3
  comuni target; Selezionati BIG + Selezionati SMA + Esclusi SMA = stesso
  insieme. Nessuna vista per comune (il comune/zona resta filtrabile).
- **Solo i 3 comuni target nella webapp**: gli annunci di altri comuni restano
  nel JSON grezzo (backup) ma NON compaiono in alcuna vista.
- **Rank POI solo sui Selezionati**: la colonna `Rank POI` (§2quater) è
  valorizzata solo per le righe Selezionato BIG/SMA. NON esiste una vista
  dedicata ai POI (rimossa su richiesta dell'utente). Il dettaglio completo
  (distanze e nomi per categoria) è nel pannello di dettaglio e nel campo
  `poi` del JSON grezzo.
- **Vista FLIP RENO**: solo i candidati (§2quinquies), ordinata per ROI netto
  decrescente. Prima colonna **Esito** (VERDE/GIALLO/ROSSO con badge colorato),
  poi ROI netto, margine netto, offerta max, dati annuncio, sconto vs zona,
  ARV, lavori. Il dettaglio espanso mostra il conto economico completo
  (ARV €/m² e totale, fonte ARV, lavori, costi accessori, capitale, plusvalenza).
- **Vista FLIP STALE**: tutti gli annunci target, ordinata per score
  decrescente. Prima colonna **Negoziabilità** (fascia Alto/Medio/Basso con
  badge colorato), poi score, giorni online, ribassi osservati, prezzo target
  suggerito, eventuale candidabilità RENO. Il dettaglio espanso mostra il
  breakdown dello score (keyword incluse).
- Backup dati grezzi in JSON (per rielaborazioni senza ri-scraping): contiene
  TUTTI gli annunci raccolti, anche quelli dei comuni non target.
- **Storico prezzi**: `output/prezzi-storico.json` (§2quinquies), base per il
  rilevamento dei ribassi tra run successivi.

## 7. Login e credenziali

- L'utente effettua il login con il **proprio account** (email o Google/Apple/Facebook).
- Le credenziali vanno salvate in **variabili d'ambiente** (mai nel codice o nel repo):
  - `IMMOBILIARE_EMAIL`
  - `IMMOBILIARE_PASSWORD`
- Strategia:
  1. Primo login manuale (o assistito) con browser persistente → salvataggio sessione
     (profilo utente dedicato / storage state) per i run successivi.
  2. Run automatici: riuso della sessione; se scaduta, tentativo di re-login con le
     variabili d'ambiente. Se il sito richiede OTP/magic-link o login social,
     fallback a login manuale interattivo (`npm run login`).
- Nessun segreto committato; `.gitignore` per profilo browser, storage state e output.

## 8. Comportamento "utente normale"

- Browser reale con Playwright (Chromium headed di default), viewport e lingua it-IT.
- Profilo persistente dedicato (cookie/sessione come un utente di ritorno).
- Navigazione con **pause casuali** tra le azioni (2–6 s), scroll graduale delle pagine
  (le sezioni del dettaglio sono lazy-load), attesa dei contenuti prima dell'estrazione.
- Paging naturale: click su "Successiva" / link di pagina, non URL forzati in raffica.
- Limiti di cortesia: ~1 annuncio ogni 5–10 s, tetto di annunci per run configurabile.
- Gestione banner cookie ("Continua senza accettare").
- Se compare CAPTCHA / blocco / 403: **stop graceful** con messaggio, nessun aggiramento
  delle protezioni anti-bot.
- Rispetto dei ToS: scraping personale, non massivo, dei soli annunci pubblici.

## 9. Tecnologia e automazione

- **Node.js + Playwright** (Node v24, npm 11 disponibili su questa macchina).
- Rappresentazione dati: **webapp statica** (nessuna dipendenza di export;
  `exceljs` rimosso insieme all'export Excel).
- Comando unico: `npm run scrape` (opzioni: `--headless`, `--max-ads N`, `--only <area>`,
  `--url <url ricerca>`, `--min-bedrooms N` default 2 (override camere minime
  del profilo BIG),
  `--resume output\annunci-….json` per completare un run interrotto,
  `--rebuild-site --resume <json>` per rigenerare il sito da un JSON senza
  browser (alias storico: `--sort-only`),
  `--reapply-filters --resume <json>` per riapplicare i filtri aggiornati ai dati
  già raccolti e rigenerare JSON + sito senza browser,
  `--enrich --resume <json>` per aggiungere le coordinate agli annunci di un JSON
  che ne è privo (rivisita le pagine con pause umane, poi riapplica i filtri),
  `--max-km N` distanza massima dal centro abitato più vicino, default 3).
- **Doppio esito nel JSON**: ogni annuncio ha `esito`/`motivazione`/`convertibile`
  (profilo BIG) e `esitoSma`/`motivazioneSma` (profilo SMA), calcolati da
  `applyProfiles` a ogni raccolta, `--reapply-filters` ed `--enrich`.
- **Analisi flip nel JSON**: campo `flip` (`reno` + `stale`, §2quinquies),
  calcolato da `flip.mjs` a ogni raccolta, `--reapply-filters`, `--enrich`
  e `--rebuild-site` (se assente). Lo storico prezzi si aggiorna solo nei run
  che raccolgono/rivalutano dati, non nel rebuild-site.
- **Sito**: `node build-site.mjs --resume output\annunci-….json` rigenera
  `site/` da un JSON esistente (default: JSON più recente); invocato anche
  automaticamente da `scrape.mjs`. Modificare gli asset in `site-src/`,
  mai in `site/` (rigenerata).
- **Ordinamento di default delle viste**: BIG/SMA/Tutti per **€/m² crescente**
  (valori mancanti in fondo), FLIP RENO per ROI netto decrescente, FLIP STALE
  per score decrescente; ogni colonna è riordinabile con un clic.
- **Il login NON è necessario**: ricerche e annunci sono pubblici; lo script parte
  come ospite di default. L'URL della ricerca salvata contiene già tutti i filtri.
- Login assistito: `npm run login`.

### Setup una tantum

```powershell
cd C:\AI\radar-new\immobiliare.it
npm install
npx playwright install chromium
# credenziali (opzionali ma consigliate per l'automazione):
[Environment]::SetEnvironmentVariable('IMMOBILIARE_EMAIL', 'la-tua-email', 'User')
[Environment]::SetEnvironmentVariable('IMMOBILIARE_PASSWORD', 'la-tua-password', 'User')
npm run login   # primo login: sessione salvata nel profilo persistente
```

### Esecuzione ricorrente

```powershell
cd C:\AI\radar-new\immobiliare.it
npm run scrape                    # tutte le 3 aree, browser visibile
npm run scrape -- --headless      # senza finestra (per automazione/scheduler)
npm run scrape -- --max-ads 50    # limita gli annunci per run
npm run scrape -- --only pianoro  # una sola area (bologna / pianoro / san lazzaro)
```

- Senza credenziali lo script procede **come ospite**: i dati degli annunci sono
  pubblici; il login serve solo a partire dalla ricerca salvata dell'account.
- Output con timestamp in `output/`: `annunci-AAAA-MM-GG-HH-MM.json`
  (backup incrementale salvato dopo ogni annuncio; Ctrl+C salva comunque).
  I JSON storici restano come backup dati; il sito (`site/`) mostra sempre
  l'ultimo JSON elaborato. Nessun file `.xlsx` viene più generato.
- Struttura cartella:

```text
immobiliare.it/
├── requisiti-immobilare.md   # questo documento
├── package.json
├── scrape.mjs                # script principale (login, listing+paging, dettagli, filtri, sito)
├── poi.mjs / poi-config.mjs  # censimento POI Overpass + rank (§2quater)
├── flip.mjs / flip-config.mjs# analisi FLIP RENO/STALE + parametri (§2quinquies)
├── build-site.mjs            # generatore del sito statico
├── site-src/                 # sorgenti UI del sito (index.html, app.js, style.css)
├── site/                     # sito generato (doppio clic su index.html)
├── .gitignore
├── profile/                  # profilo browser persistente (ignorato da git)
└── output/                   # json + prezzi-storico.json + poi-cache.json
```

## 10. Note tecniche rilevate durante la sessione (specifiche Immobiliare.it)

> Per un nuovo sito: replicare questa analisi (struttura listing, JSON embedded,
> selettori dettaglio) in un nuovo documento/adattatore; le regole §2/§2bis e i
> formati di output §6 restano invariati.

- **Trappole qualità dati riscontrate** (valide come lezione per ogni portale):
  - annunci etichettati "Trilocale/Appartamento | Intera proprietà" che sono in
    realtà **uffici A/10, magazzini C/2, laboratori C/3** → filtro su descrizione;
  - **nuda proprietà** dichiarata solo in descrizione con tipologia "Intera
    proprietà" → filtro su descrizione;
  - la parola "ufficio" compare nei **contatti agenzia** in fondo a quasi tutte
    le descrizioni → i filtri testuali devono ignorare il footer contatti e i
    vani accessori, e citare la frase che ha causato l'esclusione.
  - il **poligono di ricerca sborda nei comuni limitrofi**: annunci di Castenaso,
    Bentivoglio, Ozzano compaiono nella ricerca "Bologna" → whitelist sul campo
    comune del dettaglio;
  - il campo **comune può essere errato anche sul dettaglio** (es. Rastignano
    etichettato "Bologna") → il filtro distanza sulle coordinate è la rete di
    sicurezza geografica;
  - gli annunci in **località isolate** (Tazzola, Livergnano) sono nel comune
    giusto ma a 5+ km dal centro abitato → filtro distanza ≤ 3 km (§2bis.9);
  - **"locale commerciale da trasformare in appartamento"** con tipologia
    "Bilocale" → è un cambio d'uso, non un appartamento: filtro uso (§2bis.1);
  - **numero di camere gonfiato**: "trilocale con 2 camere" che in planimetria ha
    1 sola camera (le altre stanze sono soggiorno/cucina/studio) → verifica visiva
    della planimetria (§2ter); il dato verificato prevale su quello dichiarato;
  - dopo run intensivi il sito può rispondere **HTTP 403 anche alla homepage**
    (blocco temporaneo su IP/profilo): lo script ricrea automaticamente un
    profilo browser vergine; se il blocco persiste, attendere e riprendere con
    `--resume` / `--enrich`, oppure usare il geocoding Nominatim per le sole
    coordinate (non richiede il sito).

- Listing: card in `li.nd-list__item` con attributo `id` = ID annuncio e link
  `a[href*="/annunci/"]`; paginazione con link `?pag=N` e pulsante "Successiva";
  conteggio "N risultati" in pagina.
- Dettaglio: la pagina espone `__NEXT_DATA__` con
  `props.pageProps.detailData.realEstate` — **JSON strutturato completo** (fonte primaria):
  - `id`, `title`, `price.value`, `price.pricePerSquareMeter`, `updatedAt`, `createdAt`
  - `properties[0]`: `rooms`, `bedRoomsNumber`, `bathrooms`, `surface`, `caption`,
    `typologyValue`, `condition` / `conditionId`, `floor.value` / `floor.floorOnlyValue`,
    `floors`, `elevator`, `kitchenStatus`, `features` / `ga4features` (chip),
    `energy.heatingType` / `energy.energyStatus`, `costs.condominiumExpenses`,
    `description`, `location` (address, city, macrozone, microzone, province, region),
    `surfaceConstitution.surfaceConstitutionElements[]` (piano, superficie, %, tipo, commerciale),
    `multimedia.photos[].urls` (+ `caption`: cercare "Planimetria" / "Camera da letto"),
    `multimedia.floorplans[].urls` + `caption` (**planimetrie**, fonte primaria per §2ter)
  - `advertiser.agency.displayName` (agenzia)
- **Planimetrie e CDN immagini**: le planimetrie stanno in `multimedia.floorplans[]`
  (a volte vuote: in quel caso cercare tra le `photos` una con caption "Planimetria").
  Gli URL puntano al CDN (`pic.im-cdn.it/plan/…`, `pwm.im-cdn.it/image/…`) che
  **NON applica i blocchi anti-bot** delle pagine HTML: le immagini si scaricano
  direttamente (anche via `Invoke-WebRequest`/fetch) quando il sito risponde 403.
  Il conteggio delle camere è una verifica visiva (§2ter), persistita nel JSON.
- **`#__NEXT_DATA__` è uno `<script>` NASCOSTO**: `page.waitForSelector('#__NEXT_DATA__')`
  con stato di default `visible` va in timeout; usare `{ state: 'attached' }`
  (oppure `.catch(()=>{})` e procedere: il JSON è comunque nel DOM).
- Fallback DOM (se il JSON manca): tabelle `dl.FeaturesGrid_list__*` con coppie `dt`/`dd`,
  superficie in `dl.SurfaceElement_details__*`.
- Le sezioni sotto la piega sono lazy-load: serve scroll progressivo per il rendering
  (il JSON `__NEXT_DATA__` è comunque disponibile subito).
- `__NEXT_DATA__` del listing NON contiene gli annunci (rendering client-side):
  per la lista si usa il DOM delle card.

## 11. Architettura multi-portale e sezione GLOBAL (aggiunta 15/11/2026)

### 11.1 Struttura
- **25 portali** censiti, ciascuno in una cartella dedicata con `adapter.mjs`
  (se attivo) e `strategia.md` (accesso, dati, BIG/SMA, FLIP, dedup).
- **Modulo condiviso `core/`**:
  - `filters.mjs` — criteri BIG/SMA (fonte di verità, §2/§2bis/§2ter).
  - `enrich.mjs` + `geocode-nominatim.mjs` — POI Overpass, geocode con filtro
    omònimi (`plausible()`, ≤12km dai centri target).
  - `flip.mjs` — analisi RENO/STALE (§2quinquies).
  - `dedup.mjs` — deduplicazione cross-portale (§11.3).
  - `runner.mjs` — orchestrazione scraping headed, backoff, `--resume`/`--reapply-filters`.
  - `poi-cache.json` — cache POI/geocode condivisa tra portali.

### 11.2 Portali per stato
- **Attivi (17)**: immobiliare.it, tempocasa, remax, tecnocasa, tecnorete,
  wikicasa, bakeca, mitula, trovit, caasa, idealista, casa.it, subito,
  attico, trovacasa, casadaprivato, **flatsearch** (aggregatore di 7 portali,
  344 annunci ≤160k sui 6 comuni target: il più ricco; listing pubblico,
  nessuna login — il verdetto iniziale "AI + login" era errato).
- **Differiti (8)**: casaclick (alias wikicasa),
  facebook (Marketplace: 589 card, 0 BIG/SMA), nextdoor (bacheca usato,
  non immobiliare), dovalue (corporate NPL), prelios (0 living a Bologna),
  agenziademanio e invimit (bandi/aste), **intesasanpaolo** (vendita diretta
  patrimonio dismesso, scrapeable con adapter pronto ma **0 residenziale**
  nell'area target → limite di contenuto, non di accesso).
- **Sezione "ASTE & NPL"**: prelios, dovalue, agenziademanio, invimit
  (fuori dai criteri standard, noAste). Intesa Sanpaolo **non** vi appartiene:
  non è un portale aste.

### 11.3 Deduplicazione cross-portale (GLOBAL)
- **Blocking**: stesso comune + fascia prezzo (prezzo/2000).
- **Gate di similarità** (almeno uno): prezzo ±1% + mq ±2%; indirizzo + prezzo
  ±2%; prezzo identico + mq ±5%.
- **Score** base 0.5 + bonus (indirizzo, agenzia, mq); soglia **0.75**.
- **DB condiviso**: tecnocasa↔tecnorete con ID numerico identico → score 1.00.
- **Priorità fonte** (vince a parità): immobiliare > idealista > casa.it >
  wikicasa > subito > attico > agenzie > P2P > aggregatori.
- **Union-find** per raggruppare; ogni annuncio GLOBAL espone `fonti` (portali),
  `duplicati` (rimossi) e `multiPortale` (presente su >1 portale).
- Duplicati reali osservati: tempocasa↔wikicasa (stessa agenzia), relisting
  interno immobiliare.it (stesso prezzo, ID diversi).

### 11.4 Sito unificato
- `build-site.mjs` (root) aggrega i portali attivi, deduplica, genera
  `site/data.js` + copia `site-src/{index,app,style}`.
- **Sezione GLOBAL**: KPI (lordi, duplicati, unici, multi-portale, €/m² mediano),
  breakdown per-portale e per-comune, viste dashboard/BIG/SMA/RENO/STALE/multi/tutti.
- Dettaglio annuncio con tabella fonti ("Presente su" + prezzi per portale).
- Export CSV (BOM, separatore `;`), filtri, ordinamento, info Aste/Differiti.
- **Modificare sempre `site-src/`, mai `site/`** (generato).

### 11.5 Criteri invariati
- I criteri business (§2–§2quinquies) sono **identici** per tutti i portali
  attivi: BIG ≤160k ≥2 camere, SMA ≤130k 1 camera, whitelist comuni, ≤3km centri,
  POI rank ≥35, RENO ROI verde ≥20%, STALE score.
- Le aste/NPL **non entrano** in BIG/SMA/FLIP/dedup standard (modello di vendita
  diverso, prezzo base ≠ prezzo di vendita, rischi legali).