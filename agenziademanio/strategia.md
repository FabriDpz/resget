# Strategia — Agenzia del Demanio (ASTE pubbliche: sezione dedicata)

## Stato
- **`/opencms/it/gare-aste/immobiliare/`** → 200, **3116 risultati**, link gara. **Accessibile**, aste pubbliche.
- Patrimonio immobiliare dello Stato in vendita/asta.

## Accesso
- **URL**: `https://www.agenziademanio.it/opencms/it/gare-aste/immobiliare/`.
- **SEMPRE headed**, pause umane, backoff. Paginazione risultati, link alla singola gara.

## Dati (schema ridotto aste)
- Indirizzo, prezzo base, data asta, lotto, link gara, ente. Tipologia catastale.

## Decisione
- **Fuori dai criteri standard** (noAste). Sezione "ASTE & NPL" del sito.
- Adattatore dedicato da costruire (listing gare → JSON ridotto). Non entra in BIG/SMA/dedup standard.
- Filtro geografico Emilia-Romagna/Bologna per ridurre i 3116 risultati nazionali.

## FLIP
- Aste pubbliche: sconto potenziale ma vincoli (beni culturali, occupazione, destinazioni d'uso). Richiede perizia e analisi legale.