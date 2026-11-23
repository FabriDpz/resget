# Strategia — Invimit (ASTE: sezione dedicata)

## Stato
- Listing su dominio separato **`vetrinaimmobili.invimit.it`** (tabella WordPress + allegati .doc). **Accessibile**, schema ridotto aste.
- Invimit = società del MEF per la valorizzazione del patrimonio immobiliare pubblico.

## Accesso
- **URL**: `https://vetrinaimmobili.invimit.it/` (tabella immobili in vendita/asta).
- **SEMPRE headed**, pause umane. Allegati .doc con dettagli lotto (da scaricare/parsare se necessario).

## Dati (schema ridotto aste)
- Indirizzo, prezzo base, data asta, lotto, link, ente venditore. Niente camere/mq strutturati (negli allegati).

## Decisione
- **Fuori dai criteri standard** (noAste). Sezione "ASTE & NPL" del sito.
- Adattatore dedicato da costruire (tabella WordPress → JSON ridotto). Non entra in BIG/SMA/dedup standard.

## FLIP
- Aste pubbliche: potenziale sconto ma rischi legali/occupazione. Richiede perizia e analisi legale, non ROI RENO automatico.