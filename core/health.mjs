// Registro salute portali (miglioria A): ogni STOP anti-bot viene registrato;
// run-all salta i portali in cooldown (fisso 24h, scelta utente 2026-11-19).
// Storico eventi append-only (cap 200) per diagnosi dei pattern di blocco.
// Policy D4: il cooldown NON è un aggiramento — è rispetto del rate-limit.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HEALTH_FILE = path.join(ROOT, 'core', 'portal-health.json');
export const COOLDOWN_MS = 24 * 60 * 60 * 1000; // fisso 24h

export function loadHealth(file = HEALTH_FILE) {
  try {
    const h = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { portals: h.portals || {}, events: h.events || [] };
  } catch {
    return { portals: {}, events: [] };
  }
}

function saveHealth(h, file) {
  fs.writeFileSync(file, JSON.stringify(h, null, 2));
}

// Registra un blocco: cooldownUntil = now + 24h, evento in storico.
export function recordBlock(id, reason, { now = new Date(), file = HEALTH_FILE } = {}) {
  const h = loadHealth(file);
  const p = h.portals[id] || { blocks: 0 };
  p.blocks = (p.blocks || 0) + 1;
  p.lastBlockAt = now.toISOString();
  p.lastReason = String(reason || '').slice(0, 300);
  p.cooldownUntil = new Date(now.getTime() + COOLDOWN_MS).toISOString();
  h.portals[id] = p;
  h.events.push({ id, type: 'block', at: p.lastBlockAt, reason: p.lastReason });
  if (h.events.length > 200) h.events = h.events.slice(-200);
  saveHealth(h, file);
  return p;
}

// Run completato senza blocchi: azzera il cooldown (il portale è tornato accessibile).
export function recordSuccess(id, { now = new Date(), file = HEALTH_FILE } = {}) {
  const h = loadHealth(file);
  const p = h.portals[id];
  if (!p) return null;
  if (p.cooldownUntil) {
    h.events.push({ id, type: 'recovered', at: now.toISOString() });
    if (h.events.length > 200) h.events = h.events.slice(-200);
  }
  p.cooldownUntil = null;
  p.lastSuccessAt = now.toISOString();
  saveHealth(h, file);
  return p;
}

// Ritorna { until, reason, hoursLeft } se il portale è in cooldown, altrimenti null.
export function inCooldown(id, { now = new Date(), file = HEALTH_FILE } = {}) {
  const p = loadHealth(file).portals[id];
  if (!p || !p.cooldownUntil) return null;
  const until = new Date(p.cooldownUntil);
  if (until <= now) return null;
  return {
    until: p.cooldownUntil,
    reason: p.lastReason || '',
    hoursLeft: Math.ceil((until - now) / 3600000),
  };
}