// Test offline del motore AI (nessuna chiamata di rete, nessun costo).
//   node test-ai.mjs
import { frasiPertinenti, aiFieldOk, chatUrl } from './core/ai.mjs';
import { loadAiConfig, AI_MODELS, DEEPSEEK_MODELS, OLLAMA_DEFAULT_URL, DEEPSEEK_DEFAULT_URL } from './core/ai-config.mjs';

let ok = 0, ko = 0;
const check = (name, cond, detail = '') => {
  if (cond) { ok++; console.log(`  OK   ${name}`); }
  else { ko++; console.log(`  FAIL ${name} ${detail}`); }
};

console.log('— Prompt minimale: solo frasi pertinenti —');
const ad = {
  titolo: 'Bilocale via Mazzini',
  descrizione: 'Zona comoda ai servizi. Vicino alla fermata del bus 14. Privato affitta bilocale arredato, no agenzie. Il quartiere è servito da scuole e negozi. Canone 800 euro. Parcheggio facile nelle vie limitrofe.',
};
const f = frasiPertinenti(ad, [/privat/i, /agenz/i]);
check('estrae la frase sul venditore', /Privato affitta/.test(f), f);
check('scarta le frasi irrilevanti', !/fermata del bus|Parcheggio facile/.test(f), f);
check('prompt bounded ≤ 700 chars', f.length <= 700, String(f.length));
const fAll = frasiPertinenti({ titolo: 'Casa', descrizione: 'Testo senza indizi sul venditore whatsoever.' }, [/privat/i]);
check('fallback bounded quando nessun match', fAll.length > 0 && fAll.length <= 700, fAll);

console.log('— Confidence fail-closed —');
const cfg = { minConfidence: 0.8 };
check('conf 0.95 accetta', aiFieldOk({ confidence: 0.95 }, cfg));
check('conf 0.6 rifiuta', !aiFieldOk({ confidence: 0.6 }, cfg));
check('conf assente rifiuta', !aiFieldOk({ data: {} }, cfg));
check('result assente rifiuta', !aiFieldOk(null, cfg));

console.log('— Modello parametrico —');
const cFlash = loadAiConfig({ model: 'qwen3.8-flash' });
check('override --model rispettato', cFlash.model === 'qwen3.8-flash');
const cMax = loadAiConfig({ model: 'qwen4-max-preview' });
check('switch a qwen4-max-preview', cMax.model === 'qwen4-max-preview');
check('lista modelli include ECO e preview', AI_MODELS.includes('qwen3.8-flash') && AI_MODELS.includes('qwen4-max-preview'));
check('nessuna API key nel sorgente del config', !/api_key\s*[:=]\s*['"][A-Za-z0-9]{8,}/.test((await import('node:fs')).readFileSync('core/ai-config.mjs', 'utf8')));

console.log('— Provider Ollama locale (parametrico) —');
const cOll = loadAiConfig({ provider: 'ollama', model: 'qwen3.5:4b' });
check('provider ollama: modello locale rispettato', cOll.provider === 'ollama' && cOll.model === 'qwen3.5:4b');
check('provider ollama: baseUrl locale di default', cOll.baseUrl === OLLAMA_DEFAULT_URL);
check('provider ollama: nessuna key richiesta, enabled', cOll.apiKey === '' && cOll.enabled === true);
check('URL chat ollama = /v1/chat/completions', chatUrl(cOll) === 'http://localhost:11434/v1/chat/completions', chatUrl(cOll));
const cTpUrl = chatUrl({ provider: 'token-plan', baseUrl: 'https://token-plan.example.com' });
check('URL chat token-plan = compatible-mode', cTpUrl === 'https://token-plan.example.com/compatible-mode/v1/chat/completions', cTpUrl);
const cTpV1 = chatUrl({ provider: 'token-plan', baseUrl: 'https://x.example.com/v1' });
check('URL chat con /v1 esplicito non duplica', cTpV1 === 'https://x.example.com/v1/chat/completions', cTpV1);
check('switch provider back to token-plan', loadAiConfig({ provider: 'token-plan' }).provider === 'token-plan');

console.log('— Provider Deepseek diretto (key dedicata) —');
const prevKey = process.env.DEEPSEEK_API_KEY;
process.env.DEEPSEEK_API_KEY = 'test-key-not-real';
const cDs = loadAiConfig({ provider: 'deepseek' });
check('deepseek: modello default deepseek-chat', cDs.model === 'deepseek-chat');
check('deepseek: baseUrl ufficiale', cDs.baseUrl === DEEPSEEK_DEFAULT_URL);
check('deepseek: key da env dedicata, enabled', cDs.apiKey === 'test-key-not-real' && cDs.enabled);
check('deepseek: override modello reasoner', loadAiConfig({ provider: 'deepseek', model: 'deepseek-reasoner' }).model === 'deepseek-reasoner');
check('deepseek: lista modelli', DEEPSEEK_MODELS.includes('deepseek-chat') && DEEPSEEK_MODELS.includes('deepseek-reasoner'));
const dsUrl = chatUrl(cDs);
check('deepseek: URL chat compatibile', dsUrl === 'https://api.deepseek.com/chat/completions', dsUrl);
delete process.env.DEEPSEEK_API_KEY;
check('deepseek senza key: enabled dipende solo dal file home', typeof loadAiConfig({ provider: 'deepseek' }).enabled === 'boolean');
if (prevKey !== undefined) process.env.DEEPSEEK_API_KEY = prevKey;

console.log(`\n${ok} OK, ${ko} FAIL`);
process.exit(ko ? 1 : 0);