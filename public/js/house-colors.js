(function (global) {
  'use strict';
  var colors = { Ravens: '#eab308', Hawks: '#2563eb', Eagles: '#ef4444', Falcons: '#16a34a' };
  var keys = { Eagles: 'eagles', Hawks: 'hawks', Ravens: 'ravens', Falcons: 'falcons' };

  global.SportsDayHousePalette = Object.freeze({
    color: function (house) { return colors[house && house.name] || (house && house.color) || '#999'; },
    key: function (house) { return keys[house && house.name] || 'other'; }
  });
})(window);
