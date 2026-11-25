// GET /api/chat/status — stesso contratto del server locale (chat-server.mjs).
// Dietro il gate del sito (functions/_middleware.js radice): senza cookie di
// sito valido o X-Chat-Auth risponde 401 e il client invita a ricaricare.
import { RADAR_DATA } from '../../../data.mjs'; // generato da scripts/build-cf.mjs

export async function onRequestGet(context) {
  const { env } = context;
  const provider = env.AI_PROVIDER || 'token-plan';
  const model = env.AI_MODEL || 'qwen3.8-flash';
  const enabled = Boolean(env.AI_API_KEY) && Boolean(RADAR_DATA?.global?.ads);
  return Response.json({
    enabled,
    provider,
    model,
    datiOk: Boolean(RADAR_DATA?.global?.ads),
    budgetOrario: Number(env.CHAT_MAX_CALLS_PER_HOUR || 60),
  });
}