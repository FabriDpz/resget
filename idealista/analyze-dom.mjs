// Analisi DOM idealista: pagina risultati Bologna + un annuncio di dettaglio.
// Estrae selettori e campi per costruire l'adapter. Browser headed, resta aperto.
// Uso: node idealista/analyze-dom.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { launchPortal, sleep, log, dismissCookies } from '../core/human.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(dir, 'profile');
const PROBE_DIR = path.join(dir, 'probe');
fs.mkdirSync(PROBE_DIR, { recursive: true });

const { context, page } = await launchPortal(PROFILE_DIR, { headless: false });
log('Browser headed aperto.');

const SEARCH = 'https://www.idealista.it/vendita-case/bologna/bologna/';
await page.goto(SEARCH, { waitUntil: 'domcontentloaded', timeout: 45000 });
await dismissCookies(page);
await sleep(3000);

// Struttura delle card nella pagina risultati
const listInfo = await page.evaluate(() => {
  const arts = [...document.querySelectorAll('article.item, article[data-adid], .item-info-container')];
  const sample = arts.slice(0, 3).map((a) => {
    const link = a.querySelector('a.item-link, a[href*="/immobile/"]');
    return {
      adid: a.getAttribute('data-adid') || a.closest('[data-adid]')?.getAttribute('data-adid') || null,
      href: link?.href || null,
      title: link?.textContent?.trim() || null,
      price: a.querySelector('.item-price, .price-row')?.textContent?.trim() || null,
      detail: a.querySelector('.item-detail-char, .item-detail')?.textContent?.trim() || null,
      desc: a.querySelector('.item-description, .description')?.textContent?.trim()?.slice(0, 120) || null,
      html: a.outerHTML.slice(0, 600),
    };
  });
  // paginazione
  const pag = [...document.querySelectorAll('.pagination a, .items-pagination a, a[href*="/pagina-"]')]
    .map((a) => a.href).slice(0, 8);
  const total = document.querySelector('h1')?.textContent?.trim() || '';
  return { count: arts.length, sample, pag, total };
});
fs.writeFileSync(path.join(PROBE_DIR, 'list-dom.json'), JSON.stringify(listInfo, null, 2));
log(`Card trovate: ${listInfo.count} — "${listInfo.total}"`);
log('Paginazione:', listInfo.pag.join(' | ') || '(nessuna rilevata)');
if (listInfo.sample[0]) log('Prima card:', JSON.stringify(listInfo.sample[0]).slice(0, 300));

// Dettaglio del primo annuncio
const firstHref = listInfo.sample.find((s) => s.href)?.href;
let detailInfo = null;
if (firstHref) {
  await sleep(2500);
  await page.goto(firstHref, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissCookies(page);
  await sleep(3000);
  detailInfo = await page.evaluate(() => {
    const ld = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try { ld.push(JSON.parse(s.textContent)); } catch { /* */ }
    });
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
    // dettagli strutturati (caratteristiche)
    const details = [...document.querySelectorAll('.details-property-feature, .details-property li, .info-features li, .details-property_features li')]
      .map((li) => li.textContent.trim()).slice(0, 40);
    const price = document.querySelector('.info-data-price, .price, [class*="price"]')?.textContent?.trim() || '';
    const title = document.querySelector('h1, .main-info__title')?.textContent?.trim() || '';
    return { ldTypes: ld.map((b) => b['@type'] || (b['@graph'] ? 'graph' : '?')), ld, details, price, title, bodySample: body.slice(0, 800) };
  });
  fs.writeFileSync(path.join(PROBE_DIR, 'detail-dom.json'), JSON.stringify(detailInfo, null, 2));
  log('Dettaglio:', detailInfo.title, '| prezzo:', detailInfo.price);
  log('LD types:', detailInfo.ldTypes.join(', '));
  log('Dettagli:', detailInfo.details.slice(0, 12).join(' | '));
}

log('>>> Analisi salvata. Browser RESTA APERTO per login manuale.');
log('>>> Premi INVIO nel terminale per chiudere e salvare la sessione.');
process.stdin.resume();
process.stdin.once('data', async () => {
  log('Chiusura e salvataggio sessione…');
  try { await context.close(); } catch { /* */ }
  process.exit(0);
});