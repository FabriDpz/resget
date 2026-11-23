// Registro di autenticazione per portale — usato dal runner globale login-all.mjs.
//
// PRINCIPI (requisiti-immobilare.md §8, fail-closed):
//   - Le credenziali NON sono mai nel codice: si leggono SOLO da variabili d'ambiente
//     (`<PREFIX>_USER` / `<PREFIX>_PASS`). Il runner non le logga mai.
//   - Il 2FA / CAPTCHA / OAuth si completano A MANO dall'utente (smartphone): il runner
//     si mette in pausa e aspetta INVIO. Nessun aggiramento, nessun solving automatico.
//   - La sessione è persistita nel profilo Playwright persistente `<cartella>/profile`
//     (la STESSA usata dallo scraper del portale): dopo il login, lo scraping riusa i cookie.
//
// Tipi di portale:
//   required = login OBBLIGATORIO per vedere gli annunci (facebook, nextdoor)
//   optional = annunci pubblici; il login riduce attriti/WAF e sblocca funzioni (idealista,
//              subito, casait). Il runner li propone ma non sono bloccanti.
//
// Flussi di login:
//   credentials = email+password nella stessa pagina (un solo submit)
//   email-first = prima email → "Continua" → poi password (idealista)
//   modal       = il form è dentro un modale da aprire con un bottone (casait)
//   oauth       = accesso via Google/Apple/Facebook: SOLO manuale (il runner apre la pagina
//                 e lascia fare all'utente; nessun campo viene compilato)
//
// I selettori sono quelli VERIFICATI col browser agent-controlled (2026-11-15).
// Dove il form è dinamico/JS e non ancora ispezionato, `selectors` è null e il runner
// apre la pagina in modalità manuale (l'utente compila a mano, poi INVIO).

