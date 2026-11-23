// Libreria di probe deterministica per l'architettura ibrida (D9).
// Stesso codice eseguibile in DUE contesti:
//   1. browser reale via Copilot Browser `run_javascript` (ricognizione agent-driven);
//   2. Playwright `page.evaluate` (verifica selettori adapter, probe-verify.mjs).
//
// Vincoli per la portabilità:
//   - nessuna import/export dentro le funzioni passate a evaluate/run_javascript:
//     vengono serializzate con .toString() ed eseguite nel contesto pagina;
//   - solo DOM standard (querySelector, innerText…), niente API Node;
//   - policy D4 invariata: challenge/CAPTCHA → STOP, nessun aggiramento.
//
// Uso agent-driven (guest code di run_javascript):
//   const src = <contenuto di questo file letto dall'agente>;
//   // incollare le funzioni probeInPage/extractLinksInPage nel guest code, oppure:
//   const probe = await tab.locator('body').count(); // poi snapshot + funzioni sotto
// Uso Playwright:
//   import { probeInPage, extractLinksInPage, summarizeProbe } from './browser-probe.mjs';
//   const raw = await page.evaluate(probeInPage, { cardSelectors, linkPattern });
//   const report = summarizeProbe(raw, { id, name, url });

// Eseguita NEL contesto pagina. Ritorna dati grezzi, serializzabili.
// opts: { cardSelectors?: string[], linkPattern?: string (regex source), maxLinks?: number }
export function probeInPage(opts = {}) {
  const cardSelectors = opts.cardSelectors || [
    'article',
    '[class*="card"]',
    '[class*="listing"]',
    '[class*="result"]',
    '[data-testid*="card"]',
    '[data-testid*="listing"]',
  ];
  const maxLinks = opts.maxLinks || 400;
  const body = document.body;
  const text = (body && body.innerText ? body.innerText : '').slice(0, 3000);

  const counts = {};
  for (const sel of cardSelectors) {
    try { counts[sel] = document.querySelectorAll(sel).length; }
    catch { counts[sel] = -1; } // selettore invalido nel contesto pagina
  }

  const jsonLdTypes = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent);
      const blocks = Array.isArray(data) ? data : [data];
      for (const b of blocks) {
        const nodes = b['@graph'] || [b];
        for (const n of nodes) {
          const t = n && n['@type'];
          for (const v of Array.isArray(t) ? t : [t]) if (v && !jsonLdTypes.includes(v)) jsonLdTypes.push(v);
        }
      }
    } catch { /* JSON-LD malformato: ignorato, non inventato */ }
  }

  const linkCounts = {};
  const sampleLinks = [];
  const re = opts.linkPattern ? new RegExp(opts.linkPattern) : null;
  const anchors = document.querySelectorAll('a[href]');
  for (let i = 0; i < anchors.length && sampleLinks.length < maxLinks; i++) {
    const href = anchors[i].getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    // pattern di path: numeri → {id}, per confrontare strutture tra pagine
    let key;
    try {
      const u = new URL(href, location.href);
      key = (u.origin === location.origin ? '' : u.origin) + u.pathname.replace(/\d{2,}/g, '{id}');
    } catch { key = href.slice(0, 120); }
    linkCounts[key] = (linkCounts[key] || 0) + 1;
    if (re && re.test(href) && sampleLinks.length < 30) {
      try {
        const abs = new URL(href, location.href).href.split('#')[0];
        // stripQuery:false per link che vivono nella query (es. trovit detailPageUrl=)
        sampleLinks.push(opts.stripQuery === false ? abs : abs.split('?')[0]);
      } catch { /* href non risolvibile */ }
    }
  }
  const topLinkPatterns = Object.entries(linkCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const blockRe = /captcha|sei un robot|are you a human|verify you are human|accesso negato|access denied|unusual traffic/i;
  const loginRe = /accedi al tuo account|log in to continue|sign in to continue|effettua l'accesso per continuare/i;

  return {
    url: location.href,
    title: document.title,
    hasNextData: !!document.getElementById('__NEXT_DATA__'),
    hasNuxt: !!document.getElementById('__NUXT__') || !!window.__NUXT__,
    jsonLdTypes,
    cardSelectors: counts,
    topLinkPatterns,
    sampleLinks: [...new Set(sampleLinks)],
    blocked: blockRe.test(text),
    loginWall: loginRe.test(text),
    bodyTextSample: text.slice(0, 600),
    probedAt: new Date().toISOString(),
  };
}

// Eseguita NEL contesto pagina: estrae link unici che matchano una regex.
// args: { pattern: string (regex source), stripQuery?: boolean }
export function extractLinksInPage(args) {
  const re = new RegExp(args.pattern);
  const strip = args.stripQuery !== false;
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    let href;
    try { href = new URL(a.getAttribute('href'), location.href).href; } catch { continue; }
    if (strip) href = href.split('#')[0].split('?')[0];
    if (re.test(href) && !seen.has(href)) { seen.add(href); out.push(href); }
  }
  return out;
}

// Lato Node: normalizza l'output grezzo in un record compatibile con
// probe-archive/probe-report.json (steps[] con cardSelectors/topLinkPatterns…).
export function summarizeProbe(raw, { id, name, category = 'standard', step = 'listing' } = {}) {
  if (!raw || typeof raw.url !== 'string') throw new Error('probeInPage: output grezzo non valido');
  return {
    id: id || 'unknown',
    name: name || id || 'unknown',
    category,
    probedAt: raw.probedAt || new Date().toISOString(),
    steps: [{
      step,
      status: raw.blocked ? 403 : 200,
      finalUrl: raw.url,
      title: raw.title || '',
      url: raw.url,
      hasNextData: !!raw.hasNextData,
      hasNuxt: !!raw.hasNuxt,
      jsonLdTypes: raw.jsonLdTypes || [],
      cardSelectors: raw.cardSelectors || {},
      topLinkPatterns: raw.topLinkPatterns || [],
      sampleLinks: raw.sampleLinks || [],
      blocked: !!raw.blocked,
      loginWall: !!raw.loginWall,
    }],
  };
}