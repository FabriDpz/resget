// Persiste i risultati di un probe agent-driven (Copilot Browser, browser reale)
// in probe-archive/. Parte "ibrida" dell'architettura D9:
//   agente fa run_javascript sul browser reale → produce JSON con probeInPage/
//   summarizeProbe → questo CLI lo valida e lo archivia in modo deterministico.
//
// Uso:
//   node core/probe-save.mjs --id wikicasa --file risultato.json [--name Wikicasa] [--category standard]
//   node core/probe-save.mjs --id wikicasa --stdin   (JSON da pipe)
//
// Il file può contenere:
//   - output grezzo di probeInPage (singola pagina) → wrap in summarizeProbe;
//   - record già completo { id, steps: [...] } → validato e salvato;
//   - array di output grezzi (più pagine/comuni) → steps multipli.
//
// Output: probe-archive/probe-agent-<id>.json (merge per step con run precedenti
// dello stesso id: gli step con stesso `step`+`url` vengono aggiornati).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeProbe } from './browser-probe.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = path.join(ROOT, 'probe-archive');

function parseArgs(argv) {
  const get = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  return {
    id: get('--id'),
    name: get('--name'),
    category: get('--category', 'standard'),
    file: get('--file'),
    stdin: argv.includes('--stdin'),
    step: get('--step', 'listing'),
  };
}

function validateRecord(rec) {
  const errs = [];
  if (!rec.id || typeof rec.id !== 'string') errs.push('id mancante');
  if (!Array.isArray(rec.steps) || rec.steps.length === 0) errs.push('steps[] mancante o vuoto');
  else {
    rec.steps.forEach((s, i) => {
      if (!s.step) errs.push(`steps[${i}].step mancante`);
      if (typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) errs.push(`steps[${i}].url non valida`);
      if (s.cardSelectors && typeof s.cardSelectors !== 'object') errs.push(`steps[${i}].cardSelectors non oggetto`);
    });
  }
  return errs;
}

function toRecord(input, { id, name, category, step }) {
  // record già completo
  if (input && Array.isArray(input.steps)) {
    return { ...input, id: input.id || id, name: input.name || name || id, category: input.category || category };
  }
  // array di output grezzi → steps multipli
  if (Array.isArray(input)) {
    const parts = input.map((raw, i) => summarizeProbe(raw, { id, name, category, step: `${step}-${i + 1}` }));
    return { id, name: name || id, category, probedAt: parts[0].probedAt, steps: parts.flatMap((p) => p.steps) };
  }
  // singolo output grezzo
  return summarizeProbe(input, { id, name, category, step });
}

function mergeSteps(existing, incoming) {
  const key = (s) => `${s.step}|${s.url}`;
  const map = new Map((existing?.steps || []).map((s) => [key(s), s]));
  for (const s of incoming.steps) map.set(key(s), s);
  return { ...existing, ...incoming, steps: [...map.values()] };
}

async function readInput({ file, stdin }) {
  if (stdin) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error('serve --file <json> oppure --stdin');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id) { console.error('Uso: node core/probe-save.mjs --id <portale> --file <json> | --stdin'); process.exit(1); }

  const input = await readInput(args);
  const record = toRecord(input, args);
  const errs = validateRecord(record);
  if (errs.length) { console.error('Probe NON valido:\n- ' + errs.join('\n- ')); process.exit(2); }

  fs.mkdirSync(ARCHIVE, { recursive: true });
  const outPath = path.join(ARCHIVE, `probe-agent-${record.id}.json`);
  let final = record;
  if (fs.existsSync(outPath)) {
    try { final = mergeSteps(JSON.parse(fs.readFileSync(outPath, 'utf8')), record); }
    catch { /* archivio precedente corrotto: sovrascritto */ }
  }
  fs.writeFileSync(outPath, JSON.stringify(final, null, 2));

  const blocked = final.steps.filter((s) => s.blocked).length;
  const login = final.steps.filter((s) => s.loginWall).length;
  console.log(`Salvato ${path.relative(ROOT, outPath)} — ${final.steps.length} step, ${blocked} bloccati, ${login} login-wall`);
  for (const s of final.steps) {
    const cards = Object.entries(s.cardSelectors || {}).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' ');
    console.log(`  [${s.step}] ${s.url}${s.blocked ? ' ⛔ BLOCKED' : ''}${s.loginWall ? ' 🔒 LOGIN' : ''} ${cards ? '| ' + cards : ''}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });