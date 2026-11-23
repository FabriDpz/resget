# Grimaldi (store Bologna Centro) — strategia di raccolta

## URL listing
`https://www.grimaldifranchising.it/agenzia/store-bologna-centro/immobili?contratto=vendita&prezzo=0-160000&mq=40-100000` → 3 risultati (base 7).

## ⚠️ VERIFICATO LIVE 22/11: filtri prezzo/mq INAFFIDABILI
Tra i 3 risultati "filtrati" c'erano annunci da **297.000 €** (22111, 85 m²) e
280.000 € (villa 22108): il server riduce la lista (7→3) ma NON applica
davvero il massimale. **Doppia rete client-side**: prezzo≤160k e mq≥40 sulla
card in raccolta (modello attico) + sul dettaglio.

- Paginazione `&page=N`.
- Link dettaglio `/vendita/<tipo>/bo/<comune>/<id>`.
- **Ozzano dell'Emilia nel portfolio (fuori whitelist)** → scarto per slug comune
  in listing e dettaglio (verificato: villa 22109 scartata).

## Dettaglio (DOM verificato live 22/11)
Prezzo in `h6.price` come "**297.000 €**" (importo PRIMA del simbolo).
Sezione "Caratteristiche" a coppie: Tipologia / **Destinazione uso** (scarto se
non residenziale) / Mq / Tipo piano / Tipo cucina / Stato interno / Tipo
riscaldamento / Spese condominiali mensili. Descrizione tra "Descrizione" e
"Rif.". Indirizzo dal titolo h1 ("… in Via X, Bologna, BO"). Zona dalla
descrizione ("Zona Saffi-Ospedale Maggiore").

## Rischi
- 0 annunci nel target è legittimo (22/11: tutti sopra budget) → minCards 0, minLinks 1.
- Locali/bagni spesso assenti nelle caratteristiche visibili ("VEDI TUTTE LE
  CARATTERISTICHE" è un toggle): fallback descrizione/bedroomsFromText.

## Validazione 22/11
- probe live: **exit 0** (3 card, 3 link match ✅)
- mini-raccolta: 0 annunci — CORRETTO: 1 scartato fuori whitelist (Ozzano),
  2 oltre budget (297k/280k, rilevati client-side). Parser dettaglio verificato
  prima del fix (prezzo/mq/piano/stato/APE estratti dal DOM reale).
- Nessun blocco.