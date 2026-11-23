// Runner GLOBALE di login — autenticazione iniziale su tutti i portali che la richiedono.
//
// Uso:
//   node login-all.mjs                 login su tutti i portali con login (required + optional)
//   node login-all.mjs --required      solo i portali a login OBBLIGATORIO
//   node login-all.mjs --portal fb     solo un portale (id o alias: fb, nextdoor, idealista…)
//   node login-all.mjs --check         verifica le sessioni esistenti senza fare login
//   node login-all.mjs --headless      (sconsigliato: il 2FA manuale richiede la finestra)
//
// Credenziali: SOLO da variabili d'ambiente `<PREFIX>_USER` / `<PREFIX>_PASS`
//   (es. FB_USER / FB_PASS, NEXTDOOR_USER / NEXTDOOR_PASS, IDEALISTA_USER / IDEALISTA_PASS).
//   Mai nel codice, mai loggate. Se mancanti → il portale passa in modalità MANUALE.
//
// 2FA / CAPTCHA / OAuth: si completano A MANO (smartphone). Il runner si mette in pausa
//   e aspetta INVIO. Nessun solving automatico, nessun aggiramento (policy §8, fail-closed).
//
// Sessione: persistita nel profilo `<cartella>/profile` (la STESSA dello scraper del portale).
//   Dopo il login, lo scraping riusa i cookie senza riautenticarsi.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { launchPortal, dismissCookies, gotoResilient, sleep, rand, log, BlockedError } from './core/human.mjs';
import { AUTH, authById, credsFromEnv, PUBLIC_NO_LOGIN } from './core/auth-registry.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const HEADLESS = argv.includes('--headless');
const CHECK_ONLY = argv.includes('--check');
const REQUIRED_ONLY = argv.includes('--required');
const portalArg = (() => {
  const i = argv.indexOf('--portal');
  return i >= 0 ? argv[i + 1] : null;
})();

// Alias comodi per --portal.
const ALIASES = { fb: 'facebook', marketplace: 'facebook', nd: 'nextdoor', ideal: 'idealista', casa: 'casait' };

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
async function pause(msg) {
  await ask(`\n  ⏸  ${msg}\n  ➜ Premi INVIO quando hai finito (o 's' per saltare): `);
}

function profileDir(entry) {
  return path.join(ROOT, entry.dir, 'profile');
}

// Verifica sessione: true se loggato, false se no, null se non determinabile.
async function isLoggedIn(page, entry) {
  const sc = entry.sessionCheck || {};
  try {
    const url = page.url();
    if (sc.loggedInUrlNot && url.includes(sc.loggedInUrlNot)) return false;
    if (sc.loggedInSelector) {
      const found = await page.locator(sc.loggedInSelector).first().isVisible({ timeout: 2500 }).catch(() => false);
      if (found) return true;
    }
    // Se non c'è un URL "non loggato" e il selettore non è trovato, non siamo certi.
    if (!sc.loggedInUrlNot) return null;
    return null;
  } catch {
    return null;
  }
}

async function safeFill(page, selector, value) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  await loc.click({ timeout: 5000 });
  await loc.fill('');
  // Digitazione "umana" (no paste istantaneo) per nontriggerare euristiche anti-bot.
  await loc.type(value, { delay: rand(40, 110) });
}

async function safeClick(page, selector) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  await loc.click({ timeout: 5000 });
}

// Esegue il flusso di login specifico del portale. Ritorna true se i campi sono stati
// compilati e inviati, false se serve intervento manuale (oauth / selettori assenti).
async function runFlow(page, entry, creds) {
  const s = entry.selectors;
  if (!s || entry.flow === 'manual' || entry.oauthOnly) return false;

  if (entry.flow === 'modal' && s.open) {
    await safeClick(page, s.open).catch(() => {});
    await sleep(rand(900, 1600));
  }

  if (entry.flow === 'email-first') {
    await safeFill(page, s.user, creds.user);
    await safeClick(page, s.continueBtn || s.submit);
    await sleep(rand(1500, 2800));
    // Il campo password appare dopo "Continua".
    await safeFill(page, s.pass, creds.pass);
    await safeClick(page, s.submit);
    return true;
  }

  // credentials / modal: email+password nella stessa pagina.
  await safeFill(page, s.user, creds.user);
  await safeFill(page, s.pass, creds.pass);
  await safeClick(page, s.submit);
  return true;
}

