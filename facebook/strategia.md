# Strategia — Facebook Marketplace (DIFFERITO: fonte P2P a resa nulla per BIG/SMA)

## Stato — VERDETTO FINALE (ricognizione chiusa)
**Login eseguito manualmente, Marketplace geolocalizzato su Bologna, 589 card esaminate → 0 BIG, 0 SMA.**
Il portale è tecnicamente scrapeable da autenticato (URL stabile, DOM leggibile) ma:
- la **card non è affidabile** (prezzo/luogo/titolo incoerenti col dettaglio: tutti i candidati in zona erano falsi positivi);
- il mix è dominato da **auto, affitti e mercatini**; gli annunci immobiliari reali sono pochi;
- la maggioranza dei **gruppi** "vendita case" è in realtà **affitto** o spam di agenti.

→ **DIFFERITO come fonte P2P complementare** (eventuale flip STALE), **non** per blocco tecnico.
Nessun adapter costruito: resa nulla rispetto al costo. Login **non** richiesto per il resto del sistema.
Le sezioni seguenti conservano la cronologia della ricognizione (pre-login → post-login → gruppi → esito).

## Stato iniziale (pre-login, superato)
- Accessibile senza login ma **geolocalizzato USA**; richiede impostazione Bologna + interazione complessa → **DIFFERITO**.
- Login spesso necessario per vedere i listing immobiliari completi.

## Ricognizione verificata (2026-11-15, browser agent-controlled)
- **Categoria immobiliare = "Home Sales"**, `category_id=1270772586445798`.
  URL: `https://www.facebook.com/marketplace/category/search/?category_id=1270772586445798&query=Home%20Sales`.
- **Senza login**: Marketplace si apre ma è geolocalizzato **San Francisco (USA)** dall'IP. La categoria
  Home Sales mostra solo mercatini USA ("moving sale", "warehouse sale"), NON immobili italiani.
- **Geolocalizzazione NON bypassabile via URL**: `/marketplace/bologna/search/?...` viene riscritto in
  `/marketplace/category/search/?...` (lo slug `bologna` viene scartato senza sessione).
- **Cambio città → Bologna è dietro login**: il pulsante Location ("Enter your city to show local results")
  rimanda a `/login/?next=%2Fmarketplace%2F...`. Confermato: serve la sessione autenticata.
- **Login**: `https://www.facebook.com/login` → form `input[name="email"]` + `input[name="pass"]` +
  `button[name="login"]`. Pagina messa in italiano. Env `FB_USER`/`FB_PASS` non impostate → login manuale.
- **2FA**: atteso checkpoint "Conferma identità" → completamento manuale dal telefono.
- **Filtri visibili anche da loggato-out**: Price (Min/Max), Sort by, Location. Post-login: impostare
  Bologna + raggio ~20 km (copre Pianoro / San Lazzaro di Savena).

### Percorso operativo post-login (da eseguire dopo autenticazione manuale)
1. Impostare Location = Bologna, raggio ~20 km.
2. Aprire categoria Home Sales (`category_id=1270772586445798`); verificare quanti annunci immobiliari
   reali (case/appartamenti) sono accessibili e se il DOM è strutturato (prezzo, titolo, luogo, link item).
3. Se i dati sono strutturati → valutare adapter dedicato (fonte P2P per flip **STALE**, privati senza
   provvigione). Dedup in GLOBAL: fonte minore, perde contro le fonti primarie (no ID stabile).
4. Nessun aggiramento di login/CAPTCHA/WAF (fail-closed §8).

## Gruppi di vendita case (verificato 2026-11-15, sessione autenticata)
Dopo il login manuale, la ricerca gruppi funziona: `https://www.facebook.com/search/groups/?q=vendita%20case%20Bologna`.
Circa 59 gruppi trovati; la maggioranza sono **affitto** (scartati: interesse solo VENDITA per il flip).
**Feed dei gruppi pubblici leggibile SENZA iscrizione** (confermato: post + commenti visibili da membro non iscritto).

### Gruppi VENDITA rilevanti (Bologna / provincia) — ordinati per pertinenza
| Gruppo | ID / slug | Membri | Visibilità | Note |
|---|---|---|---|---|
| Annunci Case Bologna - Da privato a privato | `1141916849589069` | 57.880 | Pubblico | Misto vendita/affitto/camere; molto rumore |
| Case in Vendita Bologna | `appartamento.a.costa` | 46.213 | Pubblico | Dominato da spam agenti/traslochi + richieste d'acquisto |
| Bologna - annunci immobiliari tra privati | `778236132285506` | 8.942 | Pubblico | Tab "Acquisti e vendite"; listing Marketplace embedded (prezzo+luogo strutturati) |
| Bologna Casa Vendo Affitto | `bolognacasavendo` | 13.443 | Pubblico | Misto vendo/affitto; poche vendite reali ma presenti |
| Solo tra Privati Appartamento Compro e Vendo a Bologna | `4064492833563765` | 4.979 | Pubblico | Solo privati, Bologna |
| Vendo compro affitto casa a Bologna | `561217337952828` | 8.777 | Pubblico | Misto |
| BOLOGNA - AFFITTO E VENDITA | `bologna.affittovendita` | 2.002 | Pubblico | Misto, poco attivo |
| Case di Privati in Vendita a Bologna (VendoCasaPrivato.it) | `vendocasaprivatobologna` | 1.304 | **Privato** | Richiede iscrizione+approvazione |
| Case in vendita Bologna (immobiliaredaprivato.it) | `757900277680104` | 350 | **Privato** | Richiede iscrizione; brandizzato portale |
| Affitti e Vendite Immobili Bologna e Provincia | `982604775084615` | 5.621 | **Privato** | Richiede iscrizione |

