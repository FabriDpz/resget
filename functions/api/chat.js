// ---------------------------------------------------------------------------
// POST /api/chat — la chat del sito in produzione (Cloudflare Pages Function).
// Stesso contratto del server locale (chat-server.mjs): la logica è condivisa
// in core/chat-core.mjs; qui cambia solo il guscio:
//   - cfg dai Secrets/vars del progetto (AI_API_KEY, AI_PROVIDER, AI_MODEL),
//   - dati dal bundle statico (data.mjs, generato a ogni deploy),
//   - LLM via fetch diretta all'endpoint OpenAI-compatibile (niente Node),
//   - budget orario best-effort in memoria all'isolate (il limite duro resta
//     il budget del provider; il gate password protegge l'intero sito).
// ---------------------------------------------------------------------------

import { handleChatCore } from '../../core/chat-core.mjs';
import { RADAR_DATA } from '../../data.mjs'; // generato da scripts/build-cf.mjs (gitignored)

const callTimes = [];
const budgetOk = (max, now = Date.now()) => {
  while (callTimes.length && now - callTimes[0] > 3600000) callTimes.shift();
  return callTimes.length < max;
};

// aiChat in versione Worker: fetch + AbortController, stesso shape di
// core/ai.mjs ({ok, data} | {ok:false, error}), mai throw.
async function aiChatWorker(cfg, messages, { timeoutMs = 60000, maxTokens = 700 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(cfg.chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const errBody = (await resp.text()).slice(0, 200);
      return { ok: false, error: `HTTP ${resp.status}: ${errBody}` };
    }
    const j = await resp.json();
    const content = j.choices?.[0]?.message?.content || '';
    let data;
    try { data = JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/);
      try { data = m ? JSON.parse(m[0]) : null; } catch { data = null; }
      if (!data) return { ok: false, error: `JSON non valido: ${content.slice(0, 120)}` };
    }
    return { ok: true, data, usage: j.usage || null };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function cfgFromEnv(env) {
  const provider = env.AI_PROVIDER || 'token-plan';
  // Base URL del Token Plan (abbonamento), NON dashscope pay-as-you-go:
  // la chiave sk-sp- è valida solo su questo endpoint.
  const base = (env.AI_BASE_URL || 'https://token-plan.ap-southeast-1.maas.aliyuncs.com').replace(/\/+$/, '');
  const chatUrl = provider === 'token-plan' && !/\/v1$/.test(base)
    ? `${base}/compatible-mode/v1/chat/completions`
    : `${base}/chat/completions`;
  return {
    enabled: Boolean(env.AI_API_KEY),
    provider,
    model: env.AI_MODEL || 'qwen3.8-flash',
    apiKey: env.AI_API_KEY || '',
    chatUrl,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'JSON non valido' }, { status: 400 });
  }
  const max = Number(env.CHAT_MAX_CALLS_PER_HOUR || 60);
  const r = await handleChatCore({
    cfg: cfgFromEnv(env),
    data: RADAR_DATA,
    body,
    aiChat: aiChatWorker,
    budgetOk: () => budgetOk(max),
    pushCall: () => callTimes.push(Date.now()),
    log: (m) => console.log(m),
  });
  return Response.json(r.json, { status: r.status });
}