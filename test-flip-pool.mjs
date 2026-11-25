// Test dei "no" duri del pool FLIP RENO (segnalazione utente 24/11/2026):
// demolizione, locale commerciale dichiarato, residenza non consentita e
// residenziale ipotetico non devono MAI essere candidati, anche se il campo
// stato strutturato dice "Da ristrutturare"/"Buono".
// Uso: node test-flip-pool.mjs

import assert from 'node:assert';
import { analyzeFlip } from './core/flip.mjs';
import { detectNonResidential } from './core/filters.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`✅ ${name}`); };

const base = {
  id: 't1', portale: 'test', titolo: 'Appartamento', tipologia: 'Appartamento',
  comune: 'Bologna', zona: 'Bologna / Santa Viola',
  prezzo: 90000, superficieMq: 70, prezzoMq: '1286 €/m²',
  stato: 'Da ristrutturare', descrizione: 'Appartamento da ristrutturare in zona comoda.',
};
// Comparabili sintetici per rendere l'ARV stimabile (mediana di zona).
const comps = [1, 2, 3, 4].map((i) => ({
  ...base, id: `c${i}`, stato: 'Buono / Abitabile', prezzo: 210000, superficieMq: 70, prezzoMq: '3000 €/m²',
}));

function renoOf(ad) {
  const ads = [ad, ...comps];
  analyzeFlip(ads, { detectNonResidential });
  return ads[0].flip.reno;
}

ok('controllo: ristrutturare vero con ARV stimabile → candidato', () => {
  const r = renoOf({ ...base });
  assert.equal(r.candidato, true);
});

ok('demolire e ricostruire nel testo → NON candidato (stato dice ristrutturare)', () => {
  const r = renoOf({
    ...base,
    stato: 'Da ristrutturare',
    descrizione: 'Si tratta di una casa completamente da demolire e ricostruire, attualmente su tre livelli con giardino di proprietà.',
  });
  assert.equal(r.candidato, false);
  assert.match(r.motivoPool, /demolire/i);
});

ok('demolizione già eseguita in passato → nessun falso positivo', () => {
  const r = renoOf({
    ...base,
    descrizione: 'La villetta è stata oggetto di demolizione e ricostruzione nel 2019. Interni da ristrutturare con finiture datate.',
  });
  assert.equal(r.candidato, true);
});

ok('locale commerciale dichiarato in apertura → NON candidato né BIG', () => {
  const ad = {
    ...base, stato: 'Buono / Abitabile', prezzo: 48000, superficieMq: 46, prezzoMq: '1043 €/m²',
    descrizione: 'LOCALE COMMERCIALE   Proponiamo in vendita locale commerciale di 46 mq sito al piano terra con doppia vetrina fronte portico.',
  };
  assert.notEqual(detectNonResidential(ad), '');
  assert.equal(renoOf(ad).candidato, false);
});

ok('riferimento di zona al locale commerciale → nessun falso positivo', () => {
  const ad = {
    ...base,
    descrizione: 'Appartamento da ristrutturare vicino al locale commerciale all\'angolo, in zona comoda ai servizi.',
  };
  assert.equal(detectNonResidential(ad), '');
  assert.equal(renoOf(ad).candidato, true);
});

ok('residenza non consentita → NON candidato', () => {
  const r = renoOf({
    ...base,
    descrizione: 'Appartamento da ristrutturare. Non è possibile richiedere la residenza.',
  });
  assert.equal(r.candidato, false);
  assert.match(r.motivoPool, /residenza/i);
});

ok('residenziale solo ipotetico (rendering + autorizzazioni) → NON candidato', () => {
  const r = renoOf({
    ...base,
    descrizione: 'Ipotesi progettuale con rendering per la realizzazione di un moderno bilocale. Le soluzioni sono subordinate alle verifiche di fattibilità e alle autorizzazioni eventualmente necessarie.',
  });
  assert.equal(r.candidato, false);
  assert.match(r.motivoPool, /ipotetico/i);
});

console.log(`\n${n} test passati.`);