async function processPortal(entry) {
  const tag = `[${entry.id}]`;
  const dir = profileDir(entry);
  fs.mkdirSync(dir, { recursive: true });
  const creds = credsFromEnv(entry);
  const hasCreds = !!creds;
  const canAutomate = hasCreds && entry.selectors && entry.flow !== 'manual' && !entry.oauthOnly;

  log(`${tag} ${entry.name} — login ${entry.type}${entry.needs2FA ? ' +2FA' : ''} | env ${entry.envPrefix}_USER/_PASS: ${hasCreds ? 'OK' : 'MANCANTI'}`);

  const { context, page } = await launchPortal(dir, { headless: HEADLESS });
  try {
    // 1) Naviga alla pagina di login (resiliente al rate-limit, fail-closed).
    try {
      await gotoResilient(page, entry.loginUrl, { log, tries: 3, baseWait: 15000 });
    } catch (e) {
      if (e instanceof BlockedError) {
        log(`${tag} BLOCCO anti-bot (${e.message}). Fail-closed: salto, nessun aggiramento.`);
        return { id: entry.id, status: 'blocked', note: e.message };
      }
      throw e;
    }
    await dismissCookies(page).catch(() => {});
    await sleep(rand(1200, 2200));

    // 2) Già loggato? (sessione persistente dal run precedente)
    const already = await isLoggedIn(page, entry);
    if (already === true) {
      log(`${tag} Sessione GIÀ attiva (profilo persistente). Nessuna azione.`);
      return { id: entry.id, status: 'already', note: 'sessione persistente valida' };
    }

    if (CHECK_ONLY) {
      log(`${tag} --check: sessione ${already === false ? 'NON attiva' : 'non determinabile'}.`);
      return { id: entry.id, status: already === false ? 'logged-out' : 'unknown' };
    }

    // 3) Login automatico (se credenziali + selettori) oppure manuale.
    if (canAutomate) {
      log(`${tag} Compilo le credenziali da env (flusso: ${entry.flow})…`);
      let submitted = false;
      try {
        submitted = await runFlow(page, entry, creds);
      } catch (e) {
        log(`${tag} Auto-fill non riuscito (${String(e.message).slice(0, 70)}). Passo a manuale.`);
      }
      if (submitted) {
        await sleep(rand(2500, 4000));
        const after = await isLoggedIn(page, entry);
        if (after === true && !entry.needs2FA) {
          log(`${tag} ✅ Login riuscito, sessione persistita.`);
          return { id: entry.id, status: 'ok', note: 'auto' };
        }
        // 2FA / checkpoint / OAuth: pausa per intervento manuale.
        const why = entry.needs2FA
          ? 'Completa il 2FA / checkpoint sul telefono o nel browser'
          : 'Se serve, completa verifica/2FA nel browser';
        await pause(`${entry.name}: ${why}.`);
        const final = await isLoggedIn(page, entry);
        log(`${tag} ${final === true ? '✅ Login confermato' : '⚠ Stato sessione non certo'} (sessione persistita nel profilo).`);
        return { id: entry.id, status: final === true ? 'ok' : 'manual-done', note: 'auto+manuale' };
      }
    }

    // 4) Modalità manuale (credenziali mancanti, oauth, o selettori non disponibili).
    const reason = !hasCreds
      ? `credenziali env mancanti (${entry.envPrefix}_USER/_PASS)`
      : entry.oauthOnly || entry.flow === 'manual' || !entry.selectors
        ? 'flusso manuale/OAuth'
        : 'auto-fill fallito';
    log(`${tag} Login MANUALE (${reason}). Compila nel browser aperto.`);
    await pause(`${entry.name}: accedi a mano (email/password o OAuth), completa eventuale 2FA.`);
    const final = await isLoggedIn(page, entry);
    log(`${tag} ${final === true ? '✅ Login confermato' : '⚠ Stato sessione non certo'} (sessione persistita nel profilo).`);
    return { id: entry.id, status: final === true ? 'ok' : 'manual-done', note: 'manuale' };
  } finally {
    // Chiudere il contesto flushing lo storage su disco: la sessione resta nel profilo.
    await sleep(rand(600, 1200));
    await context.close().catch(() => {});
  }
}

async function main() {
  let targets = AUTH.slice();
  if (portalArg) {
    const id = ALIASES[portalArg] || portalArg;
    const one = authById(id);
    if (!one) {
      log(`Portale "${portalArg}" non trovato nel registro auth. Disponibili: ${AUTH.map((a) => a.id).join(', ')}`);
      rl.close();
      process.exit(1);
    }
    targets = [one];
  } else if (REQUIRED_ONLY) {
    targets = targets.filter((a) => a.type === 'required');
  }

  log('═══ RUNNER GLOBALE LOGIN ═══');
  log(`Portali con login: ${AUTH.length} (${AUTH.filter((a) => a.type === 'required').length} obbligatori, ${AUTH.filter((a) => a.type === 'optional').length} opzionali).`);
  log(`Portali pubblici senza login (${PUBLIC_NO_LOGIN.length}): ${PUBLIC_NO_LOGIN.join(', ')}.`);
  log('Credenziali SOLO da env. 2FA/OAuth manuali. Sessione persistita nei profili.');
  if (HEADLESS) log('⚠ --headless attivo: il 2FA manuale richiede la finestra visibile. Usa headed per il login.');
  if (CHECK_ONLY) log('Modalità --check: verifica sessioni, nessun login.');

  const results = [];
  for (const entry of targets) {
    try {
      results.push(await processPortal(entry));
    } catch (e) {
      log(`[${entry.id}] ERRORE: ${String(e.message).slice(0, 120)}`);
      results.push({ id: entry.id, status: 'error', note: String(e.message).slice(0, 120) });
    }
  }

  // Riepilogo.
  log('\n═══ RIEPILOGO LOGIN ═══');
  const icon = { ok: '✅', already: '✅', 'manual-done': '🟡', 'logged-out': '❌', unknown: '❓', blocked: '⛔', error: '💥' };
  for (const r of results) {
    log(`  ${icon[r.status] || '•'} ${r.id.padEnd(14)} ${r.status}${r.note ? ' — ' + r.note : ''}`);
  }
  const okCount = results.filter((r) => r.status === 'ok' || r.status === 'already').length;
  log(`\nSessioni attive confermate: ${okCount}/${results.length}.`);
  log('Le sessioni sono salvate nei profili: gli scraper le riusano automaticamente.');

  // Persisti un report (senza credenziali) per il censimento/riepilogo.
  const report = { when: new Date().toISOString(), results };
  fs.writeFileSync(path.join(ROOT, 'login-report.json'), JSON.stringify(report, null, 2));
  log('Report: login-report.json (nessuna credenziale salvata).');

  rl.close();
}

main().catch((e) => {
  log('ERRORE FATALE:', e.message);
  rl.close();
  process.exit(1);
});