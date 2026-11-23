// ---------------------------------------------------------------------------
// Test del ledger temporale unificato (core/ledger.mjs) e dell'integrazione
// con analyzeFlip (giorni osservati / ribassi cross-run). Esecuzione:
//   node test-ledger.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyLedger, loadLedger, saveLedger, updateLedger, buildKeyIndex,
  ledgerObservations, adLedgerInfo, entryTimeline, adKeys,
} from './core/ledger.mjs';
import { analyzeFlip } from './core/flip.mjs';

let pass = 0, fail = 0;
function check(nome, ok) {
  if (ok) { pass++; console.log(`  OK   ${nome}`); }
  else { fail++; console.log(`  FAIL ${nome}`); }
}

const day = (n) => new Date(Date.UTC(2026, 10, n, 12)); // 2026-11-<n>
const iso = (n) => day(n).toISOString().slice(0, 10);

function ad(portale, id, prezzo, extra = {}) {
  return {
    portale, id, prezzo,
    titolo: `Casa ${id}`, comune: 'Bologna', zona: 'Bologna - Centro',
    indirizzo: 'Via Zamboni 10', superficieMq: 80, camere: 3,
    url: `https://example.test/${portale}/${id}`, agenzia: 'Agenzia Test',
    ...extra,
  };
}
function cluster(...annunci) {
  return { winner: annunci[0], annunci, duplicati: annunci.length - 1, fonti: [] };
}
const entryOf = (ledger, a) => {
  const idx = buildKeyIndex(ledger);
  const id = adKeys(a).map((k) => idx.get(k)).find(Boolean);
  return id ? [id, ledger.entries[id]] : [null, null];
};

// --- 1. primo run: creazione voci e diff ------------------------------------
console.log('\n[1] Primo run');
{
  const l = emptyLedger();
  const d = updateLedger(l, [cluster(ad('immobiliare', 'A1', 200000))], { now: day(1) });
  const [id, e] = entryOf(l, ad('immobiliare', 'A1', 200000));
  check('una voce creata', Object.keys(l.entries).length === 1);
  check('diff.nuovi contiene la voce', d.nuovi.length === 1 && d.nuovi[0] === id);
  check('firstSeen = giorno del run', e.firstSeen === iso(1));
  check('serie con un punto', e.serie['immobiliare:A1'].length === 1);
  check('prezzoCorrente corretto', e.prezzoCorrente === 200000);
  check('nessuno sparito al primo run', d.spariti.length === 0);
}

// --- 2. idempotenza stesso giorno -------------------------------------------
console.log('\n[2] Re-run nello stesso giorno');
{
  const l = emptyLedger();
  const c = cluster(ad('immobiliare', 'A1', 200000));
  updateLedger(l, [c], { now: day(1) });
  const d = updateLedger(l, [c], { now: day(1) });
  const [, e] = entryOf(l, c.winner);
  check('nessun nuovo al re-run', d.nuovi.length === 0);
  check('serie senza duplicati', e.serie['immobiliare:A1'].length === 1);
  check('una sola voce in runs per giorno', l.runs.length === 1);
}

// --- 3. ribasso reale --------------------------------------------------------
console.log('\n[3] Ribasso cross-run');
{
  const l = emptyLedger();
  updateLedger(l, [cluster(ad('immobiliare', 'A1', 200000))], { now: day(1) });
  const d = updateLedger(l, [cluster(ad('immobiliare', 'A1', 185000))], { now: day(5) });
  const [id, e] = entryOf(l, ad('immobiliare', 'A1', 185000));
  check('diff.ribassati con da/a', d.ribassati.length === 1 && d.ribassati[0].da === 200000 && d.ribassati[0].a === 185000);
  check('ribassiOsservati = 1', e.ribassiOsservati === 1);
  check('ribassoTotEuro = 15000', e.ribassoTotEuro === 15000);
  check('giorniOsservati = 4', e.giorniOsservati === 4);
  check('serie con 2 punti', e.serie['immobiliare:A1'].length === 2);
  // re-run stesso giorno col prezzo ribassato: nessun falso diff
  const d2 = updateLedger(l, [cluster(ad('immobiliare', 'A1', 185000))], { now: day(5) });
  check('re-run ribassato: nessun falso diff', d2.ribassati.length === 0);
  check('adLedgerInfo.ribassatoOggi sul primo diff', adLedgerInfo(l, buildKeyIndex(l), ad('immobiliare', 'A1', 185000), d).ribassatoOggi === true);
}

