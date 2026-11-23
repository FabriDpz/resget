# Strategia di scraping — Idealista (ATTIVO)

## Stato
- **ATTIVO**: slug col TRATTINO provincia-comune (`bologna-bologna`, `bologna-pianoro`,
  `bologna-san-lazzaro-di-savena`). Il vecchio `/vendita-case/bologna/` dà 404
  ("l'indirizzo non corrisponde a nessuna pagina").

## Filtri nativi (verificati browser reale 22/11)
- **Prezzo**: token path `con-prezzo_160000` (=max; `con-prezzo-massimo_` → 404).
  142 case ≤160k a Bologna.
- **Superficie**: token **`dimensione_40` = MINIMO mq** (dai link preset del dropdown
  Dimensione: `dimensione_N`=min, `dimensione-max_N`=max; `dimensione-da_40` → 404).
  Combinato: `con-prezzo_160000,dimensione_40/` → 142→81.
- **URL usata**: `/vendita-case/{slug}/con-prezzo_160000,dimensione_40/`,
  paginazione `{base}lista-N.htm` (token preservati).
- Rete client-side su `.item-price` sempre attiva.
- `probeChecks` dichiarate; verify `--live` headed 22/11: **2/2 OK**.

## Accesso
- WAF (DataDome/PerimeterX): **SEMPRE headed**, profilo persistente, pause, backoff.
  Nessun aggiramento; CAPTCHA/403 → STOP D4 + cooldown 24h.

## Dati
- Card `article.item[data-element-id]` → `a.item-link` (/immobile/{id}/), `.item-price`.
- Dettaglio: `.details-property-feature` (mq, locali, bagni, stato, piano, ascensore,
  APE…). No JSON-LD. Camere esplicite dove esposte, altrimenti `bedroomsFromText`.
- **Planimetria**: criterio §2 verificato a valle dove disponibile.

## BIG / SMA / FLIP / Dedup
- Profili lato script. **RENO**: stato strutturato. **STALE**: storico prezzi esposto.
- Fonte primaria, priorità alta (subito dopo immobiliare.it).
