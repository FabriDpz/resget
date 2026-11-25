/* Tema grafico del radar: 5 palette dal chiaro allo scuro.
   Caricato PRIMA del CSS nell'<head> per applicare data-theme senza flash.
   La scelta persiste in localStorage (radar-theme); default = notte (storico).
   Espone window.RADAR_THEMES per il selettore in app.js e per la pagina login. */
(function () {
  'use strict';
  var THEMES = [
    { id: 'chiaro', label: 'Chiaro', icon: '☀️' },
    { id: 'nebbia', label: 'Nebbia', icon: '🌤️' },
    { id: 'seppia', label: 'Seppia', icon: '📜' },
    { id: 'ardesia', label: 'Ardesia', icon: '🌆' },
    { id: 'notte', label: 'Notte', icon: '🌙' },
  ];
  var KEY = 'radar-theme';
  function valid(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return id;
    return 'notte';
  }
  var saved = 'notte';
  try { saved = valid(localStorage.getItem(KEY)); } catch (e) { /* storage assente */ }
  document.documentElement.setAttribute('data-theme', saved);
  window.RADAR_THEMES = {
    list: THEMES,
    current: function () { return valid(document.documentElement.getAttribute('data-theme')); },
    apply: function (id) {
      id = valid(id);
      document.documentElement.setAttribute('data-theme', id);
      try { localStorage.setItem(KEY, id); } catch (e) { /* storage assente */ }
      return id;
    },
  };
})();