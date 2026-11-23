# Strategia — Alfa & Omega (progettocasadialfaeomega.it)

Aggiornato: 2026-11-22 (listing GET e dettaglio verificati dal vivo).

## Tecnologia
- **Agestaweb ASP** (immobili.asp / immobile_dettaglio.asp), media su
  `agestanet.risorseimmobiliari.it/public/annunci/10141/<id>/…`.
- Listing **GET con filtri server funzionanti** (prezzo_max, mq_min).

## Listing
- URL: `/web/immobili.asp?link=1&cod_regione=5&cod_provincia=14&cod_comune=<c>
  &language=ita&tipo_contratto=V&cod_categoria=R&prezzo_max=160000&mq_min=40&maxann=30`
  - cod_comune: **1247 Bologna, 1239 San Lazzaro di Savena**.
  - **Pianoro NON trattato** dal portale (assente dal select comuni) → nessuna query.
  - cod_categoria=R = residenziale (esclude commerciali); maxann=30 → 1 pagina
    (portfolio ~7 annunci totali al 22/11).
- Stato 22/11: Bologna ≤160k → "NESSUN IMMOBILE TROVATO" (0); SL 1 annuncio
  (76mq, 220k → fuori budget); senza prezzo_max la query base V+R dà 7 annunci
  (Loiano/Monterenzio/Monghidoro/Guiglia oltre ai whitelist → scarto comune).
- Card: anchor `immobile_dettaglio.asp?cod_annuncio=<id>&language=ita`;
  il contenitore espone titolo, "In vendita a <Comune> Zona <zona>", estratto,
  "76 Mq - 4 Vani", "€ 220.000". id = cod_annuncio.
- Filtri server + rete client (prezzo/mq/whitelist) per sicurezza.

## Dettaglio
- DOM puro, **nessun ld+json**. Contenitore `.row.dettaglio`:
  - titolo h1/h2; "Rif: 10141RA95360"; riga comune MAIUSCOLO;
    "BOLOGNA - zona la Mura San Carlo"
  - descrizione lunga ("In vendita a … proponiamo …") con mq, vani, camere,
    bagni, piano, indirizzo, riscaldamento, stato
  - **Consistenze**: tabella "Sup. Principale - piano terra 76 Mq 76 Mqc" +
    accessori (Taverna collegata - seminterrato 20 Mq…) → superficieMq dalla
    principale, dettaglioSuperficie dal blocco, piano dalla principale
  - sidebar: "€ 220.000", "Appartamento", "Vendita", "4 Vani", "2 Camere",
    "2 Bagni", "Classe energetica G (DL 192/2005)", EPI
  - foto: `.bigfoto img` / flexslider `a[data-img]`; planimetrie se data-img
    con "planimetria" nel titolo.
- Nessun campo ascensore strutturato → dal testo (conservativo).

## Anti-bot / ritmo
- Nessun blocco al 22/11. 2 listing + dettagli target, pause 2-4.5s (D4).
- Fail-closed su 403/CAPTCHA (gotoResilient/checkBlocked).

## probeChecks
- listingUrl **senza prezzo_max** (query base V+R+maxann=30, ~7 risultati:
  con ≤160k oggi 0 e il probe non campionerebbe link),
  linkPattern `immobile_dettaglio\.asp\?cod_annuncio=\d+`,
  **stripQuery: false** (l'id vive nella query!), minLinks 1, minCards 0.
  Verifica live: exit 0 (22/11).

## Audit filtri nativi (23/11)
- Agestaweb, form GET completa: oltre a prezzo_max/mq_min gia' usati, espone
  `vani_min/max`, `camere_min/max`, `cod_tipologia` (3=Appartamento), checkbox
  `localita=<id>` per zona, ascensore/balcone/cantina/garage/giardino=1.
- **Adapter aggiornato**: aggiunto `cod_tipologia=3` (esclude ville/rustici server-side).
- vani/camere non aggiunti: il portfolio e' piccolo (~7) e i profili BIG/SMA si
  applicano gia' lato script; tenerli come riserva se il portfolio cresce.
