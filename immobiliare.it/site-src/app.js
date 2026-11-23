/* Radar Immobiliare — UI statica (vanilla JS, nessun server). */
(function () {
  'use strict';
  const D = window.RADAR_DATA;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ALLOWED = ['bologna', 'pianoro', 'san lazzaro di savena'];
  const eur = (n) => (n == null || n === '' || isNaN(n)) ? '' : Number(n).toLocaleString('it-IT') + ' €';
  const num = (n, d = 0) => (n == null || n === '' || isNaN(n)) ? '' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: d });
  const pmq = (a) => {
    if (typeof a.prezzoMq === 'number') return a.prezzoMq;
    const m = String(a.prezzoMq || '').replace(/\./g, '').match(/(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const badge = (txt, cls) => `<span class="badge ${esc(cls || txt)}">${esc(txt)}</span>`;
  const subzona = (z) => String(z || '').split('/').pop().trim();

  if (!D) {
    $('#table-wrap').innerHTML = '<p>Dati mancanti: esegui <code>node build-site.mjs</code>.</p>';
    return;
  }

  const state = { portal: 'immobiliare', view: 'dashboard', sortKey: null, sortDir: 1, expanded: null };

  const portalAds = () => (D.portals.find((p) => p.id === state.portal)?.ads) || [];
  const targetAds = () => portalAds().filter((a) => ALLOWED.includes(String(a.comune || '').trim().toLowerCase()));

  // ------------------------------------------------------------- viste
  const VIEWS = {
    dashboard: { title: 'Dashboard' },
    big: {
      title: 'BIG — ≤160k, ≥2 camere',
      rows: () => targetAds(),
      sortKey: 'pmq', sortDir: 1,
      extra: { label: 'Esito BIG', get: (a) => a.esito, options: ['Selezionato', 'Escluso'] },
      cols: () => [
        col('esito', 'Esito BIG', (a) => badge(a.esito, a.esito), (a) => a.esito),
        ...baseCols(),
        col('rankPoi', 'Rank POI', (a) => a.esito === 'Selezionato' ? num(a.poi?.rank) : '', (a) => a.esito === 'Selezionato' ? a.poi?.rank : null, true),
        col('motivazione', 'Motivazione', (a) => esc(a.motivazione), (a) => a.motivazione),
      ],
    },
    sma: {
      title: 'SMA — ≤130k, 1 camera',
      rows: () => targetAds().filter((a) => a.esito !== 'Selezionato'),
      sortKey: 'pmq', sortDir: 1,
      extra: { label: 'Esito SMA', get: (a) => a.esitoSma, options: ['Selezionato', 'Escluso'] },
      cols: () => [
        col('esitoSma', 'Esito SMA', (a) => badge(a.esitoSma, a.esitoSma), (a) => a.esitoSma),
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
        ...baseCols(),
        col('prezzoTarget', 'Prezzo target', (a) => eur(a.flip.stale.prezzoTarget), (a) => a.flip.stale.prezzoTarget, true),
        col('candReno', 'RENO', (a) => a.flip.reno?.candidato ? badge(num(a.flip.reno.roi, 1) + '%', a.flip.reno.semaforo) : '—', (a) => a.flip.reno?.candidato ? a.flip.reno.roi : null, true),
      ],
    },
    tutti: {
      title: 'Tutti gli annunci target',
      rows: () => targetAds(),
      sortKey: 'pmq', sortDir: 1,
      cols: () => [
        col('esito', 'BIG', (a) => badge(a.esito, a.esito), (a) => a.esito),
        col('esitoSma', 'SMA', (a) => a.esito === 'Selezionato' ? '—' : badge(a.esitoSma, a.esitoSma), (a) => a.esitoSma),
        ...baseCols(),
        col('reno', 'RENO', (a) => a.flip?.reno?.candidato ? badge(num(a.flip.reno.roi, 1) + '%', a.flip.reno.semaforo) : '—', (a) => a.flip?.reno?.candidato ? a.flip.reno.roi : null, true),
        col('stale', 'STALE', (a) => a.flip?.stale ? badge(String(a.flip.stale.score), a.flip.stale.fascia) : '—', (a) => a.flip?.stale?.score, true),
      ],
    },
  };

  function col(key, label, render, sortVal, numeric) { return { key, label, render, sortVal, numeric }; }
  function baseCols() {
    return [
      col('id', 'Annuncio', (a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(a.id)}</a>`, (a) => a.id),
      col('titolo', 'Titolo', (a) => esc(a.titolo), (a) => a.titolo),
      col('zona', 'Zona', (a) => esc(subzona(a.zona) || a.zona), (a) => subzona(a.zona)),
      col('prezzo', 'Prezzo', (a) => eur(a.prezzo), (a) => a.prezzo, true),
      col('pmq', '€/m²', (a) => num(pmq(a)), (a) => pmq(a), true),
      col('mq', 'm²', (a) => num(a.superficieMq), (a) => a.superficieMq, true),
      col('camere', 'Camere', (a) => num(a.camere), (a) => a.camere, true),
      col('stato', 'Stato', (a) => esc(a.stato), (a) => a.stato),
      col('piano', 'Piano', (a) => esc(a.pianoSolo ?? a.piano), (a) => a.pianoSolo ?? a.piano),
    ];
  }

  // ------------------------------------------------------------- sidebar
  function renderNav() {
    const nav = $('#portal-nav');
    nav.innerHTML = '';
    for (const p of D.portals) {
      const div = document.createElement('div');
      div.className = 'portal' + (p.active ? '' : ' disabled');
      const counts = { dashboard: '', big: '', sma: '', reno: '', stale: '', tutti: '' };
      if (p.active) {
        const saved = state.portal; state.portal = p.id;
        counts.big = VIEWS.big.rows().length;
        counts.sma = VIEWS.sma.rows().length;
        counts.reno = VIEWS.reno.rows().length;
        counts.stale = VIEWS.stale.rows().length;
        counts.tutti = VIEWS.tutti.rows().length;
        state.portal = saved;
      }
      let html = `<div class="portal-name">${esc(p.name)}${p.active ? '' : '<span class="soon">in arrivo</span>'}</div>`;
      if (p.active) {
        for (const [id, v] of Object.entries(VIEWS)) {
          const label = { dashboard: 'Dashboard', big: 'BIG', sma: 'SMA', reno: 'FLIP RENO', stale: 'FLIP STALE', tutti: 'Tutti' }[id];
          html += `<button class="nav-item${state.portal === p.id && state.view === id ? ' active' : ''}" data-portal="${p.id}" data-view="${id}">${label}${counts[id] !== '' ? `<span class="n">${counts[id]}</span>` : ''}</button>`;
        }
      }
      div.innerHTML = html;
      nav.appendChild(div);
    }
    nav.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => {
      state.portal = b.dataset.portal;
      state.view = b.dataset.view;
      state.sortKey = null; state.expanded = null;
      $('#q').value = '';
      render();
    }));
    const d = new Date(D.generatedAt);
    $('#meta').innerHTML = `Dati: ${esc(D.source)}<br>Generato: ${d.toLocaleString('it-IT')}`;
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
    if (!v.rows) return [];
    let rows = v.rows();
    const q = $('#q').value.trim().toLowerCase();
    if (q) rows = rows.filter((a) => [a.id, a.titolo, a.zona, a.comune, a.agenzia, a.indirizzo].join(' ').toLowerCase().includes(q));
    const fz = $('#f-zona').value;
    if (fz) rows = rows.filter((a) => subzona(a.zona) === fz);
    const fs = $('#f-stato').value;
    if (fs) rows = rows.filter((a) => (a.stato || 'n/d') === fs);
    const fe = $('#f-extra');
    if (v.extra && !fe.classList.contains('hidden') && fe.value) rows = rows.filter((a) => v.extra.get(a) === fe.value);
    const key = state.sortKey || v.sortKey;
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
    if (a.distanzaKm != null) chips.push(`<span class="badge info">dal centro: ${num(a.distanzaKm, 1)} km (${esc(a.centroVicino || '')})</span>`);
    if (a.poi?.rank != null) chips.push(`<span class="badge info">POI: ${num(a.poi.rank)} — ${esc(a.poi.etichetta || '')}</span>`);
    if (a.speseCondominio) chips.push(`<span class="badge info">condominio: ${esc(a.speseCondominio)}</span>`);

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
      staleHtml = `<h4>FLIP STALE — ${badge(s.fascia, s.fascia)} score ${num(s.score)}/100</h4>
      <div class="motiv" style="margin-bottom:10px">Online da ${num(s.giorniOnline)} giorni (${num(s.puntiGiorni)} pt) · ribassi: ${s.ribassi || 0} (${num(s.puntiRibassi)} pt) · keyword: ${esc((s.keyword || []).join(', ') || 'nessuna')} (${num(s.puntiKeyword)} pt)<br>Prezzo target suggerito: <strong>${eur(s.prezzoTarget)}</strong></div>`;
    }

    const imgs = [];
    if (a.foto) imgs.push(`<img src="${esc(a.foto)}" alt="Foto annuncio" loading="lazy">`);
    if (a.planimetriaUrl) imgs.push(`<img src="${esc(a.planimetriaUrl)}" alt="Planimetria" loading="lazy">`);
    const imgsHtml = imgs.length ? imgs.join('') : '<div class="ph">Nessuna immagine disponibile</div>';

    const motiv = [];
    if (a.esito === 'Escluso' && a.motivazione) motiv.push(`BIG: ${esc(a.motivazione)}`);
    if (a.esito !== 'Selezionato' && a.esitoSma === 'Escluso' && a.motivazioneSma) motiv.push(`SMA: ${esc(a.motivazioneSma)}`);
    if (a.notaPlanimetria) motiv.push(`Planimetria: ${esc(a.notaPlanimetria)}`);
    if (a.altreCaratteristiche) motiv.push(`Altre caratteristiche: ${esc(a.altreCaratteristiche)}`);
    if (a.dettaglioSuperficie) motiv.push(`Dettaglio superficie: ${esc(a.dettaglioSuperficie)}`);

    return `<td colspan="99"><div class="detail"><div class="detail-grid">
      <div class="detail-imgs">${imgsHtml}<div class="motiv">${esc(a.indirizzo || '')} — ${esc(a.comune || '')}<br>${a.agenzia ? 'Agenzia: ' + esc(a.agenzia) : 'Privato'}<br>Pubblicato: ${esc((a.pubblicatoIl || '').slice(0, 10))} · Aggiornato: ${esc((a.aggiornatoIl || '').slice(0, 10))}</div></div>
      <div>
        <div class="chips">${chips.join('')}</div>
        ${poiHtml}
        ${motiv.length ? `<div class="motiv" style="margin-bottom:10px">${motiv.join('<br>')}</div>` : ''}
        ${flipHtml}${staleHtml}
        <h4>Descrizione</h4><div class="desc">${esc(a.descrizione || 'n/d')}</div>
        <a href="${esc(a.url)}" target="_blank" rel="noopener">Apri l'annuncio su Immobiliare.it ↗</a>
      </div>
    </div></div></td>`;
  }

  // ------------------------------------------------------------- dashboard
  function renderDashboard() {
    const ads = targetAds();
    const selBig = ads.filter((a) => a.esito === 'Selezionato');
    const selSma = ads.filter((a) => a.esito !== 'Selezionato' && a.esitoSma === 'Selezionato');
    const reno = ads.filter((a) => a.flip?.reno?.candidato).sort((a, b) => b.flip.reno.roi - a.flip.reno.roi);
    const stale = ads.filter((a) => a.flip?.stale).sort((a, b) => b.flip.stale.score - a.flip.stale.score);
    const fuori = portalAds().length - ads.length;
    const kpi = (v, l, view) => `<div class="kpi${view ? ' clickable' : ''}" ${view ? `data-view="${view}"` : ''}><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const mini = (a, right, view) => `<div class="mini-row" data-view="${view}" data-id="${esc(a.id)}"><span class="t">${esc(a.id)} — ${esc(subzona(a.zona) || a.comune)} · ${eur(a.prezzo)}</span><span class="v">${right}</span></div>`;
    $('#dashboard').innerHTML = `
      <div class="kpis">
        ${kpi(ads.length, `Annunci target (+${fuori} fuori comune)`, 'tutti')}
        ${kpi(selBig.length, 'Selezionati BIG', 'big')}
        ${kpi(selSma.length, 'Selezionati SMA', 'sma')}
        ${kpi(reno.length, 'Candidati FLIP RENO', 'reno')}
        ${kpi(reno.filter((a) => a.flip.reno.semaforo !== 'rosso').length, 'RENO verdi/gialli', 'reno')}
        ${kpi(stale.filter((a) => a.flip.stale.score >= 60).length, 'STALE negoziabilità alta', 'stale')}
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
      state.expanded = el.dataset.id || null;
      render();
    }));
  }

  // ------------------------------------------------------------- render
  function render() {
    renderNav();
    const v = VIEWS[state.view];
    $('#view-title').textContent = v.title;
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
    const sortKey = state.sortKey || v.sortKey;
    const sortDir = state.sortKey ? state.sortDir : (v.sortDir || 1);
    $('#count').textContent = `${rows.length} annunci${rows.length !== ads.length ? ` (filtrati da ${ads.length})` : ''} — clic su una riga per il dettaglio, clic sulle intestazioni per ordinare`;
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
  // Esporta la vista corrente (righe filtrate e ordinate) con le colonne
  // visibili + link annuncio. Separatore ";" e BOM per Excel/LibreOffice.
  function exportCsv() {
    const v = VIEWS[state.view];
    if (!v.rows) return;
    const rows = currentRows();
    const cols = v.cols();
    const cell = (x) => {
      const s = String(x ?? '');
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [
      [...cols.map((c) => c.label), 'Link annuncio'].map(cell).join(';'),
      ...rows.map((a) => [...cols.map((c) => c.sortVal(a)), a.url].map(cell).join(';')),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `radar-${state.view}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }
  $('#btn-csv').addEventListener('click', exportCsv);

  $('#q').addEventListener('input', () => render());
  for (const id of ['#f-zona', '#f-stato', '#f-extra']) $(id).addEventListener('change', () => render());
  render();
})();