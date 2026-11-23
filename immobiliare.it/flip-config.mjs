// ---------------------------------------------------------------------------
// Configurazione analisi FLIP (RENO + STALE) — requisiti §2quinquies.
// Tutti i valori economici sono STIME INDICATIVE modificabili: non perizie.
// ---------------------------------------------------------------------------

export const FLIP_CONFIG = {
  reno: {
    // Buono stato/abitabile entra nel pool RENO solo se il €/m² è scontato
    // almeno del 15% rispetto alla mediana di zona (≤ 0,85 × mediana).
    scontoMinimoBuonoStato: 0.15,
    // Costo lavori €/m² (stime di mercato, personalizzabili).
    costoLavoriMqRistrutturare: 600, // ristrutturazione completa
    costoLavoriMqRestyling: 150,     // restyling leggero su buono stato
    // Costi accessori d'acquisto/hold/vendita.
    valoreCatastaleMq: 500,   // proxy €/m² catastali per il calcolo del registro
    aliquotaRegistro: 0.09,   // 9% sul valore catastale (seconda casa, residenziale)
    notaio: 2500,             // rogito d'acquisto
    aliquotaAgenzia: 0.03,    // 3% del prezzo (+IVA in realtà; stima conservativa)
    holdingEVendita: 1500,    // IMU durante i lavori + costi rivendita
    aliquotaPlusvalenza: 0.26, // 26% sulla plusvalenza se rivendita < 5 anni
    // Soglie semaforo sul ROI netto.
    roiVerde: 0.20,
    roiGiallo: 0.10,
    // ROI netto minimo usato per calcolare il prezzo massimo d'offerta.
    roiTargetOfferta: 0.20,
    // Comparabili minimi per usare la mediana di zona; sotto soglia si usa
    // la mediana comunale (segnalato nell'analisi).
    minComparabiliZona: 3,
  },
  stale: {
    // Punteggio negoziabilità 0–100 = giorniOnline (max 40) + ribassi (max 30)
    // + keyword venditore motivato (max 30).
    giorniPienoPunteggio: 180, // ≥180 giorni online → 40 punti
    puntiGiorni: 40,
    puntiRibassoSingolo: 15,   // per ribasso rilevato nello storico
    puntiRibassoMax: 30,
    puntiKeywordSingola: 10,
    puntiKeywordMax: 30,
    sogliaAlto: 60,
    sogliaMedio: 35,
    // Sconto suggerito sul prezzo richiesto per fascia di score.
    scontoAlto: 0.18,
    scontoMedio: 0.10,
    scontoBasso: 0.05,
    keyword: [
      'trattabil', 'urgent', 'successione', 'ered[ei]', 'trasferimento',
      'libero subito', 'occasione', 'prezzo ribassato', 'ribassato',
      'da vedere', 'vendita rapida',
    ],
  },

  // -------------------------------------------------------------------------
  // Override manuale ARV (€/m² di rivendita) — VINCE sempre sulla mediana.
  // Chiavi: sottozona esatta (parte dopo " / " nel campo zona, case-insensitive)
  // oppure "comune:<nome>" come fallback comunale.
  // Precompilato con le mediane del dataset del 14/11/2026 (34 annunci, pochi
  // comparabili per zona): sono valori di partenza da affinare con la propria
  // conoscenza del mercato o con le quotazioni OMI. Mettere null per disattivare
  // un override e tornare alla mediana calcolata.
  // -------------------------------------------------------------------------
  arvOverrideMq: {
    'bolognina': 2400,
    'corticella': 2600,
    'noce - pescarola': 2400,
    'borgo panigale': 2600,
    'san donato': 2300,
    'san ruffillo': 2600,
    'savena': 2700,
    'colli murri': 2600,
    'massarenti': 2500,
    'santa viola': 2300,
    'saragozza dentro le mura': 3200,
    'saragozza fuori porta': 2900,
    'saffi': 2700,
    'rastignano': 2200,
    'livergnano': 1500,
    'tazzola': 1200,
    'comune:bologna': 2500,
    'comune:pianoro': 1800,
    'comune:san lazzaro di savena': 2600,
  },
};