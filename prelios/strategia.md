# Strategia — Prelios (ASTE/NPL: sezione dedicata)

## Stato
- Listing reali su **`prelios.com/it/societa-operative/prelios-agency/immobili`** (109 card). Piattaforma **ARECNEPRIX**. **Accessibile**, aste/NPL.
- Prelios = gestione crediti e immobili NPL per conto di banche/fondi.

## Accesso
- **URL**: `https://www.prelios.com/it/societa-operative/prelios-agency/immobili`.
- **SEMPRE headed**, pause umane, backoff. Piattaforma ARECNEPRIX (card con prezzo base, lotto, data asta).

## Dati (schema ridotto aste)
- Indirizzo, prezzo base, data asta, lotto, link, tipologia. Camere/mq non sempre strutturati.

## Decisione
- **Fuori dai criteri standard** (noAste). Sezione "ASTE & NPL" del sito.
- Adattatore dedicato da costruire (card ARECNEPRIX → JSON ridotto). Non entra in BIG/SMA/dedup standard.

## FLIP
- NPL/aste: sconto potenziale ma rischi legali. Richiede perizia, non ROI RENO automatico.