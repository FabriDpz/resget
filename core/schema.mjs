// Schema comune di annuncio per tutti i portali + normalizzazione.
// Ogni adattatore produce oggetti con questi campi (null/'' se non disponibili).
// I moduli core (filters/flip/poi/dedup) lavorano solo su questo schema.

export function emptyAd(portal) {
  return {
    id: '',                 // id univoco NEL portale (stringa)
    portale: portal,        // slug del portale (es. 'idealista')
    url: '',
    area: '',               // area di ricerca da cui proviene
    titolo: '',
    comune: '',
    provincia: '',
    zona: '',
    indirizzo: '',
    lat: null,
    lon: null,
    prezzo: null,
    prezzoMq: '',
    tipologia: '',
    locali: null,
    camere: null,
    bagni: null,
    superficieMq: null,
    piano: '',
    pianoSolo: '',
    pianiEdificio: '',
    ascensore: '',
    cucina: '',
    arredato: '',
    balcone: '',
    terrazzo: '',
    cantina: '',
    stato: '',
    ape: '',
    riscaldamento: '',
    speseCondominio: '',
    altreCaratteristiche: '',
    dettaglioSuperficie: '',
    agenzia: '',
    privato: false,          // true se venditore privato (no agenzia)
    aggiornatoIl: '',        // YYYY-MM-DD
    pubblicatoIl: '',       // YYYY-MM-DD
    descrizione: '',
    foto: '',
    planimetrie: [],         // [{url, caption}]
    planimetriaUrl: '',
    camerePlanimetria: null, // verifica visiva a valle
    notaPlanimetria: '',
    scrapedAt: new Date().toISOString(),
  };
}

// Normalizza un annuncio parziale di un adattatore nello schema comune.
export function normalizeAd(portal, partial) {
  const ad = { ...emptyAd(portal), ...partial };
  ad.id = String(ad.id ?? '');
  ad.zona = sanitizeZona(ad.zona);
  ad.planimetriaUrl = ad.planimetriaUrl || ad.planimetrie?.[0]?.url || '';
  if (ad.prezzoMq === '' && ad.prezzo != null && ad.superficieMq) {
    ad.prezzoMq = `${Math.round(ad.prezzo / ad.superficieMq)} €/m²`;
  }
  return ad;
}

