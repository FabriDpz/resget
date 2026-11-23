// Test del dedup esatto via ID d'origine (aggregatore flatsearch → portali diretti).
// Uso: node test-dedup-origine.mjs
import { similarity, deduplicate } from './core/dedup.mjs';

const base = { comune: 'Bologna', prezzo: 120000, superficieMq: 70, camereDaLetto: 2, locali: 3, titolo: 'Trilocale via Roma 1', agenzia: 'Agenzia X', lat: 44.5, lng: 11.3 };
const diretto = { ...base, portale: 'subito', id: '668297848' };
const agg = { ...base, portale: 'flatsearch', id: 'uuid-abc', idsOrigine: [{ portale: 'Subito', id: '668297848' }] };

let fail = 0;
const check = (nome, ok) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome}`); if (!ok) fail++; };

// 1) prezzo/mq molto diversi: l'euristica NON matcha, l'ID d'origine sì.
const aggStale = { ...agg, prezzo: 99000, superficieMq: 55 };
check('ID origine batte prezzo/mq divergenti', similarity(diretto, aggStale) === 1);
check('senza ID origine il match fallisce', similarity(diretto, { ...aggStale, idsOrigine: undefined }) < 0.75);

// 2) comuni diversi non devono matchare nemmeno con ID (fail-closed sul comune).
//    Nota: l'ID è una chiave globale del portale d'origine, quindi il match vale.
check('ID origine valido anche con comune scritto diversamente',
  similarity({ ...diretto, comune: 'bologna' }, aggStale) === 1);

// 3) ID numerico uguale su portali DIVERSI senza dichiarazione = coincidenza, non match.
const altroPortale = { ...base, portale: 'idealista', id: '668297848', prezzo: 400000, superficieMq: 200 };
check('stesso ID su portali diversi NON matcha', similarity(diretto, altroPortale) < 0.75);

// 4) portale d'origine non mappato → nessuna chiave, si torna all'euristica.
const aggSconosciuto = { ...agg, idsOrigine: [{ portale: 'PortaleInesistente', id: '668297848' }], prezzo: 400000, superficieMq: 200 };
check('portale origine ignoto ignorato', similarity(diretto, aggSconosciuto) < 0.75);

// 5) deduplicate: l'aggregatore con prezzo obsoleto finisce nello stesso cluster.
const clusters = deduplicate([diretto, aggStale]);
check('cluster unico con prezzo obsoleto', clusters.length === 1 && clusters[0].fonti.length === 2);
check('vince il portale diretto', clusters[0].winner.portale === 'subito');

// 6) due aggregatori che puntano allo stesso annuncio diretto.
const agg2 = { ...agg, portale: 'mitula', id: 'uuid-xyz', prezzo: 150000, superficieMq: 90 };
check('due aggregatori stesso ID origine', similarity(agg, agg2) === 1);

// 7) annuncio senza relazione resta separato.
const estraneo = { ...base, portale: 'idealista', id: '999', prezzo: 300000, superficieMq: 150 };
check('annuncio estraneo resta separato', deduplicate([diretto, agg, estraneo]).length === 2);

// 8) doppioni dello STESSO portale con UUID diversi (flatsearch) → un solo annuncio.
const d1 = { ...base, portale: 'flatsearch', id: 'uuid-1', indirizzo: 'Via del Milliario 17', prezzo: 75000, superficieMq: 55, idsOrigine: [{ portale: 'Subito', id: '111' }] };
const d2 = { ...d1, id: 'uuid-2', idsOrigine: [{ portale: 'Idealista', id: '222' }] };
const cl8 = deduplicate([d1, d2]);
check('doppioni stesso portale collassati', cl8.length === 1 && cl8[0].annunci.length === 1);
check('ID origine dei doppioni uniti', cl8[0].winner.idsOrigine.length === 2);

// 9) senza indirizzo il pre-collasso non scatta: due annunci dello stesso portale
//    restano distinti se prezzo/mq non coincidono (dato mancante ≠ doppione accertato).
const s1 = { ...d1, indirizzo: '', prezzo: 75000, superficieMq: 55 };
const s2 = { ...d2, indirizzo: '', prezzo: 120000, superficieMq: 90 };
check('indirizzo assente: nessun collasso', deduplicate([s1, s2]).length === 2);

console.log(fail === 0 ? '\nTUTTI I CASI OK' : `\n${fail} CASI FALLITI`);
process.exit(fail === 0 ? 0 : 1);