export const AUTH = [
  // ── LOGIN OBBLIGATORIO ──────────────────────────────────────────────────────
  {
    id: 'facebook',
    name: 'Facebook Marketplace',
    dir: 'facebook',
    type: 'required',
    flow: 'credentials',
    loginUrl: 'https://www.facebook.com/login',
    envPrefix: 'FB',
    needs2FA: true,
    oauthOnly: false,
    selectors: {
      user: 'input[name="email"]',
      pass: 'input[name="pass"]',
      submit: 'button[name="login"], button[type="submit"]',
    },
    // Dopo il login: URL non più /login e presente il campo di ricerca o il feed.
    sessionCheck: {
      loggedInUrlNot: '/login',
      loggedInSelector: '[aria-label="Marketplace"], a[href*="/marketplace/"], [role="feed"]',
    },
    notes:
      'Marketplace geolocalizzato (default USA): dopo il login impostare Bologna. ' +
      '2FA via checkpoint (codice/app). ID dei campi dinamici → usare name, non id. ' +
      'Possibile checkpoint "Conferma identità": completarlo a mano.',
  },
  {
    id: 'nextdoor',
    name: 'Nextdoor',
    dir: 'nextdoor',
    type: 'required',
    flow: 'credentials',
    loginUrl: 'https://it.nextdoor.com/login/',
    envPrefix: 'NEXTDOOR',
    needs2FA: true,
    oauthOnly: false,
    selectors: {
      user: 'input#id_email',
      pass: 'input#id_password',
      submit: 'button#signin_button',
    },
    sessionCheck: {
      loggedInUrlNot: '/login',
      loggedInSelector: 'a[href*="/for_sale_and_free/"], [data-testid="feed"], nav',
    },
    notes:
      'Social di quartiere: /for_sale_and_free/ redirige a /login/ senza sessione. ' +
      'OAuth Google (#google-button) / Facebook (#facebook-button) alternativi. ' +
      '2FA possibile via email/SMS. Verifica indirizzo di quartiere richiesta in fase di signup.',
  },
  // flatsearch NON è qui: la classificazione iniziale "login obbligatorio" era errata
  // (erano stati provati solo URL intuitivi, tutti 404). Listing e dettaglio sono pubblici
  // (/properties/sale/… e /property/<UUID>, robots.txt "Allow: /"); il modale "Sign in"
  // è facoltativo. È in PUBLIC_NO_LOGIN → il runner non chiede credenziali. Vedi
  // flatsearch/strategia.md per la mappa tecnica e le trappole dati.

  // ── LOGIN OPZIONALE (annunci pubblici; login riduce attriti/WAF) ─────────────
  {
    id: 'idealista',
    name: 'Idealista',
    dir: 'idealista',
    type: 'optional',
    flow: 'email-first',
    loginUrl: 'https://www.idealista.it/it/login',
    envPrefix: 'IDEALISTA',
    needs2FA: false,
    oauthOnly: false,
    selectors: {
      user: 'input#login-email',
      continueBtn: 'button:has-text("Continua")',
      pass: 'input[type="password"]',
      submit: 'button[type="submit"], button:has-text("Accedi"), button:has-text("Continua")',
    },
    sessionCheck: {
      loggedInUrlNot: '/login',
      loggedInSelector: 'a[href*="/utente/"], [data-testid="user-menu"], .user-avatar',
    },
    notes:
      'Flusso EMAIL-FIRST: email → "Continua" → password (campo appare dopo). ' +
      'OAuth Google (iframe) / Apple alternativi. Login opzionale: gli annunci sono pubblici; ' +
      'una sessione autenticata può ridurre i blocchi WAF (403) sul profilo headless.',
  },
  {
    id: 'subito',
    name: 'Subito.it',
    dir: 'subito',
    type: 'optional',
    flow: 'manual',
    loginUrl: 'https://www.subito.it/utente/login',
    envPrefix: 'SUBITO',
    needs2FA: false,
    oauthOnly: false,
    selectors: null, // form JS/SPA non ispezionato: login manuale
    sessionCheck: {
      loggedInUrlNot: '/utente/login',
      loggedInSelector: 'a[href*="/utente/"], [data-testid="user-menu"]',
    },
    notes:
      'Area riservata SPA (form renderizzato via JS). Annunci pubblici senza login. ' +
      'Login manuale consigliato (email+password o OAuth). 2FA possibile.',
  },
  {
    id: 'casait',
    name: 'Casa.it',
    dir: 'casait',
    type: 'optional',
    flow: 'manual',
    loginUrl: 'https://www.casa.it/',
    envPrefix: 'CASAIT',
    needs2FA: false,
    oauthOnly: false,
    selectors: null, // modale "Accedi al tuo account" (URL /utente/login è 404)
    sessionCheck: {
      loggedInUrlNot: null,
      loggedInSelector: '[data-testid="user-menu"], a[href*="/utente/"], .user-avatar',
    },
    notes:
      'Login via modale "Accedi al tuo account" (icona in header); /utente/login è 404. ' +
      'Portale dietro WAF DataDome: una sessione autenticata può aiutare ma NON aggira il WAF. ' +
      'Login manuale. Fail-closed sul 403 (policy §8).',
  },
];

// Portali PUBBLICI senza login (annunci accessibili anonimamente). Elencati per
// completezza del censimento: il runner li salta (nessuna credenziale richiesta).
export const PUBLIC_NO_LOGIN = [
  'immobiliare.it', 'wikicasa', 'tempocasa', 'remax', 'tecnocasa', 'tecnorete',
  'mitula', 'trovit', 'caasa', 'bakeca', 'attico', 'trovacasa', 'casadaprivato',
  'flatsearch', 'intesasanpaolo', 'prelios', 'agenziademanio', 'invimit', 'dovalue',
];

export function authById(id) {
  return AUTH.find((a) => a.id === id) || null;
}

// Credenziali da env (mai loggate). Ritorna {user, pass} o null se mancanti.
export function credsFromEnv(entry) {
  const user = process.env[`${entry.envPrefix}_USER`] || '';
  const pass = process.env[`${entry.envPrefix}_PASS`] || '';
  if (!user || !pass) return null;
  return { user, pass };
}