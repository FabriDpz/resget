// Adattatore immobiliarecavallo.it — WP + RealEstateManager cloud, Playwright headed.
// ⚠️ Ricerca SOLO POST (GET ignorato). Flusso verificato 22/11:
// 1) GET /ricerca/ (cookie/sessione, ritmo D4)
// 2) context.request.post('/ricerca/?do=1', {form}) con i campi del form
//    id=realestate_search: nature_property=F, contract_property=R,
//    relation_property=V, int_property=118, reg_property=8, prov_property=37,
//    com_property=37006 (Bologna) / 37047 (Pianoro) / 37054 (San Lazzaro),
//    public_price=160000, lower_price=0, categoria_rem=1 (Appartamento) / 2 (Casa indipendente).
//    (Il form UI ha select comuni popolati via AJAX srpc_switcher.php e il fill
//    Playwright è risultato fragile: la POST form-encoded è la risposta legittima
//    del sito alla nostra ricerca, fallback documentato e adottato.)
// 3) parsing HTML risposta con page temporanea (context.newPage + setContent).
// Card risultato: div.rem_block.ext → a[href*="/focus/<id>/<slug>"],
// span.entry_item (prezzo '€ 133000', '42mq'), testo 'Bologna (BO)', badge 'Venduto'.
// Il server filtra prezzo ma NON mq → mq client-side. Scarto Venduto e fuori comune.
// Dettaglio /focus/<id>/<slug>: tabella td span.entry_desc/entry_item
// (Riferimento, Località, Prezzo, Tipologia, Stato, Superficie, Classe energetica,
// Riscaldamento, Cam. Matrimoniali, Camere Singole, Num. Bagni, Ascensore, Piano,
// Spese condominio). ld+json presente ma inaffidabile (JSON malformato) → DOM.

import { sleep, rand, humanPause, checkBlocked, gotoResilient, BlockedError } from '../core/human.mjs';
import { mapStato, bedroomsFromText, zonaFromDescrizione } from '../core/schema.mjs';

const BASE = 'https://www.immobiliarecavallo.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const COMUNI = [
  { code: '37006', name: 'Bologna' },
  { code: '37047', name: 'Pianoro' },
  { code: '37054', name: 'San Lazzaro di Savena' },
];
const CATEGORIE = ['1', '2']; // Appartamento, Casa indipendente
const WHITELIST = ['bologna', 'pianoro', 'san lazzaro di savena'];