// --- 4. sparizione, guard, riapparizione ------------------------------------
console.log('\n[4] Sparizioni e guard anti-run-rotto');
{
  const l = emptyLedger();
  updateLedger(l, [cluster(ad('immobiliare', 'A1', 200000))], { now: day(1) });
  const d = updateLedger(l, [cluster(ad('immobiliare', 'A2', 300000, { indirizzo: 'Via Rizzoli 5' }))], { now: day(2) });
  const [, e1] = entryOf(l, ad('immobiliare', 'A1', 200000));
  check('voce assente marcata sparita', e1.stato === 'sparito' && e1.sparitoIl === iso(2));
  check('diff.spariti contiene la voce', d.spariti.length === 1);
  const d2 = updateLedger(l, [
    cluster(ad('immobiliare', 'A1', 200000)),
    cluster(ad('immobiliare', 'A2', 300000, { indirizzo: 'Via Rizzoli 5' })),
  ], { now: day(3) });
  check('riapparizione registrata', d2.riapparsi.length === 1);
  check('voce torna attiva', entryOf(l, ad('immobiliare', 'A1', 200000))[1].stato === 'attivo');
}
{
  const l = emptyLedger();
  const many = Array.from({ length: 30 }, (_, i) =>
    cluster(ad('immobiliare', `B${i}`, 100000 + i * 1000, { indirizzo: `Via Test ${i}`, superficieMq: 50 + i })));
  updateLedger(l, many, { now: day(1) });
  const d = updateLedger(l, many.slice(0, 5), { now: day(2) });
  check('guard attivo su crollo copertura', d.guardAttivo === true);
  check('nessuno marcato sparito col guard', d.spariti.length === 0);
  check('voci assenti restano attive', Object.values(l.entries).filter((e) => e.stato === 'sparito').length === 0);
  const dNoGuard = updateLedger(l, many.slice(0, 5), { now: day(3), guard: false });
  check('guard disattivabile', dNoGuard.spariti.length === 25);
}

