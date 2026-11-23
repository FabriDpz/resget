// Test di regressione sulle regole di qualità dati CONDIVISE nel core.
// Nasce dai difetti reali di flatsearch (aste, camere, geocoding omonimo) ed è
// esteso ai bug emersi centralizzandoli: aste nei comparabili ARV, hard-filter
// del pool RENO, non residenziale in descrizioni senza punteggiatura (attico).
// Ogni caso è un annuncio reale che produceva un falso positivo o un ROI sbagliato.
//   node test-qualita-dati.mjs

import fs from 'node:fs';
import path from 'node:path';
import { detectAuction, applyProfiles, detectNonResidential, detectEstero, pianoNumero, detectPianoAltoSenzaAscensore, detectSeminterratoDaTesto, detectNoResidenza, detectIpoteticoResidenziale, detectAffitto, detectNudaProprieta, leadAffittoPrivato } from './core/filters.mjs';
import { comuneContraddetto, zonaEsclusa } from './core/geo.mjs';
import { bedroomsFromText, sanitizeZona } from './core/schema.mjs';
import { computeMedians } from './core/flip.mjs';

// Fixture STORICHE: i run nuovi non contengono più gli annunci difettosi
// originali (rimossi dai portali o fuori budget), ma le regole vanno testate
// comunque. Si usa il dataset che contiene i casi, non l'ultimo in assoluto.
const outDir = 'flatsearch/output';
const file = 'annunci-2026-11-15-13-48.json';
const ads = JSON.parse(fs.readFileSync(path.join(outDir, file), 'utf8'));
const byId = (p) => ads.find((a) => a.id.startsWith(p));
// Dataset CORRENTE per i casi recenti.
const curFile = fs.readdirSync(outDir).filter((f) => f.startsWith('annunci-')).sort().pop();
const curAds = JSON.parse(fs.readFileSync(path.join(outDir, curFile), 'utf8'));
const curById = (p) => curAds.find((a) => a.id.startsWith(p));
// Fixture STORICA con descrizione backfillata: dal run 21/11 flatsearch non
// copia più la descrizione (ecd8fb7c oggi ha desc vuota). Il caso nuda proprietà
// si testa sul file che la contiene, non sull'ultimo in assoluto.
const nudaAds = JSON.parse(fs.readFileSync(path.join(outDir, 'annunci-2026-11-16-08-52.json'), 'utf8'));
const nudaById = (p) => nudaAds.find((a) => a.id.startsWith(p));

let ok = 0, ko = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok++; console.log(`  OK   ${name}`); }
  else { ko++; console.log(`  FAIL ${name} ${detail}`); }
};

console.log('— Aste: i 9 annunci reali che il vecchio filtro lasciava passare —');
const asteIds = ['21490eb4', '888d87f2', 'e040a8be', 'd06a81a6', '3945ab40', '185d8f47', '4b43e762', 'cebe9545', '3dd71c6e'];
for (const p of asteIds) {
  const a = byId(p);
  check(`asta ${p} riconosciuta`, Boolean(detectAuction(a)), `→ "${detectAuction(a)}"`);
}

console.log('— Comune contraddetto dalla descrizione —');
const cento = byId('d436f14a');
check('Cento vs JSON-LD Bologna → rilevato', comuneContraddetto(cento) === 'Cento');
check('annuncio Bologna genuino non scartato',
  comuneContraddetto({ descrizione: 'Appartamento in via Mazzini a Bologna, ottimo stato.', comune: 'Bologna' }) === '');
check('citazione non di luogo non scarta',
  comuneContraddetto({ descrizione: 'Agenzia con sede a Modena, vende appartamento a Bologna.', comune: 'Bologna' }) === '');
check('comune dichiarato coincide → nessun conflitto',
  comuneContraddetto({ descrizione: 'Casa nel comune di Cento, ampia.', comune: 'Cento' }) === '');

console.log('— Camere: il testo dell\'inserzionista vince sul fallback locali-1 —');
const casiCamere = [
  ['d436f14a', 3], // 7 locali ma "tre camere"
  ['f77755b5', 2], // 5 locali ma "due camere da letto"
  ['d06a81a6', 2], // 4 locali ma "due camere"
];
for (const [p, atteso] of casiCamere) {
  const a = byId(p);
  const dalTesto = bedroomsFromText(a.descrizione, null);
  check(`camere ${p} = ${atteso} (JSON ha ${a.camere})`, dalTesto === atteso, `→ ${dalTesto}`);
}

