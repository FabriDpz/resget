// Riapplica le regole di qualità correnti ai JSON già raccolti, senza re-scrape.
// Uso: node sanitize-dati.mjs [--dry-run] [--portale flatsearch]
//
// Perché esiste: gli annunci raccolti prima dei fix restavano nel sito con esiti
// BIG/SMA e ROI basati su dati falsi (7 aste promosse, un immobile di Cento
// geocodificato a Bologna con ROI 61,5%). Uno scrape completo costa ore: questo
// riscrive in place ciò che è verificabile offline dal testo già scaricato.
//
// Cosa fa:
//   1. camere: se la descrizione dichiara un numero diverso dal campo strutturato,
//      vince il testo (il fallback locali-1 conta anche cucine e ripostigli);
//   2. isAuction: calcolato da detectAuction invece di una costante;
//   3. esiti BIG/SMA: ricalcolati con applyProfiles (aste e geocoding omonimo
//      sono ora esclusioni del core).
// NON cancella annunci: la tracciabilità dello scrape si conserva e il sito mostra
// la motivazione dell'esclusione. Le aste restano fuori dai comparabili ARV.

import fs from 'node:fs';
import path from 'node:path';
import { applyProfiles, detectAuction } from './core/filters.mjs';
import { comuneContraddetto } from './core/geo.mjs';
import { bedroomsFromText } from './core/schema.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const soloPortale = (() => { const i = args.indexOf('--portale'); return i >= 0 ? args[i + 1] : null; })();

const dirs = fs.readdirSync('.').filter((d) => {
  if (soloPortale && d !== soloPortale) return false;
  try { return fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'output')); } catch { return false; }
});

let totCamere = 0, totAste = 0, totEsiti = 0, totComuni = 0;
for (const d of dirs) {
  const out = path.join(d, 'output');
  const file = fs.readdirSync(out).filter((f) => f.startsWith('annunci-')).sort().pop();
  if (!file) continue;
  const full = path.join(out, file);
  const ads = JSON.parse(fs.readFileSync(full, 'utf8'));
  let camere = 0, aste = 0, esiti = 0, comuni = 0;

  for (const a of ads) {
    const dalTesto = bedroomsFromText(a.descrizione, null);
    if (dalTesto != null && a.camere !== dalTesto) {
      console.log(`[camere] ${d}/${String(a.id).slice(0, 10)}: ${a.camere ?? '?'} → ${dalTesto}`);
      a.camere = dalTesto;
      camere++;
    }
    const asta = Boolean(detectAuction(a));
    // Si contano solo i valori realmente sbagliati, non l'aggiunta del campo
    // mancante: 9 adapter non lo espongono e undefined→false non è una correzione.
    if (asta || (a.isAuction != null && a.isAuction !== asta)) aste++;
    a.isAuction = asta;
    const fuori = comuneContraddetto(a);
    if (fuori) { comuni++; console.log(`[comune] ${d}/${String(a.id).slice(0, 10)}: "${a.comune}" ma la descrizione indica ${fuori}`); }
    const next = applyProfiles(a, { maxKm: 3, minPoi: 35 });
    if (next.esito !== a.esito || next.esitoSma !== a.esitoSma) {
      esiti++;
      console.log(`[esito]  ${d}/${String(a.id).slice(0, 10)}: ${a.esito}/${a.esitoSma} → ${next.esito}/${next.esitoSma}`);
    }
    Object.assign(a, next);
  }

  const big = ads.filter((a) => a.esito === 'Selezionato').length;
  const sma = ads.filter((a) => a.esitoSma === 'Selezionato').length;
  console.log(`${d}: ${ads.length} annunci · ${camere} camere · ${aste} aste · ${comuni} comuni · ${esiti} esiti → BIG ${big} SMA ${sma}`);
  if (!DRY && (camere || aste || esiti)) fs.writeFileSync(full, JSON.stringify(ads, null, 2));
  totCamere += camere; totAste += aste; totEsiti += esiti; totComuni += comuni;
}
console.log(`\nTOTALE: ${totCamere} camere, ${totAste} aste, ${totComuni} comuni sospetti, ${totEsiti} esiti`);
console.log(DRY ? '(dry-run: nessuna scrittura)' : 'salvato.');