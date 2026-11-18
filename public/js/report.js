/* Printable results and awards. Read-only; uses the same public data as the live site. */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ord = function (n) { var v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
  var relayDetails = function (r) {
    if (!r.relayMembers || !r.relayMembers.length) return '';
    var splits = r.relaySplits || [];
    return '<br><small>' + r.relayMembers.map(function (m) {
      var split = splits.filter(function (s) { return s.leg === m.leg; })[0];
      return 'Leg ' + m.leg + ': ' + esc(m.name) + (split ? ' · ' + (split.splitMs / 1000).toFixed(2) + 's' : '');
    }).join(' · ') + '</small>';
  };
  var doc = document.getElementById('doc'), last = null;
  document.getElementById('print').addEventListener('click', function () { window.print(); });

  function render(s) {
    var houseColor = window.SportsDayHousePalette.color;
    var H = function (id) { return s.houses.filter(function (h) { return h.id === id; })[0] || { name: '?', color: '#999' }; };
    var dot = function (h) { return '<i class="dot" style="background:' + esc(houseColor(h)) + '"></i>'; };
    var d = s.settings.date.split('-'), dateTxt = new Date(+d[0], d[1] - 1, +d[2]).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.title = 'Results · ' + s.settings.title;
    var awRow = function (a, label) { var h = H(a.house_id); return '<tr><td>' + dot(h) + '<b>' + esc(a.name) + '</b></td><td>' + esc(label) + '</td><td>' + esc(h.name) + '</td><td class="n"><b>' + a.points + '</b></td><td class="n">' + a.gold + ' / ' + a.silver + ' / ' + a.bronze + '</td></tr>'; };
    var aw = function (title, rows) { return '<h3>' + title + '</h3><table><thead><tr><th>Athlete</th><th></th><th>House</th><th class="n">Points</th><th class="n">G / S / B</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">No awards yet.</td></tr>') + '</tbody></table>'; };
    var A = s.awards;
    doc.innerHTML =
      '<header class="rep"><img src="/img/crest.png" alt=""><div><h1>' + esc(s.settings.title) + '</h1><p>Machabeng College · ' + esc(dateTxt) + (s.settings.venue ? ' · ' + esc(s.settings.venue) : '') + '</p><span class="stamp ' + (s.settings.finalised ? 'final' : '') + '">' + (s.settings.finalised ? 'FINAL RESULTS' : 'PROVISIONAL: the day is not finalised yet') + '</span></div></header>' +
      (s.settings.finalised && s.winner.length ? '<div class="win"><span style="font-size:40px">🏆</span><div><b>' + s.winner.map(function (id) { return esc(H(id).name); }).join(' &amp; ') + (s.winner.length > 1 ? ' share the title' : ' are the champions') + '</b></div></div>' : '') +
      '<h2>Overall house ranking</h2><table class="big"><thead><tr><th>#</th><th>House</th><th class="n">Points</th><th class="n">Gold</th><th class="n">Silver</th><th class="n">Bronze</th></tr></thead><tbody>' + s.standings.map(function (h) { return '<tr><td class="p">' + h.rank + '</td><td>' + dot(h) + '<b>' + esc(h.name) + '</b></td><td class="n"><b>' + h.points + '</b></td><td class="n">' + h.gold + '</td><td class="n">' + h.silver + '</td><td class="n">' + h.bronze + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<p class="empty">' + s.progress.done + ' of ' + s.progress.total + ' events complete. Ties on points are separated by golds, then silvers, then bronzes.</p>' +
      '<h2>Individual awards</h2>' +
      aw('Top athletes overall', A.topAthletes.map(function (a) { return awRow(a, '#' + a.rank + (a.level ? ' ' + a.level : '')); }).join('')) +
      aw('Best performer in each house', A.bestPerHouse.map(function (x) { return x.athlete ? awRow(x.athlete, x.athlete.joint ? 'joint best' : 'best in house') : '<tr><td class="empty">—</td><td></td><td>' + esc(H(x.house_id).name) + '</td><td></td><td></td></tr>'; }).join('')) +
      aw('Age-group champions', A.ageGroups.map(function (a) { return awRow(a, a.label + (a.joint ? ' (joint)' : '')); }).join('')) +
      '<h2>Event results</h2><div class="cols">' + (s.events.map(function (e) {
        var rows = e.entries.map(function (r) { var h = H(r.house_id); return '<tr><td class="p">' + (r.status !== 'ok' ? r.status.toUpperCase() : r.position === null ? '–' : r.position) + '</td><td>' + esc(r.name) + relayDetails(r) + '</td><td>' + dot(h) + esc(h.name) + '</td><td>' + esc(r.performance) + '</td><td class="n">' + r.points + '</td></tr>'; }).join('');
        return '<div class="ev"><h3>' + esc(e.name) + ' <small>' + esc(e.level) + (e.kind === 'relay' ? ' · Relay' : '') + ' · ' + esc(e.status) + '</small></h3>' + (rows ? '<table><tbody>' + rows + '</tbody></table>' : '<p class="empty">No results.</p>') + '</div>';
      }).join('') || '<p class="empty">No events.</p>') + '</div>' +
      '<h2>Points system</h2><p>' + s.settings.scheme.points.map(function (p, i) { return ord(i + 1) + ' = ' + p; }).join(', ') + ', ' + ord(s.settings.scheme.points.length + 1) + ' and below = ' + s.settings.scheme.rest + '. DNS, DNF and DQ score 0. Relays use the same scale. Equal performances share a position.</p>' +
      '<footer>Generated ' + esc(new Date(s.generatedAt).toLocaleString()) + ' · Machabeng College Computer Science CAS project</footer>';
  }
  function load() {
    fetch('/api/state', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (s) { if (!last || s.v !== last) { last = s.v; render(s); } }).catch(function () { /* keep what is shown */ });
  }
  load(); setInterval(function () { if (!matchMedia('print').matches) load(); }, 20000);
})();
