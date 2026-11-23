// Centri delle frazioni/località dei 3 comuni target, per il geocoding di
// secondo livello: gli aggregatori (mitula/trovit) espongono solo la località
// ("3 locali a Livergnano") senza indirizzo, e Nominatim spesso non indicizza
// le località minori come place.
//
// La tabella NON contiene coordinate scritte a mano: viene popolata da
// core/verify-frazioni.mjs che interroga Nominatim (1 req/s) e salva SOLO
// risultati verificati (place/hamlet/village/suburb dentro i 12 km dai centri,
// con il comune dichiarato che coincide). Cache: core/frazione-cache.json.
// Le coordinate sono del CENTRO della località: precisione "frazione" (~±1 km),
// dichiarata in geocodeFonte. Il filtro distanza ≤3 km resta il giudice finale.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'frazione-cache.json');

// Nomi delle frazioni/quartieri noti dei 3 comuni (solo nomi: le coordinate
// arrivano dalla verifica Nominatim). Località appenniniche incluse di proposito:
// il filtro distanza le escluderà con una motivazione REALE ("N km dal centro")
// invece di "coordinate non verificabili".
export const FRAZIONI_NOTE = {
  Bologna: [
    'Bolognina', 'Navile', 'San Donato', 'San Vitale', 'Savena', 'Porto',
    'Saragozza', 'Santo Stefano', 'Murri', 'Mazzini', 'Fossolo',
    'Borgo Panigale', 'Santa Viola', 'Corticella', 'San Ruffillo',
    'Centro', 'Centro Storico', 'Pescarola', 'Noce', 'Lame', 'Barca',
    'Battindarno', 'Pilastro', 'Roveri', 'Quarto Superiore', 'Quarto Inferiore',
    'Casteldebole', 'Caserme Rosse', 'Costa', 'Colli',
  ],
  'San Lazzaro di Savena': [
    'Idice', 'Cicogna', 'Ponticella', 'Colunga', 'Borgatella', 'Castel de Britti',
  ],
  Pianoro: [
    'Rastignano', 'Pianoro Vecchio', 'Pianoro Nuovo', 'Pian di Macina',
    'Carteria di Sesto', 'Livergnano', 'Botteghino di Zebio', 'Musiano',
    'Pian di Venola', 'Zebio', 'Gorgognano', 'Crocione', 'Tazzola',
  ],
};

let cache = null;
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
  catch { cache = {}; }
  return cache;
}
export function saveFrazioneCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache || {}, null, 2));
}
export function setFrazioneCentro(zona, comune, entry) {
  loadCache();
  cache[`${String(comune).toLowerCase()}|${String(zona).toLowerCase()}`] = entry;
}

// Match sulla zona normalizzata. Forme reali dei portali: "Savena",
// "Navile-Lame-Pescarola" (quartiere composto: prova ogni segmento),
// "Borgo Panigale - Aeroporto" (tratti/parentesi: prova il primo segmento).
// Niente match parziale sulle parole: "Borgo San Paolo" (Monterenzio) non deve
// matchare "Borgo Panigale". Ritorna { lat, lon, fonte } o null.
export function frazioneCentro(zona, comune) {
  const c = String(comune || '').trim().toLowerCase();
  if (!c) return null;
  const raw = String(zona || '').split('/').pop().trim().toLowerCase()
    .replace(/^zona\s+/, '').replace(/\s+/g, ' ');
  if (!raw) return null;
  const cache = loadCache();
  const candidates = [raw];
  if (raw.includes('-')) candidates.push(...raw.split(/\s*-\s*/).map((s) => s.trim()));
  for (const z of candidates) {
    if (!z) continue;
    const hit = cache[`${c}|${z}`];
    if (hit && hit.lat != null) return hit;
  }
  return null;
}