// --- 5. ripubblicazione con ID nuovo -----------------------------------------
console.log('\n[5] Ripubblicazioni');
{
  const l = emptyLedger();
  updateLedger(l, [cluster(ad('immobiliare', 'OLD', 200000))], { now: day(1) });
  updateLedger(l, [cluster(ad('immobiliare', 'ALTRO', 300000, { indirizzo: 'Via Rizzoli 5' }))], { now: day(2) });
  const d = updateLedger(l, [
    cluster(ad('immobiliare', 'NEW', 195000)), // stesso indirizzo/mq, prezzo -2.5%
    cluster(ad('immobiliare', 'ALTRO', 300000, { indirizzo: 'Via Rizzoli 5' })),
  ], { now: day(3) });
  const [idNew, eNew] = entryOf(l, ad('immobiliare', 'NEW', 195000));
  const [idOld] = entryOf(l, ad('immobiliare', 'OLD', 200000));
  check('ID nuovo agganciato alla voce sparita', idNew !== null && idNew === idOld);
  check('firstSeen preservato', eNew.firstSeen === iso(1));
  check('ripubblicazione registrata con prezzi', eNew.ripubblicazioni.length === 1 && eNew.ripubblicazioni[0].prezzoPrima === 200000 && eNew.ripubblicazioni[0].prezzoDopo === 195000);
  check('diff.ripubblicati', d.ripubblicati.length === 1);
  check('non contato come nuovo', !d.nuovi.includes(idNew));
  check('non contato come riapparso (ID diverso)', d.riapparsi.length === 0);
}
{
  // ambiguità: due voci sparite identiche → nessun merge
  const l = emptyLedger();
  updateLedger(l, [
    cluster(ad('immobiliare', 'U1', 200000)),
    cluster(ad('subito', 'U2', 200000)), // stesso indirizzo: cluster distinti a mano
  ], { now: day(1) });
  updateLedger(l, [cluster(ad('immobiliare', 'KEEP', 400000, { indirizzo: 'Via Irnerio 90', superficieMq: 120 }))], { now: day(2) });
  const d = updateLedger(l, [
    cluster(ad('immobiliare', 'U3', 200000)),
    cluster(ad('immobiliare', 'KEEP', 400000, { indirizzo: 'Via Irnerio 90', superficieMq: 120 })),
  ], { now: day(3) });
  check('candidato ambiguo → voce nuova', d.nuovi.length === 1);
  check('nessuna ripubblicazione forzata', d.ripubblicati.length === 0);
}
{
  // prezzo troppo diverso → non è la stessa unità
  const l = emptyLedger();
  updateLedger(l, [cluster(ad('immobiliare', 'OLD', 200000))], { now: day(1) });
  updateLedger(l, [cluster(ad('immobiliare', 'X', 300000, { indirizzo: 'Via Rizzoli 5' }))], { now: day(2) });
  const d = updateLedger(l, [
    cluster(ad('immobiliare', 'NEW', 260000)), // +30%: fuori tolleranza
    cluster(ad('immobiliare', 'X', 300000, { indirizzo: 'Via Rizzoli 5' })),
  ], { now: day(3) });
  check('prezzo fuori ±10% → voce nuova', d.nuovi.length === 1 && d.ripubblicati.length === 0);
}

// --- 6. multi-fonte: cambio fonte non è ribasso ------------------------------
console.log('\n[6] Multi-portale');
{
  const l = emptyLedger();
  const a1 = ad('immobiliare', 'M1', 200000);
  const a2 = ad('mitula', 'M2', 198000, { url: 'https://mitula.test/M2' });
  updateLedger(l, [cluster(a1, a2)], { now: day(1) });
  const [id, e] = entryOf(l, a1);
  check('una sola voce per il cluster', Object.keys(l.entries).length === 1);
  check('serie per entrambe le fonti', Boolean(e.serie['immobiliare:M1'] && e.serie['mitula:M2']));
  check('prezzo corrente dalla fonte prioritaria', e.prezzoCorrente === 200000);
  // giorno 5: immobiliare sparisce dal cluster, resta mitula (prezzo più basso)
  const d = updateLedger(l, [cluster(a2)], { now: day(5) });
  check('cambio fonte non contato come ribasso', d.ribassati.length === 0);
  check('ribassiOsservati ancora 0', e.ribassiOsservati === 0);
  // giorno 8: mitula ribassa davvero
  const a2b = ad('mitula', 'M2', 190000, { url: 'https://mitula.test/M2' });
  const d2 = updateLedger(l, [cluster(a2b)], { now: day(8) });
  check('ribasso reale sulla fonte rimasto contato', d2.ribassati.length === 1 && d2.ribassati[0].da === 198000);
  check('timeline con punti di entrambe le fonti', entryTimeline(e).some((p) => p.fonte === 'immobiliare') && entryTimeline(e).some((p) => p.fonte === 'mitula'));
}

// --- 7. fusione voci (dedup scopre stesso immobile) --------------------------
console.log('\n[7] Fusione voci');
{
  const l = emptyLedger();
  updateLedger(l, [cluster(ad('immobiliare', 'F1', 200000))], { now: day(1) });
  updateLedger(l, [
    cluster(ad('immobiliare', 'F1', 200000)),
    cluster(ad('subito', 'F2', 200000)),
  ], { now: day(2) });
  // giorno 3: il dedup li unisce (stesso cluster con entrambi gli ID)
  const d = updateLedger(l, [cluster(ad('immobiliare', 'F1', 200000), ad('subito', 'F2', 200000))], { now: day(3) });
  check('una fusione registrata', d.fusi.length === 1);
  check('una sola voce sopravvissuta', Object.keys(l.entries).length === 1);
  const [id, e] = entryOf(l, ad('subito', 'F2', 200000));
  check('firstSeen della voce più vecchia', e.firstSeen === iso(1));
  check('chiavi di entrambe le voci', e.chiavi.includes('immobiliare:F1') && e.chiavi.includes('subito:F2'));
  check('la voce fusa punta alla primaria', id === d.fusi[0].in);
}

