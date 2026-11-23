# Strategia — Trovacasa.it (ATTIVO)

## Stato
- **ATTIVO**: nonostante il gruppo Immobiliare.it S.p.A. (footer), il DB è distinto
  (annunci con agenzie locali non presenti su immobiliare.it) → adapter dedicato.
- Filtri server-side verificati browser reale **22/11** leggendo i `name=` degli input
  nel pannello "+ Altre opzioni".

## Listing filtrata
- `/case-in-vendita/{comune}?PrezzoMax=160000&MqMin=40` (SSR), paginazione `&page=N`.
- **PrezzoMax** (P maiuscola): 3371→196. **MqMin**: 196→118, tutte le card ≥40 m².
- IGNORATI: `SuperficieMinima`, `superficieMinima`, `prezzoMassimo`, `Locali` (client-side).
- ⚠️ Il path senza query redirige alla home al primo accesso su profilo fresco:
  partire sempre dalla URL con query.
- Card `.card.js_card_immobile`: prezzo `.card__price`, `.card__info` ("73 m²", "3 locali").

## Dettaglio
- DOM (no JSON-LD): `.immobileInfo.info`, `.immobileInfo.price`, tag, descrizione dopo
  "Descrizione", coordinate negli script inline (`var latitude/longitude`), foto
  `pic.trovacasa.it/image/{id}/m-c.jpg`. Camere da descrizione o locali-1.

## BIG / SMA / FLIP / Dedup
- Profili lato script. Fonte primaria (gruppo immobiliare): priorità alta in GLOBAL;
  dedup naturale con immobiliare.it per indirizzo+prezzo+mq.
