# Strategia — Nextdoor (DIFFERITO: login obbligatorio, contenuto non immobiliare)

> Ricognizione con **browser agent-controlled** (via di default per tutti i portali).
> Nessun CAPTCHA, nessun WAF: l'unico blocco è l'**autenticazione**. Fail-closed §8: non aggirato.

## 1. Login wall — verificato sul campo

| URL provato | Esito |
|---|---|
| `https://it.nextdoor.com/for_sale_and_free/` | redirect → `/login/?next=…` |
| `https://it.nextdoor.com/for_sale_and_free/?category=for_sale` | redirect → `/login/?next=…` |
| `https://nextdoor.it/for_sale_and_free/` | redirect → `/login/?next=…` (dominio `.it` equivalente) |
| `https://it.nextdoor.com/choose_address/` | pagina vuota, solo pulsante "Log in" |
| `https://it.nextdoor.com/it/for-sale-and-free/` | **404** |
| `https://it.nextdoor.com/neighborhood/bologna/` | **404** |
| `https://it.nextdoor.com/city/bologna/` | **404** |
| `https://help.nextdoor.com/s/article/For-Sale-and-Free?language=it` | **404** |

**Attenzione**: lo status HTTP è **200** anche quando il contenuto è la pagina di login.
Il rilevamento del login wall va fatto sul **contenuto/URL finale**, non sullo status code.

## 2. Selettori di login — CONFERMATI (registry già corretto)

| Campo | Selettore | Note |
|---|---|---|
| Email | `input#id_email` | `name=email`, **`type=text`** (NON `email`), nessun placeholder/autocomplete |
| Password | `input#id_password` | `name=password`, `type=password` |
| Submit | `button#signin_button` | `type=submit`, testo **"Log in"** |
| OAuth Google | `#google-button` | "Continue with Google", `type=button` |
| OAuth Facebook | `#facebook-button` | "Continue with Facebook", `type=button` |

Il `<form>` ha `action=https://it.nextdoor.com/login/` e **`method=get`**.
Esiste anche un `button[type=submit]` **senza id e senza testo**: non usarlo, usare `#signin_button`.
Il toggle di visibilità password è un ulteriore `<button>`: non confonderlo col submit.

## 3. Gotcha tecnici

- **Timing DOM**: una `page.evaluate` lanciata a ~2500 ms dal `goto` può restituire un DOM
  **completamente vuoto** (`input:[]`, `button:[]`, `form:[]`) mentre lo snapshot accessibility
  è già popolato. Verificato che **non è shadow DOM** (`hostCount:0`, nessun iframe con `src`):
  è solo rendering asincrono.
  → **Mitigazione**: usare `page.locator(sel).count()` (auto-wait) o ripetere la evaluate.
- **Filtro link**: i link città **non** stanno sotto `/trova-quartiere/<regione>/…` ma sotto
  `/citta/…`. Una regex troppo restrittiva restituisce `links:[]` anche quando la pagina è piena.
  → In ricognizione, lo **snapshot accessibility** è più affidabile di una regex su un pattern ignoto.
- **Rumore console** (innocuo): Didomi cookie consent, Google GSI/FedCM
  (`Not signed in with the identity provider`, `FedCM get() rejects with NetworkError`),
  molti tracker `ERR_ABORTED`. Non sono segnali di blocco.
- **Encoding**: il testo estratto via `innerText` può arrivare in mojibake (`â‚¬` per `€`, `Â·` per `·`).
  Normalizzare prima del parsing dei prezzi.

## 4. URL pubblici scoperti (SEO, senza login)

- `/trova-quartiere/` → directory delle **20 regioni**, link `/trova-quartiere/<sigla>/`.
  **Emilia-Romagna = `emr`**.
- `/trova-quartiere/emr/` → elenco città pubblico (Bologna, Casalecchio di Reno, Castenaso, …).
- **`/citta/<slug>--<regione>/`** → pagina città. Es. `https://it.nextdoor.com/citta/bologna--emr/`.
- **`/quartiere/<slug>--<citta>--<regione>/`** → pagina quartiere.
  Es. `https://it.nextdoor.com/quartiere/bologninanordovest--bologna--emr/`.
- Altri: `/choose_address/`, `/join`, `/create-business/`, `/neighborhood_guidelines/`.