function parsePrice(txt) {
  const m = String(txt || '').replace(/[.\s]/g, '').match(/(\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}
function localiFromTipologia(t) {
  const s = String(t || '').toLowerCase();
  const map = { monolocale: 1, bilocale: 2, trilocale: 3, quadrilocale: 4, quinquelocale: 5, plurilocale: null };
  for (const k of Object.keys(map)) if (s.includes(k)) return map[k];
  return null;
}
// "Buono (restaurato 6-20 anni)" contiene 'restaur' → mapStato lo leggerebbe
// "Da ristrutturare": si mappa sul solo aggettivo principale.
function statoCavallo(raw) {
  const s = String(raw || '');
  const head = s.split('(')[0].trim();
  return mapStato(head || s);
}

export default {
  id: 'cavallo',
  name: 'Immobiliare Cavallo',

  // La ricerca è POST: il probe GET su /ricerca/ non vede risultati.
  // minLinks/minCards 0: verify non deve fallire; la verifica vera è la POST
  // del collector (fail-closed su 403/429).
  probeChecks: {
    listingUrl: 'https://www.immobiliarecavallo.it/ricerca/',
    linkPattern: '\\/focus\\/\\d+',
    minLinks: 0,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const resp = await gotoResilient(page, `${BASE}/ricerca/`, { log, baseWait: 20000 });
    await dismissCookies(page);
    await humanPause(2000, 3500);
    await checkBlocked(page, resp);
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      for (const cat of CATEGORIE) {
        if (cards.length >= maxAds) break;
        const form = {
          id_ref_agency: '', cod_property: '',
          nature_property: 'F', contract_property: 'R', relation_property: 'V',
          int_property: '118', reg_property: '8', prov_property: '37', com_property: c.code,
          public_price: String(MAX_PREZZO), lower_price: '0', categoria_rem: cat,
        };
        const r = await page.context().request.post(`${BASE}/ricerca/?do=1`, { form });
        if (r.status() === 403 || r.status() === 429) throw new BlockedError(`HTTP ${r.status()} sulla ricerca POST (cavallo)`);
        if (!r.ok()) throw new Error(`ricerca POST HTTP ${r.status()}`);
        const html = await r.text();
        // Parsing della risposta legittima del sito con una pagina temporanea.
        const tmp = await page.context().newPage();
        let rows = [];
        try {
          await tmp.setContent(html, { waitUntil: 'domcontentloaded' });
          rows = await tmp.evaluate(() => {
            const out = [];
            document.querySelectorAll('div.rem_block.ext').forEach((el) => {
              const a = el.querySelector('a[href*="/focus/"]');
              if (!a) return;
              const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
              // solo card risultato: hanno prezzo o superficie come entry_item
              if (!el.querySelector('.entry_desc') || !/Superficie|€/.test(txt)) return;
              const comuneM = txt.match(/([A-Za-zÀ-ú' ]+) \((BO|MO|MI|[A-Z]{2})\)/);
              out.push({
                href: a.href,
                testo: txt.slice(0, 300),
                comune: comuneM ? comuneM[1].trim() : '',
                venduto: /\bVenduto\b/i.test(txt),
                prezzo: (txt.match(/€\s*([\d.\s]+)/)?.[1] || '').trim(),
                mq: txt.match(/Superficie:\s*(\d+)\s*mq/i)?.[1] || null,
              });
            });
            return out;
          });
        } finally { await tmp.close().catch(() => {}); }
        let added = 0, skipped = 0;
        for (const row of rows) {
          const id = row.href.match(/\/focus\/(\d+)/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const p = parsePrice(row.prezzo);
          const mq = row.mq ? parseInt(row.mq, 10) : null;
          const comuneOk = !row.comune || WHITELIST.includes(row.comune.toLowerCase());
          if (row.venduto || !comuneOk || (p != null && p > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) { skipped++; continue; }
          cards.push({ id, url: row.href, area: row.comune || c.name, prezzo: p, mq });
          added++;
          if (cards.length >= maxAds) break;
        }
        log(`[cavallo] ${c.name} cat ${cat}: ${rows.length} card, +${added} (tot ${cards.length}, ${skipped} scartati)`);
        await sleep(rand(2500, 5000));
      }
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 20000 });
    await dismissCookies(page);
    await humanPause(2000, 3800);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const feats = {};
      document.querySelectorAll('tr').forEach((tr) => {
        const label = tr.querySelector('.entry_desc')?.textContent?.trim();
        const value = tr.querySelector('.entry_item')?.textContent?.trim();
        if (label && value) feats[label.replace(/\s+$/, '')] = value;
      });
      const bodyText = (document.body?.innerText || '').replace(/\r/g, '');
      const titolo = document.querySelector('h1')?.textContent?.trim() || '';
      // descrizione: paragrafi sostanziosi prima della tabella caratteristiche
      const rifEl = [...document.querySelectorAll('.entry_desc')].find((e) => /Riferimento/i.test(e.textContent || ''));
      const table = rifEl ? rifEl.closest('table') : null;
      const paras = [];
      document.querySelectorAll('p').forEach((p) => {
        if (table && (table.contains(p) || table.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_PRECEDING)) return;
        const t = (p.textContent || '').trim();
        if (t.length > 60 && !/cookie|privacy|consenso/i.test(t)) paras.push(t);
      });
      let desc = paras.join('\n');
      if (!desc) {
        // fallback testuale: ultimo blocco prima della tabella caratteristiche
        const idx = bodyText.search(/Riferimento\s*\n/);
        const head = idx > 0 ? bodyText.slice(0, idx) : bodyText;
        const m = head.match(/Richiedi info\n([\s\S]*)$/);
        desc = (m ? m[1] : '').trim();
      }
      const plan = [...document.querySelectorAll('.rem_block.pla img, [class*="pla"] img')]
        .map((i) => ({ url: i.src || i.getAttribute('u') || '', caption: 'Planimetria' }))
        .filter((p) => /^https?:/.test(p.url));
      const foto = document.querySelector('[data-u="slides"] img, .slideshow-container img')?.src || '';
      const venduto = /\bVenduto\b/i.test(bodyText.slice(0, 1500));
      return { feats, titolo, desc, plan, foto, venduto };
    });
    if (data.venduto) { log(`[cavallo] VENDUTO: scarto ${card.id}`); return null; }
    const f = data.feats;
    const prezzo = parsePrice(f['Prezzo']) ?? card.prezzo ?? null;
    const mq = parseInt(f['Superficie'], 10) || card.mq || null;
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[cavallo] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    if (!/residenziale/i.test(f['Proposta'] || 'residenziale')) { log(`[cavallo] non residenziale: scarto ${card.id}`); return null; }
    const comune = (f['Località'] || card.area || '').replace(/\s*\([A-Z]{2}\)\s*/, '').trim();
    if (comune && !WHITELIST.includes(comune.toLowerCase())) {
      log(`[cavallo] comune fuori whitelist (${comune}): scarto ${card.id}`);
      return null;
    }
    const camMatr = parseInt(f['Cam. Matrimoniali'], 10) || 0;
    const camSing = parseInt(f['Camere Singole'], 10) || 0; // "Nessuna" → 0
    const camere = camMatr + camSing > 0 ? camMatr + camSing : bedroomsFromText(data.desc, localiFromTipologia(f['Tipologia']));
    const speseM = (f['Spese condominio'] || '').match(/([\d.]+)\s*€?\s*\/?\s*mese/i) || (f['Spese condominio'] || '').match(/€\s*([\d.]+)/);
    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: data.titolo || 'Immobile in vendita',
      comune,
      provincia: 'BO',
      zona: zonaFromDescrizione(data.desc),
      indirizzo: '',
      prezzo,
      tipologia: f['Tipologia'] || '',
      locali: parseInt(f['Locali'], 10) || localiFromTipologia(f['Tipologia']),
      camere,
      bagni: parseInt(f['Num. Bagni'], 10) || null,
      superficieMq: mq,
      piano: f['Piano'] || '',
      ascensore: f['Ascensore'] || '',
      cucina: f['Cucina'] || (/angolo cottura/i.test(data.desc) ? 'Angolo cottura' : ''),
      balcone: f['Balcone'] ? !/^no$/i.test(f['Balcone']) : /balcon/i.test(data.desc),
      cantina: /cantin/i.test(data.desc),
      stato: statoCavallo(f['Stato'] || ''),
      ape: String(f['Classe energetica'] || '').toUpperCase(),
      riscaldamento: f['Riscaldamento'] || '',
      speseCondominio: speseM ? `${speseM[1]} €/mese` : (f['Spese condominio'] || ''),
      altreCaratteristiche: f['Stabile'] ? `Stabile: ${f['Stabile']}` : '',
      agenzia: 'Immobiliare Cavallo',
      privato: false,
      descrizione: data.desc,
      foto: data.foto,
      planimetrie: data.plan,
    };
  },
};