### Gruppi VENDITA nazionali (privato-a-privato, non solo Bologna) — filtrare per zona nel testo
| Gruppo | ID | Membri | Visibilità |
|---|---|---|---|
| Vendita case in privato | `5637513676278860` | 75.106 | Pubblico |
| VENDERE CASA DA PRIVATO A PRIVATO | `1259036065159344` | 73.695 | Pubblico |
| Compro e vendo casa da privato | `540022972026966` | 55.233 | Pubblico |
| Da privati a privati affitti vendite case terreni ristrutturazioni | `111377986220842` | 159.412 | Pubblico |
| Case in vendita da privati | `872384882869961` | 168.503 | **Privato** |

### Criticità tecniche dello scraping dei gruppi (verificate)
- **Rumore anti-scraping nel DOM**: ogni post contiene decine di `<span>Facebook</span>` e caratteri
  invisibili (U+034F, zero-width) per offuscare il testo. **Mitigazione**: estrarre solo il blocco
  messaggio (`div[data-ad]` / `[data-ad-comet-preview="message"]`, o il parent del bottone "Altro..."),
  poi ripulire con `replace(/Facebook/g,'')` + rimozione zero-width. NON usare `innerText` dell'intero post.
- **Testo troncato**: i post lunghi mostrano "…Altro...". Serve **click su "Altro..."** (div[role=button])
  prima di estrarre, altrimenti prezzo/mq nel finale vengono persi.
- **Post non strutturati**: prezzo, mq, zona, locali sono nel **testo libero** (italiano, maiuscolo, emoji).
  Parsing eur/mq via regex funziona ma la zona è discorsiva ("zona Saragozza", "via Marconi", "adiacenze Ducati").
  Geocoding required; molti post **senza prezzo** → esclusi (fail-closed).
- **Bassa resa**: su un campione, la maggioranza dei post è **spam di agenti/traslochi** o **richieste
  d'acquisto ("cerco")**, non vendite. Le vendite reali sono una minoranza; alcune sono **negozi/capannoni**
  (non residenziale → esclusi dai criteri flip).
- **Listing Marketplace embedded**: alcuni gruppi (es. `778236132285506`, tab "Acquisti e vendite")
  incorporano listing Marketplace con **prezzo + luogo strutturati** e `product_id` stabile
  (`/commerce/listing/<id>/`, `/marketplace/profile/<uid>/?product_id=<id>`). Questi sono i più scrapeable.
- **Dedup GLOBAL**: nessun ID stabile per i post-testo → fonte minore; i listing embedded hanno `product_id`
  (dedup migliore). Matching cross-portale difficile (no indirizzo normalizzato).

### Valutazione per il flip (BIG / SMA / RENO / STALE)
- **Fonte P2P per STALE**: privati senza provvigione, potenziale margine. Ma **resa bassa e alto rumore**:
  il rapporto segnale/rumore è sfavorevole rispetto ai portali primari.
- **Raccomandazione**: usare i gruppi come **fonte complementare manuale/assistita**, NON come scraper
  automatico primario. Se si automatizza: partire dai gruppi con **listing Marketplace embedded**
  (prezzo+luogo strutturati, `product_id`), filtrare VENDITA (no affitto/cerco/spam), residenza, ≤160k.

## Marketplace autenticato + geolocalizzato Bologna (verificato sul campo)

**SVOLTA**: dopo il login manuale, Marketplace è **molto più scrapeable dei gruppi**. Card strutturate
(prezzo | titolo | città), `item_id` stabile, `maxPrice` funzionante lato server.

### URL stabile
```
https://www.facebook.com/marketplace/110340245656034/search/?query=<q>&maxPrice=160000&exact=false
```
- `110340245656034` = **ID città Bologna**, ottenuto applicando il luogo via UI. È persistente nell'account.
- `maxPrice` **funziona** (filtro server-side).
- `latitude` / `longitude` / `radius` nell'URL sono **ignorati**: il raggio si imposta solo via UI.
- Lo slug `/marketplace/bologna/search` fa redirect a `/marketplace/category/search/` **perdendo la geo**
  (risultati da tutta Italia). Usare l'ID numerico.
- **NON usare `category_id=1270772586445798`** ("Vendite di case"): su Bologna restituisce
  *"Al momento non sono presenti prodotti nella tua zona"*. Usare **query testuale**.

