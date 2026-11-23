// Configurazione AI per l'interpretazione annunci (pipeline a imbuto).
// MODELLO e PROVIDER parametrici (regole utente 23/11). Tre provider alternativi:
//   --provider token-plan|deepseek|ollama  (env RADAR_AI_PROVIDER, ai-config.json)
//   --model <id>                           (env RADAR_AI_MODEL, ai-config.json)
// - token-plan: Alibaba Token Plan (Qwen/Deepseek ospitati), default qwen3.8-flash.
// - deepseek: API diretta api.deepseek.com con key dedicata dell'utente.
// - ollama: locale http://localhost:11434/v1, nessuna key, costo token ZERO;
//   i modelli sono i tag locali (es. qwen3.5:4b), elencabili con listOllamaModels.
// Credenziali cloud: MAI nel codice/repo — env RADAR_AI_API_KEY/DASHSCOPE_API_KEY
// o ~/.bailian/config.json (token-plan); env DEEPSEEK_API_KEY/RADAR_DEEPSEEK_API_KEY
// o ~/.radar-ai.json {"deepseekApiKey": "..."} (deepseek). Tutti fuori dal repo.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Modelli consentiti sul Token Plan. ECO per estrazione/classificazione;
// qwen4-max-preview solo su richiesta esplicita (costo maggiore).
export const AI_MODELS = [
  'qwen3.8-flash',
  'qwen3.8-max',
  'qwen4-max-preview',
  'deepseek-v4.1-flash-1017',
  'deepseek-v4-pro-0813',
];

export const OLLAMA_DEFAULT_URL = 'http://localhost:11434/v1';

// Modelli dell'API diretta Deepseek (key dedicata, distinta dal Token Plan).
export const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'];
export const DEEPSEEK_DEFAULT_URL = 'https://api.deepseek.com';

// Modelli locali installati (discovery, per --list-models). Ritorna [] se
// Ollama non è attivo: mai throw, la configurazione resta usabile offline.
export async function listOllamaModels(baseUrl = OLLAMA_DEFAULT_URL) {
  try {
    const root = baseUrl.replace(/\/v1\/?$/, '');
    const resp = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return [];
    const j = await resp.json();
    return (j.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

export function loadAiConfig({ model = null, provider = null } = {}) {
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ai-config.json'), 'utf8')); } catch { /* assente = default */ }
  const prov = provider || process.env.RADAR_AI_PROVIDER || fileCfg.provider || 'token-plan';
  const shared = {
    provider: prov,
    maxCallsPerRun: fileCfg.maxCallsPerRun ?? 60,
    minConfidence: fileCfg.minConfidence ?? 0.8,
  };
  if (prov === 'ollama') {
    const baseUrl = process.env.RADAR_AI_BASE_URL || fileCfg.ollamaBaseUrl || OLLAMA_DEFAULT_URL;
    const mdl = model || process.env.RADAR_AI_MODEL || fileCfg.ollamaModel || 'qwen3.5:4b';
    return { ...shared, model: mdl, apiKey: '', baseUrl, enabled: Boolean(baseUrl) };
  }
  if (prov === 'deepseek') {
    let home = {};
    try { home = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.radar-ai.json'), 'utf8')); } catch { /* assente */ }
    const apiKey = process.env.RADAR_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || home.deepseekApiKey || '';
    const baseUrl = process.env.RADAR_DEEPSEEK_BASE_URL || fileCfg.deepseekBaseUrl || DEEPSEEK_DEFAULT_URL;
    const mdl = model || process.env.RADAR_AI_MODEL || fileCfg.deepseekModel || 'deepseek-chat';
    return { ...shared, model: mdl, apiKey, baseUrl, enabled: Boolean(apiKey && baseUrl) };
  }
  let tp = {};
  try {
    const bl = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.bailian', 'config.json'), 'utf8'));
    tp = bl[bl.active_config] || bl['token-plan'] || {};
  } catch { /* CLI bl non configurata */ }
  const apiKey = process.env.RADAR_AI_API_KEY || process.env.DASHSCOPE_API_KEY || tp.api_key || '';
  const baseUrl = process.env.RADAR_AI_BASE_URL || tp.base_url || '';
  const mdl = model || process.env.RADAR_AI_MODEL || fileCfg.model || 'qwen3.8-flash';
  return { ...shared, model: mdl, apiKey, baseUrl, enabled: Boolean(apiKey && baseUrl) };
}