// Adattatore progettocasadialfaeomega.it — Agestaweb ASP, Playwright headed.
// Listing GET con filtri SERVER (verificati 22/11):
// /web/immobili.asp?link=1&cod_regione=5&cod_provincia=14&cod_comune=<c>
//   &language=ita&tipo_contratto=V&cod_categoria=R&prezzo_max=160000&mq_min=40&maxann=30
// cod_comune: 1247=Bologna, 1239=San Lazzaro di Savena; Pianoro NON trattato
// dal portale (nel select comuni non esiste) → nessuna query per Pianoro.
// cod_categoria=R esclude commerciali; maxann=30 sta in 1 pagina (portfolio ~7).
// Oggi Bologna ≤160k = 0 ("NESSUN IMMOBILE TROVATO"), SL 1 (220k, fuori budget).
// Card: link /web/immobile_dettaglio.asp?cod_annuncio=<id>&language=ita,
// testo contenitore: titolo, "In vendita a <Comune> Zona <zona>", estratto,
// "76 Mq - 4 Vani", "€ 220.000". Filtri server prezzo/mq + rete client.
// Dettaglio DOM (nessun ld+json): .row.dettaglio → descrizione, box_consistenze
// (tabella Sup. Principale/accessorie), sidebar prezzo/Vani/Camere/Bagni/Classe.

import { sleep, rand, humanPause, checkBlocked, gotoResilient } from '../core/human.mjs';
import { mapStato, bedroomsFromText } from '../core/schema.mjs';

const BASE = 'https://www.progettocasadialfaeomega.it';
const MAX_PREZZO = 160000;
const MIN_MQ = 40;
const COMUNI = [
  { code: '1247', name: 'Bologna' },
  { code: '1239', name: 'San Lazzaro di Savena' },
];
const WHITELIST = ['bologna', 'san lazzaro di savena', 'pianoro'];