// Estrae un quartiere dalla descrizione ("in zona Mazzini", "quartiere Navile").
// Passa da sanitizeZona: scarta vani interni e descrittori. Ritorna '' se nulla.
export function zonaFromDescrizione(desc) {
  const d = String(desc || '');
  const m = d.match(/(?:in\s+)?zona\s+(?:di\s+)?([A-Za-zàèéìòù' ]{3,40}?)(?:\s*[,.;]|\s+(?:più|precisamente|comoda|ben|in|a|di|nei|presso|adiac|esattamente)\b)/i)
    || d.match(/quartiere\s+([A-Za-zàèéìòù' ]{3,40}?)(?:\s*[,.;]|\s+(?:in|a|di|di)\b)/i);
  return m ? sanitizeZona(m[1]) : '';
}

// Pulisce il campo zona: scarta vani interni ("zona giorno/notte"), descrittori
// generici ("residenziale", "comoda") e catture di testo lungo (breadcrumb o
// body della pagina scambiati per quartiere). Mantiene le sottozone " / ".
export function sanitizeZona(raw) {
  let z = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!z) return '';
  // Rimuove un eventuale prefisso "zona "/"quartiere " ridondante.
  z = z.replace(/^(?:zona|quartiere)\s+/i, '').trim();
  // Cattura di testo lungo (regex che ha inglobato descrizione/footer): non è una zona.
  if (z.length > 60) return '';
  // Scarta se contiene parole tipiche di descrizione/footer invece di un quartiere.
  if (/\b(wikicasa|immobiliare|tempocasa|tecnocasa|provincia|emilia|romagna|prezzo|appartamento|vendita|locali|bagno|mq|m2|foto|planimetria|mutuo|agenzia|©)\b/i.test(z)) return '';
  // Frase descrittiva catturata dopo "zona": trovacasa bo-tc-75892 aveva
  // zona="quali attività commerciali" (da "servizi della zona quali attività…").
  if (/\b(quali|attivita|attività|commerciali|servizi|parchi|fermate|scuole|negozi|trasporti)\b/i.test(z)) return '';
  const clean = (part) => {
    const p = part.trim();
    if (!p) return '';
    const low = p.toLowerCase();
    // Vani interni dell'appartamento, non quartieri.
    if (/^(giorno|notte|living|cottura|pranzo|relax|ingresso|studio|hobby|ripostiglio|disimpegno|corridoio|soggiorno|salotto|sala|cucina|camera|camere|bagno|lavanderia|tinello|mansarda|taverna|cantina|garage|box|posto auto)\b/.test(low)) return '';
    // Parole descrittive ovunque nella stringa: non è un nome di quartiere.
    if (/\b(residenziale|tranquilla|tranquillo|comoda|comodo|servita|servito|strategica|strategico|centrale|periferica|periferico|signorile|elegante|prestigiosa|prestigioso|ambita|ambito|ambitissima|ambitissimo|richiesta|richiesto|silenziosa|silenzioso|verde|servitissima|esclusiva|esclusivo|panoramica|panoramico|collinare|pedemontana|pedecollinare|circostante|pregio|indiscutibile|ricca|ricco|lussuosa|lussuoso|moderna|moderno|antica|antico|storica|storico|nuova|nuovo|recente|piena|pieno|immediata|immediato|adiacenze|adiacente|vicinanze|vicino|limitrofa|limitrofo|esclusivamente|prettamente|interamente|totalmente|parzialmente)\b/.test(low)) return '';
    // Avverbio in -mente o frase introdotta da preposizione: descrittiva, non zona.
    if (/mente$/.test(low)) return '';
    if (/^(di|del|della|dei|degli|delle|a|al|alla|in|nel|nella|da|per|con|su|tra|fra)\b/.test(low)) return '';
    // Too short or purely numeric: not a neighborhood.
    if (p.length < 3 || /^\d+$/.test(p)) return '';
    return p;
  };
  // Gestione sottozone "A / B": pulisci ogni parte e ricomponi.
  if (z.includes('/')) {
    const parts = z.split('/').map(clean).filter(Boolean);
    return parts.join(' / ');
  }
  return clean(z);
}

// Stato immobile: mappa dizionari dei portali verso i valori usati dai filtri
// ("Da ristrutturare", "Buono / Abitabile", "Ottimo / Ristrutturato", "Nuovo").
export function mapStato(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return '';
  if (/demolire|pessimo|cattivo/.test(s)) return 'Da demolire';
  if (/ristrutturare|renovat|restaur|da sistemare|fixer/.test(s)) return 'Da ristrutturare';
  if (/nuovo|new|costruzione|in costruzione/.test(s)) return 'Nuovo / In costruzione';
  if (/ottimo|ristrutturat|pari al nuovo|excelente|perfetto/.test(s)) return 'Ottimo / Ristrutturato';
  if (/buono|abitabile|good|buon stato|discreto/.test(s)) return 'Buono / Abitabile';
  return String(raw);
}

// Deduce il numero di camere da letto dal testo (descrizione/titolo).
// Fallback conservativo: locali - 1 (1 soggiorno) se non esplicito.
export function bedroomsFromText(desc, locali) {
  const t = String(desc || '');
  let m = t.match(/(\d+)\s*(?:camere?\s+da\s+letto|camere\b)/i);
  if (m) return parseInt(m[1], 10);
  const words = { una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, singola: 1, doppia: 2, matrimoniale: 1 };
  // \b finale: senza, "due camere" non matchava perché "camera" è seguito da "e"
  // (carattere di parola) e il confine non sussiste → il fallback locali-1 gonfiava
  // il numero di camere su tutti i portali che non espongono il campo.
  m = t.match(/\b(una|due|tre|quattro|cinque|sei|singola|doppia|matrimoniale)\s+camere?\b/i);
  if (m) return words[m[1].toLowerCase()] || null;
  const cnt = (t.match(/camera\s+da\s+letto|camera\s+(?:singola|doppia|matrimoniale)/gi) || []).length;
  if (cnt > 0) return cnt;
  if (locali && locali >= 2) return locali - 1;
  return null;
}