console.log('— applyProfiles: aste e comune falso non possono più essere target —');
for (const p of asteIds) {
  const a = byId(p);
  const r = applyProfiles({ ...a }, { maxKm: 3, minPoi: 35 });
  check(`${p} escluso BIG e SMA`, r.esito === 'Escluso' && r.esitoSma === 'Escluso', `${r.esito}/${r.esitoSma}`);
}
const rCento = applyProfiles({ ...cento }, { maxKm: 3, minPoi: 35 });
check('Cento escluso BIG e SMA', rCento.esito === 'Escluso' && rCento.esitoSma === 'Escluso', `${rCento.esito}/${rCento.esitoSma}`);
check('motivazione cita il comune reale', /Cento/.test(rCento.motivazione), rCento.motivazione);

console.log('— Aste fuori dai comparabili ARV (drogano la mediana di zona) —');
const base = { zona: 'Bologna / Test', comune: 'Bologna', stato: 'Buono stato', prezzoMq: '3000 €/m²' };
const asta = { ...base, id: 'asta-test', titolo: 'Appartamento in asta', descrizione: 'Tribunale: Bologna RGE: 1/2025', prezzoMq: '500 €/m²' };
const senza = computeMedians([{ ...base, id: 'x' }]).medianaComune('bologna');
const con = computeMedians([{ ...base, id: 'x' }, asta]).medianaComune('bologna');
check('mediana invariata aggiungendo un\'asta', con === senza && con === 3000, `senza=${senza} con=${con}`);

console.log('— Nessun falso positivo sui 57 annunci legittimi —');
const falsiAsta = ads.filter((a) => !asteIds.some((p) => a.id.startsWith(p)) && detectAuction(a));
check('nessun annuncio legittimo scambiato per asta', falsiAsta.length === 0, falsiAsta.map((a) => a.id.slice(0, 8)).join(','));
// 55dcdce1 (Granaglione) è un vero positivo segnalato dall'utente, non un falso.
const falsiComune = ads.filter((a) => a.id !== cento.id && !a.id.startsWith('55dcdce1') && comuneContraddetto(a));
check('nessun annuncio legittimo con comune contraddetto', falsiComune.length === 0, falsiComune.map((a) => a.id.slice(0, 8)).join(','));

console.log('— Non residenziale in descrizioni senza punteggiatura (attico/55186112) —');
// Descrizione reale: blocco unico con "C/2 deposito" PRIMA dei contatti. Il flag
// contatti scartava l'intero blocco e un deposito di 16 m² era candidato RENO.
const blob = 'proponiamo in vendita un locale accatastato C/2 (deposito) di circa 18 mq. Per maggiori informazioni contattare l\'agenzia.';
check('deposito C/2 riconosciuto', /C\/2|accatast/i.test(detectNonResidential({ tipologia: 'Appartamento', descrizione: blob })));
check('contatti dopo il testo non lo annullano',
  Boolean(detectNonResidential({ tipologia: 'Appartamento', descrizione: 'Locale accatastato C/2 (deposito) senza punteggiatura maggiori informazioni contattare agenzia' })));
check('appartamento con box non è non residenziale',
  detectNonResidential({ tipologia: 'Appartamento', descrizione: 'Appartamento di 80 mq con box auto e cantina. Contattare l\'agenzia.' }) === '');

console.log('— Zona catturata da una frase descrittiva (trovacasa/bo-tc-75892) —');
// La descrizione dice "servizi della zona quali attività commerciali": la regex
// dell'adapter aveva catturato il seguito della frase come nome del quartiere.
check('frase descrittiva non è una zona', sanitizeZona('quali attività commerciali') === '');
check('sottozona legittima preservata', sanitizeZona('Bolognina, Corticella, Pescarola / Corticella') === 'Bolognina, Corticella, Pescarola / Corticella');
check('quartiere con Parco preservato', sanitizeZona('Parco Nicholas Green') === 'Parco Nicholas Green');

