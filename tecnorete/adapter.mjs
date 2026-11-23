// Adattatore tecnorete.it — stessa piattaforma/DB del Gruppo Tecnocasa.
// Riusa la factory di tecnocasa con base/id/name propri.
import { makeAdapter } from '../tecnocasa/adapter.mjs';
export default makeAdapter({ id: 'tecnorete', name: 'Tecnorete', base: 'https://www.tecnorete.it' });