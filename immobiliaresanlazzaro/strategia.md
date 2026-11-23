# Immobiliare San Lazzaro — strategia di raccolta

## ⚠️ Bug verificato (brief 22/11)
`location` + `max-price` insieme → SEMPRE 0 risultati; `max-price` è una
SELECT a preset (160000 non è un preset → 0 anche da solo con location).

## Strategia adottata: per-comune SENZA prezzo + filtro client-side
- `https://www.immobiliaresanlazzaro.it/ricerca-immobili/?status=vendita&location=bologna` → 18
- `…&location=pianoro` → 5
- `…&location=san-lazzaro-di-savena` → 33

(Alternativa scartata: `max-price=200000` globale da solo → 2 risultati, troppo poco.)

Paginazione RealHomes `/ricerca-immobili/page/N/?<stessi param>` (link next nel DOM).
Link dettaglio `/immobile/<slug>/` (id = slug).

## Dettaglio (DOM verificato live 22/11)
RealHomes custom. **Prezzo "€390,000" con VIRGOLA migliaia**, subito dopo
"Vendita" sotto il titolo: estrarre SOLO da lì — le `<option>` dei preset
(max-price) contengono "€1,000"…"€400,000" e un match sul body intero prende
il prezzo sbagliato (bug corretto in fase di validazione).
Scheda: "Camere da letto 3 Bagni 2 … Area 102 mq". Sezione "Dettagli
aggiuntivi": Piano / Totale Piani / Ascensore: SI / Vani / Cantina / Tipo
riscaldamento / Certificazione: Classe E / Spese condominio / Balcone.
Indirizzo e comune dalla riga "Via X, Bologna, BO" sotto il titolo. Zona dal
titolo ("Appartamento Toscana/S. Ruffillo"). APE anche da "APE "E"" in descrizione.

## Client-side (OBBLIGATORIO qui)
Prezzo ≤160000 e mq ≥40 sul dettaglio: il server non li supporta con location.
Scarto loggato `return null` (modello tempocasa) PRIMA dell'arricchimento:
~56 annunci visitati, molti scartati → più pagine del solito (maxPages 12/comune,
max 40 totali policy D4: 12×3=36 ≤40 ✅).

## Rischi
- Senza filtri server la raccolta visita molti annunci fuori budget: ritmo D4
  rispettato, maxAds 200 del runner limita.
- minLinks 5 sulla listing San Lazzaro (33 verificati): se il portfolio scende
  sotto 5 il probe dà exit 2 → verificare che sia calo reale, non DOM rotto.

## Validazione 22/11
- probe live: **exit 0** (60 anchor, 10 link match su listing SL, min 5 ✅)
- mini-raccolta 2 dettagli (BO): 0 raccolti — CORRETTO: 390k/102m² e
  380k/118m², entrambi oltre budget, scarto client-side loggato.
  1 fix parser applicato: prezzo dalle option preset (15k/10k fasulli) →
  prezzo reale dopo "Vendita" (390k/380k, formato virgola).
- Nessun blocco. Nessun annuncio ≤160k tra i primi 2 di Bologna; il target
  reale emerge dalle pagine successive (33 annunci a SL da esplorare nel run completo).