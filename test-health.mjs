// Test del registro salute portali (core/health.mjs, miglioria A).
// Cooldown fisso 24h, azzeramento su successo, storico eventi con cap.
// Uso: node test-health.mjs

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadHealth, recordBlock, recordSuccess, inCooldown, COOLDOWN_MS } from './core/health.mjs';

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-health-')), 'health.json');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`✅ ${name}`); };

const t0 = new Date('2026-11-19T08:00:00Z');

ok('file assente → health vuota, nessun cooldown', () => {
  assert.deepEqual(loadHealth(tmp), { portals: {}, events: [] });
  assert.equal(inCooldown('x', { now: t0, file: tmp }), null);
});

ok('recordBlock → cooldown 24h fisso, evento registrato', () => {
  const p = recordBlock('wikicasa', 'HTTP 403 persistente', { now: t0, file: tmp });
  assert.equal(p.blocks, 1);
  assert.equal(new Date(p.cooldownUntil) - t0, COOLDOWN_MS);
  const cd = inCooldown('wikicasa', { now: t0, file: tmp });
  assert.equal(cd.hoursLeft, 24);
  assert.match(cd.reason, /403/);
  assert.equal(loadHealth(tmp).events.length, 1);
});

ok('cooldown costante su blocchi ripetuti (scelta utente: fisso, non crescente)', () => {
  const t1 = new Date(t0.getTime() + 3600000);
  const p = recordBlock('wikicasa', 'HTTP 403 ancora', { now: t1, file: tmp });
  assert.equal(p.blocks, 2);
  assert.equal(new Date(p.cooldownUntil) - t1, COOLDOWN_MS);
});

ok('cooldown scade esattamente dopo 24h', () => {
  const justBefore = new Date(t0.getTime() + 3600000 + COOLDOWN_MS - 1);
  const atExpiry = new Date(t0.getTime() + 3600000 + COOLDOWN_MS);
  assert.ok(inCooldown('wikicasa', { now: justBefore, file: tmp }));
  assert.equal(inCooldown('wikicasa', { now: atExpiry, file: tmp }), null);
});

ok('recordSuccess azzera il cooldown e logga recovered', () => {
  recordSuccess('wikicasa', { now: t0, file: tmp });
  assert.equal(inCooldown('wikicasa', { now: t0, file: tmp }), null);
  const h = loadHealth(tmp);
  assert.ok(h.events.some((e) => e.type === 'recovered'));
  assert.equal(h.portals.wikicasa.blocks, 2); // lo storico blocchi resta
});

ok('recordSuccess su portale mai visto → null, nessun evento', () => {
  const before = loadHealth(tmp).events.length;
  assert.equal(recordSuccess('mai-visto', { file: tmp }), null);
  assert.equal(loadHealth(tmp).events.length, before);
});

ok('portali indipendenti tra loro', () => {
  recordBlock('idealista', 'CAPTCHA', { now: t0, file: tmp });
  assert.ok(inCooldown('idealista', { now: t0, file: tmp }));
  assert.equal(inCooldown('wikicasa', { now: t0, file: tmp }), null);
});

ok('storico eventi con cap 200', () => {
  for (let i = 0; i < 210; i++) recordBlock('spam', `b${i}`, { now: t0, file: tmp });
  const h = loadHealth(tmp);
  assert.equal(h.events.length, 200);
  assert.equal(h.events[h.events.length - 1].reason, 'b209');
});

fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
console.log(`\ntest-health: ${n}/${n} OK`);