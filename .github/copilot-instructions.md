# Radar multi-portale — istruzioni per l'agente

## Architettura ibrida (D9): browser reale per capire, Playwright per raccogliere

Due strumenti, due ruoli, mai intercambiabili:

| Fase | Strumento | Dove |
|---|---|---|
| Ricognizione portali, DOM cambiato, login/2FA | **Copilot Browser** (`browser-use-*`, browser reale dell'utente) | solo in chat, agent-driven |
| Probe ripetibili e raccolta annunci | **Playwright** (`core/human.mjs`, `core/runner.mjs`) | script, `npm run radar` |

La produzione NON usa mai il browser dell'utente. Il browser reale serve a produrre
evidenza (probe JSON, selettori verificati) che finisce negli adapter Playwright.

## Flusso 1 — Probe di un portale (nuovo o DIFFERITO)

1. `browser-use-list_browser` → `manage_group open` → `manage_tab open` con la URL di listing.
2. Leggere `core/browser-probe.mjs`: le funzioni `probeInPage` / `extractLinksInPage`
   sono scritte per girare nel contesto pagina. Nel guest code di `run_javascript`
   NON si può importare: ricopiare il corpo della funzione dentro il guest code,
   oppure osservare con `tab.snapshot()` + Locator e ricostruire lo stesso JSON.
3. Ritmo D4 anche nel browser reale: poche pagine (≤3 per ricognizione), pause,
   niente scroll infinito. CAPTCHA/403/challenge → STOP, riportare `blocked: true`.
4. Login/2FA/CAPTCHA: **handoff all'utente** (sensitive step). Mai leggere cookie,
   password o token; mai chiedere credenziali in chat. L'utente completa nel browser,
   poi nuovo Run con snapshot fresco.
5. Salvare il risultato deterministico:
   `npm run probe:save -- --id <portale> --file <json>` (o `--stdin`).
   Output: `probe-archive/probe-agent-<id>.json`, merge per step.
6. Aggiornare `<portale>/strategia.md` e la tabella D3 in `DECISIONI.md`.
7. `manage_group finalize` sempre, anche in caso di errore/abbandono.

## Flusso 2 — Adapter rotto (selettori cambiati)

1. `npm run probe:verify -- --id <portale> --live --headless` → exit 2 = selettori
   rotti, exit 3 = blocco anti-bot (STOP, non ritentare aggirando).
2. Se rotto: ricognizione col Flusso 1 sul browser reale (stesso URL di
   `adapter.probeChecks.listingUrl`), confrontare `cardSelectors`/`sampleLinks`.
3. Aggiornare l'adapter e le sue `probeChecks`, poi ri-verificare:
   `npm run probe:verify -- --id <portale> --from-archive` (nessun browser lanciato)
   oppure `--live`.
4. Gli adapter dichiarano le asserzioni in `probeChecks`:
   `{ listingUrl, cardSelectors: [...], linkPattern: '<regex href>', minLinks,
      detailChecks: { jsonLdType: '…' } }`.
   Le `detailChecks` si verificano sul dettaglio: da archivio serve un secondo step
   probe su un annuncio (`probe:save --step detail`); live basta la listing
   (il verify apre automaticamente 1 dettaglio dai link campionati).
5. Un 403 dal profilo Playwright con browser reale leggibile = blocco per-cliente,
   non DOM cambiato: documentare in `strategia.md`, attendere 24-48h, ritentare a
   freddo. Mai aggirare (D4).

## Cooldown e retry (dal 2026-11-19)

- `core/portal-health.json`: registro blocchi. Un `BlockedError` registra il portale
  con **cooldown fisso 24h** (mai crescente, scelta utente); un run riuscito lo azzera.
- Runner e `run-all` saltano i portali in cooldown (**exit code 3** = bloccato/saltato,
  diverso da errore). `--force` ignora il cooldown: usare solo dopo verifica manuale.
- Dettaglio fallito → 1 ritento con pausa lunga → se fallisce ancora va in
  `<portale>/output/falliti-*.json`. Riprova: `node <portale>/scrape.mjs --retry-failed
  --resume <json>` (niente ri-raccolta listing).
- Ogni run scrive `<portale>/output/run-summary-<stamp>.json`; `run-all` aggrega in
  `logs/run-<stamp>/report.json` (annunci, nuovi, BIG/SMA, falliti, blocchi, durata).
- Dopo un 403 persistente: Flusso 1 per distinguere blocco per-profilo da drift DOM
  (caso wikicasa 19/11: browser reale OK, Playwright 403 → cooldown, non fix adapter).

## Flusso 3 — Login per la raccolta (profili Playwright)

Il login fatto nel browser reale NON travasa nei profili `<portale>/profile/`.
Per i portali che richiedono login nella raccolta: `npm run login` (manuale,
profilo persistente). Il browser reale serve solo a validare che il flusso di
login del portale funzioni e a documentarlo in `strategia.md`.

## Policy invariata (D4)

Fail-closed su blocchi, nessuna tecnica di aggiramento, volumi personali
(≤200 annunci/portale/run, ≤40 pagine), credenziali mai nel codice né in chat.
Il browser reale non è un bypass anti-bot: un challenge si tratta come in Playwright.