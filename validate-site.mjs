import fs from 'fs';
const code = fs.readFileSync('site/data.js', 'utf8');
const window = {};
new Function('window', code)(window);
const d = window.RADAR_DATA;
console.log('generatedAt:', d.generatedAt);
console.log('portals:', d.portals.length, 'active:', d.portals.filter(p => p.active).length);
console.log('global ads:', d.global.ads.length, 'lordo:', d.global.totaleLordo, 'dup:', d.global.duplicatiRimossi, 'multi:', d.global.multiPortale);
console.log('deferred:', d.deferred.length);
console.log('ads senza prezzo:', d.global.ads.filter(a => a.prezzo == null).length);
const multi = d.global.ads.filter(a => a.multiPortale);
console.log('esempio multi:', multi[0] ? multi[0].id + ' fonti=' + JSON.stringify(multi[0].fonti) : 'none');
// integrity: every global ad has required fields
const bad = d.global.ads.filter(a => !a.id || !a.comune);
console.log('ads senza id/comune:', bad.length);
// BIG/SMA counts
const big = d.global.ads.filter(a => a.esito === 'Selezionato');
const sma = d.global.ads.filter(a => a.esitoSma === 'Selezionato');
console.log('BIG selezionati:', big.length, 'SMA selezionati:', sma.length);
const reno = d.global.ads.filter(a => a.flip && a.flip.reno && a.flip.reno.candidato);
const renoVerdi = reno.filter(a => a.flip.reno.semaforo === 'verde');
console.log('RENO candidati:', reno.length, 'verdi:', renoVerdi.length);