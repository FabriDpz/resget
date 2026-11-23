# Strategia di scraping — Wikicasa

## Filtri nativi — CORREZIONE 2026-11-22 (seconda ricognizione browser reale)
- ⚠️ **La query `?PrezzoMassimo=160000&SuperficieMinima=40` è IGNORATA dal server**,
  ANCHE quando generata dal form "Filtri" del sito (l'URL è cosmetica: dopo reload
  completo i risultati restano non filtrati — la verifica del 21/11 aveva osservato
  solo il re-render client-side della SPA).
- **UNICO filtro server-side verificato: path SEO `/vendita-case/{comune}/prezzo-fino-a-160000/`**
  (H1 "Case fino a 160.000 euro in vendita a Bologna", prezzi correnti tutti ≤160k).
- **Paginazione `?p=N`** sul path SEO (link in pagina).
- **Superficie: nessun filtro server-side** (nessun path SEO mq; la query è ignorata)
  → rete client-side ≥40 m² sulle card in collectListings, PRIMA del dettaglio.
- ⚠️ **Prezzi barrati**: le card mostrano "€ 139.000" (corrente, € prima) e
  "142.000 €-2,1%" (pre-ribasso). Il filtro client-side usa solo il corrente.
- Il pannello Filtri espone anche lo switch "Escludi aste" — non esprimibile via URL.
- `probeChecks.listingUrl` = path SEO; verify `--live` headed 22/11: **3/3 OK**.

## Accesso
- **URL ricerca**: `https://www.wikicasa.it/vendita-case/{comune}/prezzo-fino-a-160000/` (bologna, pianoro, san-lazzaro-di-savena).
- **Anti-bot**: 403 iniziale transitorio, **superato dal backoff** di `gotoResilient` (30s) → poi scraping regolare. **SEMPRE headed**.
- **casaclick.it è un alias**: redirige a wikicasa.it (stesso gruppo). Un solo adattatore; niente scraping duplicato.

### Diagnosi 403 — 2026-11-19 (architettura ibrida D9)
- Ultimo run Playwright OK: **2026-11-18 04:11**, 75 annunci.
- Oggi il profilo Playwright riceve **403 persistente** sulla listing (2 tentativi con backoff 20s/40s, sia headless sia headed) → STOP graceful D4, nessun aggiramento.
- **Browser reale (Copilot Browser) legge le stesse pagine senza blocchi**: listing Bologna 75 card, dettaglio `/annuncio/31400037` con JSON-LD completo (`RealEstateListing` + offers + geo). Il sito è su; il blocco riguarda il profilo/fingerprint Playwright o un rate-limit per-cliente ancora attivo.
- Probe agent-driven archiviati: `probe-archive/probe-agent-wikicasa.json` (step listing + detail). Verifica adapter: `npm run probe:verify -- --id wikicasa --from-archive` → **3/3 ✅** (card, link, JSON-LD dettaglio).
- **Ipotesi più probabile**: rate-limit legato al run del 18/11 (75 annunci in una notte) non ancora scaduto, oppure challenge mirata al profilo. **Azione**: attendere ≥24-48h senza traffico dal profilo, poi ritentare `npm run probe:verify -- --id wikicasa --live`. Se il 403 persiste a freddo, valutare un profilo nuovo (`wikicasa/profile/`) con login/cookie banner rifatti a mano — MAI tecniche di aggiramento.
- Nel frattempo l'adapter è verificato contro l'evidenza del browser reale: nessun cambiamento di selettori necessario.

## Dati (dettaglio)
- **JSON-LD `mainEntity`** (NUXT): `numberOfBedrooms`=camere ✅, `geo.latitude/longitude`=coordinate native ✅, mq, locali, bagni, prezzo, indirizzo.
- Geocode nativo → nessun Nominatim necessario (più preciso).

## BIG / SMA
- Superset server-side, profili lato script. Esito test: 8 annunci, 0 BIG / 0 SMA (fascia alta).

## FLIP
- **RENO**: stato da descrizione; ARV mediane zona.
- **STALE**: date limitate → score da keyword/ribassi.

## Dedup
- Fonte primaria. Coordinate native → matching indirizzo preciso. In GLOBAL vince su aggregatori.
- Cross-portale reale osservato: annunci Tempocasa ricomparsi su Wikicasa (stessa agenzia "Bologna - Mazzini - Tempocasa") → dedup per prezzo+mq+indirizzo.