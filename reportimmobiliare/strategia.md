# Strategia — Report Immobiliare (reportimmobiliare.it)

Aggiornato: 2026-11-22 (probe live Playwright headed, DOM verificato).

## Tecnologia
- WordPress, tema **Realty** (property / property-status / property-feature CPT).
- ⚠️ **TLS legacy**: curl/fetch HTTP falliscono la handshake; Chromium funziona
  (verificato 22/11) → si usa SEMPRE il browser del runner, mai fetch Node.
- SSR completo, nessun anti-bot riscontrato.

## Listing
- URL: `https://reportimmobiliare.it/property-status/residenziale-vendita/`
  paginazione `/page/2/` … `/page/5/` (46 immobili, ~10 card/pagina al 22/11).
- **Nessun filtro server-side** (prezzo/comune): scarto client dalle card:
  - `.price-tag` "€440.000" → prezzo > 160000 scartato
  - comune da titolo/slug (`h3.title` "BOLOGNA – VIA PUNTA", "MILANO – UPTOWN"):
    whitelist bologna / san-lazzaro / pianoro; lista nera comuni limitrofi
    (Milano, Monza, Castel Maggiore, Casalecchio…) per titoli senza comune
  - badge **VENDUTO** nel markup card → scarto
- Card: `div.property-item` → `h3.title`, `h4.address`, `span.type`,
  `span.status`, `.property-meta .meta-data[data-original-title]`
  (Dimensioni "85 m2", Locali, Camere da letto, Bagni), `.price-tag`.
- id = slug `/property/<slug>/`.

## Dettaglio
- `#property-content p` → descrizione (primo p spesso il quartiere,
  es. "BORGO PANIGALE/BARGELLINO").
- `#property-features li a`: elenco accessori completo con stato:
  **`a.inactive` (fa-times) = accessorio ASSENTE**, `fa-check` = presente.
  L'innerText non distingue → si legge la classe. Riscaldamento Autonomo è
  una feature ("Riscaldamento Autonomo").
- Meta in testa come in listing (`.property-meta .meta-data`).
- ld+json solo **Yoast** (WebPage/BreadcrumbList/ImageObject): nessun dato
  immobile; `WebPage.datePublished` → pubblicatoIl.
- Prezzo "Prezzo su Richiesta" possibile → null (in valutazione nei filtri).
- Piano dal testo descrizione; comune confermato da titolo+descrizione,
  se resta ignoto → scarto fail-closed.

## Anti-bot / ritmo
- Nessun blocco al 22/11. ≤6 pagine listing + dettagli target, pause 2-4s (D4).
- Fail-closed su 403/CAPTCHA.

## probeChecks
- listingUrl residenziale-vendita, cardSelectors `.property-item`,
  linkPattern `/property/[^/]+/`, minLinks 5. Verifica live: exit 0 (22/11).

## Audit filtri nativi (23/11)
- Tema Realty: nessuna form SSR nella listing; ricerca JS via
  GET /wp-admin/admin-ajax.php?action=tt_ajax_search&min_price=&max_price=...
  (endpoint evidente nell'HTML inline, campi completaltform su altra pagina).
- Valutabile in futuro ma richiede reverse dei campi: non adottato.
- NB: TLS legacy risolvibile con curl -k --tls-max 1.2 (HTTP 200): fetch diretto possibile.