Le pagine città/quartiere **sono pubbliche** e contengono le sezioni:
`Conversations happening in …`, `Discover local groups`, `Latest safety updates near …`,
**`For sale and free items nearby`**, `Upcoming events`, `Neighborhood FAQs`, `Nearby neighborhoods`.
I post sono linkati come `/p/<id>`, ma ogni link "vedi tutti" passa da
`/choose_address/?…&next=/for_sale_and_free` → **login**.

## 5. Copertura geografica — ottima (ma non immobiliare)

Rilevata dalle pagine città pubbliche, persistita in
[`probe/quartieri-target.json`](./probe/quartieri-target.json) (107 quartieri, 6 comuni):

| Comune | Quartieri | Listings dichiarati | Gruppi | Residenti |
|---|---:|---|---:|---:|
| Bologna | 63 | 1.000+ | 119 | 390.098 |
| San Lazzaro di Savena | 14 | 700+ | 54 | 32.699 |
| Casalecchio di Reno | 11 | 400+ | 36 | 35.373 |
| Castenaso | 4 | 100+ | 53 | 16.357 |
| Pianoro | 8 | 50+ | 41 | 17.746 |
| Zola Predosa | 7 | 50+ | 33 | 19.369 |

**Tutti e 6 i comuni della whitelist sono coperti.** La geografia non è il problema.

## 6. Contenuto reale di "For Sale & Free" — VERIFICATO: oggetti usati, NON immobili

Campionamento della sezione pubblica `For sale and free items nearby` su **6 pagine**
(1 città + 5 quartieri, incluso un comune fuori Bologna):

| Pagina | Oggetti effettivamente in vendita |
|---|---|
| Bologna (città) | sedie Calligaris €220, divano Arketipo €200, bollini Esselunga, lavatrice, estrattore di succo |
| Bolognina Nord-Ovest | cuscini gommapiuma, catene da neve €10, letto singolo €135, armadio, termoarredo, divano in pelle |
| Costa | abbigliamento bambini, macchina da cucire €80, cornice €80, carta Pokémon, libri, scarpiera |
| Mazzini | board game €25, porta calici €10, aloe vera, fasce crochet, cassettiera IKEA, armadio 4 ante |
| San Lazzaro (Savena) | **"Affittasi Garage Centro" €1** (affitto, non vendita), accessori vino €10, mobile IKEA, tavolo, monete |
| Pianoro | **auto bianca €6.500**, congelatore €140, pianoforte Roland, poltrona IKEA, dog sitting, calzoni donna |

**Esito: 0 annunci immobiliari in vendita su ~36 listing campionati.**
L'unico match "immobiliare" è un **garage in affitto a €1** → escluso due volte
(affitto ≠ vendita; garage ≠ residenziale).

Il pattern è strutturale, non un campione sfortunato: **For Sale & Free è la bacheca
degli oggetti usati del quartiere**, l'equivalente di un mercatino. Non esiste una
categoria "case/appartamenti" paragonabile a Marketplace o Subito.

## 7. Decisione

- **DIFFERITO confermato**, ma il motivo cambia: non è solo il login, è che
  **la fonte non contiene immobili in vendita**. Il login da solo non sbloccherebbe nulla di utile.
- **Nessun adapter Nextdoor.** Nessuna richiesta di login all'utente: sarebbe costo (credenziali,
  eventuale 2FA, sessione persistente) a fronte di resa attesa nulla sui criteri BIG/SMA.
- Le pagine pubbliche SEO restano utili come **mappa quartieri** (`probe/quartieri-target.json`),
  riutilizzabile per geolocalizzare annunci di altre fonti a livello di quartiere.
- Se in futuro l'utente segnala annunci immobiliari reali dentro i **gruppi** di quartiere
  (119 gruppi su Bologna), rivalutare: i gruppi sono un canale diverso da For Sale & Free
  e sono completamente chiusi al pubblico. In quel caso: login manuale + 2FA,
  poi scraping dei soli gruppi a tema casa/vendite, **solo vendita**.

## 8. BIG / SMA / FLIP

Nessuna. Non ci sono immobili → nessun candidato BIG (≤160k, ≥2 camere) né SMA (≤130k, 1 camera).
Il valore residuo per STALE (privati senza provvigione) è **teorico**: i privati qui vendono mobili, non case.

## 9. Dedup

Non applicabile: nessun annuncio da deduplicare. La fonte **non entra in GLOBAL**.