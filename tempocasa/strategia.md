# Strategia di scraping — Tempocasa

## Filtri: NESSUNO via URL — 2026-11-21 (ricognizione browser reale, D9)
- I dropdown prezzo/superficie sono **JS puro con fasce FISSE** (150k/170k/200k…,
  10/50/60 mq…): niente 160k né 40 mq. Applicandoli la **URL non cambia mai** e
  `?prezzo_max=160000` viene **ignorato** (card a 165k ancora presenti).
- **Strategia (dal 22/11): filtro CLIENT-SIDE sulle CARD in `collectListings`**
  (prezzo/mq esposti nel contenitore card: scarto >160000 € o <40 m² PRIMA di
  aprire il dettaglio) + rete sul dettaglio JSON-LD. 140 link → ~12 target a Bologna.
- Riconferma 22/11: il form è **Livewire POST `/livewire/update`**, nessun GET
  filtrabile esiste.
- Probe: `probe-archive/probe-agent-tempocasa.json`; `probeChecks` aggiunti
  (listing invariata + dettaglio JSON-LD RealEstateListing). Verify da archivio: OK
  (inconcludente su card/link: l'archivio non ha campioni, solo osservazioni).
  Il probe `--live --headless` del 21/11 ha preso 403 (headless rilevato, SEMPRE
  headed) → cooldown 24h, retry headed dopo scadenza.

## Accesso
- **URL ricerca**: `https://www.tempocasa.it/it/vendita/bologna/{comune}` (comuni: bologna, pianoro, san-lazzaro-di-savena).
- **Paginazione**: `?page=N` (max 12 pagine). Link annuncio: `/it/vendita/bologna/{comune}/{tipo}/{id}`.
- **Anti-bot**: headless rilevato (403). **SEMPRE headed** (profilo persistente `profile/`). `gotoResilient` con backoff 25–80s su 403/429, poi STOP graceful. Pause umane 2–4s.
- **Copertura**: Bologna città + San Lazzaro di Savena. **Pianoro: 0 annunci** (fail-open, non errore).

## Dati (dettaglio)
- **JSON-LD `RealEstateListing`** → `mainEntity` (Apartment): `numberOfRooms`=locali, `numberOfBathroomsTotal`, `floorSize.value`=mq, `address`, `geo` (assente → geocode Nominatim).
- **`offers`**: prezzo, `seller.name`=agenzia.
- **`datePublished` / `dateModified`**: ✅ presenti → fondamentali per **FLIP STALE** (giorni sul mercato).
- **Camere da letto**: esplicite nella sezione DOM "Dettagli" (`Camere da letto N`); fallback `bedroomsFromText(desc, locali)`.
- Cucina/Balconi/Cantina dai Dettagli; piano/zona dalla descrizione; APE da `amenityFeature` o testo.

## BIG / SMA
- Ricerca server-side = superset (tutti gli annunci vendita). Profili applicati lato script (`core/filters.mjs`):
  - **BIG** ≤160k, ≥2 camere reali, ≥2 locali.
  - **SMA** ≤130k, esattamente 1 camera (monolocale ≥55m² vale 1).
- Esito reale test: 24 annunci, 0 BIG / 0 SMA (fascia di prezzo alta della rete).

## FLIP
- **RENO**: stato da descrizione (`mapStato`); ARV da mediane zona; ROI con lavori 600€/m².
- **STALE**: `datePublished`/`dateModified` native → score giorni + ribassi + keyword. Punto di forza di questo portale.

## Dedup
- Fonte primaria (agenzia). In GLOBAL vince su aggregatori. ID numerico stabile.