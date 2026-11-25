/* Radar Immobiliare — UI statica multi-portale (vanilla JS, nessun server). */
(function () {
  'use strict';
  const D = window.RADAR_DATA;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ALLOWED = ['bologna', 'pianoro', 'san lazzaro di savena'];
  const eur = (n) => (n == null || n === '' || isNaN(n)) ? '' : Number(n).toLocaleString('it-IT') + ' €';
  const num = (n, d = 0) => (n == null || n === '' || isNaN(n)) ? '' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: d });
  const shortId = (id) => { const s = String(id); return s.length > 16 ? s.slice(0, 14) + '…' : s; };
  const pmq = (a) => {
    if (typeof a.prezzoMq === 'number') return a.prezzoMq;
    const m = String(a.prezzoMq || '').replace(/\./g, '').match(/(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const badge = (txt, cls) => `<span class="badge ${esc(cls || txt)}">${esc(txt)}</span>`;
  const subzona = (z) => String(z || '').split('/').pop().trim();
  const inTarget = (a) => ALLOWED.includes(String(a.comune || '').trim().toLowerCase());
  // Regola utente 22/11: niente ottimo/ristrutturato/nuovo nelle liste (nessun
  // margine per un flip). Stato vuoto resta visibile: in valutazione (D2).
  const statoFlipInutile = (a) => {
    const s = String(a.stato || '').trim().toLowerCase();
    if (!s) return false;
    if (/demolire|ristrutturare|pessimo|cattivo|da sistemare|renovat|restaur|fixer/.test(s)) return false;
    return /^nuovo|in costruzione|\bnew\b|ottimo|ristrutturat[oa]|pari al nuovo|perfetto|excelente|chiavi in mano|recentemente ristruttur|appena ristruttur|completamente ristruttur|totalmente ristruttur|già ristruttur/i.test(s);
  };
  // Affitti (canone, non prezzo di vendita): fuori dalle liste operative,
  // visibili solo nella sezione Lead privati. Stesso segnale del build
  // (motivazione da detectAffitto in core/filters.mjs).
  const isAffitto = (a) => /affitto, non vendita/i.test(`${a.motivazione || ''} ${a.motivazioneSma || ''}`);
  const median = (arr) => {
    const v = arr.filter((x) => x != null && !isNaN(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const portalName = (id) => (D.portals.find((p) => p.id === id)?.name) || id;

  if (!D) {
    $('#table-wrap').innerHTML = '<p>Dati mancanti: esegui <code>node build-site.mjs</code>.</p>';
    return;
  }

  const state = { portal: 'global', view: 'dashboard', sortKey: null, sortDir: 1, expanded: null, chatFilter: null };

  const isGlobal = () => state.portal === 'global';
  const rawAds = () => isGlobal() ? (D.global?.ads || []) : (D.portals.find((p) => p.id === state.portal)?.ads || []);
  const targetAds = () => rawAds().filter((a) => inTarget(a) && !isAffitto(a));
  // Liste operative del flip: oltre al comune, escludono gli stati senza margine.
  const flipAds = () => targetAds().filter((a) => !statoFlipInutile(a));

  // ------------------------------------------------------------- colonne
  function col(key, label, render, sortVal, numeric) { return { key, label, render, sortVal, numeric }; }
  function baseCols() {
    return [
      col('id', 'Annuncio', (a) => {
        const l = a.ledger;
        const flags = (l?.nuovo ? badge('NUOVO', 'verde') + ' ' : '') + (l?.ribassatoOggi ? badge('RIBASSATO', 'giallo') + ' ' : '');
        const obs = l?.giorniOsservati > 0 ? ` title="Visto dal radar dal ${esc(l.firstSeen)} (${l.giorniOsservati} gg)"` : '';
        return `${flags}<a class="id-link" href="${esc(a.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"${obs || ` title="${esc(a.id)}"`}>${esc(shortId(a.id))}</a>`;
      }, (a) => a.id),
      col('titolo', 'Titolo', (a) => esc(a.titolo), (a) => a.titolo),
      col('zona', 'Zona', (a) => esc(subzona(a.zona) || a.zona), (a) => subzona(a.zona)),
      col('prezzo', 'Prezzo', (a) => eur(a.prezzo), (a) => a.prezzo, true),
      col('pmq', '€/m²', (a) => num(pmq(a)), (a) => pmq(a), true),
      col('mq', 'm²', (a) => num(a.superficieMq), (a) => a.superficieMq, true),
      col('camere', 'Camere', (a) => camereCell(a), (a) => a.camere ?? a.camereAI, true),
      col('stato', 'Stato', (a) => esc(a.stato) + (a.fonteStato ? ` <span class="badge info" title="${esc(a.fonteStato)}">AI</span>` : ''), (a) => a.stato),
      col('piano', 'Piano', (a) => esc(a.pianoSolo ?? a.piano), (a) => a.pianoSolo ?? a.piano),
    ];
  }
  // Camere: dato portale in chiaro; se manca, il valore verificato dall'AI
  // (registro ai-residui.json, conf ≥ soglia) con badge e fonte nel tooltip.
  function camereCell(a) {
    if (a.camere != null) return num(a.camere);
    if (a.camereAI != null) return `${num(a.camereAI)} <span class="badge info" title="Verificate dall'AI sul testo (conf ${a.camereAIConfidenza ?? '?'}) — registro ai-residui.json">AI</span>`;
    return '';
  }
  function fonteCol() {
    return col('fonti', 'Portali', (a) => {
      const fs = a.fonti || [{ portale: a.portale }];
      const names = fs.map((f) => portalName(f.portale));
      const cls = fs.length > 1 ? 'info' : '';
      return `<span class="badge ${cls}" title="${esc(names.join(', '))}">${fs.length > 1 ? '★ ' : ''}${esc(names[0] || '')}${fs.length > 1 ? ' +' + (fs.length - 1) : ''}</span>`;
    }, (a) => (a.fonti?.length || 1), true);
  }

  // ------------------------------------------------------------- viste
  const VIEWS = {
    dashboard: { title: 'Dashboard' },
    big: {
      title: 'BIG — ≤160k, ≥2 camere',
      rows: () => flipAds(),
      sortKey: 'pmq', sortDir: 1,
      extra: { label: 'Esito BIG', get: (a) => a.esito, options: ['Selezionato', 'Escluso'] },
      cols: () => [
        col('esito', 'Esito BIG', (a) => badge(a.esito, a.esito), (a) => a.esito),
        ...(isGlobal() ? [fonteCol()] : []),
        ...baseCols(),
        col('rankPoi', 'Rank POI', (a) => a.esito === 'Selezionato' ? num(a.poi?.rank) : '', (a) => a.esito === 'Selezionato' ? a.poi?.rank : null, true),
        col('motivazione', 'Motivazione', (a) => esc(a.motivazione), (a) => a.motivazione),
      ],
    },
    sma: {
      title: 'SMA — ≤130k, 1 camera',
      rows: () => flipAds().filter((a) => a.esito !== 'Selezionato'),
      sortKey: 'pmq', sortDir: 1,
      extra: { label: 'Esito SMA', get: (a) => a.esitoSma, options: ['Selezionato', 'Escluso'] },
      cols: () => [
        col('esitoSma', 'Esito SMA', (a) => badge(a.esitoSma, a.esitoSma), (a) => a.esitoSma),
        ...(isGlobal() ? [fonteCol()] : []),
        ...baseCols(),
        col('rankPoi', 'Rank POI', (a) => a.esitoSma === 'Selezionato' ? num(a.poi?.rank) : '', (a) => a.esitoSma === 'Selezionato' ? a.poi?.rank : null, true),
        col('motivazioneSma', 'Motivazione', (a) => esc(a.motivazioneSma), (a) => a.motivazioneSma),
      ],
    },
    reno: {
      title: 'FLIP RENO — compra, ristruttura, rivendi',
      rows: () => targetAds().filter((a) => a.flip?.reno?.candidato),
      sortKey: 'roi', sortDir: -1,
      extra: { label: 'Semaforo', get: (a) => a.flip.reno.semaforo, options: ['verde', 'giallo', 'rosso'] },
      cols: () => [
        col('semaforo', 'Esito', (a) => badge(a.flip.reno.semaforo.toUpperCase(), a.flip.reno.semaforo), (a) => a.flip.reno.semaforo),
        col('roi', 'ROI netto', (a) => num(a.flip.reno.roi, 1) + '%', (a) => a.flip.reno.roi, true),
        col('margineNetto', 'Margine netto', (a) => eur(a.flip.reno.margineNetto), (a) => a.flip.reno.margineNetto, true),
        col('maxOffer', 'Offerta max', (a) => eur(a.flip.reno.maxOffer), (a) => a.flip.reno.maxOffer, true),
        ...(isGlobal() ? [fonteCol()] : []),
        ...baseCols(),
        col('sconto', 'Sconto zona', (a) => a.flip.reno.scontoVsZona == null ? '' : num(a.flip.reno.scontoVsZona, 1) + '%', (a) => a.flip.reno.scontoVsZona, true),
        col('arvTot', 'ARV', (a) => eur(a.flip.reno.arvTot), (a) => a.flip.reno.arvTot, true),
        col('costoLavori', 'Lavori', (a) => eur(a.flip.reno.costoLavori), (a) => a.flip.reno.costoLavori, true),
      ],
    },
    stale: {
      title: 'FLIP STALE — annunci fermi, venditori motivati',
      rows: () => targetAds().filter((a) => a.flip?.stale),
      sortKey: 'score', sortDir: -1,
      extra: { label: 'Negoziabilità', get: (a) => a.flip.stale.fascia, options: ['Alto', 'Medio', 'Basso'] },
      cols: () => [
        col('fascia', 'Negoziabilità', (a) => badge(a.flip.stale.fascia, a.flip.stale.fascia), (a) => a.flip.stale.fascia),
        col('score', 'Score', (a) => num(a.flip.stale.score), (a) => a.flip.stale.score, true),
        col('giorni', 'Giorni online', (a) => num(a.flip.stale.giorniOnline), (a) => a.flip.stale.giorniOnline, true),
        col('ribassi', 'Ribassi', (a) => a.flip.stale.ribassi ? `${a.flip.stale.ribassi} (−${num(a.flip.stale.ribassoTot)} €)` : '—', (a) => a.flip.stale.ribassi, true),
        ...(isGlobal() ? [fonteCol()] : []),
        ...baseCols(),
        col('prezzoTarget', 'Prezzo target', (a) => eur(a.flip.stale.prezzoTarget), (a) => a.flip.stale.prezzoTarget, true),
        col('candReno', 'RENO', (a) => a.flip.reno?.candidato ? badge(num(a.flip.reno.roi, 1) + '%', a.flip.reno.semaforo) : '—', (a) => a.flip.reno?.candidato ? a.flip.reno.roi : null, true),
      ],
    },
    tutti: {
      title: 'Tutti gli annunci target (no ottimo/ristrutturato)',
      rows: () => flipAds(),
      sortKey: 'pmq', sortDir: 1,
      cols: () => [
        col('esito', 'BIG', (a) => badge(a.esito, a.esito), (a) => a.esito),
        col('esitoSma', 'SMA', (a) => a.esito === 'Selezionato' ? '—' : badge(a.esitoSma, a.esitoSma), (a) => a.esitoSma),
        ...(isGlobal() ? [fonteCol()] : []),
        ...baseCols(),
        col('reno', 'RENO', (a) => a.flip?.reno?.candidato ? badge(num(a.flip.reno.roi, 1) + '%', a.flip.reno.semaforo) : '—', (a) => a.flip?.reno?.candidato ? a.flip.reno.roi : null, true),
        col('stale', 'STALE', (a) => a.flip?.stale ? badge(String(a.flip.stale.score), a.flip.stale.fascia) : '—', (a) => a.flip?.stale?.score, true),
      ],
    },
    multi: {
      title: 'Multi-portale — stesso immobile su più siti',
      rows: () => flipAds().filter((a) => a.multiPortale),
      sortKey: 'nfonti', sortDir: -1,
      cols: () => [
        col('nfonti', 'N. portali', (a) => badge(String(a.fonti?.length || 1), 'info'), (a) => a.fonti?.length || 1, true),
        col('portali', 'Portali', (a) => esc((a.fonti || []).map((f) => portalName(f.portale)).join(', ')), (a) => (a.fonti || []).map((f) => f.portale).join(',')),
        ...baseCols(),
        col('prezzi', 'Prezzi per portale', (a) => esc((a.fonti || []).map((f) => `${portalName(f.portale)}: ${eur(f.prezzo)}`).join(' · ')), (a) => a.prezzo, true),
      ],
    },
    novita: {
      title: 'Novità — nuovi e ribassati dall\'ultimo run',
      rows: () => flipAds().filter((a) => a.ledger?.nuovo || a.ledger?.ribassatoOggi),
      sortKey: 'novita', sortDir: 1,
      extra: { label: 'Novità', get: (a) => a.ledger?.nuovo ? 'Nuovo' : 'Ribassato', options: ['Nuovo', 'Ribassato'] },
      cols: () => [
        col('novita', 'Novità', (a) => a.ledger?.nuovo ? badge('NUOVO', 'verde') : badge('RIBASSATO', 'giallo'), (a) => a.ledger?.nuovo ? 0 : 1, true),
        col('firstSeen', 'Visto dal', (a) => esc(a.ledger?.firstSeen || ''), (a) => a.ledger?.firstSeen),
        col('ggObs', 'Gg osservati', (a) => num(a.ledger?.giorniOsservati), (a) => a.ledger?.giorniOsservati, true),
        col('ribassiObs', 'Ribassi', (a) => a.ledger?.ribassiOsservati ? String(a.ledger.ribassiOsservati) : '—', (a) => a.ledger?.ribassiOsservati, true),
        ...(isGlobal() ? [fonteCol()] : []),
        ...baseCols(),
        col('esito', 'BIG', (a) => badge(a.esito, a.esito), (a) => a.esito),
        col('esitoSma', 'SMA', (a) => a.esito === 'Selezionato' ? '—' : badge(a.esitoSma, a.esitoSma), (a) => a.esitoSma),
      ],
    },
    lead: {
      title: 'LEAD PRIVATI — affitti in scope, contatto manuale',
      rows: () => {
        if (isGlobal()) return (D.leadAffitti || []).filter(inTarget);
        return rawAds().filter((a) => inTarget(a) && a.leadAffitto);
      },
      sortKey: 'canone', sortDir: 1,
      extra: { label: 'Profilo', get: (a) => a.leadAffitto?.profilo, options: ['BIG', 'SMA'] },
      cols: () => [
        col('profilo', 'Profilo', (a) => badge(a.leadAffitto?.profilo || '', 'info'), (a) => a.leadAffitto?.profilo),
        col('privato', 'Privato', (a) => {
          const s = a.leadAffitto?.statoPrivato || '';
          const cls = s === 'verificato' ? 'verde' : s === 'da verificare' ? 'giallo' : 'info';
          const title = s === 'da verificare' ? 'Flag inferito (agenzia assente): aprire la scheda sul portale e verificare chi pubblica prima di contattare'
            : s === 'verificato' ? `Verifica manuale del ${a.leadAffitto?.verificaPrivato?.data || '?'}: ${a.leadAffitto?.verificaPrivato?.nota || ''}`
            : 'Il portale espone il tipo di inserzionista: privato dichiarato';
          return `<span class="badge ${cls}" title="${esc(title)}">${esc(s)}</span>`;
        }, (a) => a.leadAffitto?.statoPrivato),
        ...(isGlobal() ? [fonteCol()] : []),
        col('id', 'Annuncio', (a) => `<a class="id-link" href="${esc(a.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${esc(a.id)}">${esc(shortId(a.id))}</a>`, (a) => a.id),
        col('titolo', 'Titolo', (a) => esc(a.titolo), (a) => a.titolo),
        col('zona', 'Zona', (a) => esc(subzona(a.zona) || a.zona), (a) => subzona(a.zona)),
        col('canone', 'Canone/mese', (a) => eur(a.prezzo), (a) => a.prezzo, true),
        col('mq', 'm²', (a) => num(a.superficieMq), (a) => a.superficieMq, true),
        col('locali', 'Locali', (a) => num(a.locali), (a) => a.locali, true),
        col('camere', 'Camere', (a) => num(a.camere), (a) => a.camere, true),
        col('stato', 'Stato', (a) => esc(a.stato), (a) => a.stato),
        col('pub', 'Pubblicato', (a) => esc((a.pubblicatoIl || '').slice(0, 10)), (a) => a.pubblicatoIl),
      ],
    },
  };
  const VIEW_LABELS = { dashboard: 'Dashboard', novita: 'Novità', big: 'BIG', sma: 'SMA', reno: 'FLIP RENO', stale: 'FLIP STALE', lead: 'Lead privati', tutti: 'Tutti', multi: 'Multi-portale' };

  // ------------------------------------------------------------- sidebar
  function navButton(portalId, viewId, label, count) {
    const active = state.portal === portalId && state.view === viewId;
    return `<button class="nav-item${active ? ' active' : ''}" data-portal="${portalId}" data-view="${viewId}">${label}${count != null && count !== '' ? `<span class="n">${count}</span>` : ''}</button>`;
  }
  function renderNav() {
    const nav = $('#portal-nav');
    let html = '';

    // Sezione GLOBAL (deduplicata).
    const g = D.global || { ads: [] };
    const saved = state.portal; state.portal = 'global';
    const gc = { big: VIEWS.big.rows().length, sma: VIEWS.sma.rows().length, reno: VIEWS.reno.rows().length, stale: VIEWS.stale.rows().length, lead: VIEWS.lead.rows().length, tutti: VIEWS.tutti.rows().length, multi: VIEWS.multi.rows().length };
    state.portal = saved;
    html += '<div class="portal global-portal"><div class="portal-name">🌐 GLOBAL<span class="soon">dedup</span></div>';
    const novitaCount = D.novita ? (D.novita.nuovi + D.novita.ribassati.length) : null;
    for (const id of ['dashboard', 'novita', 'big', 'sma', 'reno', 'stale', 'lead', 'multi', 'tutti']) {
      const count = id === 'dashboard' ? '' : id === 'novita' ? (novitaCount ?? '') : gc[id];
      html += navButton('global', id, VIEW_LABELS[id], count);
    }
    html += '</div>';

    // Portali attivi.
    for (const p of D.portals) {
      if (!p.active) continue;
      const sv = state.portal; state.portal = p.id;
      const c = { big: VIEWS.big.rows().length, sma: VIEWS.sma.rows().length, reno: VIEWS.reno.rows().length, stale: VIEWS.stale.rows().length, lead: VIEWS.lead.rows().length, tutti: VIEWS.tutti.rows().length };
      state.portal = sv;
      html += `<div class="portal"><div class="portal-name">${esc(p.name)}</div>`;
      for (const id of ['dashboard', 'novita', 'big', 'sma', 'reno', 'stale', ...(c.lead ? ['lead'] : []), 'tutti']) {
        const count = id === 'dashboard' ? '' : id === 'novita' ? VIEWS.novita.rows().length : c[id];
        html += navButton(p.id, id, VIEW_LABELS[id], count);
      }
      html += '</div>';
    }

    // Aste & NPL (informativo).
    html += `<div class="portal"><div class="portal-name">🔨 Aste &amp; NPL</div>${navButton('aste', 'info', 'Informazioni', '')}</div>`;

    // Portali differiti (informativo).
    html += `<div class="portal"><div class="portal-name">⏸ Differiti<span class="soon">${(D.deferred || []).length}</span></div>${navButton('differiti', 'info', 'Elenco e motivazioni', '')}</div>`;

    nav.innerHTML = html;
    nav.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => {
      state.portal = b.dataset.portal;
      state.view = b.dataset.view;
      state.sortKey = null; state.expanded = null;
      state.chatFilter = null; state.chatRank = null;
      $('#q').value = '';
      closeNav();
      render();
    }));
    const d = new Date(D.generatedAt);
    $('#meta').innerHTML = `Fonte: ${esc(D.source)}<br>Generato: ${d.toLocaleString('it-IT')}`;
  }

  // ------------------------------------------------------------- filtri
  function fillSelect(sel, values, keep) {
    const cur = keep ? sel.value : '';
    const first = sel.options[0].outerHTML;
    sel.innerHTML = first + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    sel.value = values.includes(cur) ? cur : '';
  }
  function currentRows() {
    const v = VIEWS[state.view];
    if (!v || !v.rows) return [];
    let rows = v.rows();
    const q = $('#q').value.trim().toLowerCase();
    if (q) rows = rows.filter((a) => [a.id, a.titolo, a.zona, a.comune, a.agenzia, a.indirizzo, (a.fonti || []).map((f) => f.portale).join(' ')].join(' ').toLowerCase().includes(q));
    const fz = $('#f-zona').value;
    if (fz) rows = rows.filter((a) => subzona(a.zona) === fz);
    const fs = $('#f-stato').value;
    if (fs) rows = rows.filter((a) => (a.stato || 'n/d') === fs);
    const fe = $('#f-extra');
    if (v.extra && !fe.classList.contains('hidden') && fe.value) rows = rows.filter((a) => v.extra.get(a) === fe.value);
    // Filtro applicato dalla chat (AND con i filtri manuali della vista).
    if (state.chatFilter) rows = rows.filter((a) => chatMatch(a, state.chatFilter));
    // Classifica chat: ordine esplicito per id (gli annunci fuori lista in coda).
    if (state.chatRank) {
      const order = state.chatRank;
      rows = [...rows].sort((a, b) => {
        const ia = order.has(String(a.id)) ? order.get(String(a.id)) : 1e9;
        const ib = order.has(String(b.id)) ? order.get(String(b.id)) : 1e9;
        return ia - ib;
      });
    }
    const key = state.chatRank ? null : (state.sortKey || v.sortKey);
    const dir = state.sortKey ? state.sortDir : (v.sortDir || 1);
    const cols = v.cols();
    const c = cols.find((x) => x.key === key);
    if (c) {
      rows = [...rows].sort((a, b) => {
        const va = c.sortVal(a), vb = c.sortVal(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'it');
        return cmp * dir;
      });
    }
    return rows;
  }

  // ------------------------------------------------------------- dettaglio
  function detailHtml(a) {
    const chips = [];
    for (const [k, label] of [['locali', 'locali'], ['bagni', 'bagni'], ['pianiEdificio', 'piani edificio'], ['cucina', 'cucina'], ['ascensore', 'ascensore'], ['arredato', 'arredato'], ['balcone', 'balcone'], ['terrazzo', 'terrazzo'], ['cantina', 'cantina'], ['riscaldamento', 'riscaldamento'], ['ape', 'APE']]) {
      if (a[k]) chips.push(`<span class="badge info">${esc(label)}: ${esc(a[k])}</span>`);
    }
    if (a.convertibile) chips.push(`<span class="badge info">convertibile in trilocale: ${esc(a.convertibile)}</span>`);
    if (a.camereAI != null) chips.push(`<span class="badge info" title="Registro ai-residui.json — campo verificato dall'AI sul testo, confidence ${a.camereAIConfidenza ?? '?'}">camere AI: ${num(a.camereAI)} (conf ${a.camereAIConfidenza ?? '?'})</span>`);
    if (a.convertibileAIEvidenza) chips.push(`<span class="badge info" title="Verifica AI sul testo">convertibilità AI: "${esc(a.convertibileAIEvidenza)}"</span>`);
    if (a.fonteStato) chips.push(`<span class="badge info">stato da ${esc(a.fonteStato)}</span>`);
    if (a.distanzaKm != null) chips.push(`<span class="badge info">dal centro: ${num(a.distanzaKm, 1)} km (${esc(a.centroVicino || '')})</span>`);
    if (a.poi?.rank != null) chips.push(`<span class="badge info">POI: ${num(a.poi.rank)} — ${esc(a.poi.etichetta || '')}</span>`);
    if (a.speseCondominio) chips.push(`<span class="badge info">condominio: ${esc(a.speseCondominio)}</span>`);
    if (a.fonteAggregata) chips.push(`<span class="badge info">fonte: ${esc(a.fonteAggregata)}</span>`);

    let fontiHtml = '';
    if (a.fonti?.length) {
      const rows = a.fonti.map((f) => `<div><span><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(portalName(f.portale))}</a>${f.agenzia ? ' · ' + esc(f.agenzia) : ''}</span><span>${eur(f.prezzo)}</span></div>`).join('');
      fontiHtml = `<h4>Presente su ${a.fonti.length} portal${a.fonti.length > 1 ? 'i' : 'e'}</h4><div class="cost-table" style="margin-bottom:12px">${rows}</div>`;
    }

    let poiHtml = '';
    if (a.poi?.categories) {
      const cats = Object.entries(a.poi.categories).map(([k, c]) => `${esc(k)}: ${esc(c.nome || '')} (${num(c.distanzaM)} m)`).join(' · ');
      poiHtml = `<div class="motiv" style="margin-bottom:10px">POI — ${cats}</div>`;
    }

    let flipHtml = '';
    const r = a.flip?.reno;
    if (r?.candidato) {
      const row = (l, v, cls) => `<div><span>${l}</span><span class="${cls || ''}">${v}</span></div>`;
      flipHtml = `<h4>FLIP RENO — ${badge(r.semaforo.toUpperCase(), r.semaforo)} ROI netto ${num(r.roi, 1)}%</h4>
      <div class="cost-table">
        ${row('Prezzo richiesto', eur(a.prezzo))}
        ${row(`Lavori (${esc(r.tipoLavori)}, ${num(r.costoLavoriMq)} €/m²)`, '− ' + eur(r.costoLavori))}
        ${row('Registro + notaio + agenzia + holding', '− ' + eur(r.costiAccessori))}
        ${row('Capitale totale', eur(r.capitale), 'tot')}
        ${row(`ARV (${num(r.arvMq)} €/m² — ${esc(r.arvFonte)})`, eur(r.arvTot))}
        ${row('Margine lordo', eur(r.margineLordo))}
        ${row('Plusvalenza 26%', '− ' + eur(r.plusvalenza))}
        ${row('Margine netto', eur(r.margineNetto), 'tot ' + (r.margineNetto >= 0 ? 'pos' : 'neg'))}
        ${row('Offerta max per ROI ≥ 20%', eur(r.maxOffer), 'tot')}
      </div>`;
    } else if (r) {
      flipHtml = `<h4>FLIP RENO — non candidato</h4><div class="motiv" style="margin-bottom:10px">${esc(r.motivoPool)}</div>`;
    }
    const s = a.flip?.stale;
    let staleHtml = '';
    if (s) {
      const gg = s.giorniOsservati != null && s.giorniOsservati > (s.giorniDichiarati ?? 0)
        ? `Online da ${num(s.giorniOnline)} giorni (osservati dal radar; dichiarati: ${num(s.giorniDichiarati ?? 0)})`
        : `Online da ${num(s.giorniOnline)} giorni`;
      staleHtml = `<h4>FLIP STALE — ${badge(s.fascia, s.fascia)} score ${num(s.score)}/100</h4>
      <div class="motiv" style="margin-bottom:10px">${gg} (${num(s.puntiGiorni)} pt) · ribassi: ${s.ribassi || 0} (${num(s.puntiRibassi)} pt) · keyword: ${esc((s.keyword || []).join(', ') || 'nessuna')} (${num(s.puntiKeyword)} pt)<br>Prezzo target suggerito: <strong>${eur(s.prezzoTarget)}</strong></div>`;
    }

    let ledgerHtml = '';
    const lg = a.ledger;
    if (lg) {
      const tl = (lg.timeline || []).map((p) => `<div><span>${esc(p.data)} · ${esc(portalName(p.fonte))}</span><span>${eur(p.prezzo)}</span></div>`).join('');
      const rip = (lg.ripubblicazioni || []).map((r) => `Ripubblicato il ${esc(r.data)} (${eur(r.prezzoPrima)} → ${eur(r.prezzoDopo)})`).join('<br>');
      ledgerHtml = `<h4>Memoria radar — dal ${esc(lg.firstSeen)} (${num(lg.giorniOsservati)} gg osservati)</h4>
      ${tl ? `<div class="cost-table">${tl}</div>` : ''}
      ${rip ? `<div class="motiv" style="margin-bottom:10px">${rip}</div>` : ''}`;
    }

    const imgs = [];
    if (a.foto) imgs.push(`<img src="${esc(a.foto)}" alt="Foto annuncio" loading="lazy">`);
    if (a.planimetriaUrl) imgs.push(`<img src="${esc(a.planimetriaUrl)}" alt="Planimetria" loading="lazy">`);
    const imgsHtml = imgs.length ? imgs.join('') : '<div class="ph">Nessuna immagine disponibile</div>';

    const motiv = [];
    if (a.leadAffitto) {
      const sp = a.leadAffitto.statoPrivato;
      const privTxt = sp === 'verificato'
        ? `Privato VERIFICATO il ${esc(a.leadAffitto.verificaPrivato?.data || '?')}${a.leadAffitto.verificaPrivato?.nota ? ' (' + esc(a.leadAffitto.verificaPrivato.nota) + ')' : ''}.`
        : sp === 'da verificare'
        ? '⚠️ Privato DA VERIFICARE caso per caso: il flag è inferito (agenzia assente), non dichiarato — aprire la scheda sul portale e confermare chi pubblica prima di contattare.'
        : 'Privato dichiarato dal portale (campo venditore esplicito).';
      motiv.push(`💬 LEAD PRIVATO (${esc(a.leadAffitto.profilo)}): annuncio di affitto ma in scope con gli altri filtri. ${privTxt} Il privato potrebbe essere interessato a vendere — contatto manuale dal portale d'origine (il canone non è un prezzo di vendita).`);
    }
    if (a.esito === 'Escluso' && a.motivazione) motiv.push(`BIG: ${esc(a.motivazione)}`);
    if (a.esito !== 'Selezionato' && a.esitoSma === 'Escluso' && a.motivazioneSma) motiv.push(`SMA: ${esc(a.motivazioneSma)}`);
    if (a.notaPlanimetria) motiv.push(`Planimetria: ${esc(a.notaPlanimetria)}`);
    if (a.altreCaratteristiche) motiv.push(`Altre caratteristiche: ${esc(a.altreCaratteristiche)}`);
    if (a.dettaglioSuperficie) motiv.push(`Dettaglio superficie: ${esc(a.dettaglioSuperficie)}`);

    return `<td colspan="99"><div class="detail"><div class="detail-grid">
      <div class="detail-imgs">${imgsHtml}<div class="motiv">${esc(a.indirizzo || '')} — ${esc(a.comune || '')}<br>${a.agenzia ? 'Agenzia: ' + esc(a.agenzia) : 'Privato'}<br>Pubblicato: ${esc((a.pubblicatoIl || '').slice(0, 10))} · Aggiornato: ${esc((a.aggiornatoIl || '').slice(0, 10))}</div></div>
      <div>
        <div class="chips">${chips.join('')}</div>
        ${fontiHtml}
        ${poiHtml}
        ${motiv.length ? `<div class="motiv" style="margin-bottom:10px">${motiv.join('<br>')}</div>` : ''}
        ${flipHtml}${staleHtml}${ledgerHtml}
        <h4>Descrizione</h4><div class="desc">${esc(a.descrizione || 'n/d')}</div>
        <a href="${esc(a.url)}" target="_blank" rel="noopener">Apri l'annuncio su ${esc(portalName(a.portale))} ↗</a>
      </div>
    </div></div></td>`;
  }

  // ------------------------------------------------------------- dashboard
  function kpi(v, l, view) { return `<div class="kpi${view ? ' clickable' : ''}" ${view ? `data-view="${view}"` : ''}><div class="v">${v}</div><div class="l">${l}</div></div>`; }
  function mini(a, right, view) { return `<div class="mini-row" data-view="${view}" data-id="${esc(a.id)}"><span class="t">${esc(a.id)} — ${esc(subzona(a.zona) || a.comune)} · ${eur(a.prezzo)}</span><span class="v">${right}</span></div>`; }

  function renderDashboard() {
    const ads = targetAds();
    const flip = flipAds();
    const selBig = flip.filter((a) => a.esito === 'Selezionato');
    const selSma = flip.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato');
    const reno = flip.filter((a) => a.flip?.reno?.candidato).sort((a, b) => b.flip.reno.roi - a.flip.reno.roi);
    const stale = flip.filter((a) => a.flip?.stale).sort((a, b) => b.flip.stale.score - a.flip.stale.score);
    const lead = VIEWS.lead.rows();
    const fuori = rawAds().filter((a) => !isAffitto(a)).length - ads.length;

    let globalBlock = '';
    if (isGlobal()) {
      const g = D.global || {};
      const med = median(ads.map(pmq));
      // Conteggio per portale degli annunci nell'area ammessa (inTarget filtra
      // solo per comune: NON sono i selezionati BIG/SMA).
      const byPortal = {};
      for (const a of ads) for (const f of (a.fonti || [{ portale: a.portale }])) byPortal[f.portale] = (byPortal[f.portale] || 0) + 1;
      const portalRows = Object.entries(byPortal).sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `<div class="mini-row" data-portal="${id}"><span class="t">${esc(portalName(id))}</span><span class="v">${n}</span></div>`).join('');
      const medByComune = ALLOWED.map((c) => {
        const m = median(ads.filter((a) => String(a.comune || '').toLowerCase() === c).map(pmq));
        return `<div class="mini-row"><span class="t">${esc(c)}</span><span class="v">${m != null ? num(m) + ' €/m²' : '—'}</span></div>`;
      }).join('');
      let novitaBlock = '';
      const nv = D.novita;
      if (nv) {
        const ribRows = nv.ribassati.slice(0, 8).map((r) => {
          const a = (g.ads || []).find((x) => x.ledger?.key === r.id);
          const label = a ? `${a.id} — ${subzona(a.zona) || a.comune}` : r.id;
          const pct = r.da ? ((r.a - r.da) / r.da * 100) : null;
          return `<div class="mini-row"${a ? ` data-view="novita" data-id="${esc(a.id)}"` : ''}><span class="t">${esc(label)}</span><span class="v">${eur(r.da)} → ${eur(r.a)}${pct != null ? ` (${num(pct, 1)}%)` : ''}</span></div>`;
        }).join('');
        const sparitiRows = nv.spariti.slice(0, 8).map((s) =>
          `<div class="mini-row"><span class="t">${esc(s.titolo || s.key)} — ${esc(s.zona || s.comune || '')}</span><span class="v">${eur(s.prezzo)} · fino al ${esc(s.lastSeen)}</span></div>`).join('');
        novitaBlock = `
      <div class="kpis">
        ${kpi(nv.nuovi, 'Nuovi dall\'ultimo run', 'novita')}
        ${kpi(nv.ribassati.length, 'Ribassati oggi', 'novita')}
        ${kpi(nv.spariti.length, 'Spariti (probabili vendite)')}
        ${kpi(nv.ripubblicati, 'Ripubblicazioni rilevate')}
        ${kpi(nv.vociTotali, 'Voci in memoria radar')}
      </div>
      ${nv.guardAttivo ? '<div class="card" style="margin-bottom:14px"><div class="motiv">⚠️ Guard attivo: più della metà degli annunci in memoria non è comparsa nell\'ultimo run — probabile portale fuori uso, le sparizioni NON sono state marcate.</div></div>' : ''}
      <div class="dash-grid" style="margin-bottom:14px">
        <div class="card"><h3>Ribassi osservati</h3>${ribRows || '<div class="motiv">Nessun ribasso rilevato</div>'}</div>
        <div class="card"><h3>Spariti dal mercato — probabili vendite</h3>${sparitiRows || '<div class="motiv">Nessuna sparizione recente</div>'}</div>
      </div>`;
      }
      globalBlock = `
      <div class="kpis">
        ${kpi(g.totaleLordo ?? ads.length, 'Annunci lordi (tutti i portali)')}
        ${kpi(g.duplicatiRimossi ?? 0, 'Duplicati rimossi')}
        ${kpi(g.ads?.length ?? rawAds().length, 'Immobili unici (dedup)')}
        ${kpi(g.multiPortale ?? 0, 'Multi-portale', 'multi')}
        ${kpi(med != null ? num(med) : '—', '€/m² mediano area ammessa')}
      </div>
      ${novitaBlock}
      <div class="dash-grid" style="margin-bottom:14px">
        <div class="card"><h3>Annunci area ammessa per portale</h3>${portalRows || '<div class="motiv">Nessun dato</div>'}</div>
        <div class="card"><h3>€/m² mediano per comune</h3>${medByComune}</div>
      </div>`;
    }

    $('#dashboard').innerHTML = `
      ${globalBlock}
      <div class="kpis">
        ${kpi(ads.length, `Annunci target (+${fuori} fuori comune)`, 'tutti')}
        ${kpi(selBig.length, 'Selezionati BIG', 'big')}
        ${kpi(selSma.length, 'Selezionati SMA', 'sma')}
        ${kpi(reno.length, 'Candidati FLIP RENO', 'reno')}
        ${kpi(reno.filter((a) => a.flip.reno.semaforo !== 'rosso').length, 'RENO verdi/gialli', 'reno')}
        ${kpi(stale.filter((a) => a.flip.stale.score >= 60).length, 'STALE negoziabilità alta', 'stale')}
        ${lead.length ? kpi(lead.length, 'Lead privati (affitti in scope)', 'lead') : ''}
      </div>
      <div class="dash-grid">
        <div class="card"><h3>Migliori FLIP RENO (ROI netto)</h3>
          ${reno.slice(0, 6).map((a) => mini(a, `${num(a.flip.reno.roi, 1)}% · offerta max ${eur(a.flip.reno.maxOffer)}`, 'reno')).join('') || '<div class="motiv">Nessun candidato</div>'}
        </div>
        <div class="card"><h3>Più negoziabili (FLIP STALE)</h3>
          ${stale.slice(0, 6).map((a) => mini(a, `score ${num(a.flip.stale.score)} · target ${eur(a.flip.stale.prezzoTarget)}`, 'stale')).join('') || '<div class="motiv">Nessun dato</div>'}
        </div>
      </div>`;
    $('#dashboard').querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => {
      state.view = el.dataset.view;
      state.sortKey = null;
      state.chatFilter = null; state.chatRank = null;
      state.expanded = el.dataset.id || null;
      render();
    }));
    $('#dashboard').querySelectorAll('[data-portal]').forEach((el) => el.addEventListener('click', () => {
      state.portal = el.dataset.portal;
      state.view = 'dashboard';
      state.sortKey = null; state.expanded = null;
      render();
    }));
  }

  // ------------------------------------------------------------- pagine informative
  function renderInfo() {
    $('#view-title').textContent = state.portal === 'aste' ? 'Aste & NPL' : 'Portali differiti';
    $('#dashboard').classList.add('hidden');
    $('#table-wrap').classList.add('hidden');
    document.querySelector('.controls').classList.add('hidden');
    let sec = $('#info-section');
    if (!sec) {
      sec = document.createElement('section');
      sec.id = 'info-section';
      document.querySelector('.main').appendChild(sec);
    }
    sec.classList.remove('hidden');
    if (state.portal === 'aste') {
      // intesasanpaolo escluso: la ricognizione ha accertato che è vendita diretta
      // di patrimonio dismesso, non aste giudiziarie (resta nei Differiti).
      const aste = (D.deferred || []).filter((d) => ['prelios', 'agenziademanio', 'invimit', 'dovalue'].includes(d.id));
      sec.innerHTML = `<div class="card" style="max-width:900px">
        <h3>🔨 Aste giudiziarie &amp; NPL — sezione informativa</h3>
        <p class="motiv" style="margin-bottom:12px">Le aste e i crediti deteriorati (NPL) sono un filone distinto dal flip BIG/SMA: richiedono lettura delle perizie, cauzione, rilanci e tempi giudiziari. Non sono ancora scraping automatizzato: i portali seguenti sono censiti come fonti da esplorare in un round dedicato.</p>
        ${aste.map((d) => `<div class="mini-row"><span class="t">${esc(d.name)}</span><span class="v" style="font-weight:400;color:var(--muted);max-width:560px;white-space:normal;text-align:right">${esc(d.motivo)}</span></div>`).join('')}
        <p class="motiv" style="margin-top:12px">Criteri flip applicabili alle aste: sconto sul valore di perizia, assenza di occupanti, costi di liberazione, ROI netto dopo ristrutturazione. Da parametrizzare in un flip-config dedicato.</p>
      </div>`;
    } else {
      const rows = (D.deferred || []).map((d) => `<div class="mini-row"><span class="t">${esc(d.name)}</span><span class="v" style="font-weight:400;color:var(--muted);max-width:620px;white-space:normal;text-align:right">${esc(d.motivo)}</span></div>`).join('');
      sec.innerHTML = `<div class="card" style="max-width:960px">
        <h3>⏸ Portali differiti</h3>
        <p class="motiv" style="margin-bottom:12px">Portali censiti ma non ancora integrati nello scraping automatico. Motivazioni registrate in DECISIONI.md (correggibili). Alcuni sono alias di portali già coperti, altri richiedono login o sono bloccati da WAF.</p>
        ${rows}
      </div>`;
    }
  }

  // ------------------------------------------------------------- render
  function render() {
    renderNav();
    const infoSec = $('#info-section');
    if (state.view === 'info') { renderInfo(); return; }
    if (infoSec) infoSec.classList.add('hidden');
    const v = VIEWS[state.view];
    $('#view-title').textContent = (isGlobal() ? 'GLOBAL · ' : portalName(state.portal) + ' · ') + v.title;
    const isDash = state.view === 'dashboard';
    $('#dashboard').classList.toggle('hidden', !isDash);
    $('#table-wrap').classList.toggle('hidden', isDash);
    document.querySelector('.controls').classList.toggle('hidden', isDash);
    if (isDash) { renderDashboard(); return; }

    const ads = v.rows();
    fillSelect($('#f-zona'), [...new Set(ads.map((a) => subzona(a.zona)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')), true);
    fillSelect($('#f-stato'), [...new Set(ads.map((a) => a.stato || 'n/d'))].sort((a, b) => a.localeCompare(b, 'it')), true);
    const fe = $('#f-extra');
    if (v.extra) {
      fe.classList.remove('hidden');
      const cur = fe.value;
      fe.innerHTML = `<option value="">${esc(v.extra.label)}: tutti</option>` +
        v.extra.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
      fe.value = v.extra.options.includes(cur) ? cur : '';
    } else {
      fe.classList.add('hidden');
      fe.value = '';
    }

    const rows = currentRows();
    const cols = v.cols();
    const sortKey = state.chatRank ? null : (state.sortKey || v.sortKey);
    const sortDir = state.sortKey ? state.sortDir : (v.sortDir || 1);
    const chatNote = state.chatFilter ? ' · 💬 filtro chat attivo (cambia vista per azzerarlo)' : '';
    $('#count').textContent = `${rows.length} annunci${rows.length !== ads.length ? ` (filtrati da ${ads.length})` : ''}${chatNote} — clic su una riga per il dettaglio, clic sulle intestazioni per ordinare`
      + (state.view === 'lead' ? ' · 💬 Affitti da privato in scope BIG/SMA: verificare CASO PER CASO chi pubblica (badge Privato), poi contattare MANUALMENTE dal portale per chiedere interesse alla vendita. Il canone non è un prezzo di vendita.' : '');
    $('#tbl thead').innerHTML = '<tr>' + cols.map((c) =>
      `<th data-key="${c.key}">${esc(c.label)}${c.key === sortKey ? ` <span class="arrow">${sortDir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('') + '</tr>';
    const tb = $('#tbl tbody');
    tb.innerHTML = '';
    for (const a of rows) {
      const tr = document.createElement('tr');
      tr.className = 'row';
      tr.innerHTML = cols.map((c) => `<td class="${c.numeric ? 'num' : ''}">${c.render(a)}</td>`).join('');
      tr.addEventListener('click', () => {
        state.expanded = state.expanded === a.id ? null : a.id;
        render();
      });
      tb.appendChild(tr);
      if (state.expanded === a.id) {
        const dtr = document.createElement('tr');
        dtr.className = 'detail';
        dtr.innerHTML = detailHtml(a);
        tb.appendChild(dtr);
      }
    }
    $('#tbl thead').querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.key;
      if (state.sortKey === k || (!state.sortKey && k === v.sortKey)) {
        state.sortDir = (state.sortKey ? state.sortDir : (v.sortDir || 1)) * -1;
      } else {
        state.sortDir = 1;
      }
      state.sortKey = k;
      render();
    }));
  }

  // ------------------------------------------------------------- export CSV
  function exportCsv() {
    const v = VIEWS[state.view];
    if (!v || !v.rows) return;
    const rows = currentRows();
    const cols = v.cols();
    const cell = (x) => {
      const s = String(x ?? '');
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [
      [...cols.map((c) => c.label), 'Portale', 'Link annuncio'].map(cell).join(';'),
      ...rows.map((a) => [...cols.map((c) => c.sortVal(a)), portalName(a.portale), a.url].map(cell).join(';')),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `radar-${state.portal}-${state.view}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }
  $('#btn-csv').addEventListener('click', exportCsv);

  $('#q').addEventListener('input', () => render());
  for (const id of ['#f-zona', '#f-stato', '#f-extra']) $(id).addEventListener('change', () => render());

  // ------------------------------------------------------------- drawer mobile
  function closeNav() {
    document.body.classList.remove('nav-open');
    const t = $('#nav-toggle');
    if (t) t.setAttribute('aria-expanded', 'false');
  }
  const navToggle = $('#nav-toggle');
  if (navToggle) navToggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  const backdrop = $('#nav-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeNav);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Esc con richiesta in corso: prima ferma la richiesta, non chiude il pannello.
    if (chat.busy && chat.ctrl) { chat.ctrl.abort(); return; }
    closeNav(); closeChat();
  });

  // ------------------------------------------------------------- chat assistente
  // Progressive enhancement: funziona solo se il sito è servito da
  // chat-server.mjs (npm run chat). Via file:// o server assente il pannello
  // spiega come attivarla; il resto del sito non dipende dalla chat.
  // Predicate allineato a core/chat-actions.mjs (matchFilter): stessa semantica.
  function chatMatch(a, f) {
    if (f.comune && String(a.comune || '').toLowerCase() !== f.comune.toLowerCase()) return false;
    if (f.zona && !String(a.zona || '').toLowerCase().includes(f.zona.toLowerCase())) return false;
    if (f.prezzoMax != null && !(a.prezzo != null && a.prezzo <= f.prezzoMax)) return false;
    if (f.prezzoMin != null && !(a.prezzo != null && a.prezzo >= f.prezzoMin)) return false;
    if (f.mqMin != null && !(a.superficieMq != null && a.superficieMq >= f.mqMin)) return false;
    if (f.mqMax != null && !(a.superficieMq != null && a.superficieMq <= f.mqMax)) return false;
    if (f.camereMin != null) { const c = a.camere ?? a.camereAI; if (!(c != null && c >= f.camereMin)) return false; }
    if (f.stato && !String(a.stato || '').toLowerCase().includes(f.stato.toLowerCase())) return false;
    if (f.ascensore && !String(a.ascensore || '').toLowerCase().includes(f.ascensore.toLowerCase())) return false;
    if (f.distanzaMaxKm != null && !(a.distanzaKm != null && a.distanzaKm <= f.distanzaMaxKm)) return false;
    if (f.poiMin != null && !(a.poi?.rank != null && a.poi.rank >= f.poiMin)) return false;
    if (f.profilo === 'BIG' && a.esito !== 'Selezionato') return false;
    if (f.profilo === 'SMA' && !(a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato')) return false;
    if (f.profilo === 'RENO' && !a.flip?.reno?.candidato) return false;
    if (f.profilo === 'STALE' && !(a.flip?.stale && a.flip.stale.fascia !== 'Basso')) return false;
    if (f.testo) {
      const hay = `${a.titolo || ''} ${a.descrizione || ''} ${a.zona || ''} ${a.indirizzo || ''} ${a.agenzia || ''}`.toLowerCase();
      if (!f.testo.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  const chat = { status: null, history: [], lastResult: null, busy: false };
  try {
    const saved = JSON.parse(sessionStorage.getItem('radar-chat') || 'null');
    if (saved && Array.isArray(saved.history)) { chat.history = saved.history.slice(-12); chat.lastResult = saved.lastResult || null; }
  } catch { /* sessione nuova */ }
  const saveChat = () => {
    try { sessionStorage.setItem('radar-chat', JSON.stringify({ history: chat.history.slice(-12), lastResult: chat.lastResult })); } catch { /* quota */ }
  };

  function chatMsg(cls, text) {
    const div = document.createElement('div');
    div.className = `chat-msg ${cls}`;
    div.textContent = text;
    $('#chat-log').appendChild(div);
    $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
    return div;
  }

  function chatCard(r) {
    const div = document.createElement('div');
    div.className = 'chat-card';
    const badges = [];
    if (r.roi != null) badges.push(badge(`ROI ${num(r.roi, 1)}%`, r.semaforo || 'info'));
    if (r.staleScore != null) badges.push(badge(`STALE ${r.staleScore}`, r.staleFascia || 'info'));
    if (r.nuovo) badges.push(badge('NUOVO', 'verde'));
    if (r.ribassatoOggi) badges.push(badge('RIBASSATO', 'giallo'));
    div.innerHTML = `<div class="t"><span>${esc(r.zona || r.comune)} — ${esc(shortId(r.id))}</span><span class="p">${eur(r.prezzo)}</span></div>
      <div class="d">${num(r.mq)} m² · ${r.camere != null ? num(r.camere) + ' camere · ' : ''}${esc(r.stato || 'stato n/d')}${r.pmq != null ? ' · ' + num(r.pmq) + ' €/m²' : ''}</div>
      ${badges.length ? `<div class="m">${badges.join(' ')}</div>` : ''}`;
    div.title = 'Apri il dettaglio nella tabella';
    div.addEventListener('click', () => openAdInTable(r.id));
    return div;
  }

  function openAdInTable(id) {
    const a = (D.global?.ads || []).find((x) => String(x.id) === String(id));
    if (!a) return;
    state.portal = 'global';
    state.view = 'tutti';
    state.chatFilter = null; state.chatRank = null;
    state.sortKey = null;
    state.expanded = String(id);
    $('#q').value = String(id);
    render();
    if (window.innerWidth <= 760) closeChat();
    const row = [...document.querySelectorAll('#tbl tbody tr.row')].find((tr) => tr.textContent.includes(shortId(id)));
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // Applica l'azione del server anche alla tabella (oltre che in chat).
  function applyChatAction(res) {
    if (res.action === 'filter' && res.filtro) {
      state.portal = 'global';
      state.view = 'tutti';
      state.sortKey = null;
      state.expanded = null;
      state.chatRank = null;
      state.chatFilter = res.filtro;
      $('#q').value = '';
      render();
    } else if (res.action === 'rank' && res.rows?.length) {
      state.portal = 'global';
      state.view = 'tutti';
      state.expanded = null;
      state.sortKey = null;
      state.chatFilter = res.filtro && Object.keys(res.filtro).length ? res.filtro : null;
      // Ordine della classifica per id; currentRows lo rispetta finché attivo.
      state.chatRank = new Map(res.rows.map((r, i) => [String(r.id), i]));
      $('#q').value = '';
      render();
    }
  }

  function renderChatResult(res) {
    const label = res.action === 'filter' ? 'Filtro' : res.action === 'rank' ? `Classifica (${res.criterio})` : res.action === 'compare' ? 'Confronto' : 'Annunci';
    if (res.action !== 'clarify' && res.action !== 'answer') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-action';
      btn.textContent = `⚡ ${label} applicato alla tabella — ${res.totale} risultat${res.totale === 1 ? 'o' : 'i'}`;
      btn.addEventListener('click', () => applyChatAction(res));
      $('#chat-log').appendChild(btn);
    }
    if (res.commento) chatMsg('bot', res.commento);
    if (res.rows?.length) {
      const wrap = document.createElement('div');
      wrap.className = 'chat-cards';
      for (const r of res.rows.slice(0, 10)) wrap.appendChild(chatCard(r));
      if (res.totale > 10) {
        const more = document.createElement('button');
        more.type = 'button'; more.className = 'chat-action';
        more.textContent = `… altri ${res.totale - 10}: apri la tabella`;
        more.addEventListener('click', () => applyChatAction(res));
        wrap.appendChild(more);
      }
      $('#chat-log').appendChild(wrap);
    }
    if (res.missing?.length) chatMsg('err', `ID non trovati tra i candidati: ${res.missing.join(', ')}`);
    $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
  }

  // Durante l'attesa il bottone invio diventa STOP (■): abort della richiesta.
  function setChatBusy(busy) {
    chat.busy = busy;
    const btn = $('#chat-send');
    btn.disabled = false;
    btn.textContent = busy ? '■' : '➤';
    btn.classList.toggle('stop', busy);
    btn.setAttribute('aria-label', busy ? 'Ferma la richiesta' : 'Invia');
    btn.title = busy ? 'Ferma la richiesta in corso' : '';
  }

  async function sendChat(text) {
    if (chat.busy || !text.trim()) return;
    if (!chat.status?.enabled) { chatMsg('err', 'Chat non attiva: avvia il server con «npm run chat» e apri http://localhost:8787.'); return; }
    setChatBusy(true);
    chat.ctrl = new AbortController();
    $('#chat-chips').innerHTML = '';
    chatMsg('user', text);
    chat.history.push({ role: 'user', content: text });
    const wait = chatMsg('bot wait', 'Sto cercando… (■ per fermare)');
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chat.history.slice(-12), lastResult: chat.lastResult }),
        signal: chat.ctrl.signal,
      });
      const res = await resp.json();
      wait.remove();
      if (!resp.ok) {
        chatMsg('err', res.error || `Errore ${resp.status}`);
      } else {
        renderChatResult(res);
        chat.history.push({ role: 'assistant', content: res.commento || '' });
        chat.lastResult = { action: res.action, filtro: res.filtro, criterio: res.criterio, totale: res.totale, rows: (res.rows || []).slice(0, 12) };
        if (res.action === 'filter' || (res.action === 'rank' && res.rows?.length)) applyChatAction(res);
        saveChat();
      }
    } catch (e) {
      wait.remove();
      if (e.name === 'AbortError') {
        // Stop dell'utente: la domanda resta in history ma senza risposta;
        // la rimuovo per non confondere il turno successivo del modello.
        chat.history.pop();
        chatMsg('bot wait', '⏹ Richiesta fermata.');
      } else {
        chatMsg('err', `Server chat non raggiungibile: ${e.message}. Avvia «npm run chat».`);
      }
    } finally {
      chat.ctrl = null;
      setChatBusy(false);
      $('#chat-input').focus();
    }
  }

  function openChat() {
    document.body.classList.add('chat-open');
    $('#btn-chat').classList.add('active');
    $('#btn-chat').setAttribute('aria-expanded', 'true');
    $('#chat-input').focus();
  }
  function closeChat() {
    document.body.classList.remove('chat-open');
    $('#btn-chat').classList.remove('active');
    $('#btn-chat').setAttribute('aria-expanded', 'false');
  }
  // Ridimensionamento col trascinamento del bordo sinistro (persistito).
  const CHAT_MIN_W = 300;
  const chatMaxW = () => Math.round(window.innerWidth * 0.94);
  const setChatWidth = (px, save) => {
    const w = Math.min(chatMaxW(), Math.max(CHAT_MIN_W, Math.round(px)));
    $('#chat-panel').style.setProperty('--chat-w', w + 'px');
    if (save) { try { localStorage.setItem('radar-chat-w', String(w)); } catch { /* quota */ } }
    return w;
  };
  try {
    const savedW = parseInt(localStorage.getItem('radar-chat-w'), 10);
    if (savedW) setChatWidth(savedW, false);
  } catch { /* storage assente */ }
  const resizer = $('#chat-resizer');
  let dragStartX = 0, dragStartW = 0;
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragStartX = e.clientX;
    dragStartW = $('#chat-panel').getBoundingClientRect().width;
    document.body.classList.add('chat-resizing');
    resizer.setPointerCapture(e.pointerId);
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!document.body.classList.contains('chat-resizing')) return;
    setChatWidth(dragStartW + (dragStartX - e.clientX), false);
  });
  const endDrag = (e) => {
    if (!document.body.classList.contains('chat-resizing')) return;
    document.body.classList.remove('chat-resizing');
    try { resizer.releasePointerCapture(e.pointerId); } catch { /* già rilasciato */ }
    setChatWidth($('#chat-panel').getBoundingClientRect().width, true);
  };
  resizer.addEventListener('pointerup', endDrag);
  resizer.addEventListener('pointercancel', endDrag);
  resizer.addEventListener('dblclick', () => setChatWidth(380, true));
  // Accessibilità: frecce quando il separatore ha il focus (passo 20px).
  resizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const w = $('#chat-panel').getBoundingClientRect().width;
    setChatWidth(w + (e.key === 'ArrowLeft' ? 20 : -20), true);
  });
  window.addEventListener('resize', () => {
    const w = $('#chat-panel').getBoundingClientRect().width;
    if (w > chatMaxW()) setChatWidth(chatMaxW(), false);
  });

  $('#btn-chat').addEventListener('click', () => document.body.classList.contains('chat-open') ? closeChat() : openChat());
  $('#chat-close').addEventListener('click', closeChat);
  $('#chat-backdrop').addEventListener('click', closeChat);
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (chat.busy) { if (chat.ctrl) chat.ctrl.abort(); return; }
    const v = $('#chat-input').value.trim();
    $('#chat-input').value = '';
    sendChat(v);
  });

  async function initChat() {
    const chips = ['I 5 migliori per ROI', 'Trilocali a San Lazzaro sotto 130k', 'I più negoziabili', 'Novità di oggi'];
    try {
      const resp = await fetch('/api/chat/status');
      chat.status = await resp.json();
    } catch { chat.status = { enabled: false }; }
    if (chat.status.enabled) {
      $('#chat-model').textContent = `${chat.status.provider} · ${chat.status.model}`;
      if (!chat.history.length) {
        chatMsg('bot', 'Ciao! Cerca tra i candidati del radar in linguaggio naturale: filtri, classifiche, confronti e domande sugli annunci. I risultati si applicano anche alla tabella.');
      } else {
        for (const m of chat.history) chatMsg(m.role === 'user' ? 'user' : 'bot', m.content);
      }
      $('#chat-chips').innerHTML = chips.map((c) => `<button type="button">${esc(c)}</button>`).join('');
      $('#chat-chips').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => sendChat(b.textContent)));
    } else {
      $('#chat-model').textContent = 'non attiva';
      const why = chat.status?.datiOk === false ? 'Dati del sito mancanti: esegui «node build-site.mjs».'
        : chat.status?.provider ? `LLM non configurato (${chat.status.provider}): vedi ai-config.json / core/ai-config.mjs.`
        : 'Il sito è aperto come file statico o il server chat non è attivo.';
      chatMsg('bot', `La chat richiede il server locale.\n\n${why}\n\n1. Avvia: npm run chat\n2. Apri: http://localhost:8787\n\nIl resto del sito funziona normalmente anche senza chat.`);
      $('#chat-input').disabled = true;
      $('#chat-send').disabled = true;
    }
  }
  initChat();

  render();
})();