// ---------------------------------------------------------------------------
// Date annuncio: normalizzazione ed estrazione best-effort della data di
// pubblicazione/aggiornamento. Usata dal runner condiviso (fallback JSON-LD
// dopo scrapeDetail) e dagli adapter che leggono date testuali.
// Principio: MAI inventare una data — se la fonte non la espone, campo vuoto.
// Il ledger (firstSeen osservato) resta la fonte robusta per l'anzianità.
// ---------------------------------------------------------------------------

// Normalizza in YYYY-MM-DD. Accetta ISO 8601, epoch (secondi o millisecondi),
// e formati italiani testuali (dd/mm/yyyy, "12 marzo 2026", "ieri", "oggi").
// Ritorna '' se non interpretabile o fuori range plausibile (1990..oggi+1gg).
export function normDate(raw, now = new Date()) {
  if (raw == null || raw === '') return '';
  let d = null;
  if (typeof raw === 'number' || /^\d{9,13}$/.test(String(raw).trim())) {
    const n = Number(raw);
    // 9-10 cifre = secondi, 13 = millisecondi.
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    const s = String(raw).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    } else {
      const it = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
      if (it) {
        d = new Date(`${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}T00:00:00Z`);
      } else if (/^oggi\b/i.test(s)) {
        d = now;
      } else if (/^ieri\b/i.test(s)) {
        d = new Date(now.getTime() - 86400000);
      } else {
        const mesi = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
        const txt = s.match(/(\d{1,2})\s+([a-zà]+)\s+(\d{4})/i);
        if (txt && mesi[txt[2].toLowerCase()]) {
          d = new Date(`${txt[3]}-${String(mesi[txt[2].toLowerCase()]).padStart(2, '0')}-${txt[1].padStart(2, '0')}T00:00:00Z`);
        }
      }
    }
  }
  if (!d || isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  if (y < 1990 || d.getTime() > now.getTime() + 86400000) return '';
  return d.toISOString().slice(0, 10);
}

// Attraversa nodi JSON-LD (array, @graph, oggetti annidati) e cerca i campi
// data di schema.org. Ritorna {pubblicatoIl, aggiornatoIl} normalizzati ('' se assenti).
const PUB_KEYS = ['datePublished', 'datePosted', 'dateCreated', 'uploadDate'];
const UPD_KEYS = ['dateModified', 'dateUpdated'];

function walkLd(node, out, depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) { for (const n of node) walkLd(n, out, depth + 1); return; }
  if (typeof node !== 'object') return;
  if (!out.pub) {
    for (const k of PUB_KEYS) {
      const v = normDate(node[k]);
      if (v) { out.pub = v; break; }
    }
  }
  if (!out.upd) {
    for (const k of UPD_KEYS) {
      const v = normDate(node[k]);
      if (v) { out.upd = v; break; }
    }
  }
  if (out.pub && out.upd) return;
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') walkLd(v, out, depth + 1);
  }
}

export function datesFromJsonLd(ld) {
  const out = { pub: '', upd: '' };
  walkLd(ld, out);
  return { pubblicatoIl: out.pub, aggiornatoIl: out.upd };
}

// Estrae i JSON-LD dalla pagina e ne ricava le date. Best-effort: mai throw
// (una pagina senza ld+json o una navigazione fallita non deve fermare il run).
export async function datesFromPage(page) {
  try {
    const ld = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try { out.push(JSON.parse(s.textContent)); } catch { /* ld malformato */ }
      });
      return out;
    });
    return datesFromJsonLd(ld);
  } catch {
    return { pubblicatoIl: '', aggiornatoIl: '' };
  }
}

// Fallback del runner: completa le date mancanti dell'annuncio appena raccolto.
// La data dell'adapter (fonte esplicita del portale) VINCE sempre sul JSON-LD.
export async function fillDates(ad, page) {
  // Normalizza sempre (gli adapter possono passare formati non-ISO).
  const pub = normDate(ad.pubblicatoIl);
  const upd = normDate(ad.aggiornatoIl);
  if (pub && upd) {
    ad.pubblicatoIl = pub;
    ad.aggiornatoIl = upd;
    return ad;
  }
  ad.pubblicatoIl = pub;
  ad.aggiornatoIl = upd;
  const ld = await datesFromPage(page);
  if (!ad.pubblicatoIl) ad.pubblicatoIl = ld.pubblicatoIl;
  if (!ad.aggiornatoIl) ad.aggiornatoIl = ld.aggiornatoIl;
  return ad;
}