// Test della libreria probe ibrida (core/browser-probe.mjs, D9).
// Verifica: wrap/validazione record, portabilità delle funzioni pagina
// (serializzabili per page.evaluate e guest code run_javascript), conteggi DOM.
// Uso: node test-browser-probe.mjs

import assert from 'node:assert';
import { summarizeProbe, probeInPage, extractLinksInPage } from './core/browser-probe.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`✅ ${name}`); };

const raw = {
  url: 'https://x.it/list', title: 'T',
  cardSelectors: { article: 3 }, sampleLinks: ['https://x.it/a/12'],
  topLinkPatterns: [['/a/{id}', 3]], jsonLdTypes: [],
  blocked: false, loginWall: false, probedAt: '2026-11-19T00:00:00Z',
};

ok('summarizeProbe: record compatibile probe-report', () => {
  const rec = summarizeProbe(raw, { id: 'x', name: 'X' });
  assert.equal(rec.id, 'x');
  assert.equal(rec.steps[0].status, 200);
  assert.equal(rec.steps[0].cardSelectors.article, 3);
});

ok('summarizeProbe: blocked → status 403', () => {
  assert.equal(summarizeProbe({ ...raw, blocked: true }, { id: 'x' }).steps[0].status, 403);
});

ok('summarizeProbe: input non valido → errore (fail-closed)', () => {
  assert.throws(() => summarizeProbe({}, { id: 'x' }));
  assert.throws(() => summarizeProbe(null, { id: 'x' }));
});

ok('funzioni pagina portabili (no import/require/process, standalone)', () => {
  for (const fn of [probeInPage, extractLinksInPage]) {
    const src = fn.toString();
    assert.ok(!/\bimport\b|\brequire\(|process\./.test(src), fn.name + ' non portabile');
    assert.equal(typeof eval('(' + src + ')'), 'function');
  }
});

// DOM finto minimale per eseguire probeInPage fuori dal browser.
globalThis.location = { href: 'https://x.it/list', origin: 'https://x.it' };
globalThis.window = {};
const mkAnchor = (href) => ({ getAttribute: (name) => (name === 'href' ? href : null) });
const anchors = [mkAnchor('/a/12345'), mkAnchor('/a/67890'), mkAnchor('#top'), mkAnchor('/b/1')];
globalThis.document = {
  title: 'Fake', body: { innerText: 'annunci normali' },
  getElementById: () => null,
  querySelectorAll: (sel) => {
    if (sel === 'a[href]') return anchors;
    if (sel === 'article') return [1, 2, 3];
    if (sel === 'script[type="application/ld+json"]') return [{ textContent: '{"@type":"RealEstateListing"}' }];
    if (sel === 'bad[[[') throw new Error('invalid');
    return [];
  },
};

ok('probeInPage: conteggi, selettore invalido=-1, JSON-LD, campioni', () => {
  const out = probeInPage({ cardSelectors: ['article', 'bad[[['], linkPattern: '\\/a\\/\\d+$' });
  assert.equal(out.cardSelectors.article, 3);
  assert.equal(out.cardSelectors['bad[[['], -1);
  assert.deepEqual(out.jsonLdTypes, ['RealEstateListing']);
  assert.equal(out.sampleLinks.length, 2);
  assert.equal(out.blocked, false);
});

ok('probeInPage: rileva challenge (D4, nessun aggiramento)', () => {
  globalThis.document.body.innerText = 'Please verify you are human';
  assert.equal(probeInPage({}).blocked, true);
  globalThis.document.body.innerText = 'annunci normali';
});

ok('extractLinksInPage: unici, assoluti, senza query', () => {
  assert.deepEqual(extractLinksInPage({ pattern: '\\/a\\/\\d+$' }),
    ['https://x.it/a/12345', 'https://x.it/a/67890']);
});

console.log(`\ntest-browser-probe: ${n}/${n} OK`);