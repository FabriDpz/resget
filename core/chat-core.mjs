// ---------------------------------------------------------------------------
// Logica della chat condivisa tra server locale (chat-server.mjs) e produzione
// (functions/api/chat.js su Cloudflare Pages). Modulo PURO: niente fs, niente
// Node-only — riceve cfg, dati e una funzione di chiamata LLM per iniezione.
// Il contratto di handleChatCore è identico nei due ambienti.
// ---------------------------------------------------------------------------

import { normalizeAction, executeAction, datasetSummary, RANK_CRITERI } from './chat-actions.mjs';

export function systemPrompt(summary) {
  return `Sei l'assistente del Radar Immobiliare (flip su Bologna, Pianoro, San Lazzaro di Savena).
Traduci la richiesta dell'utente in UNA azione JSON. Non inventare mai annunci, prezzi o ID: i dati veri li esegue il server.

Dataset (lista operativa flip, già deduplicata, esclusi affitti e stati senza margine):
${JSON.stringify(summary)}

Azioni possibili (rispondi SOLO con un oggetto JSON {"action": ..., ...}):
1. {"action":"filter","comune"?,"zona"?,"prezzoMax"?,"prezzoMin"?,"mqMin"?,"mqMax"?,"camereMin"?,"stato"?,"ascensore"?,"distanzaMaxKm"?,"poiMin"?,"profilo"?,"testo"?}
   Ricerca annunci. comune: uno di ${summary.comuni.join('/')}. zona: sottozona (es. "Centro", "Rastignano"). stato: testo contenuto nello stato (es. "ristrutturare"). profilo: "BIG"|"SMA"|"RENO"|"STALE". testo: parole da cercare in titolo/descrizione (es. "ascensore giardino").
2. {"action":"rank","criterio":"${RANK_CRITERI.join('|')}","n":5,"filtro":{...come filter}}
   Classifica: roi/margine/stale/poi = più alto meglio, pmq/prezzo = più basso meglio. n max 10.
3. {"action":"compare","ids":["id1","id2"]}
   Confronto tra 2-4 annunci. Usa gli id REALI: quelli citati dall'utente (anche abbreviati: completali con l'id intero dei risultati) o quelli dei risultati precedenti. Il server verifica che esistano.
4. {"action":"answer","ids":["id1"],"domanda":"la domanda dell'utente"}
   Domanda su annunci specifici (anche 1, id come sopra). Senza ids se la domanda è generale sul dataset/metodo.
5. {"action":"clarify","domanda":"..."}
   Richiesta ambigua o fuori tema (cerca immobili, non altro): chiedi un chiarimento breve.

Regole:
- Follow-up ("e solo con ascensore?", "escludi quelli oltre 2 km"): riparti dal filtro dell'ultima azione e modifica solo ciò che l'utente cambia.
- Richiesta nuova e autonoma (es. "i 5 migliori per ROI" senza riferimenti alla ricerca prima): NON trascinare i vecchi filtri, parti da zero.
- Prezzi in euro interi (130k = 130000). "Trilocale" ≈ 2 camere da letto: usa camereMin:2. "Bilocale" ≈ 1 camera.
- Se l'utente chiede "i migliori", "più conveniente", "da trattare": rank con criterio adatto (roi, pmq, stale).
- Non eseguire azioni se mancano gli id per compare/answer: usa clarify o prima un filter.`;
}

// Messaggio di contesto coi risultati dell'ultima azione: consente i follow-up
// senza rimandare tutto lo storico dati al modello.
export function resultContext(result) {
  if (!result) return '';
  if (result.action === 'clarify') return '';
  const rows = (result.rows || []).slice(0, 12).map((r) => ({ id: r.id, zona: r.zona, prezzo: r.prezzo, mq: r.mq, camere: r.camere, stato: r.stato, roi: r.roi, staleScore: r.staleScore }));
  return `Ultima azione eseguita: ${JSON.stringify({ action: result.action, filtro: result.filtro, criterio: result.criterio, totale: result.totale })}\nRighe risultato (id REALI da usare per compare/answer): ${JSON.stringify(rows)}`;
}