// --- 8. idsOrigine degli aggregatori -----------------------------------------
console.log('\n[8] Origine aggregatori');
{
  const l = emptyLedger();
  const orig = ad('immobiliare', 'ORIG', 200000);
  updateLedger(l, [cluster(orig)], { now: day(1) });
  const agg = ad('flatsearch', 'FS9', 200000, { idsOrigine: [{ portale: 'Immobiliare.it', id: 'ORIG' }] });
  const d = updateLedger(l, [cluster(agg)], { now: day(2) });
  check('aggregatore agganciato via idsOrigine', d.nuovi.length === 0 && Object.keys(l.entries).length === 1);
  const [, e] = entryOf(l, orig);
  check('firstSeen preservato attraverso aggregatore', e.firstSeen === iso(1));
}

// --- 9. prezzo null e persistenza ---------------------------------------------
console.log('\n[9] Prezzo null e persistenza');
{
  const l = emptyLedger();
  const d = updateLedger(l, [cluster(ad('immobiliare', 'N1', null))], { now: day(1) });
  const [, e] = entryOf(l, ad('immobiliare', 'N1', null));
  check('voce creata anche senza prezzo', d.nuovi.length === 1);
  check('nessuna serie inventata', Object.keys(e.serie).length === 0 && e.prezzoCorrente === null);

  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-')), 'ledger.json');
  saveLedger(l, tmp);
  const l2 = loadLedger(tmp);
  check('round-trip save/load', JSON.stringify(l2) === JSON.stringify(l));
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  const vuoto = loadLedger(path.join(os.tmpdir(), 'ledger-inesistente-xyz.json'));
  check('file mancante → ledger vuoto', Object.keys(vuoto.entries).length === 0);
}

// --- 10. osservazioni → analyzeFlip -------------------------------------------
console.log('\n[10] Integrazione analyzeFlip');
{
  const l = emptyLedger();
  updateLedger(l, [cluster(ad('immobiliare', 'S1', 200000))], { now: day(1) });
  updateLedger(l, [cluster(ad('immobiliare', 'S1', 185000))], { now: day(10) });
  const obs = ledgerObservations(l);
  check('osservazioni indicizzate portale:id', Boolean(obs['immobiliare:S1']));
  check('firstSeen nella osservazione', obs['immobiliare:S1'].firstSeen === iso(1));

  // annuncio "ripubblicato oggi" secondo il portale, ma osservato da 14 giorni
  const a = ad('immobiliare', 'S1', 185000, { pubblicatoIl: iso(14) });
  analyzeFlip([a], { osservazioni: obs, now: day(15) });
  const s = a.flip.stale;
  check('giorni dichiarati bassi', s.giorniDichiarati === 1);
  check('giorni osservati prevalgono', s.giorniOsservati === 14 && s.giorniOnline === 14);
  check('ribasso dal ledger', s.ribassi === 1 && s.ribassoTot === 15000);
  check('punteggio giorni da osservato', s.puntiGiorni === Math.min(40, Math.round((14 / 180) * 40)));

  // senza osservazioni: comportamento precedente invariato
  const b = ad('immobiliare', 'S2', 185000, { pubblicatoIl: iso(14) });
  analyzeFlip([b], { now: day(15) });
  check('senza ledger: giorni dichiarati', b.flip.stale.giorniOnline === 1 && b.flip.stale.giorniOsservati === null);
}

console.log(`\n${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
