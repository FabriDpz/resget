// Configurazione POI (OpenStreetMap) per il rank di vicinanza degli immobili.
// Tassonomia, pesi e scala sono pensati per essere portabili su altri siti.

// Bounding box dei 3 comuni target + buffer ~5 km (lat S, lon O, lat N, lat E).
// Il margine deve coprire anche annunci di confine: oltre FAR_M il punteggio
// è comunque 0, quindi allargare non falsa i rank.
export const POI_BBOX = { south: 44.30, west: 11.12, north: 44.62, east: 11.50 };

// Punteggio categoria: 100 entro NEAR_M, decade linearmente a 0 a FAR_M.
export const NEAR_M = 300;
export const FAR_M = 2000;

// Rank minimo per superare i filtri (etichetta "Discreto").
export const MIN_POI_RANK = 35;

// Etichette qualitative del rank.
export const RANK_LABELS = [
  { min: 75, label: 'Ottimo' },
  { min: 55, label: 'Buono' },
  { min: 35, label: 'Discreto' },
  { min: 0, label: 'Scarso' },
];

// 8 categorie pesate. I tag OSM sono nella forma chiave=valore; un POI entra
// nella categoria se possiede ALMENO UNO dei tag. Le fermate bus sono incluse
// per scelta esplicita dell'utente (rank urbani tendenzialmente alti).
export const POI_CATEGORIES = [
  {
    key: 'trasporti',
    label: 'Trasporto pubblico',
    weight: 3,
    tags: [
      'railway=station', 'railway=halt', 'railway=tram_stop',
      'highway=bus_stop', 'public_transport=station',
    ],
  },
  {
    key: 'spesa',
    label: 'Spesa alimentare',
    weight: 3,
    tags: ['shop=supermarket', 'shop=convenience'],
  },
  {
    key: 'scuola',
    label: 'Scuola',
    weight: 3,
    tags: ['amenity=school', 'amenity=kindergarten'],
  },
  {
    key: 'salute',
    label: 'Salute',
    weight: 2,
    tags: ['amenity=pharmacy', 'amenity=hospital', 'amenity=clinic', 'amenity=doctors'],
  },
  {
    key: 'verde',
    label: 'Verde e sport',
    weight: 1,
    tags: ['leisure=park', 'leisure=fitness_centre', 'leisure=sports_centre'],
  },
  {
    key: 'ristorazione',
    label: 'Ristorazione e bar',
    weight: 1,
    tags: ['amenity=cafe', 'amenity=restaurant'],
  },
  {
    key: 'servizi',
    label: 'Servizi',
    weight: 1,
    tags: ['amenity=bank', 'amenity=post_office', 'shop=mall'],
  },
  {
    key: 'cultura',
    label: 'Cultura e tempo libero',
    weight: 1,
    tags: ['amenity=library', 'amenity=cinema', 'amenity=theatre'],
  },
];

export const CACHE_TTL_DAYS = 30;

export function rankLabel(rank) {
  return RANK_LABELS.find((r) => rank >= r.min).label;
}

// Punteggio 0-100 da una distanza in metri (null/Infinity → 0).
export function categoryScore(distanceM) {
  if (distanceM == null || !isFinite(distanceM)) return 0;
  if (distanceM <= NEAR_M) return 100;
  if (distanceM >= FAR_M) return 0;
  return Math.round(100 * (1 - (distanceM - NEAR_M) / (FAR_M - NEAR_M)));
}

// Costruisce la query Overpass QL per la bbox configurata (out center per i way).
export function buildOverpassQuery(bbox = POI_BBOX) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const selectors = [...new Set(POI_CATEGORIES.flatMap((c) => c.tags))]
    .map((t) => {
      const [k, v] = t.split('=');
      return `nwr["${k}"="${v}"](${b});`;
    })
    .join('\n  ');
  return `[out:json][timeout:120];\n(\n  ${selectors}\n);\nout center tags;`;
}