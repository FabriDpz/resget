# DECISIONI AUTOMATICHE — Radar multi-portale

## D1 — Architettura: monorepo con core condiviso

- Root `C:\AI\radar-new` con `core/` (filtri, flip, POI, geocoding, dedup, helper browser) e una cartella per portale.
- `immobiliare.it/` resta funzionante com'è (codice già validato); i nuovi portali usano il core condiviso.
- Un unico sito finale in root `site/` generato da `build-site.mjs` root: nav con GLOBAL + tutti i portali.
- Il sito dentro `immobiliare.it/site/` resta come vista single-portal legacy (rigenerabile), non è più il punto d'ingresso principale.
- Motivazione: non riscrivere ciò che funziona; i moduli flip/POI erano già portale-indipendenti.

## D2 — Criteri identici su tutti i portali

- BIG ≤160k, ≥2 camere reali; SMA ≤130k, 1 camera reale; priorità BIG; whitelist comuni; ≤3km dai centri abitati; POI rank ≥35; solo residenziale; no aste nella ricerca standard; no nuda proprietà; no seminterrati.
- Dove il portale non espone un dato (es. planimetria, date, coordinate), l'annuncio resta **in valutazione**: il filtro corrispondente non inventa dati, viene marcato "non verificabile" e l'esito è deciso dai dati disponibili (fail-open sui dati mancanti, mai fail-closed silenzioso). Le camere non verificate su planimetria sono "dichiarate".
- **ECCEZIONE prezzo (regola utente 22/11/2026): trattative riservate MAI accettate** (di solito nascondono budget fuori scala). Prezzo assente, "trattativa riservata", "prezzo su richiesta/in agenzia" → escluso BIG e SMA con motivazione esplicita (`detectTrattativaRiservata` in core/filters.mjs). Il prezzo è il criterio cardine: qui fail-closed, non "in valutazione".
- **Stato senza margine flip (regola utente 22/11/2026): ottimo/ristrutturato/nuovo MAI nei target.** Un immobile già a posto non offre margine di rivalutazione → escluso BIG e SMA (`detectStatoFlipInutile` in core/filters.mjs) e **nascosto dalle liste del sito** (BIG/SMA/Tutti/Multi/Novità/RENO/STALE in site/app.js). Restano visibili: da ristrutturare, buono/abitabile, da demolire (escluso a parte), stato vuoto = in valutazione (D2).
- Le ricerche server-side usano il superset (≤160k, ≥55m² se supportato, ≥1 locale) e i profili si applicano lato script, come su immobiliare.it.
- **Geocoding profondo (22/11/2026)**: gli annunci "Coordinate non disponibili" si recuperano a 3 livelli (`geocodeAds` in core/enrich.mjs, rilanciabile offline con `node geocode-deep.mjs`): ① tabella frazioni/quartieri **verificata via Nominatim** (`node core/verify-frazioni.mjs` → core/frazione-cache.json; solo place tipizzati suburb/village/hamlet…, comune nel display_name, ≤12 km dai centri; MAI coordinate scritte a mano); ② Nominatim su indirizzo strutturato, indirizzo estratto dal titolo/descrizione (`indirizzoDaTitolo`); ③ zona come place (~±1 km, dichiarato in `geocodeFonte`). Il filtro ≤3 km resta il giudice. Run 22/11: 272/353 recuperati (trovit 174/180), 12 BIG + 3 SMA emersi; i residui sono località di ALTRI comuni (Suviana, Tivoli, Bisano…) listate sotto "Bologna" dall'aggregatore → esclusione corretta.
- **Scheda vuota non valutabile (22/11/2026)**: descrizione assente o <25 caratteri (trovit "RIF") → escluso BIG e SMA, fail-closed come il prezzo. Emersi e corretti anche: seminterrato COME unità in vendita ("vendita ampio seminterrato"), cessione attività commerciale ("Forno in vendita – attività avviata"), comune fuori whitelist nel titolo ("A CASTEL BOLOGNESE").

## D3 — Categorizzazione dei 24 portali (verificata con probe Playwright)

Esiti reali dei probe in `probe-archive/probe-report.json` e nelle `strategia.md` per cartella. Categorie:

| Categoria                    | Portali                                                | Trattamento                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portali generalisti          | idealista, casa.it, wikicasa, subito, attico           | scraping completo BIG/SMA + flip                                                                                                                                                                               |
| Aggregatori                  | trovacasa, trovit, mitula, casaclick(?), flatsearch(?) | scraping se accessibili; in dedup la fonte primaria vince sempre                                                                                                                                               |
| Reti di agenzie              | tecnocasa, tecnorete, tempocasa, remax                 | scraping se accessibili; alto tasso di duplicati atteso                                                                                                                                                        |
| Privati/P2P                  | casadaprivato, bakeca                                  | scraping se accessibili; interessanti per STALE (no provvigione)                                                                                                                                               |
| Login obbligatorio           | facebook marketplace, nextdoor                         | DIFFERITI: nessun aggiramento. Facebook: login fatto → Marketplace scrapeable ma **0 BIG/SMA**. Nextdoor: login **non richiesto**, la fonte è una bacheca di oggetti usati (0 immobili).         |
| Aste/NPL/enti                | prelios, dovalue, agenziademanio, invimit              | fuori dai criteri standard (noAste): sezione dedicata "ASTE & NPL", non entrano in BIG/SMA/RENO/STALE standard                                                                                                 |
| Patrimonio bancario dismesso | proprieta.intesasanpaolo                               | **NON aste giudiziarie** (vendita diretta, "manifestazione di interesse"): entrerebbe nei criteri standard, ma a Bologna il patrimonio è **solo non residenziale** → DEFERRED con adapter pronto |
| Rent-to-buy                  | caasa                                                  | verifica: se non ha listing di vendita, sezione informativa                                                                                                                                                    |

*(la tabella viene aggiornata con gli esiti reali dei probe)*

## D4 — Policy anti-bot (identica per tutti, fail-closed)

- Browser reale Playwright con profilo persistente per portale (`<portale>/profile/`), pause umane 2–6s, ~1 annuncio ogni 5–10s, scroll graduale.
- Cookie banner: "rifiuta/continua senza accettare" quando possibile, altrimenti accetta il minimo.
- CAPTCHA / 403 / 429 / challenge → STOP graceful, salvataggio parziale, nessuna tecnica di aggiramento (no proxy rotation, no fingerprint spoofing aggressivo, no solving di CAPTCHA).
- Login solo dove l'utente lo fornisce manualmente (profilo persistente); mai credenziali nel codice.
- Volumi personali: max ~200 annunci per portale per run, max 40 pagine listing.

## D5 — Deduplicazione cross-portale (GLOBAL)

- Chiave primaria: stesso immobile = (comune, prezzo ±1%, superficie ±2m²) oppure (indirizzo normalizzato uguale + prezzo ±2%).
- Conferme che alzano il punteggio: stessa agenzia, titolo/descrizione simili (token overlap), camere/locali uguali, stessa foto (URL hash dove disponibile).
- Soglia: match automatico se punteggio ≥ 0.75 (da calibrare); sotto soglia restano distinti.
- Vincitore del cluster: fonte primaria > aggregatore; a parità, portale con più dati (planimetria, coordinate, date). Ordine preferenza: immobiliare > idealista > casa.it > wikicasa > subito > agenzie > aggregatori > P2P minori.
- Il cluster conserva TUTTI i link (campo `fonti[]`): nessun annuncio viene perso, in GLOBAL si mostra una riga per immobile.
- Gli annunci ASTE/NPL non entrano nel dedup standard (modello di vendita diverso).

## D6 — GLOBAL: statistiche flip

- Dashboard globale: annunci unici vs totali, duplicati rimossi, copertura per portale, distribuzione prezzi €/m² per comune/zona, candidati RENO (verde/giallo/rosso), STALE alto/medio, annunci multi-portale (indice di "stanchezza" cross-portale), migliori occasioni per ROI.
- Le mediane ARV per RENO in GLOBAL si calcolano sul dataset deduplicato (più comparabili, meno duplicati drogati).

## D7 — Aste/NPL: sezione separata, non flip standard

- Le aste hanno prezzo base ≠ prezzo di vendita, rischi legali (occupazione, diritti), tempi certi: i criteri ROI RENO non sono applicabili senza perizia.
- Decisione: raccoglierle (se accessibili) con schema ridotto (indirizzo, prezzo base, data asta, lotto, link) in sezione "ASTE & NPL" del sito, escluse da BIG/SMA e dal dedup standard.

## D8 — Ordine di lavoro

1. Core condiviso + package.json root.
2. Probe Playwright di tutti i 24 portali (rapporto accessibilità/anti-bot/struttura).
3. Adattatori di scraping per i portali accessibili, in ordine di valore: idealista, casa.it, wikicasa, subito, poi agenzie e aggregatori.
4. Dedup + build GLOBAL + sito unificato.
5. Validazione end-to-end nel browser.

## D9 — Architettura ibrida: browser reale per capire, Playwright per raccogliere