function parsePrice(txt) {
  const m = String(txt || '').replace(/\./g, '').match(/(\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}
function listingUrl(c, { withBudget = true } = {}) {
  // cod_tipologia=3 = Appartamento (audit 23/11): esclude ville/rustici server-side.
  const q = `link=1&cod_regione=5&cod_provincia=14&cod_comune=${c.code}&language=ita&tipo_contratto=V&cod_categoria=R&cod_tipologia=3&maxann=30`;
  return `${BASE}/web/immobili.asp?${q}${withBudget ? `&prezzo_max=${MAX_PREZZO}&mq_min=${MIN_MQ}` : ''}`;
}

export default {
  id: 'alfaeomega',
  name: 'Alfa & Omega',

  // listingUrl SENZA prezzo_max: con ≤160k oggi 0 risultati; la query base
  // (~7 annunci) permette al probe di campionare link reali.
  // stripQuery:false perché l'id vive nella query (cod_annuncio=).
  probeChecks: {
    listingUrl: `${BASE}/web/immobili.asp?tipo_contratto=V&cod_categoria=R&maxann=30&language=ita`,
    linkPattern: 'immobile_dettaglio\\.asp\\?cod_annuncio=\\d+',
    stripQuery: false,
    minLinks: 1,
    minCards: 0,
  },

  async collectListings(page, { log, maxAds, dismissCookies }) {
    const cards = [];
    const seen = new Set();
    for (const c of COMUNI) {
      const url = listingUrl(c);
      const resp = await gotoResilient(page, url, { log, baseWait: 20000 });
      await dismissCookies(page);
      await humanPause(2200, 4000);
      await checkBlocked(page, resp);
      const rows = await page.evaluate(() => {
        const out = [];
        const seenH = new Set();
        document.querySelectorAll('a[href*="immobile_dettaglio.asp"]').forEach((a) => {
          const href = a.href;
          const id = href.match(/cod_annuncio=(\d+)/)?.[1];
          if (!id || seenH.has(id)) return;
          seenH.add(id);
          // contenitore card: primo antenato con testo sostanzioso
          let el = a;
          while (el && (el.innerText || '').length < 120) el = el.parentElement;
          const txt = (el?.innerText || '').replace(/\s+/g, ' ').trim();
          out.push({ id, url: href, txt: txt.slice(0, 800) });
        });
        return out;
      });
      let added = 0, skipped = 0;
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const comuneM = r.txt.match(/In vendita a ([A-Za-zÀ-ú' ]+?)(?: Zona | ,|$)/i);
        const comune = comuneM ? comuneM[1].trim() : c.name;
        const zonaM = r.txt.match(/Zona ([A-Za-zÀ-ú' ]+?)(?= In vendita| Proponiamo| L'|$)/i);
        const p = parsePrice(r.txt.match(/€\s*([\d.]+)/)?.[1]);
        const mq = parseInt(r.txt.match(/(\d+)\s*Mq\s*-/i)?.[1], 10) || null;
        if (!WHITELIST.includes(comune.toLowerCase()) || (p != null && p > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
          skipped++;
          continue;
        }
        cards.push({ id: r.id, url: r.url, area: c.name, comune, zona: zonaM ? zonaM[1].trim() : '', prezzo: p, mq });
        added++;
        if (cards.length >= maxAds) break;
      }
      log(`[alfaeomega] ${c.name}: ${rows.length} annunci, +${added} (tot ${cards.length}, ${skipped} scartati)`);
      await sleep(rand(2500, 4500));
    }
    return cards;
  },

  async scrapeDetail(page, card, { log, dismissCookies }) {
    const resp = await gotoResilient(page, card.url, { log, baseWait: 20000 });
    await dismissCookies(page);
    await humanPause(2000, 3800);
    await checkBlocked(page, resp);
    const data = await page.evaluate(() => {
      const main = document.querySelector('.row.dettaglio') || document.body;
      const bodyText = (main.innerText || '').replace(/\r/g, '');
      const titolo = document.querySelector('h1, .single-property h2, h2')?.textContent?.trim() || '';
      const foto = document.querySelector('.bigfoto img, .flexslider img')?.src || '';
      const plan = [...main.querySelectorAll('a[data-img], img')]
        .filter((e) => /planimetr/i.test((e.getAttribute?.('data-img') || e.src || '') + ' ' + (e.title || e.alt || '')))
        .map((e) => ({ url: e.getAttribute?.('data-img') || e.src, caption: 'Planimetria' }));
      return { bodyText: bodyText.slice(0, 12000), titolo, foto, plan };
    });
    const body = data.bodyText;
    const prezzo = parsePrice(body.match(/€\s*([\d.]+)/)?.[1]) ?? card.prezzo ?? null;
    // Superficie principale dalla tabella Consistenze ("Sup. Principale - piano terra 76 Mq")
    const supM = body.match(/Sup\. Principale[^\n]*?(\d+)\s*Mq/i) || body.match(/(\d+)\s*mq situato/i);
    const mq = supM ? parseInt(supM[1], 10) : (card.mq ?? null);
    if ((prezzo != null && prezzo > MAX_PREZZO) || (mq != null && mq < MIN_MQ)) {
      log(`[alfaeomega] fuori target (${prezzo ?? '?'} €, ${mq ?? '?'} m²): scarto ${card.id}`);
      return null;
    }
    // Comune: riga maiuscola dopo il Rif, o dal testo "In vendita a <comune>"
    const comM = body.match(/\n([A-ZÀ-Ú' ]{4,})\nBOLOGNA/i) || body.match(/In vendita a ([A-Za-zÀ-ú' ]+?)(?:,| nella| Zona)/i);
    const toTitle = (s) => s.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/\bDi\b/g, 'di').replace(/\bE\b/g, 'e');
    const comune = comM ? toTitle(comM[1].trim()) : (card.comune || '');
    const comuneNorm = comune;
    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    if (comuneNorm && !WHITELIST.includes(comuneNorm.toLowerCase())) {
      log(`[alfaeomega] comune fuori whitelist (${comune}): scarto ${card.id}`);
      return null;
    }
    const zonaM = body.match(/BOLOGNA - zona ([^\n]+)/i);
    const vani = parseInt(body.match(/(\d+)\s*Vani/i)?.[1], 10) || null;
    const camereM = body.match(/(\d+)\s*Camere/i);
    const bagni = parseInt(body.match(/(\d+)\s*Bagni/i)?.[1], 10) || null;
    const apeM = body.match(/Classe energetica\s*([A-G][1-4]?)/i);
    const pianoM = body.match(/Sup\. Principale[^\n]*?- ([a-zà-ú ]+?)\s+\d+\s*Mq/i) || body.match(/piano\s+(terra|rialzato|primo|secondo|terzo|quarto|quinto|ultimo|seminterrato)/i);
    // descrizione: paragrafo lungo "In vendita a …"/"Proponiamo …"
    const descM = body.match(/((?:In vendita a|Proponiamo)[\s\S]*?)(?:\nConsistenze|\nFoto\n|\nRichiedi maggiori)/);
    const desc = (descM ? descM[1] : '').replace(/\n+/g, ' ').trim();
    const indirizzoM = desc.match(/(?:in |situato in )?([Vv]ia [A-Za-zÀ-ú' ]+ \d+)/);
    return {
      id: card.id,
      url: card.url,
      area: card.area,
      titolo: data.titolo || 'Immobile in vendita',
      comune: comuneNorm,
      provincia: 'BO',
      zona: zonaM ? zonaM[1].trim() : (card.zona || ''),
      indirizzo: indirizzoM ? indirizzoM[1] : '',
      prezzo,
      tipologia: (body.match(/\n(Appartamento|Villa[^\n]*|Casa[^\n]*|Attico|Mansarda|Rustico[^\n]*)\nVendita/i)?.[1]) || 'Appartamento',
      locali: vani,
      camere: camereM ? parseInt(camereM[1], 10) : bedroomsFromText(desc, vani),
      bagni,
      superficieMq: mq,
      piano: pianoM ? pianoM[1].trim().replace(/^piano\s+/i, '') : '',
      ascensore: /ascensore/i.test(desc) && !/senza ascensore|no ascensore/i.test(desc) ? 'Sì' : '',
      cucina: /cucina abitabile/i.test(desc) ? 'Abitabile' : (/angolo cottura/i.test(desc) ? 'Angolo cottura' : ''),
      balcone: /balcon/i.test(desc) && !/senza balcon/i.test(desc),
      terrazzo: /terrazz|lastrico solare/i.test(desc),
      cantina: /cantina/i.test(desc),
      stato: mapStato(desc.match(/(recentemente ristrutturato|ristrutturat[ao]|ottime condizioni|buone condizioni|da ristrutturare|nuova costruzione)/i)?.[1] || ''),
      ape: apeM ? apeM[1].toUpperCase() : '',
      riscaldamento: cap(desc.match(/riscaldamento (?:è )?(autonomo|centralizzato)/i)?.[1] || ''),
      dettaglioSuperficie: (body.match(/Consistenze\n([\s\S]*?)(?:\nFoto|\nMappa)/)?.[1] || '').replace(/[\t\n]+/g, ' ').replace(/\s+/g, ' ').trim(),
      agenzia: 'Alfa & Omega',
      privato: false,
      descrizione: desc,
      foto: data.foto,
      planimetrie: data.plan,
    };
  },
};