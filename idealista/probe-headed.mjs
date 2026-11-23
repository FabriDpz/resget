// Probe headed idealista: scopre l'URL di ricerca reale e lascia il browser
// aperto per il login manuale. Nessun aggiramento anti-bot (policy §8).
// Uso: node idealista/probe-headed.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { launchPortal, sleep, log, dismissCookies } from '../core/human.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(dir, 'profile');
const PROBE_DIR = path.join(dir, 'probe');
fs.mkdirSync(PROBE_DIR, { recursive: true });

const CANDIDATE_URLS = [
  'https://www.idealista.it/',
  'https://www.idealista.it/vendita-case/bologna/',
  'https://www.idealista.it/vendita-case/bologna/bologna/',
  'https://www.idealista.it/vendita-case/bologna-provincia/',
];

const { context, page } = await launchPortal(PROFILE_DIR, { headless: false });
log('Browser headed aperto. Profilo persistente:', PROFILE_DIR);

const report = [];
for (const url of CANDIDATE_URLS) {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await dismissCookies(page);
    await sleep(2500);
    const status = resp ? resp.status() : 0;
    const info = await page.evaluate(() => {
      const txt = (document.body?.innerText || '').slice(0, 1500);
      const blocked = /captcha|sei un robot|are you a human|verify you are human|accesso negato|access denied|unusual traffic|datadome|px-captcha/i.test(txt);
      // link di ricerca immobili rilevabili
      const links = [...document.querySelectorAll('a[href]')]
        .map((a) => a.href)
        .filter((h) => /\/(vendita-case|immobile|annunci)\//.test(h))
        .slice(0, 12);
      return { title: document.title, blocked, txtSample: txt.slice(0, 400), links };
    });
    const shot = path.join(PROBE_DIR, `probe-${report.length}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    report.push({ url, status, ...info, shot });
    log(`[${status}] ${url} — blocked=${info.blocked} — "${info.title}"`);
    if (info.links.length) log('  link:', info.links.slice(0, 4).join(' | '));
  } catch (e) {
    report.push({ url, error: String(e.message).slice(0, 120) });
    log(`ERR ${url}: ${String(e.message).slice(0, 120)}`);
  }
  await sleep(2000);
}

fs.writeFileSync(path.join(PROBE_DIR, 'probe-report.json'), JSON.stringify(report, null, 2));
log('Report salvato in idealista/probe/probe-report.json');
log('>>> Browser RESTA APERTO. Se serve, fai il login a mano ora.');
log('>>> Quando hai finito, premi INVIO qui nel terminale per chiudere e salvare la sessione.');

// Attende INVIO dallo stdin (login manuale). Il profilo persistente salva i cookie.
process.stdin.resume();
process.stdin.once('data', async () => {
  log('Chiusura browser e salvataggio sessione…');
  try { await context.close(); } catch { /* */ }
  process.exit(0);
});