// Filtri BIG/SMA condivisi — fonte di verità: requisiti-immobilare.md §2.
// Estratti da immobiliare.it/scrape.mjs, identici nella logica.
// Uso: applyProfiles(ad, opts) con opts {maxKm, minPoi, minBedrooms}.

import { ALLOWED_COMUNI, COMUNI_FUORI, nearestCenter, comuneContraddetto, zonaEsclusa } from './geo.mjs';
import { MIN_POI_RANK } from './poi-config.mjs';

// Uso non residenziale (uffici/studi A10, laboratori C3, magazzini C2…).
// SOLO frasi che parlano dell'immobile: contatti d'agenzia e vani accessori esclusi.
export function detectNonResidential(ad) {
  if (/ufficio|studio|negozio|capannon|laboratorio|magazzino|deposito|commerciale/i.test(ad.tipologia || '')) {
    return 'Tipologia non residenziale';
  }
  const titolo = String(ad.titolo || '');
  // Tipologia dichiarata nel titolo del portale: attico lista "Cantina/Solaio
  // in vendita"/"Box/posto auto in vendita" sotto le ricerche residenziali
  // (50246744, 53427852). Un solaio/cantina/box non è un'unità abitativa.
  if (/^(?:cantina|solaio|soffitta|box|garage|posto\s+auto|magazzino|deposito|locale\s+commerciale)\b[^.]{0,20}(?:\/[^.]{0,20})?\s+in\s+vendita\b/i.test(titolo)) {
    return 'Tipologia non residenziale (dal titolo)';
  }
  // Cessione di attività commerciale (trovit 7780000786097988914: "Forno in
  // vendita – Attività ben avviata"): non è un immobile residenziale.
  if (/\battivit[àa]\s+(?:commerciale\s+)?(?:ben\s+)?avviata\b|\bcessione\s+(?:di\s+)?attivit[àa]\b|\b(?:forno|panetteria|bar|ristorante|pizzeria|tabaccheria|parrucchiere|negozio)\s+in\s+vendita\b/i.test(titolo)) {
    return 'Cessione di attività commerciale, non immobile residenziale';
  }
  const desc = ad.descrizione || '';
  if (/\bvendita\s+(?:di\s+)?attivit[àa]\s+commerciale\b|\battivit[àa]\s+commerciale\s+di\s+\w+,?\s+avviata\b/i.test(desc)) {
    return 'Cessione di attività commerciale, non immobile residenziale';
  }
  // Dichiarazione esplicita in apertura di descrizione: wikicasa 27261043
  // ("LOCALE COMMERCIALE   Proponiamo in vendita locale commerciale di 46 mq…")
  // aveva tipologia "Appartamento" e nessuna categoria catastale nel testo.
  // Solo nelle prime 2 frasi (dopo i contatti d'agenzia non vale) e solo come
  // soggetto dell'annuncio, non come riferimento di zona ("vicino al locale commerciale").
  const head = desc.split(/(?<=[.!?])\s+|\n+/).slice(0, 2).join(' ');
  if (!/maggiori informazioni|per info|contatt\w*|appuntament/i.test(head)
    && /(?:^|\s)(?:locale|spazio)\s+commerciale\s*[:\-–]|\bpropon\w*\s+(?:in\s+vendita\s+)?(?:un\s+|ampio\s+)?locale\s+commerciale\b|\bvendita\s+(?:di\s+)?locale\s+commerciale\b/i.test(head)) {
    return 'Locale commerciale dichiarato in descrizione';
  }
  const catRe = /cat(?:egoria)?\.?\s*(?:catastale\s*)?[BDE]\s*\/?\s*\d+|cat(?:egoria)?\.?\s*(?:catastale\s*)?C\s*\/?\s*(?!(?:[2-9]|1[01])\b)\d+|A\s*\/\s*10\b/i;
  const phraseRe = /accatast\w*|licenziat\w*|destinazione d'uso|cambio d'uso|uso ufficio|studio professionale|propon\w*\s+(?:in vendita\s+)?(?:un\s+|ampio\s+)*ufficio|vendita\s+(?:di\s+)?(?:un\s+|ampio\s+)*ufficio|(?:questo|tale|il)\s+locale\s+commerciale|trasform\w*\s+questo\s+locale/i;
  // Alcuni portali (attico) restituiscono la descrizione come blocco unico senza
  // punteggiatura: lo split dava UNA frase che conteneva sia "C/2 deposito" sia
  // "maggiori informazioni", e il flag contatti la scartava per intero lasciando
  // passare un deposito di 16 m² come candidato FLIP RENO.
  const sentences = desc.split(/(?<=[.!?])\s+|\n+/);
  let inContacts = false;
  for (const raw of sentences) {
    const contact = raw.match(/maggiori informazioni|per info|contatt\w*|appuntament|visite agli immobili|astenersi contatti/i);
    // Il flag contatti vale dalla loro menzione in poi, non retroattivamente:
    // la parte di testo che precede descrive ancora l'immobile.
    const s = contact ? raw.slice(0, contact.index) : (inContacts ? '' : raw);
    if (contact) inContacts = true;
    if (!s) continue;
    if (!catRe.test(s) && !phraseRe.test(s)) continue;
    const accessory = /vano|box|garage|cantina|soffitta|posto auto|locale tecnico|quest[’']ultimo/i.test(s);
    const subject = /l[’']immobile|l[’']unit[àa]|appartamento|accatastat[ao]\s+(?:come\s+)?ufficio/i.test(s);
    if (accessory && !subject) continue;
    const m = s.trim().match(/.{0,60}(?:accatast\w*|licenziat\w*|destinazione d'uso|cambio d'uso|uso ufficio|studio professionale|cat(?:egoria)?\.?\s*(?:catastale\s*)?[ABCDE]\s*\/?\s*\d+|ufficio).{0,60}/i);
    return `Uso non residenziale: "${(m ? m[0] : s).trim().slice(0, 140)}…"`;
  }
  return '';
}

// Residenziale solo "ipotetico": si vende uno spazio grezzo (spesso A/10) con
// rendering di un appartamento DA REALIZZARE, subordinato ad autorizzazioni.
// Caso reale: trovacasa bo-tc-63241-73999527 (via del Milliario, € 75k/55 m²,
// riscaldamento assente, 2 bagni per 2 vani) promosso SMA perché il testo di
// marketing non contiene mai "ufficio"/"A10"/"cambio d'uso".
// Serve la DOPPIA condizione (rendering/ipotesi + subordinamento ad
// autorizzazioni) per non colpire ristrutturazioni di case vere con progetto.
export function detectIpoteticoResidenziale(ad) {
  const desc = ad.descrizione || '';
  const ipotesiRe = /ipotesi\s+progettuale|rendering[^.]{0,120}(?:realizzazion|ipotizz)|realizzazione\s+di\s+un\s+(?:moderno\s+)?(?:bilocale|trilocale|appartamento)|(?:soluzione|progetto)\s+ipotizzat/i;
  const subordRe = /subordinat\w*\s+alle\s+verifiche\s+di\s+fattibilit[àa]|autorizzazioni\s+eventualmente\s+necessarie|(?:non\s+costituiscono[^.]{0,80})garanzia\s+di\s+fattibilit[àa]/i;
  if (ipotesiRe.test(desc) && subordRe.test(desc)) {
    return 'Residenziale solo ipotetico: immobile allo stato di fatto, abitabilità da realizzare e autorizzare';
  }
  // Variante "spazio grezzo" degli stessi annunci sugli aggregatori (wikicasa/
  // idealista via flatsearch: bf072ce0, 3e3d3685): il testo sintetico perde
  // rendering e clausole legali, ma resta la firma dell'ufficio travestito:
  // bilocale = due SOLI ambienti con DUE bagni (una casa vera ha soggiorno +
  // camera + bagno), tutto "da personalizzare/immaginare", nessun impianto
  // (stato, riscaldamento, cucina, APE tutti non dichiarati).
  const dueAmbienti = /\bdue\s+ambienti\b|\b2\s+ambienti\b/i.test(desc);
  const dueBagni = /\bdue\s+bagni\b|\b2\s+bagni\b/i.test(desc) || ad.bagni === 2;
  const daImmaginare = /da\s+personalizzare|da\s+reinventare|da\s+immaginare|soluzione\s+abitativa\s+su\s+misura/i.test(desc);
  const impiantiAssenti = !ad.stato && !ad.riscaldamento && !ad.cucina && !ad.ape;
  if (dueAmbienti && dueBagni && daImmaginare && impiantiAssenti) {
    return 'Bilocale solo ipotetico: due ambienti/due bagni da "personalizzare", impianti non dichiarati (probabile spazio non residenziale)';
  }
  return '';
}

// Annunci di AFFITTO finiti nelle ricerche di vendita (Subito mescola le due
// categorie). Casi reali: 667199615 "si affitta… canone mensile 1.100 €" a 1.100 €
// e 666969652 "proponiamo in affitto… € 800 al mese" a 800 €. Doppio segnale
// richiesto per non colpire frasi tipo "attualmente affittato" / "a reddito"
// su immobili in vendita: prezzo da canone (<3.000 €) OPPURE frase esplicita
// di locazione; un prezzo da vendita non è mai <3.000 € in questo radar.
export function detectAffitto(ad) {
  const text = `${ad.titolo || ''} ${ad.descrizione || ''}`;
  // Vendita "a reddito": immobile venduto con inquilino dentro, NON un affitto
  // (tecnocasa 61291062: "contratto in essere… canone mensile di € 630").
  if (/\ba\s+reddito\b|\bcontratto\s+(?:di\s+locazione\s+)?in\s+essere\b|\bgi[àa]\s+locat[oa]\b|\battualmente\s+(?:affittat|locat)[oa]\b|\bentrata\s+locativa\b|\bredditivit[àa]\b/i.test(text)) return '';
  const canone = /\bcanone\s+(?:mensile|concordato|di\s+locazione|d['’]affitto)\b|\b(?:€|euro)\s*[\d.]+\s*(?:al|\/|per)\s*mese\b/i.test(text);
  // "affittasi" e "affitto tramite agenzia" (subito 666969652, segnalato 23/11):
  // forme che il pattern storico non copriva, falso negativo su un vero affitto.
  const locazione = /\bsi\s+affitta\b|\baffitta(?:si)?\b|\bproponi(?:amo|ono)\s+in\s+affitto\b|\bin\s+affitto\b|\baffitto\s+tramite\s+agenzia\b|\bin\s+locazione\b|\bcerch(?:iamo|asi|o)\s+(?:persone\s+referenziate|inquilin\w*|una\s+coppia|studenti|ragazze|ragazzi)\b/i.test(text);
  const prezzoCanone = ad.prezzo != null && ad.prezzo > 0 && ad.prezzo < 3000;
  if (prezzoCanone && (canone || locazione || /\baffitt\w*\b/i.test(text))) {
    return `Annuncio di affitto, non vendita (prezzo ${ad.prezzo} € = canone)`;
  }
  if (canone && locazione) return 'Annuncio di affitto, non vendita (canone mensile + richiesta inquilini)';
  return '';
}

// Trattativa riservata / prezzo su richiesta: regola UTENTE 22/11/2026 —
// mai accettate (di solito nascondono budget fuori scala). Vale anche quando
// il prezzo manca del tutto: senza prezzo il budget non è verificabile.
// A differenza di altri dati mancanti (fail-open D2), qui il prezzo è il
// criterio cardine: fail-closed esplicito, non "in valutazione".
export function detectTrattativaRiservata(ad) {
  if (ad.prezzo != null && ad.prezzo > 0) return '';
  const text = `${ad.titolo || ''} ${ad.descrizione || ''} ${ad.altreCaratteristiche || ''}`;
  if (/trattativ[ae]\s+riservat|prezzo\s+su\s+richiesta|prezzo\s+in\s+agenzia|prezzo\s+non\s+(?:dichiarato|pubblicato|disponibile)|richiesta\s+riservata/i.test(text)) {
    return 'Trattativa riservata (regola utente: mai accettate)';
  }
  return 'Prezzo non dichiarato: budget non verificabile (trattativa riservata presunta, regola utente)';
}

// Nuda proprietà: il testo dell'inserzionista vince, ma gli aggregatori spesso
// non copiano la descrizione (flatsearch ecd8fb7c → immobiliare 133727750
// "nuda proprietà" solo sull'originale). Si guardano anche tipologia,
// caratteristiche e lo slug dell'URL.
export function detectNudaProprieta(ad) {
  const urlSlug = String(ad.url || '').replace(/[-_/]+/g, ' ');
  if (/nuda\s+propriet/i.test(`${ad.tipologia || ''} ${urlSlug}`)) return 'Nuda proprietà';
  let desc = String(ad.descrizione || '');
  // trovacasa accoda "VEDI ALTRI ANNUNCI SIMILI" + teaser di altri immobili e
  // boilerplate d'agenzia ("gestione delle vendite, permute e degli affitti"):
  // il "nuda proprietà" di un ALTRO annuncio non deve escludere questo.
  desc = desc.split(/vedi\s+altri\s+annunci|annunci\s+simili|trovi\s+questo\s+annuncio\s+in|potrebbero\s+interessarti/i)[0];
  const sentences = desc.split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    if (/agenzia|societ[àa]|gruppo|franchising|network|camera\s+di\s+commercio|permute|servizi|assistiamo|ci\s+occupiamo/i.test(s)) continue;
    if (/nuda\s+propriet/i.test(s)) return 'Nuda proprietà';
  }
  if (/nuda\s+propriet/i.test(String(ad.altreCaratteristiche || ''))) return 'Nuda proprietà';
  return '';
}

// Immobili all'estero pubblicati sotto comuni italiani. Caso reale: casadaprivato
// 345449 "Capo Verde, Isola di Boavista" listato come "Bologna, Zona Giardini
// Margherita" con coordinate bolognesi valide → promosso BIG. L'URL dello slug
// è un segnale forte quanto la descrizione. Richiede una preposizione di luogo
// per non colpire frasi tipo "agenzia con sede in Albania".
const ESTERO_RE = /\b(?:a|in|sull['’]isola\s+di|isola\s+di)\s+(?:capo\s+verde|cape\s+verde|boavista|boa\s+vista|sal\s+rei|canarie|tenerife|fuerteventura|gran\s+canaria|lanzarote|sharm(?:\s+el[-\s]sheikh)?|marsa\s+alam|hurghada|djerba|malta|cipro|grecia|croazia|albania|valona|saranda|spagna|portogallo|algarve|tunisia|egitto|mar\s+rosso)\b/i;

export function detectEstero(ad) {
  const urlSlug = String(ad.url || '').replace(/[-_/]+/g, ' ');
  const text = `${ad.titolo || ''} ${ad.descrizione || ''} ${urlSlug}`;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  let inContacts = false;
  for (const raw of sentences) {
    // Frasi su agenzia/mercato non parlano della posizione dell'immobile.
    if (/agenzia|sede|societ[àa]|gruppo|franchising|network|mercato|investitori esteri/i.test(raw)) continue;
    const contact = raw.match(/maggiori informazioni|per info|contatt\w*/i);
    const s = contact ? raw.slice(0, contact.index) : (inContacts ? '' : raw);
    if (contact) inContacts = true;
    if (s && ESTERO_RE.test(s)) {
      const m = s.match(/.{0,60}(?:capo\s+verde|boavista|boa\s+vista|canarie|sharm|albania|algarve|croazia|grecia|malta|spagna|portogallo|tunisia|egitto).{0,60}/i);
      return `Immobile all'estero: "${(m ? m[0] : s).trim().slice(0, 140)}…"`;
    }
  }
  return '';
}

// Numero di piano da campi strutturati E testo libero ("terzo piano", "piano 3°",
// "3º piano"). Gli aggregatori spesso espongono solo "Piano intermedio" o nulla
// e il numero reale è nella descrizione (flatsearch f8fdd0cc: "al terzo piano").
// Ritorna null se non determinabile. "terra/rialzato" → 0. Mai "N piani"
// (plurale = piani dell'edificio, non piano dell'unità).
const PIANO_ORD = { primo: 1, prima: 1, secondo: 2, seconda: 2, terzo: 3, terza: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5, sesto: 6, sesta: 6, settimo: 7, settima: 7, ottavo: 8, ottava: 8, nono: 9, nona: 9, decimo: 10, decima: 10 };
export function pianoNumero(ad) {
  const ordKeys = Object.keys(PIANO_ORD).join('|');
  // "N° piano" nel testo richiede il separatore °/º/n.: "terzo piano 75 mq"
  // NON è piano 75. Nel campo strutturato un numero nudo È il piano ("4").
  const reNumText = /(\d{1,2})\s*[°º]\s*piano(?![a-z])|piano\s*(?:n[°.]+\s*)?(\d{1,2})(?!\s*(?:mq|m²|m2|metri))\b|\bpiano\s+(\d{1,2})(?:\s*[°º]|(?![\d]))|(\d{1,2})\s*[°º]/i;
  const reOrd = new RegExp(`\\b(${ordKeys})\\s+piano\\b|\\bpiano\\s+(${ordKeys})\\b`, 'i');
  const structured = `${ad.pianoSolo || ''} ${ad.piano || ''}`.trim();
  if (structured) {
    const solo = structured.match(/^(\d{1,2})\s*[°º]?$/);
    if (solo) return parseInt(solo[1], 10);
    const o = structured.match(reOrd);
    if (o) return PIANO_ORD[(o[1] || o[2]).toLowerCase()];
    const m = structured.match(reNumText);
    if (m) return parseInt(m[1] || m[2] || m[3] || m[4], 10);
    if (/\b(?:terra|rialzato)\b/i.test(structured)) return 0;
    if (/seminterr|sotterr|interrato/i.test(structured)) return -1;
  }
  const desc = ad.descrizione || '';
  if (desc.trim()) {
    // Ordinale PRIMA del numero: "al terzo piano 75 mq" è piano 3, non 75.
    const o = desc.match(reOrd);
    if (o) return PIANO_ORD[(o[1] || o[2]).toLowerCase()];
    const m = desc.match(reNumText);
    if (m) return parseInt(m[1] || m[2] || m[3] || m[4], 10);
    if (/\bpiano\s+(?:terra|rialzato)\b/i.test(desc)) return 0;
  }
  return null;
}

// §2: esclusi i piani dal 3° in su senza ascensore. Fail-closed: se il piano è
// ≥3 e l'ascensore non è confermato (campo vuoto e nessuna menzione nel testo),
// si esclude — coerente con la policy del progetto sui dati mancanti verificabili.
export function detectPianoAltoSenzaAscensore(ad) {
  const n = pianoNumero(ad);
  if (n == null || n < 3) return '';
  const asc = String(ad.ascensore || '').trim().toLowerCase();
  const text = `${ad.descrizione || ''} ${ad.altreCaratteristiche || ''}`;
  const ascNo = /^no$/.test(asc) || /senza\s+ascensore|no\s+ascensore|ascensore\s+assente|non\s+c['’]è\s+(?:l['’])?ascensore|privo\s+di\s+ascensore/i.test(text);
  const ascSi = /^s[iìí]$/.test(asc) || /\bcon\s+(?:l['’])?ascensore\b|ascensore\s+(?:presente|condominiale|in\s+condominio)|dotat\w*\s+di\s+ascensore/i.test(text);
  if (ascSi && !ascNo) return '';
  return `Piano ${n}° ${ascNo ? 'senza ascensore' : 'con ascensore non dichiarato'} (esclusi dal 3° piano in su senza ascensore)`;
}

// Seminterrato/interrato dichiarato solo nel testo: molti adapter non popolano
// il campo piano (wikicasa "piano interrato" con ordine invertito rispetto alla
// sua regex, flatsearch meta-field assente → 6982c5d5 promosso SMA).
export function detectSeminterratoDaTesto(ad) {
  // Se il campo strutturato dice che l'unità è su un altro piano, le menzioni
  // nel testo parlano di edificio/vani accessori (cebe9545: "palazzina di sei
  // piani oltre a un piano seminterrato"; 61250087: casa a terra con taverna
  // interrata collegata da scala interna).
  const n = pianoNumero(ad);
  if (n != null && n >= 0) return '';
  const t = `${ad.descrizione || ''} ${ad.altreCaratteristiche || ''}`;
  // "propone in vendita ampio seminterrato già arredato" (trovit MG150): il
  // seminterrato È l'unità in vendita, non un vano accessorio.
  const re = /\bpiano\s+(?:semi[-\s]?interrato|interrato|sotterraneo)\b|\b(?:semi[-\s]?interrato|sotterraneo)\s+piano\b|\b(?:situato|posto|ubicato)\s+al\s+(?:piano\s+)?(?:semi[-\s]?interrato|interrato|sotterraneo)\b|\bvendita\s+(?:di\s+)?(?:(?:un|ampio|grande)\s+)*(?:seminterrat[oa]|semi-interrat[oa]|magazzino\s+seminterrat[oa]|deposito\s+seminterrat[oa])\b/i;
  // Match per frase, saltando vani accessori e contesto edificio: "cantina al
  // piano interrato" in un appartamento al secondo piano NON è un seminterrato
  // (f77755b5); "edificio di sei piani oltre a un piano seminterrato" nemmeno.
  for (const raw of t.split(/(?<=[.!?;])\s+|\n+/)) {
    if (/\b(?:edificio|palazzina|stabile|fabbricato|condominio|complesso)\b/i.test(raw) && /\b(?:di|oltre|costituito|composto|piani)\b/i.test(raw) && !/\b(?:l['’]appartamento|l['’]unit[àa]|l['’]immobile|situato|si\s+trova)\b/i.test(raw)) continue;
    // "deposito/magazzino seminterrato" è l'unità stessa se è ciò che si vende:
    // non va rimosso come vano accessorio.
    // "magazzino/deposito seminterrato" è l'unità in vendita: la parola
    // magazzino va protetta PRIMA dello strip dei vani accessori (un lookahead
    // negativo non basta: il motore riprova da "deposito" dentro la frase).
    const protetto = raw.replace(/\b(?:magazzino|deposito)\s+(?:semi[-\s]?interrato|seminterrato|interrato|sotterraneo)\b/gi, 'seminterrato');
    const s = protetto.replace(/\b(?:cantina|cantine|box|garage|posto\s+auto|locale\s+tecnico|soffitta|taverna|magazzino|deposito)\b[^.;]{0,80}/gi, '');
    if (re.test(s)) {
      const m = s.match(/.{0,50}(?:semi[-\s]?interrato|interrato|sotterraneo).{0,50}/i);
      return `Seminterrato (dalla descrizione): "${(m ? m[0] : '').trim().slice(0, 120)}…"`;
    }
  }
  return '';
}

// Immobile dove non si può prendere la residenza: incompatibile con l'acquisto
// come abitazione, a prescindere dal piano (caso 6982c5d5: "Non è possibile
// richiedere la residenza").
// Stato già ottimo/ristrutturato/nuovo: nessun margine di rivalutazione per un
// flip (regola utente 22/11/2026). Il campo stato è normalizzato da mapStato
// ("Ottimo / Ristrutturato", "Nuovo / In costruzione"); i valori liberi dei
// portali vengono ri-normalizzati qui. Stato vuoto → in valutazione (D2).
export function detectStatoFlipInutile(ad) {
  const raw = String(ad.stato || '').trim();
  if (!raw) return '';
  const s = raw.toLowerCase();
  if (/demolire|ristrutturare|pessimo|cattivo|da sistemare|renovat|restaur|fixer/.test(s)) return '';
  if (/^nuovo|in costruzione|\bnew\b|ottimo|ristrutturat[oa]|pari al nuovo|perfetto|excelente|chiavi in mano|recentemente ristruttur|appena ristruttur|completamente ristruttur|totalmente ristruttur|già ristruttur/i.test(s)) {
    return `Stato "${raw}": nessun margine per ristrutturare (flip)`;
  }
  return '';
}

// Demolizione e ricostruzione: il campo strutturato "condizioni" spesso dice
// "Da ristrutturare" mentre la descrizione rivela che la casa va ABBATTUTA
// (attico 52223207: 350 mq, 15 "camere", 145k — costo di ricostruzione fuori
// scala per il flip). Il costo reale non è stimabile dal prezzo → escluso.
export function detectDemolizione(ad) {
  const text = `${ad.titolo || ''} ${ad.descrizione || ''}`;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    if (/agenzia|societ[àa]|gruppo|franchising|network/i.test(s)) continue;
    if (/\b(?:da\s+demolire|completamente\s+da\s+demolire|demolire\s+e\s+ricostruire|demolizione\s+e\s+ricostruzione|abbattimento\s+e\s+ricostruzione)\b/i.test(s)) {
      // Passato/completato ("è stata oggetto di demolizione e ricostruzione nel
      // 2019") descrive un intervento già fatto, non un costo futuro.
      if (/\b(?:stata?\s+oggetto\s+di|già\s+demolit|stata?\s+demolit|stata?\s+ricostruit|dopo\s+(?:la\s+)?demolizione)\b/i.test(s)) continue;
      return `Da demolire e ricostruire: "${s.trim().slice(0, 140)}…"`;
    }
  }
  return '';
}

export function detectNoResidenza(ad) {
  const t = ad.descrizione || '';
  if (!/non\s+è\s+possibile\s+(?:richiedere|ottenere|prendere|avere)\s+la\s+residenza|residenza\s+non\s+(?:consentita|possibile|ammessa)|\bno\s+residenza\b|non\s+si\s+può\s+(?:prendere|richiedere|ottenere)\s+(?:la\s+)?residenza/i.test(t)) return '';
  return 'Residenza non consentita';
}

// Aste giudiziarie: vietate dai requisiti (§2). Centralizzato perché il pattern
// era duplicato e debole in 10 adapter: i portali PVP/aggregatori usano il gergo
// delle procedure ("Tribunale: … RGE: … PVP: … Lotto N") senza scrivere "asta
// giudiziaria", e 7 aste erano state promosse BIG/SMA (5 flatsearch, 2 trovacasa).
const ASTA_RE = /\basta\b|\baste\b|astagiudiziaria|vendita\s+giudiziaria|esecuzione\s+immobiliare|base\s+d['’]asta|offerta\s+minima\s+di|tribunale\s*:|\bRGE\s*:|\bPVP\s*:|procedura\s+esecutiv|custode\s+giudiziario|decreto\s+di\s+trasferimento/i;

export function detectAuction(ad) {
  const fields = [ad.titolo, ad.descrizione, ad.altreCaratteristiche, ad.tipologia];
  const text = fields.filter(Boolean).join(' ');
  if (!ASTA_RE.test(text)) return '';
  const m = text.match(/.{0,60}(?:\basta\b|\baste\b|tribunale\s*:|\bRGE\s*:|\bPVP\s*:|vendita\s+giudiziaria).{0,60}/i);
  return `Asta giudiziaria: "${(m ? m[0] : text).trim().slice(0, 140)}…"`;
}

// BIG: ≤160k, ≥2 camere reali, ≥2 locali (bilocali solo se convertibili).
// SMA: ≤130k, esattamente 1 camera reale, ≥1 locale (monolocali ≥55 m²).
// minSuperficie: §2 dei requisiti fissa 55 m² per entrambi i profili.
export const PROFILES = {
  big: { label: 'BIG', maxPrezzo: 160000, minCamere: 2, maxCamere: null, minLocali: 2, minSuperficie: 55, bilocaliRule: true, monolocaleIsCamera: false },
  sma: { label: 'SMA', maxPrezzo: 130000, minCamere: 1, maxCamere: 1, minLocali: 1, minSuperficie: 55, bilocaliRule: false, monolocaleIsCamera: true },
};

export function applyFilters(ad, profile, { maxKm = 3, minPoi = MIN_POI_RANK, ignoreAffitto = false } = {}) {
  const reasons = [];
  const comune = String(ad.comune || '').trim().toLowerCase();
  if (comune && !ALLOWED_COMUNI.includes(comune)) reasons.push(`Comune non ammesso: ${ad.comune}`);
  // Provincia estera/extra-BO dichiarata nel titolo "(RG)", "(FE)"…: gli
  // aggregatori geocodificano l'omonimo nel comune target (flatsearch
  // 73bd8777: "Santa Croce Camerina (RG)" listato Bologna con geo bolognese).
  const provM = String(ad.titolo || '').match(/\(([A-Z]{2})\)\s*$/);
  if (provM && provM[1] !== 'BO') reasons.push(`Provincia ${provM[1]} dichiarata nel titolo: fuori area (geocoding omonimo)`);
  const fuori = comuneContraddetto(ad);
  if (fuori) reasons.push(`Comune reale ${fuori}: la descrizione contraddice "${ad.comune}" (geocoding omonimo)`);
  // Comune fuori whitelist citato come luogo nel TITOLO ("…A CASTEL BOLOGNESE"):
  // gli aggregatori lo listano sotto il comune cercato (trovit 8410002781950597047).
  const titoloUp = String(ad.titolo || '');
  for (const c of COMUNI_FUORI) {
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${esc}\\b`, 'i').test(String(ad.comune || ''))) continue;
    if (new RegExp(`(?:\\ba|\\bnel|\\bpresso|\\bcomune\\s+di|\\bin)\\s+${esc}\\b`, 'i').test(titoloUp)) {
      reasons.push(`Comune reale ${c}: il titolo contraddice "${ad.comune}"`);
      break;
    }
  }
  const estero = detectEstero(ad);
  if (estero) reasons.push(estero);
  const zonaNo = zonaEsclusa(ad);
  if (zonaNo) reasons.push(`Zona esclusa: ${zonaNo} (bassa piazzabilità per lo split)`);
  let centroVicino = '';
  let distanzaKm = null;
  if (ad.lat != null && ad.lon != null) {
    const near = nearestCenter(ad.lat, ad.lon);
    centroVicino = near.name;
    distanzaKm = Math.round(near.km * 10) / 10;
    if (near.km > maxKm) {
      reasons.push(`Troppo distante dal centro abitato: ${distanzaKm} km da ${near.name} (max ${maxKm} km)`);
    }
  } else if (!comune || ALLOWED_COMUNI.includes(comune)) {
    reasons.push('Coordinate non disponibili: distanza non verificabile');
  }
  const floorTxt = `${ad.piano} ${ad.pianoSolo}`.toLowerCase();
  if (/seminterr|sotterr|interrato/.test(floorTxt)) reasons.push('Seminterrato');
  else {
    const semiTesto = detectSeminterratoDaTesto(ad);
    if (semiTesto) reasons.push(semiTesto);
  }
  const pianoAlto = detectPianoAltoSenzaAscensore(ad);
  if (pianoAlto) reasons.push(pianoAlto);
  const noResidenza = detectNoResidenza(ad);
  if (noResidenza) reasons.push(noResidenza);
  const demolizione = detectDemolizione(ad);
  if (demolizione) reasons.push(demolizione);
  if (ad.verificaOrigine?.esito === 'morto') {
    reasons.push(`Annuncio non più disponibile sul portale d'origine (${ad.verificaOrigine.portale})`);
  }
  const nonRes = detectNonResidential(ad);
  if (nonRes) reasons.push(nonRes);
  const ipotetico = detectIpoteticoResidenziale(ad);
  if (ipotetico) reasons.push(ipotetico);
  const naked = detectNudaProprieta(ad);
  if (naked) reasons.push(naked);
  // ignoreAffitto: valutazione "lead privati" (regola utente 23/11/2026) —
  // il canone non è un prezzo di vendita, si giudica solo l'idoneità fisica.
  const affitto = ignoreAffitto ? '' : detectAffitto(ad);
  if (affitto) reasons.push(affitto);
  const asta = detectAuction(ad);
  if (asta) reasons.push(asta);
  const trattativa = detectTrattativaRiservata(ad);
  if (trattativa) {
    reasons.push(trattativa);
  } else if (ad.prezzo > profile.maxPrezzo) {
    reasons.push(`Prezzo > ${profile.maxPrezzo.toLocaleString('it-IT')} €`);
  }
  // Scheda vuota degli aggregatori (trovit "RIF"/"RIF": titolo e descrizione
  // troncati, nessun contenuto reale): niente su cui valutare il flip.
  // Fail-closed come il prezzo: un annuncio senza testo non è valutabile.
  const descLen = String(ad.descrizione || '').replace(/\s+/g, ' ').trim().length;
  if (descLen < 25) {
    reasons.push(`Descrizione assente o troncata ("${String(ad.descrizione || '').trim().slice(0, 20)}"): annuncio non valutabile`);
  }
  if (/demolire|cattivo stato/i.test(ad.stato)) reasons.push(`Stato: ${ad.stato}`);
  const statoFlip = detectStatoFlipInutile(ad);
  if (statoFlip) reasons.push(statoFlip);
  if (ad.poi?.rank != null && ad.poi.rank < minPoi) {
    reasons.push(`Rank POI insufficiente: ${ad.poi.rank}/100 (minimo ${minPoi})`);
  }

  let convertibile = '';
  const rooms = ad.locali ?? 0;
  // Camere AI (Fase 2 imbuto): campo verificato dal testo con confidence alta,
  // registrato in ai-residui.json. Priorità: planimetria verificata > dato
  // strutturato del portale > AI (riempie i buchi, non smentisce la planimetria).
  const aiCamereUsate = ad.camerePlanimetria == null && ad.camere == null && ad.camereAI != null;
  let bedrooms = ad.camerePlanimetria ?? ad.camere ?? ad.camereAI ?? 0;
  const planVerified = ad.camerePlanimetria != null;
  if (aiCamereUsate) ad.fonteCamere = `AI (conf ${ad.camereAIConfidenza ?? '?'})`;
  const mq = ad.superficieMq ?? null;
  // §2: superficie minima 55 m². Se la superficie non è dichiarata non si esclude
  // (dato mancante, non violazione accertata), ma il monolocale non può valere
  // come camera senza una superficie verificata.
  if (mq != null && profile.minSuperficie != null && mq < profile.minSuperficie) {
    reasons.push(`Superficie ${mq} m² < ${profile.minSuperficie} m²`);
  }
  if (profile.monolocaleIsCamera && rooms === 1 && bedrooms < 1) {
    if (mq != null && mq >= profile.minSuperficie) bedrooms = 1;
    else reasons.push(`Monolocale: vano unico valido come camera solo da ${profile.minSuperficie} m² (superficie ${mq ?? 'non dichiarata'})`);
  }
  if (rooms > 0 && rooms < profile.minLocali) {
    reasons.push(`Monolocale: minimo ${profile.minLocali} locali`);
  }
  const bilocaliRule = profile.bilocaliRule && rooms === 2;
  if (bilocaliRule) {
    const convRe = /convertibil|trasformabil|possibilit[àa]\s+(di\s+)?(ricavare|creare|realizzare|terza\s+camera|seconda\s+camera|trilocale)|ricavare\s+(una?\s+)?(seconda|terza|nuova)\s+(camera|stanza)|frazionabil|terzo\s+locale|gi[àa]\s+due\s+camere/i;
    const text = `${ad.descrizione} ${ad.altreCaratteristiche}`;
    if (bedrooms >= 2) {
      convertibile = 'Sì';
      ad.motivazioneFiltro = 'Bilocale con 2 camere da letto reali';
    } else if (convRe.test(text)) {
      convertibile = 'Sì';
      const m = text.match(convRe);
      ad.motivazioneFiltro = `Bilocale convertibile in trilocale (rilevato: "${m[0]}")`;
    } else if (ad.convertibileAI === true) {
      // Convertibilità verificata dall'AI sul testo (conf ≥ soglia, registro).
      convertibile = 'Sì';
      ad.motivazioneFiltro = `Bilocale convertibile in trilocale (AI: "${String(ad.convertibileAIEvidenza || '').slice(0, 80)}", conf ${ad.camereAIConfidenza ?? '?'})`;
    } else {
      convertibile = 'No';
      reasons.push('Bilocale non convertibile in trilocale');
    }
  }
  if (bedrooms < profile.minCamere && !bilocaliRule) {
    if (planVerified) {
      reasons.push(`Planimetria: ${bedrooms} camera/e da letto reali (dichiarate ${ad.camere ?? '?'}, min ${profile.minCamere})`);
    } else if (aiCamereUsate) {
      reasons.push(`Camere da letto: ${bedrooms} (verificate dall'AI sul testo, < ${profile.minCamere})`);
    } else {
      reasons.push(`Camere da letto: ${ad.camere ?? '?'} (< ${profile.minCamere})`);
    }
  }
  if (profile.maxCamere != null && bedrooms > profile.maxCamere) {
    const src = planVerified
      ? `Planimetria: ${bedrooms} camere da letto reali`
      : `Camere da letto: ${bedrooms}`;
    reasons.push(`${src} (${profile.label}: esattamente ${profile.maxCamere})`);
  }
  if (bedrooms < profile.minCamere && bilocaliRule && convertibile === 'Sì') {
    ad.motivazioneFiltro += ` — camere dichiarate: ${ad.camere ?? '?'}`;
  }
  return {
    convertibile,
    centroVicino,
    distanzaKm,
    esito: reasons.length ? 'Escluso' : 'Selezionato',
    motivazione: reasons.join('; ') || (profile.bilocaliRule ? ad.motivazioneFiltro : '') || 'Tutti i criteri soddisfatti',
  };
}

// Doppio esito: BIG (esito/motivazione/convertibile) + SMA (esitoSma/motivazioneSma).
export function applyProfiles(ad, { maxKm = 3, minPoi = MIN_POI_RANK, minBedrooms = 2 } = {}) {
  delete ad.motivazioneFiltro;
  const opts = { maxKm, minPoi };
  const big = applyFilters(ad, { ...PROFILES.big, minCamere: minBedrooms }, opts);
  const sma = applyFilters(ad, PROFILES.sma, opts);
  return { ...big, esitoSma: sma.esito, motivazioneSma: sma.motivazione };
}

// Lead privati da affitto (regola utente 23/11/2026): un annuncio di AFFITTO
// pubblicato da un PRIVATO che supera tutti gli altri criteri BIG/SMA è un
// possibile contatto off-market ("sarebbe interessato a vendere?"). Il canone
// non è un prezzo di vendita: il tetto budget non si applica (il prezzo di
// vendita è ignoto, da chiedere), tutto il resto resta fail-closed.
// Il contatto è MANUALE sul portale d'origine (D4: nessuna automazione).
//
// Il "privato" si valuta CASO PER CASO (regola utente 23/11):
// - portali con campo venditore ESPLICITO → "dichiarato dal portale";
// - portali dove il flag è INFERITO (agenzia assente/testo) → "da verificare":
//   il lead resta visibile ma va aperta la scheda sul portale prima di contattare;
// - verifica manuale registrata (lead-verifiche.json) → "verificato" / "agenzia":
//   la verifica umana VINCE sempre sul flag dell'adapter (anche smentendolo).
const PRIVATO_INFERITO = new Set([
  'wikicasa', 'flatsearch', 'caasa', 'trovit', 'mitula', 'trovacasa',
]);

// verifica = { privato: boolean, data, nota } dal registro manuale, o null.
// Ritorna null se non è un lead, altrimenti {profilo, privato, motivoAffitto, ...}.
export function leadAffittoPrivato(ad, opts = {}, verifica = null) {
  const motivoAffitto = detectAffitto(ad);
  if (!motivoAffitto) return null;
  // Smentita manuale (è un'agenzia) → mai lead, qualunque cosa dica l'adapter.
  if (verifica && verifica.privato === false) return null;
  const privatoDichiarato = ad.privato === true;
  if (!privatoDichiarato && !(verifica && verifica.privato === true)) return null;
  // maxPrezzo infinito: col canone il budget di vendita non è verificabile.
  const evalOpts = { ...opts, ignoreAffitto: true };
  const big = applyFilters(ad, { ...PROFILES.big, maxPrezzo: Infinity }, evalOpts);
  const sma = applyFilters(ad, { ...PROFILES.sma, maxPrezzo: Infinity }, evalOpts);
  const okBig = big.esito === 'Selezionato';
  const okSma = !okBig && sma.esito === 'Selezionato';
  if (!okBig && !okSma) return null;
  const statoPrivato = verifica?.privato === true ? 'verificato'
    : PRIVATO_INFERITO.has(ad.portale) ? 'da verificare'
    : 'dichiarato dal portale';
  return {
    profilo: okBig ? 'BIG' : 'SMA',
    statoPrivato,
    ...(verifica?.privato === true ? { verificaPrivato: { data: verifica.data || '', nota: verifica.nota || '' } } : {}),
    motivoAffitto,
    motivazione: okBig ? big.motivazione : sma.motivazione,
    convertibile: okBig ? big.convertibile : '',
  };
}