console.log('— Nuove regole di lettura annuncio (casi reali segnalati) —');
// 6982c5d5: "piano interrato" solo in descrizione (meta-field assente) + no residenza.
const semi = byId('6982c5d5');
check('seminterrato dalla descrizione', Boolean(detectSeminterratoDaTesto(semi)));
check('residenza non consentita', Boolean(detectNoResidenza(semi)));
const rSemi = applyProfiles({ ...semi }, { maxKm: 3, minPoi: 35 });
check('6982c5d5 escluso BIG e SMA', rSemi.esito !== 'Selezionato' && rSemi.esitoSma !== 'Selezionato');
// f8fdd0cc: "Piano intermedio" nel campo, "al terzo piano 75 mq" nel testo.
const f3 = byId('f8fdd0cc');
check('piano 3 dal testo (non 75 dai mq)', pianoNumero(f3) === 3, String(pianoNumero(f3)));
const rF3 = applyProfiles({ ...f3 }, { maxKm: 3, minPoi: 35 });
check('3° piano ascensore non dichiarato escluso', rF3.esito !== 'Selezionato' && rF3.esitoSma !== 'Selezionato');
// Milliario: ufficio venduto con rendering di bilocale ipotetico + clausole.
const mill = byId('a83cc626');
check('bilocale solo ipotetico (rendering+subordinamento)', Boolean(detectIpoteticoResidenziale(mill)));
// bf072ce0/3e3d3685: stessa firma sintetica (due ambienti/due bagni/da personalizzare).
for (const p of ['bf072ce0', '3e3d3685']) {
  const r = applyProfiles({ ...byId(p) }, { maxKm: 3, minPoi: 35 });
  check(`dup Milliario ${p} non selezionato`, r.esito !== 'Selezionato' && r.esitoSma !== 'Selezionato');
}
// Anti-falsi-positivi delle nuove regole.
check('cantina al piano interrato non è seminterrato', !detectSeminterratoDaTesto(byId('f77755b5')));
check('box interrato non è seminterrato', !detectSeminterratoDaTesto({ descrizione: 'Appartamento al primo piano con box interrato.' }));
check('2° piano senza ascensore resta valido', !detectPianoAltoSenzaAscensore({ piano: '2', ascensore: 'No' }));
check('4° piano CON ascensore resta valido', !detectPianoAltoSenzaAscensore({ piano: '4', ascensore: 'S\u00ec' }));
check('ascensore in descrizione respected', !detectPianoAltoSenzaAscensore({ piano: 'Piano intermedio', descrizione: 'Quarto piano con ascensore condominiale.' }));
check('4° piano senza ascensore escluso', Boolean(detectPianoAltoSenzaAscensore({ piano: '4', ascensore: 'No' })));
check('piano numerico strutturato', pianoNumero({ piano: '4' }) === 4);
check('simbolo ° nel testo', pianoNumero({ descrizione: 'al 4\u00b0 piano' }) === 4);
check('piani edificio non è piano unità', pianoNumero({ descrizione: 'Palazzina di 5 piani, al primo piano.' }) === 1);
check('terra = piano 0', pianoNumero({ piano: 'Terra' }) === 0);
check('capo verde riconosciuto estero', Boolean(detectEstero({ titolo: 'Appartamento nuovo a Capo Verde, Isola di Boavista', url: 'https://www.casadaprivato.it/appartamenti/appartamento-nuovo-a-capo-verde-isola-di-boavista-bologna-345449' })));
check('agenzia estera non scarta immobile italiano', !detectEstero({ titolo: 'Appartamento a Bologna', descrizione: 'Agenzia con sede in Albania, vende a Bologna.' }));
check('ristrutturazione con progetto approvato non è ipotetico', !detectIpoteticoResidenziale({ descrizione: 'Appartamento con progetto approvato per la realizzazione di un bilocale. Rendering disponibile.', stato: 'Buono stato' }));
// mitula-IT-8270000794305974691: link diretto morto ("Spiacenti, ma questo non è più disponibile").
const rMorto = applyProfiles({ ...byId('58f2f4df'), verificaOrigine: { esito: 'morto', portale: 'mitula' } }, { maxKm: 3, minPoi: 35 });
check('verificaOrigine morto esclude BIG e SMA', rMorto.esito !== 'Selezionato' && rMorto.esitoSma !== 'Selezionato');
check('motivazione cita il portale morto', /non più disponibile sul portale d'origine \(mitula\)/.test(rMorto.motivazioneSma || ''));
const rSconosciuto = applyProfiles({ ...byId('58f2f4df'), verificaOrigine: { esito: 'sconosciuto', portale: 'mitula' } }, { maxKm: 3, minPoi: 35 });
check('sconosciuto (anti-bot) non esclude', rSconosciuto.esito === 'Selezionato');

console.log('— Zone collinari escluse e Appennino fuori focus (casi reali) —');
// 2e832d18: "Appartamento in Via Zena s.n.c, Pianoro" — valle dello Zena, alluvioni 2024.
const zena = byId('2e832d18');
check('Via Zena riconosciuta', Boolean(zonaEsclusa(zena)));
const rZena = applyProfiles({ ...zena }, { maxKm: 3, minPoi: 35 });
check('2e832d18 (Via Zena) escluso BIG e SMA', rZena.esito !== 'Selezionato' && rZena.esitoSma !== 'Selezionato');
check('zona Tazzola esclusa', Boolean(zonaEsclusa({ zona: 'Tazzola' })));
check('zona Colli Murri esclusa', Boolean(zonaEsclusa({ zona: 'Colli / Colli Murri' })));
check('Barbiano escluso', Boolean(zonaEsclusa({ zona: 'Barbiano' })));
check('vista sui colli non esclude', !zonaEsclusa({ descrizione: 'Appartamento in via Mazzini con vista sui colli bolognesi.' }));
check('Pianoro Vecchio resta valido', !zonaEsclusa({ zona: 'Pianoro Vecchio', descrizione: 'Appartamento a Pianoro Vecchio, vicino ai servizi.' }));
check('Rastignano resta valido', !zonaEsclusa({ zona: 'Rastignano', descrizione: 'A Rastignano in palazzina recente.' }));
check('Murri urbano resta valido', !zonaEsclusa({ zona: 'MURRI', descrizione: 'Via Murri, appartamento ristrutturato.' }));
// 55dcdce1: casetta a Noci, Comune di Granaglione (Appennino), listata "Bologna".
const granaglione = byId('55dcdce1');
check('Granaglione contraddice Bologna', comuneContraddetto(granaglione) === 'Granaglione');
const rGran = applyProfiles({ ...granaglione, verificaOrigine: undefined }, { maxKm: 3, minPoi: 35 });
check('55dcdce1 escluso anche senza verifica origine', rGran.esito !== 'Selezionato' && rGran.esitoSma !== 'Selezionato');

console.log('— Affitti nelle ricerche di vendita (Subito, casi reali) —');
// 667199615: "si affitta… canone mensile 1.100 €" a 1.100 € → era BIG-Selezionato.
// 666969652: "€ 800 AL MESE… proponiamo in affitto" a 800 € → era SMA-Selezionato.
const subFile = fs.readdirSync('subito/output').filter((f) => f.startsWith('annunci-')).sort().pop();
const subAds = JSON.parse(fs.readFileSync(path.join('subito/output', subFile), 'utf8'));
const subById = (id) => subAds.find((a) => String(a.id) === id);
for (const id of ['667199615', '666969652']) {
  const a = subById(id);
  check(`affitto ${id} riconosciuto`, Boolean(detectAffitto(a)), `→ "${detectAffitto(a)}"`);
  const r = applyProfiles({ ...a }, { maxKm: 3, minPoi: 35 });
  check(`affitto ${id} escluso BIG e SMA`, r.esito !== 'Selezionato' && r.esitoSma !== 'Selezionato', `${r.esito}/${r.esitoSma}`);
}
// Vendita "a reddito" (tecnocasa 61291062): inquilino dentro, NON un affitto.
check('vendita a reddito con canone non è affitto',
  !detectAffitto({ prezzo: 165000, descrizione: 'Monolocale locato con contratto in essere con scadenza ottobre 2030, a un canone mensile di € 630, garantendo un\'entrata locativa già avviata.' }));
check('appartamento attualmente affittato in vendita non è affitto',
  !detectAffitto({ prezzo: 120000, descrizione: 'Appartamento attualmente affittato, ottimo investimento a reddito.' }));
check('prezzo da vendita senza segnali affitto resta valido',
  !detectAffitto({ prezzo: 145000, descrizione: 'Trilocale in vendita, spese condominiali 80 euro al mese.' }));

console.log('— Lead privati da affitto (regola utente 23/11): in scope → contattabili —');
// Casi reali Subito: unico motivo di esclusione = affitto, privato dichiarato.
const lead668453390 = subById('668453390'); // quadrilocale 105 m², 3 camere, 900 €/mese
const lead668728343 = subById('668728343'); // 70 m², 2 locali 2 camere, 850 €/mese
const lead666969652 = subById('666969652'); // bilocale 72 m², 1 camera, 800 €/mese
const l1 = leadAffittoPrivato({ ...lead668453390, portale: 'subito' }, { maxKm: 3, minPoi: 35 });
check('668453390 lead BIG', l1?.profilo === 'BIG', JSON.stringify(l1));
const l2 = leadAffittoPrivato({ ...lead668728343, portale: 'subito' }, { maxKm: 3, minPoi: 35 });
check('668728343 lead BIG', l2?.profilo === 'BIG', JSON.stringify(l2));
const l3 = leadAffittoPrivato({ ...lead666969652, portale: 'subito' }, { maxKm: 3, minPoi: 35 });
check('666969652 lead SMA (bilocale non convertibile)', l3?.profilo === 'SMA', JSON.stringify(l3));
check('lead conserva il motivo affitto', /affitto/i.test(l1?.motivoAffitto || ''), l1?.motivoAffitto);
// Il canone non è un prezzo di vendita: il tetto budget non si applica.
const baseAff = { titolo: 'Trilocale Bologna', comune: 'Bologna', superficieMq: 70, locali: 3, camere: 2, lat: 44.49, lon: 11.34, prezzo: 900, privato: true, descrizione: 'Si affitta trilocale luminoso in via Mazzini a Bologna, canone mensile 900 euro.', stato: 'Buono / Abitabile' };
check('canone 900 € non blocca il lead (budget ignorato)', leadAffittoPrivato(baseAff, { maxKm: 3, minPoi: 35 })?.profilo === 'BIG');
// Non privato → nessun lead (agenzia dichiarata o flag assente).
check('affitto con agenzia non è lead', leadAffittoPrivato({ ...baseAff, privato: false, agenzia: 'Tempocasa' }, { maxKm: 3, minPoi: 35 }) === null);
check('affitto senza flag privato non è lead', leadAffittoPrivato({ ...baseAff, privato: undefined }, { maxKm: 3, minPoi: 35 }) === null);
// Altri filtri restano fail-closed: superficie sotto minimo → niente lead.
check('affitto 43 m² non è lead (superficie < 55)', leadAffittoPrivato({ ...baseAff, superficieMq: 43, locali: 2, camere: 1, descrizione: 'Privato affitta bilocale 43 mq, canone mensile 750 euro.' }, { maxKm: 3, minPoi: 35 }) === null);
// Annuncio di vendita normale → mai lead.
check('vendita normale non è lead', leadAffittoPrivato({ ...baseAff, prezzo: 140000, descrizione: 'Trilocale in vendita in via Mazzini a Bologna.' }, { maxKm: 3, minPoi: 35 }) === null);
// Vendita "a reddito" (privato) → non è affitto, quindi non è lead.
check('vendita a reddito non è lead', leadAffittoPrivato({ ...baseAff, prezzo: 120000, descrizione: 'Appartamento attualmente affittato, ottimo investimento a reddito.' }, { maxKm: 3, minPoi: 35 }) === null);
// Il flag lead non promuove l'annuncio nei profili standard.
const rLead = applyProfiles({ ...lead668453390 }, { maxKm: 3, minPoi: 35 });
check('lead resta Escluso BIG e SMA standard', rLead.esito !== 'Selezionato' && rLead.esitoSma !== 'Selezionato');
// Stato privato caso per caso: Subito espone il venditore → dichiarato.
check('subito lead = privato dichiarato dal portale', l1?.statoPrivato === 'dichiarato dal portale', l1?.statoPrivato);
// Portale con flag INFERITO (wikicasa: agenzia assente) → da verificare.
const lInf = leadAffittoPrivato({ ...baseAff, portale: 'wikicasa' }, { maxKm: 3, minPoi: 35 });
check('wikicasa lead = da verificare (flag inferito)', lInf?.statoPrivato === 'da verificare', lInf?.statoPrivato);
// Verifica manuale: conferma → verificato (anche su portale inferito).
const vSi = { privato: true, data: '2026-11-23', nota: 'scheda aperta: privato' };
const lVer = leadAffittoPrivato({ ...baseAff, portale: 'wikicasa' }, { maxKm: 3, minPoi: 35 }, vSi);
check('verifica manuale positiva → verificato', lVer?.statoPrivato === 'verificato' && lVer?.verificaPrivato?.data === '2026-11-23', JSON.stringify(lVer));
// Verifica manuale: smentita → MAI lead, anche se il portale dichiara privato.
check('verifica manuale negativa smentisce il portale', leadAffittoPrivato({ ...lead668453390, portale: 'subito' }, { maxKm: 3, minPoi: 35 }, { privato: false, data: '2026-11-23', nota: 'è agenzia' }) === null);
// Verifica positiva recupera un annuncio senza flag privato (inferito false).
const lRec = leadAffittoPrivato({ ...baseAff, privato: false, portale: 'casait' }, { maxKm: 3, minPoi: 35 }, vSi);
check('verifica manuale positiva recupera senza flag', lRec?.statoPrivato === 'verificato', JSON.stringify(lRec));
// Forme di locazione che il pattern storico mancava (falso negativo 23/11).
check('AFFITTASI riconosciuto', Boolean(detectAffitto({ prezzo: 850, titolo: 'AFFITTASI BILOCALE ARREDATO', descrizione: 'Affittasi bilocale arredato in via Massarenti.' })));
check('affitto tramite agenzia riconosciuto', Boolean(detectAffitto({ prezzo: 800, descrizione: 'Canone mensile: 800 €. AFFITTO TRAMITE AGENZIA. Si richiedono solide garanzie.' })));
check('affittasi senza prezzo-canone né canone non basta da solo', !detectAffitto({ prezzo: 140000, descrizione: 'Vendesi appartamento, affittasi eventualmente il box a parte.' }));

console.log('— Nuda proprietà: testo originale e falsi positivi dai teaser (casi reali) —');
// ecd8fb7c: descrizione backfillata dall'originale immobiliare 133727750.
const nuda = nudaById('ecd8fb7c');
check('nuda proprietà ecd8fb7c riconosciuta', Boolean(detectNudaProprieta(nuda)));
const rNuda = applyProfiles({ ...nuda }, { maxKm: 3, minPoi: 35 });
check('ecd8fb7c escluso BIG e SMA', rNuda.esito !== 'Selezionato' && rNuda.esitoSma !== 'Selezionato');
// trovacasa accoda "VEDI ALTRI ANNUNCI SIMILI": il nuda di un ALTRO annuncio non conta.
check('nuda nei teaser di altri annunci non esclude',
  !detectNudaProprieta({ descrizione: 'Trilocale ristrutturato in vendita. VEDI ALTRI ANNUNCI SIMILI: Bilocale Nuda Proprietà a Bologna.' }));
check('boilerplate agenzia non esclude',
  !detectNudaProprieta({ descrizione: 'La nostra agenzia si occupa di vendite, permute, nuda proprietà e affitti. Questo appartamento è in piena proprietà.' }));
check('nuda nello slug URL riconosciuta',
  Boolean(detectNudaProprieta({ url: 'https://portale.it/annunci/nuda-proprieta-bilocale-bologna-123', descrizione: '' })));

console.log('— Planimetria vince sulle camere dichiarate (idealista 29655698) —');
// Fixture STORICA: 29655698 è uscito dal dataset corrente (rimosso/aggiornato);
// la verifica planimetria si testa sul run che ha camerePlanimetria annotato.
const idAds = JSON.parse(fs.readFileSync(path.join('idealista/output', 'annunci-2026-11-16-08-52.json'), 'utf8'));
const trium = idAds.find((a) => String(a.id) === '29655698');
check('29655698 camerePlanimetria=1 annotato', trium?.camerePlanimetria === 1);
const rTrium = applyProfiles({ ...trium }, { maxKm: 3, minPoi: 35 });
check('29655698 escluso BIG (1 camera reale)', rTrium.esito !== 'Selezionato', rTrium.esito);
check('motivazione cita la planimetria', /Planimetria/.test(rTrium.motivazione || ''), rTrium.motivazione);
check('29655698 escluso SMA (prezzo 145k > 130k)', rTrium.esitoSma !== 'Selezionato', rTrium.esitoSma);

console.log('— Camere AI (Fase 2 imbuto): riempie i buchi, non smentisce planimetria/dato portale —');
const baseAI = { titolo: 'Appartamento Bologna', descrizione: 'Trilocale luminoso da ristrutturare in contesto servito, ottime potenzialità.', comune: 'Bologna', prezzo: 140000, superficieMq: 70, locali: 3, lat: 44.49, lon: 11.34, poi: { rank: 60 } };
const rAiOk = applyProfiles({ ...baseAI, camereAI: 2, camereAIConfidenza: 0.95 }, { maxKm: 3, minPoi: 35 });
check('camere mancanti + camereAI=2 → BIG selezionato', rAiOk.esito === 'Selezionato', rAiOk.motivazione);
const rAiKo = applyProfiles({ ...baseAI, camereAI: 1, camereAIConfidenza: 0.95 }, { maxKm: 3, minPoi: 35 });
check('camereAI=1 → BIG escluso con fonte AI', rAiKo.esito === 'Escluso' && /AI/.test(rAiKo.motivazione), rAiKo.motivazione);
const rAiPiano = applyProfiles({ ...baseAI, camerePlanimetria: 1, camereAI: 2 }, { maxKm: 3, minPoi: 35 });
check('planimetria vince su camereAI', rAiPiano.esito === 'Escluso' && /Planimetria/.test(rAiPiano.motivazione), rAiPiano.motivazione);
const rAiDato = applyProfiles({ ...baseAI, camere: 1, camereAI: 2 }, { maxKm: 3, minPoi: 35 });
check('dato portale vince su camereAI', rAiDato.esito === 'Escluso', rAiDato.motivazione);
const biAI = { ...baseAI, locali: 2, prezzo: 120000, descrizione: 'Bilocale in contesto tranquillo vicino ai servizi, ottime potenzialità di valorizzazione.' };
const rBiNo = applyProfiles({ ...biAI, camereAI: 1 }, { maxKm: 3, minPoi: 35 });
check('bilocale senza prova di convertibilità resta escluso BIG', rBiNo.esito === 'Escluso' && /non convertibile/.test(rBiNo.motivazione), rBiNo.motivazione);
const rBiSi = applyProfiles({ ...biAI, camereAI: 1, convertibileAI: true, convertibileAIEvidenza: 'possibilità di ricavare la seconda camera', camereAIConfidenza: 0.9 }, { maxKm: 3, minPoi: 35 });
check('convertibileAI=true con evidenza → BIG selezionato', rBiSi.esito === 'Selezionato', rBiSi.motivazione);
check('motivazione cita la fonte AI', /AI/.test(rBiSi.motivazione), rBiSi.motivazione);
const rBiFalse = applyProfiles({ ...biAI, camereAI: 1, convertibileAI: false }, { maxKm: 3, minPoi: 35 });
check('convertibileAI=false non apre il BIG', rBiFalse.esito === 'Escluso', rBiFalse.motivazione);
console.log('— Tipologia non residenziale dal titolo (attico: cantine/box nelle ricerche) —');
check('Cantina/Solaio in vendita → escluso', detectNonResidential({ titolo: 'Cantina/Solaio in vendita Via del Borgo di San Pietro 5, Bologna', descrizione: 'ampia cantina di 81 mq' }) !== '');
check('Box/posto auto in vendita → escluso', detectNonResidential({ titolo: 'Box/posto auto in vendita Via Libia , Bologna', descrizione: '' }) !== '');
check('Appartamento in vendita → nessun falso positivo', detectNonResidential({ titolo: 'Appartamento in vendita Via Roma, Bologna', descrizione: 'Trilocale con due camere da letto e cucina abitabile.' }) === '');
check('magazzino seminterrato in descrizione → seminterrato rilevato', detectSeminterratoDaTesto({ descrizione: 'proponiamo in vendita ampio magazzino seminterrato di circa 160 mq, con accesso carrabile diretto.' }) !== '');

console.log('— Trattativa riservata: regola utente 22/11 (mai accettate) —');
const baseTR = { titolo: 'Appartamento Bologna', descrizione: 'Bel trilocale luminoso in contesto tranquillo, vicino ai servizi.', comune: 'Bologna', prezzo: 140000, superficieMq: 70, locali: 3, camere: 2, lat: 44.49, lon: 11.34 };
const tr1 = applyProfiles({ ...baseTR, prezzo: null, descrizione: 'Trilocale, trattativa riservata in agenzia.' }, { maxKm: 3, minPoi: 35 });
check('trattativa riservata esplicita esclusa BIG e SMA', tr1.esito !== 'Selezionato' && tr1.esitoSma !== 'Selezionato');
check('motivazione cita la regola utente', /Trattativa riservata/i.test(tr1.motivazione || ''), tr1.motivazione);
const tr2 = applyProfiles({ ...baseTR, prezzo: null, descrizione: 'Prezzo su richiesta.' }, { maxKm: 3, minPoi: 35 });
check('prezzo su richiesta escluso', tr2.esito !== 'Selezionato' && tr2.esitoSma !== 'Selezionato');
const tr3 = applyProfiles({ ...baseTR, prezzo: null }, { maxKm: 3, minPoi: 35 });
check('prezzo mancante tout-court escluso (presunta trattativa)', tr3.esito !== 'Selezionato' && /trattativa riservata presunta/i.test(tr3.motivazione || ''), tr3.motivazione);
const tr4 = applyProfiles({ ...baseTR }, { maxKm: 3, minPoi: 35 });
check('prezzo presente non toccato dalla regola', !/trattativa/i.test(tr4.motivazione || ''), tr4.motivazione);

console.log('— Provincia extra-BO nel titolo: geocoding omonimo (flatsearch 73bd8777) —');
const rg = applyProfiles({ ...baseTR, titolo: "Vendita casa indipendente via sant' isidoro 32 Santa Croce Camerina (RG)" }, { maxKm: 3, minPoi: 35 });
check('titolo con (RG) escluso BIG e SMA', rg.esito !== 'Selezionato' && rg.esitoSma !== 'Selezionato');
check('motivazione cita la provincia', /Provincia RG/.test(rg.motivazione || ''), rg.motivazione);
const bo = applyProfiles({ ...baseTR, titolo: 'Appartamento in vendita a Bologna (BO)' }, { maxKm: 3, minPoi: 35 });
check('titolo con (BO) non toccato', !/Provincia BO/.test(bo.motivazione || ''), bo.motivazione);

console.log('— Demolizione e ricostruzione nascosta dallo stato (attico 52223207) —');
const dem = applyProfiles({ ...baseTR, stato: 'Da ristrutturare', descrizione: 'Si tratta di una casa completamente da demolire e ricostruire, attualmente su tre livelli con giardino.' }, { maxKm: 3, minPoi: 35 });
check('da demolire e ricostruire escluso BIG e SMA', dem.esito !== 'Selezionato' && dem.esitoSma !== 'Selezionato');
check('motivazione cita la demolizione', /demolire/i.test(dem.motivazione || ''), dem.motivazione);
const demOk = applyProfiles({ ...baseTR, descrizione: 'Appartamento da ristrutturare con ottime potenzialità. La vicina casa colonica è stata oggetto di demolizione e ricostruzione nel 2019.' }, { maxKm: 3, minPoi: 35 });
check('demolizione di un altro immobile non esclude', !/demolire/i.test(demOk.motivazione || '') || demOk.esito === 'Selezionato', demOk.motivazione);

console.log('— Stato ottimo/ristrutturato: nessun margine flip (regola utente 22/11) —');
const stOttimo = applyProfiles({ ...baseTR, stato: 'Ottimo / Ristrutturato' }, { maxKm: 3, minPoi: 35 });
check('ottimo/ristrutturato escluso BIG e SMA', stOttimo.esito !== 'Selezionato' && stOttimo.esitoSma !== 'Selezionato');
check('motivazione cita il margine flip', /nessun margine/i.test(stOttimo.motivazione || ''), stOttimo.motivazione);
const stNuovo = applyProfiles({ ...baseTR, stato: 'Nuovo / In costruzione' }, { maxKm: 3, minPoi: 35 });
check('nuovo/in costruzione escluso', stNuovo.esito !== 'Selezionato' && stNuovo.esitoSma !== 'Selezionato');
const stRaw = applyProfiles({ ...baseTR, stato: 'Appena ristrutturato' }, { maxKm: 3, minPoi: 35 });
check('valore libero "appena ristrutturato" escluso', stRaw.esito !== 'Selezionato');
const stRist = applyProfiles({ ...baseTR, stato: 'Da ristrutturare' }, { maxKm: 3, minPoi: 35 });
check('da ristrutturare resta valido', stRist.esito === 'Selezionato', stRist.motivazione);
const stBuono = applyProfiles({ ...baseTR, stato: 'Buono / Abitabile' }, { maxKm: 3, minPoi: 35 });
check('buono/abitabile resta valido', stBuono.esito === 'Selezionato', stBuono.motivazione);
const stVuoto = applyProfiles({ ...baseTR, stato: '' }, { maxKm: 3, minPoi: 35 });
check('stato vuoto resta in valutazione (D2)', stVuoto.esito === 'Selezionato', stVuoto.motivazione);

console.log('— Geocoding profondo: nuovi casi reali emersi (trovit 22/11) —');
const semiVendita = applyProfiles({ ...baseTR, titolo: 'Rif: MG150 - LA TEMPOCASA di Santa Viola propone in vendita ampio seminterrato', descrizione: 'Rif: MG150 - LA TEMPOCASA di Santa Viola propone in vendita ampio seminterrato già arredato', superficieMq: 188, camere: 3 }, { maxKm: 3, minPoi: 35 });
check('seminterrato in vendita escluso (MG150)', semiVendita.esito !== 'Selezionato' && semiVendita.esitoSma !== 'Selezionato');
check('motivazione cita seminterrato', /seminterrato/i.test(semiVendita.motivazione || ''), semiVendita.motivazione);
const forno = applyProfiles({ ...baseTR, titolo: 'Forno in vendita – Attività ben avviata In Via Vittorio Veneto', descrizione: 'In Via Vittorio Veneto proponiamo in vendita attività commerciale di forno, avviata con successo da sei anni', prezzo: 59000, superficieMq: 60, camere: 1 }, { maxKm: 3, minPoi: 35 });
check('cessione attività (forno) esclusa', forno.esito !== 'Selezionato' && forno.esitoSma !== 'Selezionato');
check('motivazione cita attività commerciale', /attivit[àa] commerciale/i.test(forno.motivazione || ''), forno.motivazione);
const castel = applyProfiles({ ...baseTR, titolo: 'VENDESI IMMOBILE IN CENTRO AL PIANO TERRA A CASTEL BOLOGNESE Appartamento', descrizione: 'Appartamento in vendita a Castel Bolognese, situato nel cuore del centro storico, libero al rogito.', prezzo: 120000, superficieMq: 130, camere: 4 }, { maxKm: 3, minPoi: 35 });
check('Castel Bolognese nel titolo escluso', castel.esito !== 'Selezionato' && castel.esitoSma !== 'Selezionato');
check('motivazione cita il comune reale', /Castel Bolognese/.test(castel.motivazione || ''), castel.motivazione);
const barOk = applyProfiles({ ...baseTR, descrizione: 'Appartamento luminoso vicino al bar sotto casa e a tutti i servizi.' }, { maxKm: 3, minPoi: 35 });
check('menzione generica di bar non esclude', barOk.esito === 'Selezionato', barOk.motivazione);
const rif = applyProfiles({ ...baseTR, titolo: 'RIF', descrizione: 'RIF', prezzo: 60000, superficieMq: 115, camere: 1 }, { maxKm: 3, minPoi: 35 });
check('scheda vuota "RIF" esclusa BIG e SMA', rif.esito !== 'Selezionato' && rif.esitoSma !== 'Selezionato');
check('motivazione cita descrizione troncata', /troncata|non valutabile/i.test(rif.motivazione || ''), rif.motivazione);

console.log(`\n${ok} OK, ${ko} FAIL`);
process.exit(ko ? 1 : 0);