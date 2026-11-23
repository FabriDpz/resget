// Verifica la regola §2 "monolocale vale come camera solo se ≥55 m²" e la
// superficie minima, che prima erano dichiarate ma non applicate.
import { applyFilters, PROFILES, applyProfiles } from './core/filters.mjs';

const base = {
  comune: 'Bologna', lat: 44.4949, lon: 11.3426, prezzo: 120000,
  locali: 1, camere: 0, bagni: 1, piano: 'Terra', tipologia: 'Appartamento',
  descrizione: 'Monolocale in zona centrale.', stato: 'Buono / Abitabile',
};

const cases = [
  ['mono 38 m² (sotto soglia)', { ...base, superficieMq: 38 }, 'sma', 'Escluso'],
  ['mono 55 m² (soglia esatta)', { ...base, superficieMq: 55 }, 'sma', 'Selezionato'],
  ['mono 70 m²', { ...base, superficieMq: 70 }, 'sma', 'Selezionato'],
  ['mono senza mq dichiarati', { ...base, superficieMq: null }, 'sma', 'Escluso'],
  ['bilocale 60 m² 1 camera', { ...base, locali: 2, camere: 1, superficieMq: 60 }, 'sma', 'Selezionato'],
  ['BIG trilocale 45 m² (sotto soglia)', { ...base, prezzo: 150000, locali: 3, camere: 2, superficieMq: 45 }, 'big', 'Escluso'],
  ['BIG trilocale 70 m²', { ...base, prezzo: 150000, locali: 3, camere: 2, superficieMq: 70 }, 'big', 'Selezionato'],
];

let fail = 0;
for (const [nome, ad, prof, atteso] of cases) {
  const r = applyFilters({ ...ad }, PROFILES[prof], { maxKm: 3, minPoi: 0 });
  const ok = r.esito === atteso;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nome} → ${r.esito} (atteso ${atteso}) | ${r.motivazione}`);
}
// un annuncio non deve mai essere Selezionato in entrambi i profili con 2 camere
const due = applyProfiles({ ...base, prezzo: 120000, locali: 3, camere: 2, superficieMq: 70 }, { maxKm: 3, minPoi: 0 });
console.log(`BIG=${due.esito} SMA=${due.esitoSma} (SMA atteso Escluso: esattamente 1 camera)`);
if (due.esitoSma !== 'Escluso') fail++;
console.log(fail === 0 ? '\nTUTTI I CASI OK' : `\n${fail} CASI FALLITI`);
process.exit(fail === 0 ? 0 : 1);