### Cambio località (una tantum, già eseguito)
1. Click sul controllo che mostra `<Città> · <N> km` (era "Barbarano Mossano · 100 km", Vicentino).
2. Dialog **"Cambia luogo"** → `input[aria-label="Luogo"]`.
3. **Gotcha**: digitare "Bologna" lascia **"Applica" DISABILITATO**. Serve selezionare il suggerimento:
   `click()` → `Control+a` → `Backspace` → `pressSequentially('Bologna',{delay:90})` → wait 2500 →
   `ArrowDown` → `Enter`. Solo così Applica si abilita.
4. Combobox "Raggio": opzioni 1/2/5/10/20/40/60/80/100/250/500 km (**non esiste 30**). Scelto **20 km**.
5. Applica → URL diventa `/marketplace/110340245656034/search/`, UI mostra "Bologna · 20 km".

### Selettori e parsing
- Card: `a[href*="/marketplace/item/"]`, ID da `/item\/(\d+)/`.
- Testo card dopo clean: `"149.000 € | Titolo | Città"`. Alcune card hanno
  `"N camere da letto N bagno Appartamento/Condominio"` al posto del titolo.
- Prezzo: `/([\d][\d.]{2,})\s*€/` → `parseInt(m[1].replace(/\./g,''),10)`.
  **Il regex greedy `[\d.\s]` cattura il contatore foto "+5"** e concatena (`5185000` invece di `185000`).
  Validare range 20000..5000000.
- Camere/mq: quasi sempre **null nella card**, presenti solo nel dettaglio.
- Scroll: `page.mouse.wheel(0,3200)` + wait 1400, 4-6 iterazioni (~40 card/query, ~119 con 6 scroll).
- Dettaglio: `/marketplace/item/<id>/` → `[role="main"]`.innerText (~1800 char) con titolo, prezzo,
  **categoria reale**, "Posizione della casa", città, Descrizione. Rumore ads da tagliare.

### CRITICITÀ DECISIVA: la card non è affidabile, serve il dettaglio
Su 589 card esaminate con query multiple, i candidati in zona sono risultati **tutti falsi positivi**:
| Falso positivo | Realtà nel dettaglio |
|---|---|
| €91.350 "2 camere da letto 1 bagno Casa" → sembrava **BIG** | categoria **Affitti**, prezzo *al mese*, stanza per lavoratori a Borgo Panigale |
| €30.990 Bologna | **Mercedes-Benz GLE Coupé** (auto usate) |
| €29.000 / €120.000 "Casa al mare" con città *Bologna* | immobili a **Manfredonia (FG)** / località marittima |
| €149.000 × 3 bilocali | **stesso immobile** via Zanardi 196, 43 m², 1 camera → né BIG né SMA |

Due trappole strutturali:
1. **La città nella card è la sede del venditore, non la posizione dell'immobile.** Filtrare per zona
   sulla card non basta: la geo va letta nel dettaglio ("Posizione della casa").
2. **Le card "Affitti" hanno lo stesso layout delle vendite** ("N camere da letto N bagno Casa") e il
   prezzo è *al mese*. Senza leggere la categoria nel dettaglio un affitto viene classificato BIG.

**Regola adottata**: la card serve solo come pre-filtro economico; **la classificazione BIG/SMA avviene
solo dopo la verifica del dettaglio**. Esiti persistiti in `probe/marketplace-verificati.json`,
usati come gate da `probe/filter-marketplace.mjs`.

### Esito raccolta (589 card, query multiple)
- 286 + 303 card raccolte, 72 candidate ≤160k, **7 in zona**, **0 BIG, 0 SMA**.
- L'unica vendita residenziale reale in zona è il bilocale via Zanardi 196 (43 m², €149.000, privato
  Antonio Parisi, no agenzia) → **fuori criteri** (1 camera ma >130k).

## Decisione
- **Nessun aggiramento del login**. Sezione nel sito con istruzioni manuali.
- **Marketplace geolocalizzato Bologna · 20 km è scrapeable** (URL stabile, maxPrice server-side,
  `item_id` per dedup GLOBAL). Resta però a **resa molto bassa** per i criteri flip: su 589 card
  **zero BIG/SMA**. Il costo di verifica del dettaglio (obbligatorio, vedi sopra) è alto rispetto alla resa.
  → **fonte complementare, non adapter primario**. Ricognizione chiusa, rivalutabile su nuova raccolta.
- Se l'utente fornisce sessione manuale (profilo persistente con login Facebook), valutare adapter dedicato con impostazione luogo Bologna.
- **Gruppi**: feed pubblici leggibili senza iscrizione (post-login). Fonte P2P complementare per STALE,
  resa bassa e alto rumore → priorità ai listing Marketplace embedded nei gruppi "Acquisti e vendite".
  Nessun adapter automatico finché non si valida la resa su un gruppo pulito (raccomandazione, correggibile).

## BIG / SMA / FLIP
- P2P puro → potenziale valore per STALE (privati, no provvigione). Ma dati non strutturati, alta variabilità.

## Dedup
- Fonte P2P minore: in GLOBAL perde contro le fonti primarie. Matching difficile (no ID stabile).