// Commento del modello sui soli risultati (seconda chiamata, breve).
export async function commentOnResult(userText, action, result, cfg, aiChat) {
  const dataLite = result.cards
    ? result.cards
    : (result.rows || []).slice(0, 10);
  const sys = `Sei l'assistente del Radar Immobiliare. Commenta in italiano, 2-4 frasi, i risultati REALI qui sotto rispetto alla richiesta dell'utente. Non inventare dati non presenti. Margini e punteggi sono stime indicative. Rispondi con JSON {"commento":"..."}${action.action === 'answer' ? '. Se la domanda richiede dati assenti, dillo chiaramente' : ''}.`;
  const user = `Richiesta: ${userText}\nAzione: ${JSON.stringify({ action: action.action, filtro: action.filtro, criterio: action.criterio, totale: result.totale })}\nDati: ${JSON.stringify(dataLite)}`;
  const r = await aiChat(cfg, [{ role: 'system', content: sys }, { role: 'user', content: user }], { maxTokens: 350, timeoutMs: 45000 });
  return r.ok ? String(r.data.commento || '').slice(0, 800) : '';
}

// Un turno di chat. Ritorna {status, json} pronto per la risposta HTTP.
//   cfg: {enabled, provider, model, apiKey?, baseUrl?}
//   data: dataset del sito (oggetto di window.RADAR_DATA)
//   body: {messages, lastResult}
//   aiChat: funzione (cfg, messages, opts) → {ok, data|error} (core/ai.mjs in
//           locale, fetch diretto nel worker)
//   budgetOk/pushCall: gate del budget orario, gestito dal chiamante.
export async function handleChatCore({ cfg, data, body, aiChat, budgetOk, pushCall, log = () => {} }) {
  if (!cfg.enabled) return { status: 503, json: { error: 'AI non configurata: imposta ai-config.json / credenziali (vedi core/ai-config.mjs).' } };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || !String(last.content || '').trim()) {
    return { status: 400, json: { error: 'messages: ultimo messaggio user mancante.' } };
  }
  if (!data?.global?.ads) return { status: 500, json: { error: 'Dati sito non leggibili: esegui node build-site.mjs.' } };
  if (!budgetOk()) return { status: 429, json: { error: 'Budget chat esaurito (chiamate/ora). Riprova più tardi.' } };

  const summary = datasetSummary(data);

  // History client: max 12 turni, solo user/assistant testuali (niente system
  // iniettati dal client). Il contesto risultati dell'ultimo turno arriva dal
  // client come campo lastResult (riassunto, non dati fidati per l'esecuzione).
  const history = messages.slice(-12)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  const ctx = body.lastResult ? resultContext(body.lastResult) : '';
  const llmMessages = [
    { role: 'system', content: systemPrompt(summary) },
    ...(ctx ? [{ role: 'user', content: `[contesto risultati precedenti]\n${ctx}` }, { role: 'assistant', content: 'Ricevuto: uso questi id e questo filtro per i follow-up.' }] : []),
    ...history,
  ];

  pushCall();
  const r1 = await aiChat(cfg, llmMessages, { maxTokens: 400 });
  if (!r1.ok) {
    log(`chat: LLM errore: ${r1.error}`);
    return { status: 502, json: { error: `LLM: ${r1.error}` } };
  }
  const action = normalizeAction(r1.data);
  const result = executeAction(action, data);

  let commento = '';
  if (result.action !== 'clarify' && (result.rows || []).length && budgetOk()) {
    pushCall();
    commento = await commentOnResult(String(last.content).slice(0, 500), action, result, cfg, aiChat);
  }
  if (result.action === 'clarify') commento = result.domanda;
  if (!commento && result.action !== 'clarify') {
    commento = result.totale
      ? `${result.totale} annunci trovati${result.rows.length < result.totale ? `, mostro i primi ${result.rows.length}` : ''}.`
      : 'Nessun annuncio corrisponde ai criteri: prova ad allargare la ricerca.';
  }

  log(`chat: ${action.action}${action.criterio ? '/' + action.criterio : ''} → ${result.totale ?? 0} risultati`);
  return {
    status: 200,
    json: {
      action: result.action,
      filtro: result.filtro || null,
      criterio: result.criterio || null,
      totale: result.totale ?? 0,
      rows: result.rows || [],
      missing: result.missing || [],
      commento,
      provider: cfg.provider,
      model: cfg.model,
    },
  };
}