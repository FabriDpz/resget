// Test normalizzazione date ed estrazione JSON-LD (core/dates.mjs).
// Uso: node test-dates.mjs

import assert from 'node:assert';
import { normDate, datesFromJsonLd, datesFromPage, fillDates } from './core/dates.mjs';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`✅ ${name}`); };
const NOW = new Date('2026-11-24T12:00:00Z');

await ok('normDate: ISO, epoch s/ms, formati italiani', () => {
  assert.equal(normDate('2026-06-09T10:22:00+02:00', NOW), '2026-06-09');
  assert.equal(normDate('2026-06-09', NOW), '2026-06-09');
  assert.equal(normDate(1780000000, NOW), '2026-05-28');
  assert.equal(normDate(1780000000000, NOW), '2026-05-28');
  assert.equal(normDate('09/06/2026', NOW), '2026-06-09');
  assert.equal(normDate('9.6.2026', NOW), '2026-06-09');
  assert.equal(normDate('12 marzo 2026', NOW), '2026-03-12');
  assert.equal(normDate('oggi', NOW), '2026-11-24');
  assert.equal(normDate('ieri alle 14', NOW), '2026-11-23');
});

await ok('normDate: valori non interpretabili o implausibili → vuoto', () => {
  assert.equal(normDate('', NOW), '');
  assert.equal(normDate(null, NOW), '');
  assert.equal(normDate('presto disponibile', NOW), '');
  assert.equal(normDate('1985-01-01', NOW), '');
  assert.equal(normDate('2027-06-01', NOW), ''); // futuro oltre 1 giorno
  assert.equal(normDate('32/13/2026', NOW), '');
});

await ok('datesFromJsonLd: nodo diretto, array e @graph annidato', () => {
  assert.deepEqual(
    datesFromJsonLd({ '@type': 'Product', datePublished: '2026-05-01', dateModified: '2026-06-01' }),
    { pubblicatoIl: '2026-05-01', aggiornatoIl: '2026-06-01' },
  );
  assert.deepEqual(
    datesFromJsonLd([{ '@type': 'BreadcrumbList' }, { '@graph': [{ '@type': 'RealEstateListing', datePosted: '2026-04-15' }] }]),
    { pubblicatoIl: '2026-04-15', aggiornatoIl: '' },
  );
  assert.deepEqual(datesFromJsonLd(null), { pubblicatoIl: '', aggiornatoIl: '' });
  assert.deepEqual(datesFromJsonLd({ datePublished: 'spam' }), { pubblicatoIl: '', aggiornatoIl: '' });
});

await ok('datesFromJsonLd: prima data valida vince, chiavi alternative', () => {
  const ld = [
    { '@type': 'WebPage', dateModified: '2026-11-01' },
    { '@type': 'Apartment', dateCreated: '2026-03-03', dateModified: '2026-10-10' },
  ];
  assert.deepEqual(datesFromJsonLd(ld), { pubblicatoIl: '2026-03-03', aggiornatoIl: '2026-11-01' });
});

await ok('datesFromPage: legge ld+json, mai throw su pagina rotta', async () => {
  const fakePage = { evaluate: async (fn) => fn.toString() && [{ datePublished: '2026-07-07' }] };
  assert.deepEqual(await datesFromPage(fakePage), { pubblicatoIl: '2026-07-07', aggiornatoIl: '' });
  const brokenPage = { evaluate: async () => { throw new Error('navigazione fallita'); } };
  assert.deepEqual(await datesFromPage(brokenPage), { pubblicatoIl: '', aggiornatoIl: '' });
});

await ok('fillDates: adapter vince, JSON-LD completa solo i vuoti', async () => {
  const page = { evaluate: async () => [{ datePublished: '2026-01-01', dateModified: '2026-02-02' }] };
  const ad = { pubblicatoIl: '2026-05-05', aggiornatoIl: '' };
  await fillDates(ad, page);
  assert.equal(ad.pubblicatoIl, '2026-05-05'); // fonte adapter preservata
  assert.equal(ad.aggiornatoIl, '2026-02-02'); // vuota → da JSON-LD
});

await ok('fillDates: entrambe presenti → nessuna lettura pagina', async () => {
  let called = false;
  const page = { evaluate: async () => { called = true; return []; } };
  const ad = { pubblicatoIl: '2026-05-05', aggiornatoIl: '2026-05-06' };
  await fillDates(ad, page);
  assert.equal(called, false);
});

await ok('fillDates: normalizza anche le date già valorizzate dall adapter', async () => {
  const page = { evaluate: async () => [] };
  const ad = { pubblicatoIl: '09/06/2026', aggiornatoIl: '2026-06-10T08:00:00Z' };
  await fillDates(ad, page);
  assert.equal(ad.pubblicatoIl, '2026-06-09');
  assert.equal(ad.aggiornatoIl, '2026-06-10');
});

console.log(`\n${n} test passati.`);