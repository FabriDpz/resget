# Strategia — Immobiliare Cavallo (immobiliarecavallo.it)

Aggiornato: 2026-11-22 (ricerca POST verificata dal vivo).

## Tecnologia
- WordPress + **RealEstateManager cloud** (media su
  `bologna-city.realestatemanage.net/rem/files/29/…`).
- ⚠️ **Ricerca SOLO POST**: la GET di /ricerca/ con querystring viene ignorata.

## Ricerca (collectListings) — POST form-encoded
Flusso adottato (verificato 22/11):
1. GET `https://www.immobiliarecavallo.it/ricerca/` (sessione/cookie, D4).
2. `context.request.post('/ricerca/?do=1', { form })` — campi del form
   `id=realestate_search`:
   `nature_property=F, contract_property=R, relation_property=V,
   int_property=118 (Italia), reg_property=8 (Emilia Romagna),
   prov_property=37 (BO), com_property=<comune>, public_price=160000,
   lower_price=0, categoria_rem=<cat>`.
   - com_property: **37006 Bologna, 37047 Pianoro, 37054 San Lazzaro di Savena**
   - categoria_rem: **1 Appartamento, 2 Casa indipendente** (2 submit/comune)
3. Parsing dell'HTML di risposta (legittima risposta del sito alla nostra
   ricerca) con pagina temporanea `context.newPage()` + `setContent`.
   Perché non il form UI: i select comuni sono popolati via AJAX
   `srpc_switcher.php` e in test headed il wait dell'option è andato in timeout
   (fragile); la POST diretta è il fallback documentato dal progetto.
- Card risultato: `div.rem_block.ext` con `span.entry_desc/.entry_item`
  (prezzo `€ 133000`, `Superficie: 42mq`), testo `Bologna (BO)`, badge
  **Venduto** da scartare. Link `https://immobiliarecavallo.it/focus/<id>/<slug>`
  (anche senza slug). id = numero nel path.
- Il server filtra prezzo (≤160k) ma **NON mq** → mq client-side (≥40).
  Scarto anche Venduto e comuni fuori whitelist (la POST può includere
  limitrofi: Granarolo, Budrio visti nei test).
- Risultati verificati 22/11: Bologna cat1 13 unici (molti Venduti), cat2 0;
  Pianoro 0; San Lazzaro 0. (Baseline storica del parent: 20 risultati/74.)

## Dettaglio
- `/focus/<id>/<slug>`: tabella `tr` con `td span.entry_desc` (label) /
  `span.entry_item` (valore): Riferimento, Proposta, Località "Bologna (BO)",
  Contratto, Prezzo, Tipologia (Bilocale…), Stato ("Buono (restaurato 6-20 anni)"
  → mapStato), Stabile, Superficie "42mq", Classe energetica, Riscaldamento,
  Cam. Matrimoniali, Camere Singole ("Nessuna"), Num. Bagni, Ascensore, Piano,
  Spese condominio "€ 50 /mese".
- Locali dedotti dalla Tipologia (monolocale=1, bilocale=2…).
- ⚠️ ld+json presente (RealEstateListing/SingleFamilyResidence) ma
  **JSON malformato** (righe `0` spurie, description non quotata bene) →
  si usa il DOM, non il JSON-LD.
- Descrizione: testo tra "Richiedi info" e la tabella "Riferimento".
  Foto/planimetrie: slider jssor (`[data-u="slides"] img`, `.rem_block.pla`).
- Cookie banner: "Rifiuta tutto" (matched da dismissCookies).

## probeChecks / verify
- listingUrl `/ricerca/`, linkPattern `/focus/\d+`, **minLinks 0, minCards 0**:
  il probe GET non vede risultati (ricerca POST) → verify exit 0 con check
  inconcludente, per design. La verifica vera è la POST del collector.

## Anti-bot / ritmo
- Nessun blocco al 22/11. 1 GET + ≤6 POST + dettagli target, pause 2.5-5s (D4).
- 403/429 sulla POST → BlockedError fail-closed, cooldown 24h, mai aggirare.

## Audit filtri nativi (23/11)
- Form POST ?do=1 confermata: public_price/lower_price, categoria_rem (1=Appartamento),
  com_property (37006 BO / 37047 Pianoro / 37054 SL). GET ignorato: nessuna URL filtrata
  condivisibile. La POST form-encoded dell'adapter e' gia' la soluzione ottimale.
  Nessun filtro mq/locali/stato (availability_property: Libero/Affittato/Nuda proprieta').