- **Copilot Browser** (plugin Chrome, `chat.agentHost.browserUse.enabled`, tool `browser-use-*`) controlla il browser reale dell'utente **solo in chat, agent-driven**: ricognizione portali nuovi/DIFFERITI, diagnosi DOM cambiato, handoff login/2FA/CAPTCHA all'utente (sensitive step).
- **Playwright resta l'unico motore di produzione** (`npm run radar`): deterministico, schedulabile, profili persistenti per portale, ritmo D4. Il browser reale non è un bypass anti-bot: challenge → STOP come sempre.
- Ponte tra i due mondi: `core/browser-probe.mjs` — funzioni probe scritte per girare sia nel guest code di `run_javascript` sia in `page.evaluate` Playwright, output compatibile con `probe-archive/probe-report.json`.
- CLI: `npm run probe:save -- --id <p> --file <json>` (valida + archivia in `probe-archive/probe-agent-<id>.json`, merge per step); `npm run probe:verify -- --id <p> --from-archive|--live` (verifica le `probeChecks` dichiarate dall'adapter; exit 2 = selettori rotti, exit 3 = blocco D4).
- Gli adapter dichiarano asserzioni verificabili in `probeChecks` (primo: wikicasa). Runbook completo in `.github/copilot-instructions.md`.
- Il login nel browser reale **non** travasa nei profili Playwright: `npm run login` resta il flusso per la raccolta.

## D10 — Chat del sito ("stile Rufus"): LLM interprete, codice esecutore, server locale

- **Richiesta utente (24/11/2026)**: ricerca conversazionale dei candidati immobili nella dashboard, con lo **stesso LLM indicato in configurazione** (`ai-config.json` → `core/ai-config.mjs`: token-plan / deepseek / ollama). Nessuna configurazione AI nuova.
- **Pattern**: il modello NON riceve l'intero dataset e non inventa dati. Traduce la richiesta in UNA azione JSON (`filter | rank | compare | answer | clarify`); il server la valida (`normalizeAction`, fail-closed: azione ignota → clarify) e la esegue sui dati reali di `site/data.js` (`core/chat-actions.mjs`, modulo puro testato). Il commento del modello vede solo le righe risultato (max 10-12) o le schede degli annunci citati (max 4, descrizione troncata a 900 caratteri).
- **Server locale** `chat-server.mjs` (`npm run chat`, default http://localhost:8787, bind 127.0.0.1): solo moduli Node built-in, nessuna dipendenza nuova. Serve `site/` e fa da proxy AI: **le API key restano lato server, mai nel browser**. Budget fail-closed: max chiamate/ora = `maxCallsPerRun` (default 60). `data.js` ricaricato a ogni richiesta se cambiato (rigeneri il sito senza riavviare).
- **Progressive enhancement**: il sito resta statico e apribile con doppio clic. Senza server (o senza config AI) il pannello chat spiega come attivarla; il resto della dashboard non dipende dalla chat.
- **UI**: pannello laterale a scomparsa (bottone 💬 in topbar), card annuncio cliccabili → dettaglio in tabella; le azioni `filter`/`rank` si applicano anche alla tabella (predicato `chatMatch` in `site-src/app.js` allineato a `matchFilter` in `core/chat-actions.mjs`). Storia in sessionStorage (max 12 turni); follow-up via contesto risultati dell'ultima azione. Pannello **ridimensionabile trascinando il bordo sinistro** (min 300px, max 94vw; doppio clic = reset 380px; frecce ←/→ col separatore a fuoco; larghezza persistita in localStorage; su mobile full-width, resizer nascosto). **Stop della richiesta in corso**: durante l'attesa il bottone invio diventa ■ rosso (AbortController sul fetch; anche Esc ferma la richiesta senza chiudere il pannello); la domanda interrotta è rimossa dalla history per non confondere il turno successivo.
- **Perimetro**: la chat cerca nella lista operativa flip (comuni ammessi, no affitti, no stati senza margine) — stessi predicati della UI. Prezzi/ID mostrati sono sempre quelli reali del dataset.
- Test: `node test-chat.mjs` (azioni, normalizzazione fail-closed, `aiChat` con fetch mockato).
- **Tema dark** (24/11, richiesta utente): l'intera dashboard usa una palette scura definita nelle variabili `:root` di `site-src/style.css` (`color-scheme: dark`); nessun colore hardcoded fuori dalle variabili, badge verde/giallo/rosso con fondi scuri dedicati. Le foto annuncio restano su fondo chiaro (`--img-bg`) per leggibilità delle planimetrie.

## D11 — Data di pubblicazione: raccolta best-effort su tutti i portali

- **Richiesta utente (24/11/2026)**: scaricare anche la data di pubblicazione in tutto il processo di scraping. Il campo `pubblicatoIl` esiste già nello schema (`core/schema.mjs`) ma solo ~9 portali su 19 attivi lo valorizzavano (subito, immobiliare, trovit, caasa, bakeca, mitula parziale, millecase…).
- **Meccanismo centrale**: `core/dates.mjs` + hook nel runner condiviso (`core/runner.mjs`, dopo `scrapeDetail`): `fillDates(ad, page)` normalizza le date dell'adapter e, **solo se mancanti**, legge i JSON-LD (`datePublished`/`datePosted`/`dateCreated`/`uploadDate`, update: `dateModified`) dalla pagina di dettaglio GIÀ aperta — zero navigazioni extra, zero costo anti-bot. La fonte esplicita dell'adapter vince sempre sul JSON-LD. Mai throw: pagina senza ld+json → campo vuoto.
- **Mai inventare date**: se il portale non espone la data, il campo resta '' (D2). Il ledger (`firstSeen` osservato) resta la fonte robusta per l'anzianità in FLIP STALE; `pubblicatoIl` la affianca dove disponibile.
- **Vale per tutte le prossime esecuzioni** di `npm run radar` (runner condiviso). Lo scraper autonomo di immobiliare.it già raccoglie `createdAt`/`updatedAt` e non è toccato. Gli adapter con date testuali proprie possono usare `normDate` (ISO, epoch s/ms, dd/mm/yyyy, "12 marzo 2026", oggi/ieri).
- Test: `node test-dates.mjs` (8 casi). Verifica live differita alla prossima esecuzione regolare (richiesta utente: nessun probe dedicato adesso).

### 2026-11-24 (5) — Falsi positivi nella classifica RENO (segnalazione utente)

Utente: "tra i top ho 2 locali non abitabili e una casa completamente da demolire". Cause e fix:

- **Gap RENO vs BIG/SMA**: `analyzeReno` applicava solo un sottoinsieme dei "no" duri. La casa da demolire (attico 52223207, ROI fittizio 103,6%) era esclusa da BIG (`detectDemolizione`) ma non da RENO, perché il campo stato diceva "Da ristrutturare". Ora il pool RENO applica anche `detectDemolizione`, `detectNoResidenza`, `detectIpoteticoResidenziale` (core/flip.mjs).
- **Locale commerciale non riconosciuto**: wikicasa 27261043 ("LOCALE COMMERCIALE … proponiamo in vendita locale commerciale di 46 mq") aveva tipologia "Appartamento" e nessuna categoria catastale nel testo → sfuggiva a `detectNonResidential`. Aggiunta regola: dichiarazione esplicita "locale/spazio commerciale" come soggetto nelle prime 2 frasi della descrizione (mai come riferimento di zona, mai dopo i contatti d'agenzia).
- Risultato dopo il rebuild: i 2 falsi positivi fuori dal pool; nuovo top RENO = bilocale Santa Viola 75k (ROI 27,8%, capitale ~92k), attico Mazzini 130k (22,4%).
- Test: `node test-flip-pool.mjs` (7 casi, inclusi i contro-casi: demolizione già eseguita, "vicino al locale commerciale").
- **Nota budget**: il capitale RENO include lavori stimati (600 €/m² ristr.) — un ROI alto su mq grandi può comunque richiedere un capitale oltre la disponibilità dell'utente. Parametri in flip-config.mjs; eventuale tetto di capitale in chat: chiedere.

## Log decisioni operative

*(append durante l'esecuzione, con timestamp)*

### 2026-11-23 (4) — Fase 3: audit filtri nativi delle 10 agenzie senza filtri server-side

Audit read-only (≤2 fetch/sito, nessun JS, nessuna POST) delle form di ricerca. Esiti nelle `strategia.md` per portale. Sintesi:

- **Adapter aggiornati** (effetto leva: meno candidati = meno dettagli visitati = meno token AI):
  - **ars**: query prezzo + `in_cat=41` (Appartamento) + `custom_field[custom-number]=40-1000` (mq server-side). Verifica: HTTP 200, 0 link come la vecchia query solo-prezzo (portfolio ≤160k vuoto oggi, comportamento invariato); probe live exit 0. Espone anche filtro stato "Da ristrutturare" (riserva).
  - **alfaeomega**: + `cod_tipologia=3` (Appartamento). Espone anche vani/camere min/max e zone (riserva se il portfolio cresce).
- **Scoperte documentate, non ancora adottate**: grandicase ha una ricerca GET `task=search` con catid/prezzo (HTTP 200; contenuto risultati da confermare col browser); mondore `min-area` è testo libero con meta_query numerica (il "bug preset" del 22/11 potrebbe essere un artefatto — da ritestare live prima di alzare 30→40); reportimmobiliare cerca via AJAX `tt_ajax_search` (reverse dei campi necessario).
- **Nessun filtro utile**: toscano (Blazor, filtri solo JS), vivacasa (ricerca avanzata rotta anche con preset validi), cavallo (POST già ottimale, niente mq/locali), giacopini (già ottimale).
- **millecase**: già massimo filtraggio REST possibile. Il 401 segnalato dall'audit è un **falso allarme**: riverifica diretta HTTP 200 con la anon key dell'adapter.

### 2026-11-23 (3) — Provider AI a tre alternative + Fase 2 residui (regola utente)

**Richiesta utente**: nel cambio modello dare anche la possibilità di selezionare i modelli dall'Ollama locale; Ollama deve restare UNA delle alternative ad Alibaba o Deepseek; per Deepseek l'utente ha una API key specifica (dedicata, distinta dal Token Plan).

**Provider parametrici** (`core/ai-config.mjs`, flag `--provider` / env `RADAR_AI_PROVIDER` / `ai-config.json`):
- `token-plan` (default): Alibaba Token Plan, `~/.bailian/config.json`, path `/compatible-mode/v1/`. Modelli: qwen3.8-flash (ECO default) → qwen4-max-preview.
- `deepseek`: API diretta `https://api.deepseek.com`, key dedicata da env `DEEPSEEK_API_KEY`/`RADAR_DEEPSEEK_API_KEY` o `~/.radar-ai.json` `{"deepseekApiKey": "..."}` (fuori dal repo, MAI nel codice/chat). Modelli: deepseek-chat (default), deepseek-reasoner.
- `ollama`: locale `http://localhost:11434/v1`, nessuna key, **costo token ZERO**. Modelli = tag locali (`--list-models` li elenca via `/api/tags`); default qwen3.5:4b. Modelli "thinking": `reasoning_effort: 'none'` obbligatorio, altrimenti i 220 token finiscono nel reasoning e il content è vuoto.
- Cache per provider+modello+hash(SYSTEM)+hash(testo): una risposta locale non si mescola con una cloud; SYSTEM diverso = domanda diversa.

**Fase 2 — coda residui** (`ai-residui.mjs`, registro `ai-residui.json`): entra SOLO chi è escluso da BIG/SMA esclusivamente per ragioni AI-risolvibili (camere/convertibilità, stato, indirizzo). Task `indirizzo`: l'AI estrae solo l'indirizzo testuale, le coordinate restano Nominatim (mai geocoding AI). Confidence <0.8 o campo nullo → rifiutato, registrato (non si ripaga), annuncio resta escluso (D2).

**Integrazione filtri** (`applyFilters`): priorità planimetria verificata > dato strutturato portale > `camereAI` (riempie i buchi, non smentisce); `convertibileAI === true` con evidenza conta come prova di convertibilità bilocale; fonte tracciata (`fonteCamere`, badge "AI" nel sito con confidence nel tooltip).

**Primo run reale (ollama/qwen3.5:4b, costo zero)**: 27 chiamate, ~12.5k token locali, 14 accettati / 12 rifiutati fail-closed. 1 recupero SMA reale (caasa-1703372597, bilocale 59 m² Corticella: camere mancanti → AI 1 camera conf 0.95 → SMA Selezionato). Lezione: il modello locale aveva allucinato convertibilità da "da personalizzare" → SYSTEM irrigidito (solo frasi esplicite di ricavabilità seconda camera), voce rimossa e rianalizzata. I rifiuti mitula/trovit (conf 0.1) sono schede tronche: correttamente non recuperabili.

**Fix regole emersi dai residui**: cantine/solai/box listati da attico nelle ricerche residenziali → `detectNonResidential` legge la tipologia dal titolo ("Cantina/Solaio in vendita"); "magazzino seminterrato" come unità in vendita → `detectSeminterratoDaTesto` (protezione parola prima dello strip vani accessori; `semi[-\s]?interrato` NON matcha "seminterrato", serve alternativa esplicita). Test: 145 qualità dati + 26 AI, tutti OK.

### 2026-11-23 (2) — AI sugli annunci: pipeline a imbuto, modello parametrico (regola utente)

**Richiesta utente**: dare a Qwen il potere di interpretare gli annunci minimizzando i token; sfruttare al massimo i filtri nativi sito per sito (effetto leva: meno candidati = meno consumo); modello switchabile in modo parametrico (fino a qwen4-max-preview).

- **Architettura approvata — pipeline a imbuto**: filtri nativi server-side (già auditati 22/11) → regole core (regex/schema/geocode/POI, costo zero) → **AI solo sui residui ambigui** il cui esito dipende dal campo mancante. Mai AI su annunci già decisi. Misura iniziale: 421 unici, 370 con ≥1 ambiguità, ma la maggioranza si risolve senza AI.
- **5 leve di risparmio**: ① filtri nativi al massimo; ② solo residui; ③ prompt minimale (frasi pertinenti al campo, ≤700 chars, non la descrizione intera); ④ cache persistente `ai-cache.json` con chiave `portale:id|task|modello|hash(system)|hash(testo)` — annuncio invariato mai ripagato, SYSTEM diverso = domanda diversa; ⑤ modello ECO di default.
- **Core**: `core/ai-config.mjs` (modello parametrico: `--model` > env `RADAR_AI_MODEL` > `ai-config.json` > default `qwen3.8-flash`; credenziali da env o `~/.bailian/config.json`, MAI nel repo; `maxCallsPerRun` 60, `minConfidence` 0.8) + `core/ai.mjs` (`aiBatch` con cache/budget/pausa gentile, stop su 401/403, errori per-item mai fatali; `frasiPertinenti`; `aiFieldOk` fail-closed).
- **Fase 1 realizzata — `ai-lead-privati.mjs`**: verifica "privato caso per caso" dei lead affitto. Seleziona solo i lead in scope non ancora verificati, chiede chi pubblica con output JSON `{privato, confidence, evidenza}`, scrive `lead-verifiche.json` SOLO con confidence ≥0.8. `--dry-run` (mostra prompt e stima token, zero chiamate), `--model`, `--id portale:id`.
- **Esito reale (4 chiamate ECO totali, ~3.900 token)**: 668453390 privato ✓ (conf 0.95, "Privato affitta"); 668728343 privato ✓ (conf 0.95 dopo revisione prompt: "proponiamo" da solo non prova agenzia); **666969652 = AGENZIA** (conf 0.98, "AFFITTO TRAMITE AGENZIA" nel testo) → rimosso dai lead: il flag `privato:true` di Subito era sbagliato, l'AI ha corretto un errore del portale. Lead finali: **2 BIG verificati**.
- **Fix regex emerso dal caso**: `detectAffitto` non riconosceva "AFFITTASI" e "affitto tramite agenzia" (666969652 era passato come vendita) → pattern esteso, 3 nuovi test.
- **Stato privato nel sito** (dal turno precedente, ora alimentato dall'AI): badge "verificato" (verde) / "dichiarato dal portale" (info) / "da verificare" (giallo, portali con flag inferito: wikicasa/flatsearch/caasa/trovit/mitula/trovacasa); la verifica registrata VINCE sul flag dell'adapter, anche smentendolo.
- Test: qualità dati **133 OK** (+3), nuovo `test-ai.mjs` **12 OK** (offline, zero costi: prompt minimale, confidence fail-closed, modello parametrico, nessuna key nel sorgente).
- **Prossime fasi (non ancora implementate)**: Fase 2 coda AI sui residui BIG/SMA (camere/convertibilità/stato reale); Fase 3 audit filtri nativi dei 18 siti-agenzia nuovi (Flusso 1 D9) per ridurre ancora il volume a monte.

### 2026-11-23 — Lead privati da affitto: sezione dedicata, contatto manuale (regola utente)

**Richiesta utente**: gli annunci in affitto ma in scope con gli altri filtri si potrebbero contattare, se da privati, per capire se sono interessati alla vendita. Approvata la sezione dedicata nel sito.

- **`leadAffittoPrivato` (core/filters.mjs)**: affitto riconosciuto da `detectAffitto` + **privato dichiarato** (`ad.privato === true`, mai dedotto dall'agenzia vuota) + tutti gli altri criteri BIG/SMA superati con `ignoreAffitto`. Il **tetto budget non si applica** (il canone non è un prezzo di vendita: il prezzo è ignoto, da chiedere); tutto il resto resta fail-closed (superficie, camere, zona, piano, stato…). Esito `{profilo: BIG|SMA, motivoAffitto, motivazione}` allegato come `ad.leadAffitto`; i profili standard restano **Escluso** (nessuna promozione).
- **Sito**: nuova vista **"Lead privati"** (GLOBAL + per-portale dove presenti), KPI in dashboard, nota nel dettaglio, CSV export. Gli affitti spariscono dalle liste operative (BIG/SMA/Tutti/Novità/Multi) e dalla dashboard conteggi.
- **Dedup/ledger**: gli affitti restano fuori dai cluster (il canone potrebbe fondersi con una vendita economica dello stesso stabile); entrano in GLOBAL come singleton. Come le aste (D7), **non entrano nei comparabili ARV** né nel pool RENO (`computeMedians`/`analyzeReno` ora scartano `detectAffitto`).
- **Adapter subito**: gli affitti da privato NON si scartano più in `collectListings` (servono alla sezione lead); quelli da agenzia sì. Gli altri adapter invariati: dove l'affitto è scartato a monte da un portale-agenzia è corretto (nessun privato possibile); casadaprivato/flatsearch restano com'è (P2P, valutazione futura).
- **Contatto MANUALE dal portale d'origine** (D4: nessuna automazione di contatto, volumi personali). Primi 3 lead reali: subito 668453390 (BIG, quadrilocale 105 m² a studenti), 668728343 (BIG, 70 m² Massarenti "no agenzia"), 666969652 (SMA, bilocale 72 m² Borgo Panigale).
- Test: suite qualità dati da 113 a **125 OK, 0 FAIL** (casi lead reali + guard: agenzia, no flag, superficie, vendita a reddito, nessuna promozione standard). Dedup/ledger/superficie invariati.

### 2026-11-22 (sera) — Audit filtri server-side dei 17 portali storici: 9 adapter corretti

**Problema segnalato dall'utente**: durante il run si aprivano annunci palesemente fuori budget/filtri. Causa confermata dai log (tecnocasa: 17/21 dettagli visitati fuori budget, fino a 860k): i portali storici pre-datano il flusso D9 di verifica filtri — diversi adapter usavano parametri **inventati/ignorati** o URL che il server tratta come listing generica. Ricognizione completa: fetch+confronto conteggi (agent research) per i siti raggiungibili, **browser reale** (Task Group Copilot Browser) per i WAF-blocked (wikicasa/attico/trovacasa/idealista/mitula/trovit), ispezionando le maschere di ricerca reali (name= degli input, URL generate dai form, link SEO dei dropdown).

| Portale | Problema trovato | Fix verificato (baseline→filtrato) |
| --- | --- | --- |
| **attico** | `/vendita-residenziale/in-{comune}/lista-N` era una listing **NAZIONALE** (annunci di Milano!) | URL da form reale: `dimensione-40-qualsiasi-per-0-160000-in-{Comune}/lista-N` (Bologna 49 card tutte ≤160k ≥40mq). "in-Bologna"=comune, "in-bo,+emilia-romagna"=provincia |
| **wikicasa** | `?PrezzoMassimo&SuperficieMinima` IGNORATI dal server **anche quando generati dal form** (URL cosmetica, confermato con reload) | path SEO `/vendita-case/{comune}/prezzo-fino-a-160000/` (H1 e prezzi correnti verificati; i prezzi >160k nel DOM sono **barrati pre-ribasso**). mq: nessun filtro server → rete client-side su card. Paginazione `?p=N` |
| **trovacasa** | `SuperficieMinima` ignorato | nome vero dal form: **`MqMin=40`** (196→118, tutte le card ≥40 m²). `PrezzoMax` già corretto |
| **tecnocasa/tecnorete** | ⚠️ **fallback zero-risultati**: se i filtrati sono 0 il server restituisce la lista COMPLETA (San Lazzaro: 31 annunci fino 860k) | guardia anti-fallback (>50% card oltre budget ⇒ pagina scartata) + rete client-side prezzo/mq su card. Bologna max_price+min_surface reali (169→6) |
| **idealista** | solo prezzo filtrato, mq no | token SEO **`dimensione_40`** (=minimo; `dimensione-max_N`=massimo; `dimensione-da_40`→404): `con-prezzo_160000,dimensione_40/` (142→81) |
| **mitula** | URL SEO `-160000-euro` = "**intorno a**" (card fino 179k+) | endpoint **`/find?geoId={id}&operationType=sell&propertyType=apartment&maxPrice=160000&minArea=40`** (BO 276→171). geoId: **BO=R43172, Pianoro=R43050, SL=R43173**. Ora copre tutti e 3 i comuni (prima solo Bologna). Guardia fallback "l'abbiamo ampliata" + rete data-attr card |
| **trovit** | idem mitula ("intorno 160.000 €" nel title) | stesso endpoint `/find` (**piattaforma Lifull condivisa, geoId identici**; il geoId composito `mitula-IT-poblacion-…#` NON vale su trovit, usare la forma semplice). `freeText=bologna` matcha la PROVINCIA (Monterenzio!) → mai freeText. 3 comuni ora coperti |
| **flatsearch** | solo price_max | **`surface_min=40`** verificato (243→90 con 50) |
| **tempocasa/casait/casadaprivato** | filtri solo POST/Livewire/WebForms (nessun GET possibile) | rete client-side prezzo/mq **sulle card prima del dettaglio** (tempocasa: 140 link→12 target; casait pace 20s: ogni dettaglio evitato ≈25s risparmiati) |

- Tutti gli adapter corretti ri-verificati con `probe:verify --live` headed: **exit 0**. `probe-verify.mjs`: fix falsi positivi (le cardSelectors della listing non vanno cercate sul dettaglio).
- **Regola operativa permanente**: un parametro filtro è valido SOLO dopo confronto baseline-vs-filtrato (conteggio e prezzi/mq campionati). Le URL generate dai form possono essere cosmetiche (wikicasa): verificare con reload completo. Attenzione ai fallback zero-risultati (tecnocasa, mitula): "0 risultati" può diventare "tutti i risultati".
- Prezzi barrati (wikicasa/trovit): il prezzo CORRENTE è quello col formato "€ N" / il primo della card; il secondo è il pre-ribasso. Mai confonderli nel filtro client-side.

### 2026-11-22 — Censimento agenzie locali: 18 nuovi portali-agenzia

Censimento esaustivo (~60 agenzie tra Bologna/Pianoro/San Lazzaro via PagineGialle + reti affiliate): **18 siti proprietari con listing pubblico verificato**, integrati come portali di prima classe (adapter + probeChecks + scrape.mjs, registrati in run-all/build-site/SOURCE_PRIORITY). Analisi dei filtri server-side per tutti i 18 (form HTML ispezionati, URL filtrate aperte con confronto conteggi): si usano i filtri nativi dove funzionano, client-side solo per il resto (D2).

| Portale | Filtri server-side usati | Client-side residuo / note |
| --- | --- | --- |
| gabetti | `?prezzoMax=160000&mqMin=40` per comune (path) | — (dettaglio DOM, no JSON-LD) |
| toscano | comune via path (Blazor Server) | prezzo/mq dalle card/dettaglio; JSON-LD RealEstateListing |
| professionecasa | `contratto=vendita&uso=abitativo` per-agenzia (bologna-san-vitale) | ⚠️ prezzo/mq dichiarati ma IGNORATI dal server → doppia rete client-side |
| grimaldi | `contratto=vendita&prezzo=0-160000&mq=40-100000` (store-bologna-centro) | ⚠️ filtri inaffidabili → client-side; Ozzano fuori whitelist scartato |
| livingin | `ct_city&ct_price_to&ct_sqft_from` (m²) | ⚠️ non filtra contratto → scarto affitti; JSON-LD malformato |
| mondore | `/risultati-ricerca-immobili/?status&location[]&type[]&max-price` | ⚠️ min-area+max-price → 0: min-area=30 + client ≥40 |
| immobiliaresanlazzaro | `location` per comune (RealHomes) | ⚠️ location+prezzo → 0 e max-price solo preset → prezzo/mq client-side |
| grandicase | nessuno (Joomla REM inaffidabile, 7 annunci) | tutto dalle card; residenziale+vendita |
| vivacasa | `status[]&location[]&type[]&max-price` (Houzez) | solo Bologna tra le location; soglia esatta client |
| reportimmobiliare | nessuno (tema realty, no form) | card server-rendered con prezzo/mq → filtro in listing; TLS legacy (browser OK) |
| ars | `directory_type&price[1]` (Directorist) | ⚠️ address+price → 0 e address matcha la descrizione → comune client-side |
| kapitalre | JSF `?jsf=jet-engine:immobili&tax=comune:<id>&meta=_immobili_prezzo:0,160000` (BO=204, Pianoro=18, SL=218) | ⚠️ tax≠204+meta → 0 → per Pianoro/SL solo tax + filtro prezzo dalle card |
| limmobiliare | `status=vendita&location=bologna` (RealHomes) | prezzo/mq client; portfolio globale include Bolzano → whitelist |
| giacopini | Gestim `cf=yes&Motivazione[]=1&Tipologia[]=1&Comune=764` | mq assente nel form → client; solo Bologna trattato |
| abitarebologna | `op&tip&loc&mq=min|max&prezzo1=min|max` (pipe %7C) | ⚠️ chiavi mq/prezzo1 SEMPRE presenti altrimenti risposta rotta |
| millecase | API Supabase PostgREST pubblica (apikey anon del bundle): `contract_type&status&price=lte&square_meters=gte&location ilike` | scraper API puro, niente browser per la raccolta |
| cavallo | ricerca POST form (RealEstateManager): com_property 37006/37047/37054, public_price | GET ignorato; mq assente → client |
| alfaeomega | Agesta GET `tipo_contratto=V&cod_categoria=R&prezzo_max&mq_min&cod_comune` (1247 BO, 1239 SL) | Pianoro non trattato dall'agenzia |

- **Dedup (D5)**: i siti agenzia sono fonte diretta → priorità dopo le reti nazionali, prima di P2P/aggregatori. Alias dominio→id aggiunti in ORIGIN_ALIASES.
- **Gruppo B/C del censimento** (senza adapter): desideratadomus.it, io.casa, venderecasaabologna.it, teamimmobili.it, capitalhouse.it/bologna, immobiliareinsieme.it (vetrine senza listing); conciliamoconsulenzeimmobiliari.it e lugattiimmobiliare.it (403, D4 non aggirato); gabettisaffisantaviola.it (DNS morto, probabile affiliato Gabetti già coperto); ~25 agenzie solo sui portali (già coperte indirettamente).
- Gap noti: altre agenzie ProfessioneCasa/Grimaldi a Bologna non enumerate (scope per-agenzia); paginazione POST di Cavallo non documentata.
- **Primo run 18 portali (22/11, tutti exit 0, 0 blocchi)**: gabetti 5 annunci (tutti già noti cross-portale, 0 BIG dopo fix), toscano 1 e millecase 2 **nuovi/esclusivi** (prezzo trattativa riservata → in valutazione), altri 15 siti 0 target oggi (portfolio >160k o solo commerciali nella fascia bassa; scarti loggati). GLOBAL: 1213 → 761 unici.
- **Fix qualità gabetti post-run**: (1) `/bar/…` passava come residenziale → NON_RESIDENZIALE esteso (bar/ristorante/albergo…) + scarto su titolo "Attività…"; (2) "Descrizione" compare 2 volte nel body (tab nav + sezione vera): il parser prendeva la prima → descrizione vuota e **"NUDA PROPRIETÀ" invisibile ai filtri** (3343643 falsamente BIG; il dedup lo aveva già fuso col gemello subito escluso). Parser corretto (occorrenza con testo più lungo), re-scrape dei 5 dettagli: 3343643 ora Escluso=Nuda proprietà.

### 2026-11-15 — Esiti probe round 1+2 (URL verificati sul campo)

- **casaclick = wikicasa**: casaclick.it redirige a wikicasa.it (stesso sito/gruppo). Un solo adattatore `wikicasa`; la sezione casaclick nel sito è un alias informativo. Niente scraping duplicato.
- **trovacasa = gruppo Immobiliare.it**: footer "© Immobiliare.it S.p.A."; URL stile immobiliare.it. Timeout/404 sui pattern provati → DIFFERITO, bassa priorità (fonte già coperta da immobiliare.it).
- **caasa = motore di ricerca** (NON rent-to-buy): "Il motore di ricerca degli immobili in vendita in Italia". Aggregatore con link `ClickTag` verso i portali originali. Trattato come aggregatore.
- **nextdoor**: `/for_sale_and_free/` e `/choose_address/` → login wall. LOGIN OBBLIGATORIO → DIFFERITO. Ricognizione 2026-11-15 (agent-controlled): le pagine SEO pubbliche `/citta/<slug>--emr/` e `/quartiere/<slug>--<citta>--emr/` coprono **107 quartieri su tutti e 6 i comuni target**, ma la sezione "For sale and free items nearby" contiene **solo oggetti usati** (mobili, elettrodomestici, auto) → **0 immobili in vendita**. **Nessun adapter, login non richiesto**: il limite è il contenuto, non l'accesso. Dettagli in `nextdoor/strategia.md`.
- **facebook marketplace**: accessibile senza login ma geolocalizzato USA; richiede impostazione Bologna + interazione complessa → DIFFERITO. Ricognizione 2026-11-15: categoria immobiliare = **Home Sales** (`category_id=1270772586445798`); senza login mostra solo mercatini USA; cambio città→Bologna è **dietro login** (`/login/?next=…`); slug `bologna` nell'URL scartato senza sessione. Login manuale + 2FA, poi Bologna + raggio ~20 km. Dettagli in `facebook/strategia.md`.
- **facebook gruppi (post-login, verificato 2026-11-15)**: dopo login manuale la ricerca gruppi funziona (`/search/groups/?q=vendita%20case%20Bologna`), ~59 gruppi (maggioranza affitto → scartati, interesse solo VENDITA). **Feed dei gruppi pubblici leggibile senza iscrizione**. Criticità: (1) rumore anti-scraping nel DOM (span "Facebook" + caratteri zero-width) → estrarre solo `div[data-ad]`/parent di "Altro..." e ripulire; (2) post troncati → click "Altro..." prima di estrarre; (3) testo libero non strutturato (prezzo/mq via regex, zona discorsiva → geocoding); (4) **resa bassa**: maggioranza spam agenti/traslochi + richieste "cerco", vendite reali minoranza (alcune negozi/capannoni → esclusi). Gruppi con **listing Marketplace embedded** (tab "Acquisti e vendite", es. `778236132285506`) hanno prezzo+luogo strutturati e `product_id` stabile → i più scrapeable. Raccomandazione: fonte P2P **complementare** per STALE, non scraper primario; nessun adapter automatico finché non validata la resa. Elenco gruppi e dettagli in `facebook/strategia.md`.
- **flatsearch**: solo home con assistente AI, nessun listing pubblico, `/compra` e `/ricerca` → 404. Probabile login/app → DIFFERITO.
  → **SUPERATO / VERDETTO ERRATO**: il listing è pubblico e ricchissimo. Vedi sezione "FlatSearch RICOGNIZIONE CHIUSA — promosso ad ATTIVO".
- **casadaprivato**: home con form, URL ricerca non scoperti (`/annunci-vendita/...` → 404). Da esplorare via form → DIFFERITO temporaneo.
- **dovalue**: sito corporate, `/it/real-estate` → ERR_TOO_MANY_REDIRECTS, `realestate.dovalue.it` non risolve. Listing non pubblici → sezione ASTE/NPL informativa.
- **invimit**: listing su dominio separato `vetrinaimmobili.invimit.it` (tabella WordPress + allegati .doc). Accessibile, schema ridotto aste.
- **prelios**: listing reali su `prelios.com/it/societa-operative/prelios-agency/immobili` (109 card). Piattaforma ARECNEPRIX. Accessibile, aste/NPL.
- **intesasanpaolo**: form PROVINCIA/COMUNE/TIPOLOGIA/PREZZO su `/immobili`; ricerca via form (no URL query semplice). Accessibile, aste.
  → **SUPERATO dalla ricognizione completa**: gli URL query filtrabili esistono (`?comune=<ISTAT>`, `?provincia=037`, esposti dai breadcrumb del dettaglio) e **non è un portale aste**. Vedi sezione "Intesa Sanpaolo RICOGNIZIONE CHIUSA".
- **agenziademanio**: `/opencms/it/gare-aste/immobiliare/` → 200, 3116 risultati, link gara. Accessibile, aste pubbliche.

### 2026-11-15 — Portali con listing accessibili e struttura dati verificata

| Portale   | URL ricerca verificato                                            | Struttura dettaglio                 | Coordinate                | Camere                  | Note                                                       |
| --------- | ----------------------------------------------------------------- | ----------------------------------- | ------------------------- | ----------------------- | ---------------------------------------------------------- |
| casa.it   | `/vendita/residenziale/{comune}?prezzoMax=160000`               | `__NEXT_DATA__.pdp` (ricchissimo) | ✅ address.lat/lon        | dedotte da descrizione  | POI già integrati; **CloudFront 403 intermittente** |
| wikicasa  | `/vendita-case/{comune}/`                                       | JSON-LD `mainEntity`              | ✅ geo.latitude/longitude | ✅ numberOfBedrooms     | NUXT; 1529 case Bologna                                    |
| tempocasa | `/it/vendita/bologna/bologna`                                   | JSON-LD `RealEstateListing`       | ❌ (geocode)              | ❌ numberOfRooms=locali | datePublished/Modified ✅ per STALE                        |
| remax     | `/vendita-appartamenti/bologna`                                 | JSON-LD `RealEstateListing`       | ❌ (geocode)              | da descrizione          | prestige.remax.it per dettagli                             |
| tecnocasa | `/annunci/immobili/emilia-romagna/bologna/bologna.html`         | DOM "Caratteristiche"               | ❌ (geocode)              | ✅ "Camere da letto: N" | stessa piattaforma di tecnorete                            |
| tecnorete | (stessa piattaforma tecnocasa)                                    | DOM                                 | ❌                        | ✅                      | DB condiviso → dedup interno                              |
| mitula    | `/appartamento-bologna` (singolare)                             | JSON-LD SearchResultsPage           | ❌                        | da card                 | aggregatore puro (rimanda ad altri)                        |
| trovit    | `/case-bologna`                                                 | JSON-LD SearchResultsPage           | ❌                        | da card                 | aggregatore puro                                           |
| bakeca    | `/annunci/vendita-case/bologna/`                                | JSON-LD Product                     | ❌                        | da descrizione          | privato/agenzia; paginazione `/page/N/`                  |
| caasa     | `/bologna/bologna/appartamento/in-vendita.html`                 | JSON-LD ItemList + ClickTag         | ❌                        | da card                 | aggregatore                                                |
| idealista | `/vendita-case/bologna/` → 404                                 | —                                  | —                        | —                      | **404 persistente**, URL da riscoprire               |
| subito    | `/annunci-bologna/vendita/appartamenti/bologna/bologna/` → 404 | NEXT_DATA                           | —                        | —                      | **404**, URL corretto da scoprire                    |
| attico    | `/vendita/emilia-romagna/bologna/` → contenuto nazionale       | —                                  | —                        | —                      | URL Bologna non trovata                                    |

### 2026-11-15 — Anti-bot casa.it (CloudFront)

- casa.it risponde **403 CloudFront con body vuoto** dopo alcune richieste ravvicinate; il challenge non si risolve in headless né con profilo fresco dopo il blocco. Il primo accesso (probe) funzionava.
- Decisione: **pause molto lunghe** (≥30–60s tra listing, ≥15s tra dettagli) e retry con backoff esponenziale sul 403; se persiste, STOP graceful e run rimandato. Nessun aggiramento del challenge.
- Il flag `--disable-blink-features=AutomationControlled` NON è la causa (testato: 403 anche senza). È rate-limiting/IP reputation.
- Gli altri portali (wikicasa, tempocasa, remax, tecnocasa) non hanno mostrato questo blocco nei probe.

### 2026-11-16 — Regole: affitti nelle vendite, nuda proprietà dall'origine, planimetria idealista

Casi reali segnalati dall'utente (4 annunci invalidi promossi):
- **Subito 667199615** (1.100 €, "si affitta… canone mensile") era BIG; **666969652** (800 €, "€ 800 AL MESE") era SMA. Subito mescola affitti nelle ricerche vendita.
- **flatsearch ecd8fb7c → immobiliare 133727750**: NUDA PROPRIETÀ dichiarata solo sull'originale (descrizione aggregata vuota). Fetch headed dell'origine: "SANTA VIOLA – NUDA PROPRIETÀ CON BALCONE E SOFFITTA… usufruttuario 80 anni".
- **idealista 29655698**: "trilocale, due ampie camere matrimoniali" nel testo, ma le 2 planimetrie (visitate headed su `/planimetria/1|2/`) mostrano SALA+CUCINA+BAGNO+**1 sola CAMERA** (il seminterrato è cantina).

Regole implementate (`core/filters.mjs`, condivise anche da immobiliare.it):
- **`detectAffitto`**: prezzo < 3.000 € + segnale affitto (affitta/canone/al mese), OPPURE canone + richiesta inquilini. **Guard "a reddito"**: "contratto in essere / già locato / attualmente affittato / entrata locativa / redditività" = vendita con inquilino, NON affitto (falso positivo reale: tecnocasa 61291062 a 165k).
- **`detectNudaProprieta`**: scan per frase con skip boilerplate agenzia; **tronca ai teaser** "VEDI ALTRI ANNUNCI SIMILI / Trovi questo annuncio in" (trovacasa accoda altri immobili: il loro "nuda proprietà" non deve escludere questo); guarda anche slug URL e altreCaratteristiche.
- **Backfill descrizione in `verify-source.mjs`**: aggregatore vivo ma senza descrizione → testo recuperato dalla pagina d'origine durante la verifica, poi i filtri riescono a leggere "nuda proprietà" (flusso VERIFY riapplica già i filtri dopo).
- **idealista adapter**: estrae le planimetrie dalla galleria (bottone "N planimetrie" → `/immobile/<id>/planimetria/N/`, img `WEB_DETAIL-XL`, max 4). `camerePlanimetria` resta una **verifica visiva manuale** che prevale sulle camere dichiarate: 29655698 annotato `camerePlanimetria=1` + URL planimetrie + nota → escluso BIG (1 camera < 2) e SMA (145k > 130k).
- Test: suite da 71 a **87 OK, 0 FAIL** (fixture storiche pinned a `annunci-2026-11-15-13-48.json`: i run nuovi non contengono più i casi originali). Audit su 1.227 annunci: 8 affitti Subito + ~45 nuda proprietà colpiti, **nessun falso positivo** dopo le guard. Sito rigenerato: 5 BIG + 2 SMA.

### 2026-11-16 — Runner centralizzato `run-all.mjs` (parallelo, grado 8)

- `npm run radar` (= `node run-all.mjs`): lancia i 16 portali attivi **in parallelo, 8 worker**, headed; ogni portale è un processo figlio con log dedicato in `logs/run-<data>/<portale>.log`. A fine giro esegue `build-site.mjs` + `validate-site.mjs`.
- **casait opt-in** (`--only casait`): WAF DataDome persistente, incluso solo su richiesta (ritmo ≥20s già attivo). **intesasanpaolo escluso**: solo storico prezzi, schema diverso.
- Opzioni: `--parallel N`, `--only a,b`, `--exclude a,b`, `--resume` (ultimo JSON per portale), `--site-only`, passthrough `--headless/--no-verify/--max-ads/--max-km/--min-poi/--no-geocode/--no-poi/--refresh-poi`.
- Ctrl+C → SIGINT inoltrato agli scraper (salvataggio parziale già gestito dal runner per-portale), sito NON rigenerato; si riprende con `npm run radar:resume`.
- Validato: `--site-only` OK; pool parallelo testato con 2 portali finti (entrambi partiti insieme, conteggi BIG/SMA letti dal JSON, sito rigenerato). Nessun aggiramento anti-bot: la richiesta utente di eludere i WAF è stata rifiutata (policy §8 + vincoli ambiente).

### 2026-11-16 — Ritmo per-portale (`adapter.pace`) + casa.it ≥20s; NO camuffamento firma

- Richiesta utente: **Playwright headed sempre** (già default del runner, confermato) e per **casa.it click ogni ≥20s, non di meno**.
- Implementato `setPace(minMs)` in `core/human.mjs`: ogni `humanPause` viene alzata almeno al minimo del portale. Il runner la attiva da `adapter.pace = { minMs, reason }`; la pausa tra dettagli usa `humanPause` (rispetta il floor). `casait/adapter.mjs`: `pace.minMs = 20000`, pause tra pagine/aree alzate a 20–25s.
- **Camuffare la firma dell'automazione (stealth plugin, patch fingerprint): NO.** Vietato dalla policy §8 (nessun aggiramento dei sistemi anti-bot) e dai vincoli dell'ambiente. Le leve ammesse restano: headed, profilo persistente, ritmo lento, backoff e STOP graceful. Il flag `--disable-blink-features=AutomationControlled` già presente è configurazione standard del browser, non un aggiramento del challenge.

### 2026-11-15 — SCOPERTA CHIAVE: headless rilevato → usare SEMPRE headed

- Test comparativo: `curl` (client non-browser) → **200** su tempocasa/remax/tecnocasa; **Playwright `--headless` → 403** sugli stessi URL. Il 403 è **rilevamento della modalità headless**, NON un blocco IP permanente.
- **Con Chromium headed (finestra reale) lo scraping funziona**: tempocasa ha raccolto 6 annunci reali con dati completi (camere, locali, bagni, mq, date pubblicazione/modifica).
- Decisione: **default headed per tutti i portali** (il runner usa `--headless` solo come opt-in esplicito). casa.it/wikicasa torneranno accessibili in headed una volta raffreddato l'eventuale rate-limit residuo.
- `gotoResilient` nel core: retry con backoff (20/40/60/80s) sul 403/429, poi STOP graceful. Rispetto del rate-limit, nessun aggiramento.
- tempocasa: sezione DOM "Dettagli" espone **Camere da letto N** esplicito + Cucina/Balconi/Cantina; descrizione ha piano/zona. JSON-LD privo di camere → si usa il DOM.
- tempocasa NON copre Pianoro (0 annunci); copre Bologna città e San Lazzaro di Savena (24). Fail-open: comune assente = nessun annuncio, non errore.

### 2026-11-15 — Adattatori costruiti e VALIDATI end-to-end (headed)

| Portale        | Stato       | Annunci test | Geocode       | POI | BIG/SMA test        | Note                                                        |
| -------------- | ----------- | ------------ | ------------- | --- | ------------------- | ----------------------------------------------------------- |
| immobiliare.it | ✅ legacy   | 34           | ✅            | ✅  | sì                 | dataset storico, incluso in GLOBAL                          |
| tempocasa      | ✅ validato | 24           | 20/24         | ✅  | 0 (fascia alta)     | DOM "Dettagli" camere esplicite; date per STALE             |
| remax          | ✅ validato | 9            | 5/9           | ✅  | 0 (fascia alta)     | sottodomini agenzia multipli; mq anomali da fonte           |
| tecnocasa      | ✅ validato | 15           | 11/15         | ✅  | 0 (nuda proprietà) | DOM "Caratteristiche" camere esplicite                      |
| tecnorete      | ✅ validato | 12           | 9/12          | ✅  | 0                   | **stesso DB tecnocasa** (ID identici) → dedup        |
| wikicasa       | ✅ validato | 8            | ✅ geo nativo | ✅  | 0 (fascia alta)     | JSON-LD camere+geo; backoff supera 403 iniziale             |
| bakeca         | ✅ validato | 12           | 7/12          | ✅  | 0 (fuori comuni)    | sottodominio bologna = tutta la provincia; whitelist filtra |
| mitula         | ✅ validato | 30 card      | da zona       | ✅  | in corso            | aggregatore: dati da data-attr card, no dettaglio           |
| trovit         | 🔄 test     | —           | —            | —  | —                  | **stesso DB mitula** (data-retis-id) → dedup         |

**Scoperte chiave sul campo:**

- **tecnocasa ≡ tecnorete**: stesso database, ID annuncio identici (es. 61299751). Il dedup GLOBAL li unifica (stesso prezzo+mq+indirizzo). Agenzia diversa ("Tecnocasa"/"Tecnorete") ma il cluster regge.
- **mitula ≡ trovit**: piattaforma Lifull/Thribee, `data-retis-id` di trovit = `data-listingid` di mitula. Stesso DB → dedup. Entrambi aggregatori: i dati card (prezzo, locali, bagni, mq, zona, età, fonte) bastano per flip/dedup, nessun viaggio in dettaglio.
- **casa.it: WAF DataDome persistente** anche headed (403 dopo 5 min di backoff). Diverso da tempocasa/remax/wikicasa. Adapter pronto (`__NEXT_DATA__.pdp` ricchissimo) ma portale non accessibile al momento → DIFFERITO, run rimandato. Nessun aggiramento.
- **wikicasa: 403 iniziale transitorio**, superato dal backoff di `gotoResilient` (30s) → poi scraping regolare. Conferma che il backoff è la strategia corretta.
- **bakeca**: il sottodominio `bologna.bakeca.it` copre TUTTA la provincia (Argelato, Camugnano, Calderara, ecc.). La whitelist comuni a valle scarta i fuori-target. Aste catturate (campo isAuction). Privati/agenzia distinti.
- **mitula filtro prezzo URL non rigoroso**: `/appartamento-bologna-160000-euro` mostra anche annunci >160k; il filtro BIG/SMA a valle scarta correttamente.

**Migliorie core apportate:**

- `core/schema.mjs`: aggiunto `bedroomsFromText(desc, locali)` condiviso (prima duplicato in ogni adattatore).
- `core/runner.mjs`: `BlockedError` in `collectListings` ora gestito con STOP graceful + save (prima crashava).
- `core/enrich.mjs`: geocode Nominatim + POI Overpass condivisi, cache POI root (6666 elementi) riusata da tutti i portali → arricchimento istantaneo dopo il primo.
- `core/dedup.mjs`: union-find con blocking per comune+prezzo, source priority, richness. Pronto per GLOBAL.

**Decisione camere mancanti**: dove il portale non espone le camere (remax, mitula, trovit, bakeca), si deducono da descrizione/titolo con `bedroomsFromText` (fallback conservativo locali-1). Le camere dedotte sono "dichiarate", non verificate su planimetria.

### 2026-11-15 — Fix prezzo-null, geocode omònimi, caasa, dedup DB condiviso, sito unificato

- **FIX prezzo null (fail-closed sul budget)**: gli annunci "Consultare il prezzo" / "Prezzo su richiesta" (mitula, trovit, caasa) avevano `prezzo=null` e passavano BIG/SMA come Selezionati (fail-open). Ora `core/filters.mjs` li esclude con "Prezzo non disponibile: budget non verificabile". Effetto reale: **trovit 9→0 BIG**, **mitula 7→1 BIG / 4 SMA**. Il "? €" nei log è prezzo-su-richiesta legittimo, NON un bug di parsing.
- **FIX geocode omònimi (in ENTRAMBI i moduli)**: Nominatim risolveva "Santo Stefano" (quartiere di Bologna) a una frazione remota a 13.4 km. Aggiunto `plausible(lat,lon)` = `nearestCenter(...).km ≤ 12` che scarta gli omònimi, sia in `core/enrich.mjs` (runner) sia in `core/geocode-nominatim.mjs` (standalone). Agisce solo sui nuovi geocode: i dati già raccolti con coordinate errate richiedono reset/ri-scraping.
- **caasa VALIDATO**: 18 annunci, geocode 18/18, POI rank ok. Aggregatore puro ClickTag → immobiliare.it (qualche trovacasa.it). Card `.result-item`/`[id^="ID_"]`, realUrl decodificato dal ClickTag `url=`. 0 BIG / 1 SMA (fascia alta + prezzo-su-richiesta).
- **Regola dedup DB condiviso**: tecnocasa/tecnorete condividono lo stesso ID numerico di database. Alcune coppie avevano score 0.60 (<0.75) per la penalità agenzia (-0.2) e NON venivano unite. Aggiunta `sameSharedDbId()` in `core/dedup.mjs`: ID numerico identico + portali nello stesso `SHARED_DB_GROUPS` → score 1.00. Risultato: **153 annunci → 138 unici, 15 duplicati**, tutte le 8 coppie tecnocasa/tecnorete a 1.00.
- **Sito UNIFICATO root costruito e VALIDATO nel browser**: `build-site.mjs` root aggrega i 10 portali attivi + 15 differiti, deduplica in GLOBAL. `site-src/` (index.html, app.js, style.css) → `site/`. **162 annunci lordi → 147 unici (15 duplicati, 15 multi-portale)**, 134 nel target comuni. Zero errori JS. Nav GLOBAL + per-portale + Aste&NPL + Differiti. Viste dashboard/big/sma/reno/stale/multi/tutti, dettaglio con tabella fonti, export CSV (colonna Portale), filtri/ordinamento. ID lunghi degli aggregatori troncati con ellissi + tooltip.
- **Stato portali attivi (10)**: immobiliare.it 34, tempocasa 24, remax 9, tecnocasa 15, tecnorete 12, wikicasa 8, bakeca 12, mitula 15, trovit 15, caasa 18.
- **Sezione Aste & NPL**: placeholder informativo nel sito (prelios, dovalue, agenziademanio, invimit, ~~intesasanpaolo~~). Listing accessibili ma schema aste diverso → non entrano in BIG/SMA/dedup standard. Adattatori dedicati da costruire in fase successiva.
  → *intesasanpaolo rimosso da questa sezione dopo la ricognizione: non è un portale aste.*
- **Differiti (15)**: idealista/subito/attico (URL 404 da riscoprire), casait (DataDome), trovacasa (gruppo immobiliare), casaclick (alias wikicasa), casadaprivato/flatsearch/facebook/nextdoor (login/P2P), dovalue (corporate NPL), intesasanpaolo/prelios/agenziademanio/invimit (aste).
  → *Stato storico: superato dai round successivi. Stato attuale in [requisiti §11.2](./immobiliare.it/requisiti-immobilare.md).*

### 2026-11-15 — Strategie complete + FIX qualità dati zona

- **Tutti i 25 portali hanno `strategia.md`**: 10 attivi, 1 bloccato (casait), 9 differiti, 5 aste/NPL (prelios, dovalue, agenziademanio, invimit, intesasanpaolo con schema ridotto e URL verificati). Aggiunti anche i riferimenti legacy immobiliare.it. Requisiti aggiornati con §11 (architettura multi-portale, criteri BIG/SMA invariati).
  → *Conteggi e categorizzazione storici, superati dai round successivi (oggi 16 attivi, 9 differiti; intesasanpaolo non è aste).*
- **FIX bug zona (data-quality)**: le regex di estrazione zona dagli adattatori catturavano vani interni ("zona giorno"/"zona notte" → tempocasa/remax), descrittori generici ("residenziale", "comoda", "ambitissima") e perfino l'INTERO body della pagina (wikicasa, regex `[^,]+` greedy fino a "Wikicasa" nel footer, 4456 char). Impatto: display sbagliato ("1679911 — giorno · 420.000 €") e raggruppamento falsato delle mediane RENO per sottozona.
  - **Fix centrale** in `core/schema.mjs`: nuova `sanitizeZona(raw)` scarta (a) testo >60 char = body catturato, (b) parole di descrizione/footer (wikicasa/prezzo/appartamento/mq…), (c) vani interni (giorno/notte/living/cottura/hobby/ingresso…), (d) aggettivi descrittivi ovunque nella stringa (residenziale/tranquilla/comoda/ambitissima/pregio/circostante/pedecollinare…), (e) avverbii in -mente e frasi introdotte da preposizione (di/del/a/in…). Gestisce le sottozone "A / B" pulendo ogni parte. Applicata in `normalizeAd` → vale per TUTTI i portali, scrape futuri inclusi.
  - **`zonaFromDescrizione(desc)`** condivisa: estrae "in zona Mazzini"/"quartiere Navile" dalla descrizione (sanitizzata) come fallback quando il breadcrumb manca o era spurio.
  - **Regex wikicasa corretta**: `Case a ([A-Za-zàèéìòù' ,]{3,60}?)\s+Wikicasa` (bounded, sole lettere/spazi/virgole) + fallback descrizione.
  - **Recupero dati cached**: `build-site.mjs` ora sanitizza la zona di ogni annuncio e, se vuota, la recupera dalla descrizione; poi **ricalcola il flip** (`analyzeFlip`) con le zone corrette, così le mediane per zona sono giuste senza ri-scrapare. 44 zone corrette su 6 portali (tempocasa 15, tecnocasa 11, wikicasa 8, caasa 5, remax 3, bakeca 1), di cui 6 recuperate dalla descrizione.
  - **Effetto sul RENO**: candidati 8→6 (i 2 falsi positivi erano raggruppati su zone spurie). Tutti i 6 candidati ora sono "Da ristrutturare" reali con mediane di zona corrette (Borgo Panigale, Tazzola, San Ruffillo, Bolognina). Il prezzo €420k nel pool RENO NON era un bug: il budget non si applica al flip (semaforo rosso se ROI negativo) — comportamento intenzionale.
  - **Validazione**: rebuild OK (162→147), browser zero errori JS, filtro zone pulito (solo quartieri reali), dashboard e viste RENO/STALE corrette.
- **Nota display**: il campo zona resta stringa libera del portale; `sanitizeZona` è conservativa (meglio zona vuota che zona sbagliata). Le zone vuote non falsano le mediane (vengono escluse dal raggruppamento per sottozona).

### 2026-11-15 — Censimento LOGIN/2FA + runner globale di autenticazione

**Ricognizione col browser agent-controlled** dei form di login (selettori reali verificati sul campo). Il censimento distingue login **obbligatorio** (annunci visibili solo dopo autenticazione) da **opzionale** (annunci pubblici; il login riduce attriti/WAF e sblocca funzioni).

| Portale              | Login                                       | 2FA                   | Flusso                | Selettori verificati                                                                                                                                       | Env prefix    | Note                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------- | --------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **facebook**   | OBBLIGATORIO                                | sì (checkpoint)      | email+pwd             | `input[name=email]`, `input[name=pass]`, `button[name=login]`                                                                                        | `FB`        | Marketplace geolocalizzato USA → impostare Bologna. ID dinamici → usare `name`.                                                                                                                                                                        |
| **nextdoor**   | OBBLIGATORIO — **non richiesto**     | possibile (email/SMS) | email+pwd / OAuth     | `#id_email` (**type=text**), `#id_password`, `#signin_button`; OAuth `#google-button`/`#facebook-button` — **confermati sul campo** | `NEXTDOOR`  | `/for_sale_and_free/` e `/choose_address/` → login wall (status **200**, pagina login). Selettori validi ma **login non attivato**: la fonte non contiene immobili in vendita (solo usato). Env `NEXTDOOR_*` **non configurate**. |
| **flatsearch** | ~~OBBLIGATORIO~~ → **NESSUN LOGIN** | no                    | —                    | —                                                                                                                                                         | —            | **Verdetto errato, corretto**: listing e dettaglio sono pubblici. Il modale "Sign in" è facoltativo. Spostato in PUBLIC_NO_LOGIN, env `FLATSEARCH_*` non servono.                                                                                 |
| **idealista**  | opzionale                                   | no                    | **email-first** | `#login-email` → "Continua" → `input[type=password]`; OAuth Google(iframe)/Apple                                                                     | `IDEALISTA` | Sessione autenticata può ridurre i 403 WAF sul profilo headless.                                                                                                                                                                                          |
| **subito**     | opzionale                                   | possibile             | manuale (SPA)         | form JS non ispezionato → manuale                                                                                                                         | `SUBITO`    | Area riservata SPA; annunci pubblici senza login.                                                                                                                                                                                                          |
| **casait**     | opzionale                                   | possibile             | modale manuale        | modale "Accedi al tuo account" (header); `/utente/login` è 404                                                                                          | `CASAIT`    | Dietro WAF DataDome: il login NON aggira il WAF (fail-closed §8).                                                                                                                                                                                         |

**Portali PUBBLICI senza login (19)**: immobiliare.it, wikicasa, tempocasa, remax, tecnocasa, tecnorete, mitula, trovit, caasa, bakeca, attico, trovacasa, casadaprivato, **flatsearch**, intesasanpaolo, prelios, agenziademanio, invimit, dovalue. Il runner li salta (nessuna credenziale richiesta).

**Runner globale `login-all.mjs`** (script `npm run login`):

- All'avvio itera i portali con login; per ognuno apre il **profilo persistente** `<cartella>/profile` (lo STESSO dello scraper → i cookie di sessione vengono riusati dallo scraping).
- Inserisce **user/password SOLO da variabili d'ambiente** `<PREFIX>_USER`/`<PREFIX>_PASS` (mai nel codice, mai loggate). Se mancanti → modalità manuale.
- **2FA/CAPTCHA/OAuth = manuali**: il runner si mette in pausa (`⏸ Premi INVIO quando hai finito`) e l'utente completa dal **smartphone**/browser. Nessun solving automatico, nessun aggiramento (policy §8, fail-closed).
- Verifica la sessione post-login (`sessionCheck`) e la persiste chiudendo il contesto (flush storage su disco).
- Flag: `--portal <id|alias>` (singolo), `--required` (solo obbligatori), `--check` (verifica sessioni senza login), `--headless` (sconsigliato: il 2FA manuale richiede la finestra).
- Scrive `login-report.json` (stato per portale, **nessuna credenziale**).
- Registro: `core/auth-registry.mjs` (loginUrl, selettori, envPrefix, needs2FA, sessionCheck, notes per portale).

**Validazione runner**: `node login-all.mjs --portal idealista --check` → navigazione resiliente (backoff sul 403 WAF), rilevamento sessione corretto ("logged-out"), report scritto, nessuna credenziale esposta. Il profilo Playwright di idealista incontra il noto 403 WAF (il browser agent-controlled funziona): gestito con fail-closed, nessun aggiramento.

**Credenziali da impostare (env)** prima di `npm run login`:
`FB_USER`/`FB_PASS`, `NEXTDOOR_USER`/`NEXTDOOR_PASS`, `IDEALISTA_USER`/`IDEALISTA_PASS`, `SUBITO_USER`/`SUBITO_PASS`, `CASAIT_USER`/`CASAIT_PASS`. In PowerShell: `$env:FB_USER="…"; $env:FB_PASS="…"` (solo nella sessione corrente, mai su file).
*(`FLATSEARCH_USER`/`FLATSEARCH_PASS` non servono più: portale pubblico.)*

### 2026-11-15 — Criticità portale per portale (ricognizione completa, browser agent-controlled)

Esito della ricognizione di TUTTI i 25 portali col browser agent-controlled (via di default). Stato accesso, blocco, strategia.

**ATTIVI (16) — scraping funzionante o adapter pronto:**

| Portale        | Criticità                                            | Mitigazione                                                           | Stato                               |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------- |
| immobiliare.it | nessuna rilevante                                     | headed + profilo persistente                                          | ✅ legacy 34 annunci                |
| wikicasa       | 403 iniziale transitorio                              | backoff `gotoResilient` (30s)                                       | ✅ geo nativo JSON-LD               |
| tempocasa      | headless rilevato (403)                               | **headed obbligatorio**                                         | ✅ DOM camere esplicite             |
| remax          | headless rilevato                                     | headed                                                                | ✅ sottodomini agenzia              |
| tecnocasa      | headless rilevato                                     | headed                                                                | ✅ ≡ tecnorete (dedup DB)          |
| tecnorete      | headless rilevato                                     | headed                                                                | ✅ ≡ tecnocasa                     |
| mitula         | prezzo-su-richiesta (null)                            | fail-closed budget                                                    | ✅ aggregatore                      |
| trovit         | ≡ mitula (DB Lifull)                                 | dedup `data-retis-id`                                               | ✅ aggregatore                      |
| caasa          | ClickTag → altri portali                             | realUrl decodificato                                                  | ✅ aggregatore                      |
| bakeca         | sottodominio = tutta provincia                        | whitelist comuni                                                      | ✅ privato/agenzia                  |
| attico         | contenuto nazionale su URL Bologna                    | filtro comune a valle                                                 | ✅ adapter                          |
| casadaprivato  | URL ricerca da form                                   | esplorazione form                                                     | ✅ adapter                          |
| trovacasa      | gruppo Immobiliare.it                                 | fonte già coperta                                                    | 🟡 bassa priorità                  |
| casait         | **WAF DataDome persistente** (403 anche headed) | backoff lungo; fail-closed; login opzionale NON aggira                | ⛔ adapter pronto, run rimandato    |
| idealista      | **WAF 403 sul profilo Playwright**              | browser agent-controlled funziona; seed-from-browser; login opzionale | 🟡 seed browser (geocode da fixare) |
| subito         | headless rilevato; URL regione non provincia          | headed; `/annunci-emilia-romagna/...`                               | ✅ NEXT_DATA                        |

**DIFFERITI / ASTE-NPL (8) — ricognizione completata:**

| Portale                   | Cosa è realmente                                                       | Accesso                                      | Strategia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **casaclick**       | alias di wikicasa (redirect)                                            | pubblico                                     | un solo adapter wikicasa; sezione alias informativa                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ~~**flatsearch**~~ | ~~assistente AI, no listing pubblico~~                                 | ~~login obbligatorio~~                      | **PROMOSSO AD ATTIVO**: verdetto errato, listing pubblico con 344 annunci ≤160k. Vedi sezione dedicata.                                                                                                                                                                                                                                                                                                                                                                                        |
| **facebook**        | Marketplace P2P geolocalizzato                                          | **login fatto** (+2FA manuale)         | **Bologna · 20 km impostato e persistente**; URL `/marketplace/110340245656034/search/?query=…&maxPrice=160000`; `maxPrice` server-side; categoria "Vendite di case" **vuota** su Bologna → query testuale; card strutturate + `item_id`; **card inaffidabili** (città = sede venditore, affitti con layout identico alle vendite) → **verifica del dettaglio obbligatoria**; 589 card → **0 BIG/SMA** → fonte complementare                               |
| **nextdoor**        | social di quartiere, **bacheca oggetti usati**                    | **login obbligatorio** (non richiesto) | `/for_sale_and_free/` e `/choose_address/` → login wall (status **200** ma pagina login); selettori `#id_email`/`#id_password`/`#signin_button` confermati; pagine SEO pubbliche `/citta/<slug>--emr/` e `/quartiere/<slug>--<citta>--emr/`; **107 quartieri su tutti e 6 i comuni target**, 119 gruppi a Bologna; ma "For sale and free items nearby" contiene **solo mobili/usato** → **0 immobili in vendita su ~36 listing campionati** → nessun adapter |
| **dovalue**         | corporate NPL/credit servicing                                          | listing non pubblici                         | sezione ASTE/NPL informativa; no scraping standard                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **intesasanpaolo**  | **vetrina pubblica** vendita diretta gruppo (patrimonio dismesso) | pubblico, **scrapeable**               | `/immobili` 850 annunci nazionali; **URL diretti** `?comune=<ISTAT>` / `?provincia=037`; **8 annunci in provincia BO, 5 nei comuni target, 0 residenziali**; adapter scritto e testato → **DEFERRED per contenuto** (vedi sezione dedicata)                                                                                                                                                                                                                                  |
| **prelios**         | Blinks Real Estate (piattaforma Wikicasa)                               | pubblico                                     | `blinksre.prelios.com` filtrabile `/re/.../provincia-bo/contratto-vendita/`; **0 living vendita a Bologna** (copertura bassa); area riservata wikicasa.it/pro/login-blinks                                                                                                                                                                                                                                                                                                                  |
| **agenziademanio**  | bandi pubblici (gare locazione/vendita)                                 | pubblico                                     | `/it/gare-aste/immobiliare/` avvisi di gara, NON annunci residenziali standard; schema aste                                                                                                                                                                                                                                                                                                                                                                                                         |
| **invimit**         | vetrina aste RAN/confronto competitivo                                  | pubblico                                     | `vetrinaimmobili.invimit.it` WordPress; filtri Comune/Procedura/Stato Bando; schede PDF/DOC; schema aste                                                                                                                                                                                                                                                                                                                                                                                            |

**Decisioni operative dalla ricognizione:**

- **intesasanpaolo è scrapeable** (vetrina pubblica, 850 annunci nazionali, vendita diretta non aste giudiziarie). ~~candidato alla promozione ad ATTIVO~~ → **superato**: la ricognizione completa ha trovato **0 immobili residenziali** nell'area target, quindi resta DEFERRED con adapter pronto (vedi sezione dedicata). Il form provincia richiede il codice interno dal dropdown (il param `?provincia=Bologna` dà 0); banner iubenda `#iubenda-cs-banner` intercetta i click → rimuovere via JS. Mix residenziale+commerciale → whitelist.
- **prelios/blinks**: stessa piattaforma Wikicasa (adapter riusabile) ma **0 annunci living vendita a Bologna** → valore attuale nullo per il target; tenere come fonte aste/NPL informativa.
- **agenziademanio / invimit**: bandi/aste con schema diverso (PDF, RAN) → non entrano in BIG/SMA/dedup standard; sezione Aste&NPL dedicata.
- **facebook**: login obbligatorio → gestito dal runner globale `login-all.mjs` (env + 2FA manuale). Post-login: marketplace geolocalizzato su Bologna, fonte P2P complementare.
- ~~**flatsearch**: login obbligatorio~~ → **corretto**: nessuna login necessaria, adapter scritto e validato (vedi sezione dedicata).
- **nextdoor**: login censito nel runner ma **non richiesto all'utente**: la ricognizione sulle pagine pubbliche SEO ha dimostrato che la fonte non contiene immobili in vendita (vedi sezione dedicata). Richiedere credenziali + 2FA sarebbe costo a resa nulla.

### 2026-11-15 — Intesa Sanpaolo RICOGNIZIONE CHIUSA: scrapeable ma 0 residenziale

- **Browser agent-controlled**, nessun WAF, nessuna login, HTTP 200. È **il differito più pulito da scrapeare**.
- **Corretta la classificazione errata "ASTE / fuori criteri / ricerca solo via form"** (D3, D7, probe round 1+2):
  è **vendita diretta** di patrimonio dismesso del gruppo, con "manifestazione di interesse". Il filtro Stato
  ha 4 voci (*In vendita / In gara / Venduto / Aggiudicato*): "In gara" è procedura competitiva interna, **non asta
  giudiziaria**. Il prezzo esposto è un **VALORE** di vendita, non una base d'asta.
- **SCOPERTA CHIAVE — URL diretti filtrabili**: il form usa dropdown custom (`button` + `ul > li`, nessun `<select>`),
  ma i **breadcrumb della pagina di dettaglio** espongono gli stessi filtri in query string. Si bypassa il form:
  - `?provincia=037` → **codice interno a 3 cifre** (NON ISTAT, NON nome: `?provincia=Bologna` dà 0 **senza errore**)
  - `?comune=037011` → **codice ISTAT a 6 cifre** (Bologna `037006`, Casalecchio `037011`, Castenaso `037019`,
    Pianoro `037047`, San Lazzaro `037054`, Zola Predosa `037061`)
  - `?tipologia=29` (Deposito), `?vista=griglia|elenco|mappa`, `?ordina=price-ascending|…`
  - Paginazione nel **path**: `/immobili/pag-N?comune=…`, **6 card/pagina**
  - Il contatore `MOSTRA I RISULTATI (N)` è **live**: si stima la resa di un filtro senza caricare i risultati.
  - *Trucco riusabile su altri portali con form opachi*: aprire un dettaglio e leggere i link "Ricerca per: Comune > Tipologia".
- **Esito sul contenuto — il vero blocco**: provincia Bologna **8 annunci su 2 pagine** (2 già VENDUTI), solo 5 comuni
  con patrimonio (Argelato, Bologna, Casalecchio, Casalfiumanese, Marzabotto). Nei **6 comuni target: 5 annunci, tutti
  non residenziali** (3 a Bologna: 2 Filiali Bancarie + 1 Ufficio; 2 a Casalecchio: Deposito + Ufficio).
  Le **5 tipologie residenziali** rilevanti interrogate su provincia 037 → **tutte `MOSTRA I RISULTATI (0)`**.
  → **0 BIG / 0 SMA.** Mappa verificata in `intesasanpaolo/probe/comuni-target.json`.
- **Adapter scritto e VALIDATO comunque** (`intesasanpaolo/adapter.mjs` + `scrape.mjs`, modello casadaprivato):
  il portale è tecnicamente pulito e il patrimonio bancario cambia nel tempo → costo di manutenzione basso, pronto all'uso.
  Run reale: **0 annunci, 5 scartati come non residenziali**, coerente con la ricognizione manuale.
- **Listing e dettaglio hanno parser DIVERSI**: il listing usa `<table>` (Indirizzo/Superficie), il dettaglio
  **non ha né `<table>` né `__NEXT_DATA__` né JSON-LD** → coppie di `<p>` fratelli con label
  `Tipologia`/`Comune`/`Indirizzo`/**`Valore`**/`Superficie`. Il `<title>` contiene **`rif. IT…`**, id stabile utile al **dedup**.
  Non espone locali/camere/bagni/piano → per un eventuale residenziale servirebbe la **brochure PDF** (`media.getrix.it`).
- **Gotcha — falso positivo CAPTCHA**: il footer di **ogni** pagina recita "Questo sito è protetto da reCAPTCHA"
  (il widget è solo sul form di contatto, mai usato). Il `checkBlocked` condiviso cerca `/captcha/i` nel testo e
  **abortiva ogni dettaglio**. L'adapter usa un `checkPage` locale che verifica solo il blocco reale (HTTP 403/429,
  "accesso negato", iframe challenge, assenza dati attesi): **resta fail-closed, nessun CAPTCHA risolto**.
- **Decisione**: **resta DEFERRED**, ma il motivo cambia natura — da "aste fuori criteri" (sbagliato) a
  **"scrapeable e pronto, patrimonio non residenziale nell'area target"**. Promuoverlo ad ACTIVE aggiungerebbe
  un portale a resa nulla. **Nessuna login richiesta** (vetrina pubblica). Ricognizione Intesa **chiusa**.
- **LEZIONE (conferma del pattern Nextdoor)**: anche qui il blocco è di **contenuto**, non tecnico.
  **Verificare il contenuto PRIMA di investire nell'adapter**: la facilità di scraping non predice la resa.

### 2026-11-15 — Facebook RICOGNIZIONE CHIUSA: Marketplace sbloccato ma resa nulla per il flip

- **Login manuale eseguito** (2FA dallo smartphone), profilo persistente `facebook/profile/`.
- **Marketplace geolocalizzato su Bologna · 20 km**, persistente nell'account. URL stabile:
  `https://www.facebook.com/marketplace/110340245656034/search/?query=<q>&maxPrice=160000&exact=false`
  (`110340245656034` = ID città Bologna). `maxPrice` funziona server-side; `latitude/longitude/radius`
  nell'URL sono **ignorati**; lo slug `/marketplace/bologna/` perde la geo → usare l'ID numerico.
- **Cambio località**: il controllo "<Città> · <N></n> km" apre il dialog "Cambia luogo". Digitare "Bologna"
  **non abilita "Applica"**: serve selezionare il suggerimento (`pressSequentially` + `ArrowDown` + `Enter`).
  Raggio disponibile: 1/2/5/10/20/40/60/80/100/250/500 km (**no 30**) → scelto 20 km.
- **Categoria "Vendite di case" (`category_id=1270772586445798`) è VUOTA su Bologna** → usare query testuale.
- **Raccolta**: 589 card su 9 query, 72 candidate ≤160k, **7 in zona, 0 BIG, 0 SMA**.
- **Criticità decisiva — la card non è affidabile, il dettaglio è obbligatorio**:
  (1) la città nella card è la **sede del venditore**, non la posizione dell'immobile (case in Puglia
  risultavano "Bologna"); (2) le card **"Affitti" hanno lo stesso layout delle vendite** ("2 camere da letto
  1 bagno Casa") col prezzo *al mese* → un affitto da €91.350/mese era stato classificato **BIG**;
  (3) nel mix finiscono anche **auto usate** (Mercedes GLE a €30.990);
  (4) l'unica vendita residenziale reale in zona (bilocale via Zanardi 196, 43 m², €149.000, privato)
  è pubblicata **3 volte** con `item_id` diversi → dedup interno per indirizzo+prezzo+mq, ed è fuori criteri.
- **Strumenti**: `facebook/probe/filter-marketplace.mjs` (filtro zona + esclusioni affitto/non-res/fuori-zona
  + gate sugli esiti verificati) e `facebook/probe/marketplace-verificati.json` (esiti dal dettaglio).
- **Decisione**: Marketplace Facebook è **tecnicamente scrapeable** ma **non promuovibile ad adapter
  primario**: costo di verifica del dettaglio alto, resa zero sui criteri flip. Resta **fonte P2P
  complementare** per STALE, sezione informativa nel sito. **Ricognizione Facebook chiusa** → si passa a Nextdoor.

### 2026-11-15 — Nextdoor RICOGNIZIONE CHIUSA: login wall + fonte non immobiliare

- **Browser agent-controlled** su `https://it.nextdoor.com/login/`. Nessun WAF/CAPTCHA: l'unico blocco è l'autenticazione.
- **Credenziali assenti**: `NEXTDOOR_USER`/`NEXTDOOR_EMAIL`/`NEXTDOOR_PASS`/`NEXTDOOR_PASSWORD` tutte vuote, nessun `.env` → sarebbe servito login manuale. **Non richiesto** (vedi esito).
- **Login wall verificato**: `/for_sale_and_free/` (con e senza `?category=for_sale`), `nextdoor.it/for_sale_and_free/`,
  `/choose_address/` → tutti chiusi. **Status HTTP 200 anche sulla pagina di login** → il rilevamento va fatto
  su URL/contenuto finale, non sullo status. **404**: `/neighborhood/bologna/`, `/city/bologna/`, `/it/for-sale-and-free/`.
- **Selettori confermati sul campo** (il registry era già corretto): `input#id_email` (**`type=text`**, non `email`),
  `input#id_password`, `button#signin_button`; OAuth `#google-button`/`#facebook-button`. Form `method=get`.
- **URL pubblici scoperti**: `/trova-quartiere/` → 20 regioni (**Emilia-Romagna = `emr`**) → `/trova-quartiere/emr/`
  → elenco città. Pattern reale: **`/citta/<slug>--<regione>/`** e **`/quartiere/<slug>--<citta>--<regione>/`**.
- **Copertura geografica ottima**: **107 quartieri su tutti e 6 i comuni della whitelist**
  (Bologna 63 · San Lazzaro 14 · Casalecchio 11 · Castenaso 4 · Pianoro 8 · Zola Predosa 7),
  119 gruppi a Bologna, "1.000+ listings". Mappa persistita in `nextdoor/probe/quartieri-target.json`
  (estrattore: `nextdoor/probe/estrai-quartieri.mjs`).
- **Criticità decisiva — la fonte non è immobiliare**: le pagine SEO espongono la sezione
  **"For sale and free items nearby"**. Campionata su 6 pagine (città Bologna + Bolognina Nord-Ovest, Costa,
  Mazzini, Savena/San Lazzaro, Pianoro): sedie, divani, catene da neve, letti, armadi, macchina da cucire,
  carta Pokémon, congelatore, **auto usata a €6.500**. **0 immobili in vendita su ~36 listing.**
  L'unico match è *"Affittasi Garage Centro" €1* → escluso due volte (affitto ≠ vendita, garage ≠ residenziale).
  **For Sale & Free è il mercatino dell'usato del quartiere**, non esiste una categoria case/appartamenti.
- **Decisione**: **nessun adapter Nextdoor**, **nessuna richiesta di login**. Il login da solo non sbloccherebbe
  annunci utili: il limite è il **contenuto**, non l'accesso. La fonte **non entra in GLOBAL**.
  Rivalutare solo se emergono vendite reali nei **gruppi** di quartiere (canale diverso, chiuso al pubblico).
- **Gotcha tecnico — timing DOM**: una `page.evaluate` a ~2500 ms dal `goto` può restituire DOM **vuoto**
  (`input:[]`, `button:[]`, `form:[]`) con snapshot accessibility già popolato. **Non è shadow DOM**
  (`hostCount:0`) → usare `page.locator(sel).count()` (auto-wait) o ripetere la evaluate.
- **Gotcha tecnico — filtro link**: i link città stanno sotto `/citta/…`, non sotto `/trova-quartiere/<reg>/…`;
  una regex troppo stretta dà `links:[]` su una pagina piena → in ricognizione fidarsi dello **snapshot accessibility**.
- **Gotcha encoding**: `innerText` può arrivare in mojibake (`â‚¬` per `€`, `Â·` per `·`) → normalizzare prima del parsing prezzi.
- **Gotcha tecnico**: `window.__x` si **azzera ad ogni `page.goto`** → accumulare lato Node (`Object.assign`).
  Regex prezzo: `[\d.\s]` greedy cattura il contatore foto "+5" concatenando le cifre → usare `[\d.]`.
- **casait / idealista**: WAF (DataDome / 403). Il browser agent-controlled accede; il profilo Playwright headless no. Fail-closed: nessun aggiramento. Per idealista esiste `seed-from-browser.mjs` (geocode da fixare: indirizzo/zona dal titolo). Login opzionale censito nel runner (può ridurre gli attriti ma NON aggira il WAF).

### 2026-11-15 — FlatSearch RICOGNIZIONE CHIUSA: promosso ad ATTIVO (verdetto iniziale errato)

**Il differito più ricco del progetto era classificato per errore come "login obbligatorio".**
La prima ricognizione aveva provato solo URL intuitivi (`/compra`, `/ricerca`, `/annunci`, `/search`,
`/case/bologna`, …) — tutti 404 — e la home mostra un assistente AI che suggerisce un prodotto chiuso.
**Errore di metodo**: non erano stati letti i link reali della home. La home linka **"Annunci per città"**
verso i percorsi veri, tutti pubblici. `robots.txt` = `User-Agent: * / Allow: /` (vietati solo `/api/` e `/admin/`).
**Nessun login, nessun WAF, nessun CAPTCHA.** Il modale "Sign in" esiste ma è facoltativo.

**Resa misurata ≤160.000 € sui 6 comuni target: 344 annunci — più di tutti gli altri portali attivi messi insieme.**

| Comune                | ≤160k        |
| --------------------- | ------------- |
| Bologna               | 273           |
| Zola Predosa          | 18            |
| Pianoro               | 16            |
| San Lazzaro di Savena | 15            |
| Casalecchio di Reno   | 14            |
| Castenaso             | 8             |
| **Totale**      | **344** |

(Senza filtro prezzo Bologna dichiara 4.199 annunci. Mappa in `flatsearch/probe/resa-target.json`.)

- **Cos'è**: **aggregatore di 7 portali** (Subito, Immobiliare.it, Casa.it, Idealista, …). Ogni annuncio dichiara
  su quali portali è pubblicato → **la fonte migliore del progetto per il dedup cross-portale in GLOBAL**.
- **URL**: listing `/properties/sale/province-bologna/municipality-<slug>?price_max=160000&ordering=-updated_at&page=N`;
  dettaglio `/property/<UUID v4>`; pagina provincia elenca i comuni e i loro slug.
- **GOTCHA slug**: gli spazi sono **`%20`, NON trattini**. `municipality-casalecchio%20di%20reno` ✅ —
  `municipality-casalecchio-di-reno` ❌ 404. Apostrofo non encodato (`castello%20d'argile`).
- **GOTCHA filtri**: **solo `price_max` è onorato**. `priceTo`/`max_price`/`maxPrice`/`prezzoMax`/`price=0-160000`/`priceRange`
  sono ignorati **SILENZIOSAMENTE** (il totale non cambia e sembra che funzionino). 20 card/pagina.
  *Regola generale: verificare sempre il contatore dopo aver applicato un filtro, non fidarsi del nome del parametro.*
- **JSON-LD È LA FONTE PRIMARIA DEL DETTAGLIO** (seconda correzione: una nota intermedia diceva che il JSON-LD
  contenesse solo Organization/WebSite). Il secondo blocco `<script type="application/ld+json">` ha un `@graph`
  con 4 nodi: Organization, WebSite, **`RealEstateListing`**, BreadcrumbList. **Cercare il nodo per `@type`, non il primo.**
  Fornisce `geo.latitude/longitude` reali, `offers.price`, `about.floorSize/numberOfRoomsTotal/numberOfBathroomsTotal`,
  `address.streetAddress/addressLocality/postalCode`, `name`, `description`, `image[]`, `datePosted`.
- **DOM come fallback**: `.meta-card__label` / `.meta-card__value` → Superficie, Locali, **CAMERE** (esposte:
  correzione di un'altra nota che le diceva assenti), Bagni, Tipologia, Piano, Classe energetica, Riscaldamento.
  `.property-detail-price`, riga sotto `<h1>` (`indirizzo · Comune, Quartiere`), "Proposto da <agenzia></agenzia>"
  (assente ⇒ **privato**, utile a STALE), "Altre caratteristiche". **Contatti NON esposti** ("disponibili sul portale di origine").
- **GOTCHA COORDINATE — il bug più insidioso incontrato finora**: cercare `lat` con regex libere nell'HTML
  matcha **"F-lat-search"** (nome del brand) e numeri casuali, producendo coordinate **plausibili ma FALSE**,
  identiche su annunci di quartieri diversi. Il primo pilota aveva tutte le coordinate uguali (44.4938203, 11.3426327)
  e il difetto non era visibile a occhio. Diagnosticato con 3 probe (0 coppie plausibili → dump delle occorrenze di "lat"
  → intercettazione delle risposte). **Si legge solo il JSON-LD**; se serve una regex, word-boundary obbligatorio
  (`\b(?:latitude|longitude|lat|lng|lon)\b`). La mappa dichiara "zona, non indirizzo esatto": precisione di quartiere,
  sufficiente per il filtro ≤3 km.
- **Chiave di dedup esatta (opportunità non ancora sfruttata)**: i link ai portali d'origine sono tracker
  `/api/property-analytics/<ID numerico>/track` dove **l'ID è l'ID dell'annuncio sul portale d'origine**
  (668297848 = Subito, 134727351 = Immobiliare.it). Incrociando `portaliOrigine` + questi ID con gli `id` degli
  adapter diretti si può ottenere un **dedup esatto** invece che euristico. Campo `portaliOrigine` già salvato negli annunci.
- **Trappole dati**: (1) **nuda proprietà nel mix** (2 su 12 nel pilota) → esclusa; (2) **affitti marcati VENDITA**
  a € 1.200 → sanity `prezzo < 15000 ⇒ null` (fail-closed); (3) **UUID diversi per lo stesso immobile**
  (via della Barca 47 due volte, stesso prezzo/mq) → dedup interno su **indirizzo+prezzo+mq**, non sull'id;
  (4) `mapStato` **ritorna l'input se non riconosce nulla** → passargli solo un estratto breve, mai la descrizione
  intera (il pilota aveva `stato` = descrizione completa).
- **Pre-filtro superficie in `collectListings`**: il mix ≤160k è **dominato da monolocali 30-45 m²**, che il §2 esclude.
  La card espone i m² → si scartano prima di aprire il dettaglio: **344 candidati → 86** (~75% di dettagli evitati,
  ~4× più veloce) senza perdere nessun annuncio valido.
- **Adapter validato end-to-end**: `flatsearch/adapter.mjs` + `scrape.mjs`. Secondo pilota (post-fix JSON-LD):
  12 annunci, **10 coordinate distinte** (erano 1), `stato` breve, `zona` e `indirizzo` popolati, `portaliOrigine` su 12/12.
- **Registri aggiornati**: `build-site.mjs` DEFERRED→ACTIVE (**17 attivi, 8 differiti**), `core/auth-registry.mjs`
  rimosso da AUTH e aggiunto a `PUBLIC_NO_LOGIN` (19), env `FLATSEARCH_*` non più necessarie.
  Dettagli completi in [flatsearch/strategia.md](./flatsearch/strategia.md).
- **LEZIONE (terza conferma del pattern)**: Intesa sembrava utile ed è vuoto di residenziale; Nextdoor sembrava
  bloccato e non contiene immobili; **flatsearch sembrava chiuso ed è il più ricco**. Il verdetto va dato sul
  **contenuto reale**, non sull'aspetto della home né sugli URL intuitivi.
  **Tecnica riusabile**: leggere i link reali della home → compilare il form e osservare l'URL generato →
  ispezionare TUTTI i blocchi JSON-LD cercando il nodo per `@type` → misurare la resa prima di scrivere l'adapter.

### 2026-11-15 — FIX criterio superficie minima (bug condiviso, tutti i portali)

- **Bug**: la regola §2 *"monolocale vale come 1 camera SOLO se ≥55 m²"* era **documentata ma MAI implementata**.
  `core/filters.mjs` faceva `if (profile.monolocaleIsCamera && rooms === 1 && bedrooms < 1) bedrooms = 1;`
  **senza alcun controllo sulla superficie**; `superficieMq` non era mai referenziato nel file e non esisteva
  alcun `minSuperficie` nel progetto. Effetto: monolocali da **30-38 m² promossi a SMA su TUTTI i portali**.
  Scoperto grazie al pilota flatsearch, il cui mix è dominato da monolocali piccoli.
- **Fix** in `core/filters.mjs`: `minSuperficie: 55` su entrambi i PROFILES (il §2 lo prevede per BIG e SMA);
  esclusione con reason esplicita quando `superficieMq < 55`; il monolocale vale come camera solo con
  superficie **dichiarata e ≥55 m²**. Se la superficie **non è dichiarata** l'annuncio non viene escluso per
  la soglia (dato mancante ≠ violazione accertata) ma il monolocale **non** viene promosso a camera.
- **Validazione**: `test-superficie.mjs` — 7 casi mirati (38 m² escluso, 55 m² soglia esatta incluso, 70 m² incluso,
  mq non dichiarati, bilocale 60 m², BIG 45 m² escluso, BIG 70 m² incluso) + non-sovrapposizione BIG/SMA. **Tutti OK.**

---

## Dedup cross-portale: da euristico a ESATTO dove il portale lo consente

**Problema.** GLOBAL deduplicava solo per euristica (comune + prezzo ±1% + mq ±2,
conferme da agenzia/camere/locali/titolo, soglia 0.75). Funziona, ma sbaglia in due casi:
prezzo **obsoleto** su un aggregatore (delta > 1% ⇒ nessun match) e stesso immobile
con mq mancante. Con l'ingresso di flatsearch — che è un aggregatore degli stessi
immobili degli altri portali — il rischio di doppioni in GLOBAL diventa concreto.

**Soluzione.** Flatsearch espone, nel box "Pubblicato su", i link tracker
`/api/property-analytics/<ID>/track`: **quell'ID è l'id dell'annuncio sul portale
d'origine**. L'adapter ora salva `idsOrigine: [{portale, id}]` e `core/dedup.mjs`:

1. mappa il nome display sul nostro id portale (`ORIGIN_ALIASES`), ignorando i non mappati;
2. `sameOriginId()` assegna **score 1.0** al match dichiarato (aggregatore→diretto, o
   aggregatore→aggregatore che puntano allo stesso annuncio);
3. aggiunge un **secondo blocking sugli ID d'origine**, così il match si trova anche
   quando prezzo e mq divergono e il bucket comune+prezzo non li metterebbe a confronto.

**Garanzie.** Un ID numerico uguale su portali diversi **senza** dichiarazione d'origine
resta una coincidenza: nessun match. `SOURCE_PRIORITY` mette flatsearch **ultimo**, quindi
quando l'immobile arriva anche dal portale diretto vince sempre la fonte primaria.

**Verifica.** `test-dedup-origine.mjs` — 9 casi, tutti verdi: ID batte prezzo/mq divergenti,
match fallisce senza ID, coincidenza di ID tra portali non matcha, portale ignoto ignorato,
cluster unico con prezzo obsoleto, vince il diretto, due aggregatori convergono,
annuncio estraneo resta separato.

**JSON già raccolti.** `flatsearch/enrich-ids.mjs` rivisita solo i dettagli già noti e
aggiunge `idsOrigine` senza riscaricare gli annunci (salvataggio incrementale, stop
graceful su blocco, riprendibile con `--resume`).

**Decisione automatica.** Estendere lo stesso meccanismo agli altri aggregatori
(trovit, mitula, casaclick) **solo se** espongono un ID d'origine verificabile: non si
inventano chiavi. Finché non è verificato, restano sull'euristica.

---

## Qualità dati: regole centralizzate nel core

Le regole di qualità **non stanno negli adapter**: vivono in `core/` e valgono per tutti
i portali, coperte da un solo test. Un pattern duplicato nell'adapter è la causa più
frequente di esclusioni mancanti su un portale solo.

### Dove vive ogni regola

| Regola                        | API                                                       | Effetto                                              |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| Aste                          | `detectAuction(ad)` — `core/filters.mjs`             | esclusione da BIG/SMA, da RENO e dai comparabili ARV |
| Uso non residenziale          | `detectNonResidential(ad)` — `core/filters.mjs`      | esclusione da BIG/SMA e da RENO                      |
| Comune contraddetto dal testo | `comuneContraddetto(ad)` — `core/geo.mjs`            | esclusione da BIG/SMA e da RENO                      |
| Camere dal testo              | `bedroomsFromText(desc, locali)` — `core/schema.mjs` | conteggio camere reale, non dedotto dai locali       |
| Zona                          | `sanitizeZona(raw)` — `core/schema.mjs`              | scarta le zone catturate da frasi descrittive        |
| Mediane ARV                   | `computeMedians` — `core/flip.mjs`                   | le aste non entrano nei comparabili                  |

`detectAuction` riconosce 17 termini (`PVP`, `RGE`, `base d'asta`, `offerta minima di`,
`custode giudiziario`, `decreto di trasferimento`, `vendita giudiziaria`, …), **non** la
sola parola "asta".

### Due punti di ingresso indipendenti

`applyFilters` (profili BIG/SMA) e `analyzeReno` (pool RENO) hanno liste di "no" duri
**separate**: `analyzeReno` non legge `applyProfiles`. Un fix in uno **non si propaga
all'altro**.

**Regola permanente: ogni nuova esclusione va aggiunta in ENTRAMBI** e coperta da un caso
in `test-qualita-dati.mjs`.

### Regole sul testo degli annunci

- **La descrizione batte il JSON-LD sul luogo.** Un JSON-LD può essere perfettamente
  coerente (comune, CAP, coordinate) e **falso**: gli aggregatori geocodificano le
  omonimie. `comuneContraddetto` confronta il testo con 29 `COMUNI_FUORI` **frase per
  frase**, scartando le frasi che parlano dell'agenzia ("Agenzia con sede a Modena" non è
  il luogo dell'immobile). Restituisce il comune con l'**iniziale maiuscola**: confrontare
  case-insensitive.
- **Le descrizioni arrivano spesso come blocco unico senza punteggiatura.** Lo split per
  frasi può produrre una sola frase che contiene sia il dato utile sia i contatti. Il
  flag contatti vale **dalla menzione in poi, non retroattivamente**: si analizza
  `raw.slice(0, contact.index)`.
- **Le camere si leggono, non si deducono.** La regex deve accettare il plurale
  (`camere?` con il `\b` finale) e i numerali in lettere. Il fallback `locali - 1`
  **gonfia** le camere: usarlo solo se il testo non dice nulla.
- **La zona non è una frase.** Espressioni come "servizi della zona quali attività
  commerciali" non sono un quartiere. `sanitizeZona` scarta i termini descrittivi
  (`quali`, `attività`, `commerciali`, `servizi`, `parchi`, `fermate`, …) preservando i
  toponimi legittimi ("Parco Nicholas Green") e le sottozone ("A / B").

### Nomi di campo dello schema (usare questi, non varianti)

`camere`, `locali`, `superficieMq`, `esito`, `esitoSma`, `isAuction`,
**`flip.reno.candidato`**.

Un controllo scritto con un nome sbagliato (`camereDaLetto`, `candidate`) legge
`undefined` da entrambi i lati e riporta **"0 anomalie": un falso verde**. Nei test e
negli script di verifica usare sempre i nomi reali.

`ad._nonResidenziale` è **temporaneo**: `analyzeFlip` lo cancella dopo l'uso. Per
verificare il non residenziale sui dati pubblicati chiamare `detectNonResidential(ad)`.

### Strumenti

- **`sanitize-dati.mjs`** (root): corregge i JSON cached di tutti i portali **senza
  re-scrape**. Flag `--dry-run` e `--portale X`. **Corregge, non cancella**: gli annunci
  restano tracciabili e il sito mostra la motivazione dell'esclusione. Nel conteggio
  distingue i **campi mancanti** dai **valori sbagliati**: sommarli dà numeri gonfiati.
- **Il build riapplica i filtri** (`applyProfiles`) sui dati cached: se le regole in
  `core/filters.mjs` cambiano, il sito riflette le regole correnti senza un re-scrape.
- **`test-qualita-dati.mjs`**: **36 casi, tutti verdi**. Usa solo le API pubbliche del
  core (niente `eval` sul sorgente). Copre aste, comune, camere, `applyProfiles`,
  mediane ARV, non residenziale, zona, e **l'assenza di falsi positivi** sui 57 annunci
  legittimi di flatsearch.

### Semantica delle etichette KPI

`inTarget` nella webapp filtra **solo per comune**: i "226" sono l'**area ammessa**, non i
selezionati. Le etichette lo dicono esplicitamente: *"Immobili unici (dedup)"* (246),
*"€/m² mediano area ammessa"*, *"Annunci area ammessa per portale"*.

BIG/SMA mostrano di proposito **tutti** gli annunci dell'area con badge e filtro "Esito":
è il modo di leggere anche le motivazioni di esclusione, non un difetto.

### Stato verificato

| Metrica                | Valore                                                                        |
| ---------------------- | ----------------------------------------------------------------------------- |
| Annunci lordi          | 327                                                                           |
| Immobili unici (dedup) | **246**                                                                 |
| Nell'area ammessa      | 226                                                                           |
| Selezionati BIG        | **13**                                                                  |
| Selezionati SMA        | **5**                                                                   |
| Candidati FLIP RENO    | **8** (0 verdi, 0 gialli, 8 rossi)                                      |
| Aste flaggate          | **21** (bakeca 1, attico 2, trovacasa 8, casadaprivato 1, flatsearch 9) |
| Aste tra i target      | **0**                                                                   |
| Target sotto 55 m²    | **0**                                                                   |
| Camere discordanti     | **0**                                                                   |
| Zone spurie            | **0**                                                                   |

Miglior RENO: `immobiliare/127234671`, Bologna Borgo Panigale, 160k, 98 m²,
**ROI 7,3% rosso** (ARV 2600 €/m² da override zona). Nessun candidato RENO sotto 40 m²:
**non serve una soglia di superficie aggiuntiva** nel pool RENO.

Suite: `test-qualita-dati` 36/36, `test-dedup-origine` tutti OK, `test-superficie` tutti
OK, `validate-site` coerente. Webapp verificata nel browser agent-controlled:
**0 errori JS**, 17 portali attivi, 8 differiti.

**Backup conservati.** `.bak-sanitize/` (17 JSON pre-sanitize) **non viene rimosso**: è
l'unica copia dei valori originali e permette di auditare ogni correzione. Il build legge
solo `annunci-*.json` nelle cartelle `output/`, quindi il backup non influenza il sito.

### 2026-11-19 — Diagnosi 403 wikicasa (primo uso operativo del flusso ibrido D9)

- Profilo Playwright wikicasa: 403 persistente (headless e headed, backoff rispettato) → STOP D4. Ultimo run OK: 18/11, 75 annunci.
- Browser reale (Copilot Browser): listing e dettaglio leggibili, 75 card, JSON-LD `RealEstateListing`+offers+geo intatto → **nessun cambio DOM, adapter valido**.
- Probe agent-driven archiviati (listing+detail) in `probe-archive/probe-agent-wikicasa.json`; `probe:verify --from-archive` 3/3 OK.
- `probe-verify` esteso: supporto `probeChecks.detailChecks` (asserzioni JSON-LD sul dettaglio, step separato da archivio o 1 pagina live extra).
- Diagnosi e piano (attesa 24-48h, poi retry a freddo) in `wikicasa/strategia.md`. Nessun aggiramento.

### 2026-11-19 — Migliorie runner A+B+D (approvate dall'utente)

- **A — Cooldown anti-ban**: nuovo `core/health.mjs` + `core/portal-health.json`. Un `BlockedError` registra il portale con **cooldown fisso 24h** (scelta esplicita dell'utente: NON crescente); un run riuscito lo azzera (evento `recovered`). Runner e `run-all` saltano i portali in cooldown; **exit code 3 = bloccato/saltato** (prima i blocchi uscivano 0 e sembravano successi). `--force` ignora il cooldown, solo dopo verifica manuale. Storico eventi con cap 200.
- **B — Retry dettaglio + coda falliti**: errore transiente sul dettaglio → 1 ritento dopo pausa lunga (15-25s); mai sui `BlockedError` (D4). Doppio fallimento → `<portale>/output/falliti-<stamp>.json`; `--retry-failed --resume <json>` riprova solo quelli senza ri-raccogliere le listing.
- **D — Report**: ogni run scrive `<portale>/output/run-summary-<stamp>.json` (annunci, nuovi, BIG/SMA, falliti, blocco, durata); `run-all` aggrega in `logs/run-<stamp>/report.json` con riepilogo console (⛔ bloccati distinto da ✖ errori).
- Test: `node test-health.mjs` 8/8; test end-to-end runner con adapter finto 4/4 (retry recupera, coda falliti, retry-failed, blocco→exit 3+cooldown, skip senza browser).
- Wikicasa registrato in cooldown fino al 2026-11-20 07:20 UTC (blocco diagnosticato oggi).


### 2026-11-19 — Track A: ledger temporale unificato (memoria tra i run)

- Nuovo `core/ledger.mjs` + `ledger.json` in root (write atomico tmp+rename). Chiave di identità: il **cluster dedup**, non il singolo annuncio — chiavi `portale:id` + `orig:portale:id` (idsOrigine degli aggregatori, alias inclusi): stesso immobile su più portali o con fonte vincente cambiata resta UNA voce (`L000001`…).
- Per voce: `firstSeen/lastSeen` (**giorni osservati**, non dichiarati), serie prezzi per fonte (1 punto/giorno, solo sui cambi), ribassi reali per fonte, stato attivo/sparito, ripubblicazioni, ultima istantanea. Fusione automatica quando il dedup unisce voci prima separate (vince il firstSeen più vecchio).
- **Ribasso = calo sulla STESSA fonte**: cambiare fonte vincente (o portale che sparisce dal cluster) non è un ribasso. Il conteggio mostrato è il max tra le fonti, non la somma (lo stesso calo propagato su N portali si conta una volta).
- **Sparito ≠ venduto**: "non più visibile" → probabile vendita/rimozione. **Guard anti-run-rotto**: se >50% delle voci attive (>20 totali) è assente, NESSUNA sparizione marcata (`guardAttivo` nel diff e nel sito) — più probabile un portale rotto che 100 vendite insieme.
- **Ripubblicazioni con ID nuovo**: merge solo su voce sparita, stesso comune+indirizzo normalizzato, mq ±2, prezzo ±10%, candidato UNIVOCO (2 candidati = ambiguità → nessun merge). firstSeen preservato: il venditore non azzera l'anzianità cambiando ID.
- **Idempotente**: re-run nello stesso giorno aggiorna il punto di giornata senza duplicare serie/diff/run. Aste escluse dal ledger (D7, come dal dedup standard). Prezzo null non entra nelle serie.
- Integrazione: `build-site.mjs` aggiorna il ledger dopo il dedup, allega `a.ledger` (compatto: firstSeen, giorni, ribassi, timeline cap 12) agli annunci e pubblica `payload.novita` (diff + spariti ultimi 30 gg + ultimi 30 run). `--no-ledger` per build effimere. `analyzeFlip` accetta `osservazioni`: STALE usa max(giorni dichiarati, osservati) e i ribassi cross-run del ledger al posto dello storico per-portale.
- Sito: vista **Novità** (nuovi/ribassati dall'ultimo run, per GLOBAL e per portale), badge NUOVO/RIBASSATO sulla colonna Annuncio, KPI e card "Ribassi osservati" / "Spariti — probabili vendite" in dashboard GLOBAL, blocco "Memoria radar" con timeline prezzi nel dettaglio.
- Test: `node test-ledger.mjs` **58/58** (creazione, idempotenza, ribassi, guard, riapparizioni, ripubblicazioni univoche/ambigue, multi-fonte, fusioni, idsOrigine, persistenza, integrazione STALE). Regressione: dedup-origine e superficie tutti OK. Primo run reale: 801 voci su 880 unici (79 cluster asta esclusi), secondo run stesso giorno 0 nuovi. `validate-site` OK, UI verificata nel browser agent-controlled.
- **FAIL pre-esistenti** in `test-qualita-dati` (5): i fixture `ecd8fb7c` (trovacasa) e `29655698` (idealista) non sono più nei dataset correnti del 18/11 — i test leggono l'ultimo JSON, non fixture congelate. Non correlati al ledger; da congelare i fixture in un round dedicato.


### 2026-11-21 — Filtri nativi su TUTTI i portali (campagna approvata dall'utente: "tutti")

**Problema**: il run del 20/11 raccoglieva ~1053 annunci lordi, di cui ~525 (50%)
sopra i 160k — scartati solo a valle, sprecando pagine, dettagli e geocoding.
Solo 5 portali filtravano lato server (immobiliare.it, idealista, trovacasa, mitula,
flatsearch); attico/casadaprivato avevano reti client-side documentate.

**Ricognizione**: Flusso 1 D9 sul browser reale per i 9 portali mancanti (≤3 pagine
cadauno, ritmo D4), probe archiviati in `probe-archive/probe-agent-<id>.json`.
Ogni URL filtrata è stata VERIFICATA sul campo (conteggi/chips/card), mai inventata.

| Portale | Meccanismo | Prima → Dopo (Bologna) |
| --- | --- | --- |
| subito | query `?pe=160000&szs=40` (**pe=MAX, ps=MIN: trappola**) | 1379 → 484 |
| bakeca | slug path `mqcaseinvendita/40-0/prezzoimmobile/0-160000/` (**query string ignorata**) | 519 → 141 |
| trovit | path `-160000-euro` (semantica "intorno" ~+5k) + **rete client-side ≤160k** | 5475 → 297 |
| wikicasa | query `?PrezzoMassimo=160000&SuperficieMinima=40` (**case-sensitive**) | ~1529 → 61 |
| caasa | query `?euro-a=160000&mq-da=40` | filtrato, 13 pagine |
| remax | query `?prezzo_max=160000&superficie_min=40` | 6 (tutti >200k) → 0 |
| tempocasa | **NESSUN filtro via URL** (JS-only, fasce fisse) → rete client-side sul dettaglio | invariato, dettagli risparmiati |
| tecnocasa | query `?max_price=160000&min_surface=40` | 15 → 6 |
| tecnorete | stessi parametri (piattaforma/DB condivisi con tecnocasa) | 15 → 6 |

**Paginazioni corrette dove i filtri le cambiavano**: subito `&o=N`; wikicasa `&p=N`;
caasa `&page=N` (il vecchio `page-N.html` con filtri dà **404**); remax `&page=N`;
tecnocasa/tecnorete `/pag-N.html?query` (query preservata).

**Reti client-side** (dove il server non basta): trovit ≤160k in collectListings
("intorno" tollera +5k); tempocasa ≤160k/≥40mq in scrapeDetail → null (il runner
salta, niente geocoding sprecato). remax: guardia "Nessun annuncio trovato" per NON
raccogliere le card suggerite di altri comuni a 0 risultati.

**probeChecks su tutti e 9 gli adapter** + estensioni minime del tooling:
`stripQuery:false` (trovit: i link vivono nella query), check `nextData` (subito;
nei probe Playwright non misurato → inconcludente, non rotto), `minCards` (remax:
0 card legittimo), sameUrl tollerante a www/slash in pickStep.

**Verifica**: `probe:verify --from-archive` exit 0 su 9/9. Test core invariati:
browser-probe 7/7, ledger 58/58. Verify live headless: caasa 3/3 ✅, tecnocasa 2/2 ✅,
tecnorete 2/2 ✅ (tollerano headless); subito 45 card ✅; remax 0 card = filtri OK.
bakeca/trovit/wikicasa/tempocasa: 403/CAPTCHA in headless — **atteso, headless rilevato
(decisione 15/11: SEMPRE headed)**, cooldown 24h registrato, nessun aggiramento;
adapter validati sull'evidenza del browser reale. Avviso `--headless` documentato
nell'header di probe-verify.

**Soglia di raccolta = 40 m²** (target utente), non 55: i profili BIG/SMA restano
più stretti (minSuperficie 55) e si applicano a valle, invariati (D2).
Atteso: il ~50% di volume fuori budget sparisce a monte; primo run di conferma
al prossimo `npm run radar` (4 portali saltati per cooldown fino al 22/11).
