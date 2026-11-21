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
  var doc = document.getElementById('doc'), pdfButton = document.getElementById('pdf'), last = null, state = null;
  var pdfPreparingState = null, pdfPreparedState = null, pdfPreparationError = null, pdfUrl = null;
  function setPdfPending(text) {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = null;
    pdfButton.removeAttribute('href');
    pdfButton.removeAttribute('download');
    pdfButton.setAttribute('aria-disabled', 'true');
    pdfButton.tabIndex = -1;
    pdfButton.textContent = text;
  }
  function preparePdf() {
    if (!state || pdfPreparingState === state || pdfPreparedState === state) return;
    var requestedState = state;
    pdfPreparingState = requestedState;
    pdfPreparationError = null;
    setPdfPending('Preparing PDF…');
    window.SportsDayReportPdf.prepare(requestedState).then(function () {
      if (state === requestedState) {
        var link = window.SportsDayReportPdf.createDownloadLink(requestedState);
        pdfPreparedState = requestedState;
        pdfPreparationError = null;
        pdfUrl = link.url;
        pdfButton.href = link.url;
        pdfButton.download = link.filename;
        pdfButton.removeAttribute('aria-disabled');
        pdfButton.tabIndex = 0;
        pdfButton.textContent = 'Download PDF';
      }
    }).catch(function (error) {
      if (state === requestedState) {
        pdfPreparationError = error;
        console.error('Could not prepare results PDF fonts', error);
      }
    }).finally(function () {
      if (pdfPreparingState !== requestedState) return;
      pdfPreparingState = null;
      if (state !== requestedState) {
        preparePdf();
        return;
      }
      if (pdfPreparationError) {
        pdfButton.href = '#retry';
        pdfButton.removeAttribute('aria-disabled');
        pdfButton.tabIndex = 0;
        pdfButton.textContent = 'Retry PDF preparation';
      }
    });
  }
  document.getElementById('print').addEventListener('click', function () { window.print(); });
  pdfButton.addEventListener('click', function (event) {
    if (state && pdfPreparedState === state) return;
    event.preventDefault();
    if (state) preparePdf();
  });

  function render(s) {
    var houseColor = window.SportsDayHousePalette.color;
    var H = function (id) { return s.houses.filter(function (h) { return h.id === id; })[0] || { name: '?', color: '#999' }; };
    var dot = function (h) { return '<i class="dot" style="background:' + esc(houseColor(h)) + '"></i>'; };
    var chartColor = function (h) { var c = houseColor(h); return /^#[0-9a-f]{6}$/i.test(c) ? c : '#64748b'; };
    var housePoints = function (event) {
      return s.houses.map(function (h) {
        return {
          house: h,
          points: (event.entries || []).reduce(function (total, entry) {
            return total + (entry.house_id === h.id && Number.isFinite(entry.points) ? entry.points : 0);
          }, 0)
        };
      });
    };
    var chart = function (rows, label) {
      var width = 760, left = 126, barWidth = 520, rowHeight = 32, height = rows.length * rowHeight + 8;
      var max = Math.max.apply(null, rows.map(function (row) { return row.points; }).concat([1]));
      var ticks = '<line x1="' + left + '" y1="0" x2="' + left + '" y2="' + (height - 4) + '" stroke="#cbd5e1"/>';
      [0.5, 1].forEach(function (portion) {
        var x = left + barWidth * portion;
        ticks += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + (height - 4) + '" stroke="#e2e8f0" stroke-dasharray="3 4"/>';
      });
      var bars = rows.map(function (row, index) {
        var y = index * rowHeight + 6, color = chartColor(row.house);
        var filled = row.points ? Math.max(2, barWidth * row.points / max) : 0;
        return '<text x="0" y="' + (y + 13) + '" class="chart-house">' + esc(row.house.name) + '</text>' +
          '<rect x="' + left + '" y="' + y + '" width="' + barWidth + '" height="16" rx="8" fill="#eef2f7"/>' +
          (filled ? '<rect x="' + left + '" y="' + y + '" width="' + filled.toFixed(2) + '" height="16" rx="8" fill="' + color + '"/>' : '') +
          '<text x="' + (left + barWidth + 12) + '" y="' + (y + 13) + '" class="chart-value">' + row.points + '</text>';
      }).join('');
      return '<svg class="points-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(label) + '">' + ticks + bars + '</svg>';
    };
    var scoredResults = s.events.reduce(function (total, event) {
      return total + (event.entries || []).filter(function (entry) { return entry.position !== null; }).length;
    }, 0);
    var seenAthletes = new Set(), duplicateEntries = 0, statusCounts = {};
    s.events.forEach(function (event) {
      (event.entries || []).forEach(function (entry) {
        if (entry.status !== 'ok') statusCounts[entry.status] = (statusCounts[entry.status] || 0) + 1;
        if (entry.athlete_id == null) return;
        var key = event.id + ':' + entry.athlete_id;
        if (seenAthletes.has(key)) duplicateEntries++;
        seenAthletes.add(key);
      });
    });
    var leader = s.standings[0], runnerUp = s.standings[1];
    var analysis = (s.progress.done || 0) + ' of ' + (s.progress.total || 0) +
      ' events complete · ' + scoredResults + ' ranked results';
    if (leader) analysis += ' · ' + leader.name + ' lead';
    if (leader && runnerUp) analysis += ' by ' + (leader.points - runnerUp.points) + ' points over ' + runnerUp.name;
    var statusSummary = Object.keys(statusCounts).map(function (status) {
      return statusCounts[status] + ' ' + status.toUpperCase();
    }).join(', ');
    if (statusSummary) analysis += ' · ' + statusSummary + ' (0 points)';
    analysis += duplicateEntries ? ' · ' + duplicateEntries + ' duplicate individual entries detected.' : ' · no duplicate individual entries detected.';
    var d = s.settings.date.split('-'), dateTxt = new Date(+d[0], d[1] - 1, +d[2]).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.title = 'Results · ' + s.settings.title;
    var awRow = function (a, label) { var h = H(a.house_id), photo = a.photoUrl ? '<img class="athlete-photo" src="' + esc(a.photoUrl) + '" alt="Photo of ' + esc(a.name) + '">' : ''; return '<tr><td>' + photo + dot(h) + '<b>' + esc(a.name) + '</b></td><td>' + esc(label) + '</td><td>' + esc(h.name) + '</td><td class="n"><b>' + a.points + '</b></td><td class="n">' + a.gold + ' / ' + a.silver + ' / ' + a.bronze + '</td></tr>'; };
    var aw = function (title, rows) { return '<h3>' + title + '</h3><table><thead><tr><th>Athlete</th><th></th><th>House</th><th class="n">Points</th><th class="n">G / S / B</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">No awards yet.</td></tr>') + '</tbody></table>'; };
    var A = s.awards;
    doc.innerHTML =
      '<header class="rep"><img src="/img/crest.png" alt=""><div><h1>' + esc(s.settings.title) + '</h1><p>Machabeng College · ' + esc(dateTxt) + (s.settings.venue ? ' · ' + esc(s.settings.venue) : '') + '</p>' + (s.settings.finalised ? '<span class="stamp final">FINAL RESULTS</span>' : '') + '</div></header>' +
      (s.settings.finalised && s.winner.length ? '<div class="win"><span style="font-size:40px">🏆</span><div><b>' + s.winner.map(function (id) { return esc(H(id).name); }).join(' &amp; ') + (s.winner.length > 1 ? ' share the title' : ' are the champions') + '</b></div></div>' : '') +
      '<h2>Overall house ranking</h2><table class="big"><thead><tr><th>#</th><th>House</th><th class="n">Points</th><th class="n">Gold</th><th class="n">Silver</th><th class="n">Bronze</th></tr></thead><tbody>' + s.standings.map(function (h) { return '<tr><td class="p">' + h.rank + '</td><td>' + dot(h) + '<b>' + esc(h.name) + '</b></td><td class="n"><b>' + h.points + '</b></td><td class="n">' + h.gold + '</td><td class="n">' + h.silver + '</td><td class="n">' + h.bronze + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<section class="chart-panel"><h3>House points</h3>' + chart(s.standings.map(function (h) { return { house: H(h.house_id), points: h.points }; }), 'Overall points by house') + '<p class="chart-note">' + esc(analysis) + '</p></section>' +
      '<p class="empty">' + s.progress.done + ' of ' + s.progress.total + ' events complete. Ties on points are separated by golds, then silvers, then bronzes.</p>' +
      '<h2>Individual awards</h2>' +
      aw('Top athletes overall', A.topAthletes.map(function (a) { return awRow(a, '#' + a.rank + (a.level ? ' ' + a.level : '')); }).join('')) +
      aw('Best performer in each house', A.bestPerHouse.map(function (x) { return x.athlete ? awRow(x.athlete, x.athlete.joint ? 'joint best' : 'best in house') : '<tr><td class="empty">—</td><td></td><td>' + esc(H(x.house_id).name) + '</td><td></td><td></td></tr>'; }).join('')) +
      aw('Age-group champions', A.ageGroups.map(function (a) { return awRow(a, a.label + (a.joint ? ' (joint)' : '')); }).join('')) +
      '<h2>Event results</h2><div class="cols">' + (s.events.map(function (e) {
        var rows = e.entries.map(function (r) { var h = H(r.house_id), photo = r.photoUrl ? '<img class="athlete-photo" src="' + esc(r.photoUrl) + '" alt="Photo of ' + esc(r.name) + '">' : ''; return '<tr><td class="p">' + (r.status !== 'ok' ? r.status.toUpperCase() : r.position === null ? '–' : r.position) + '</td><td>' + photo + esc(r.name) + relayDetails(r) + '</td><td>' + dot(h) + esc(h.name) + '</td>' + (e.measure === 'time' ? '' : '<td>' + esc(r.performance) + '</td>') + '<td class="n">' + r.points + '</td></tr>'; }).join('');
        return '<div class="ev"><h3>' + esc(e.name) + ' <small>' + esc(e.level) + (e.gender ? ' · ' + (e.gender === 'F' ? 'Girls' : 'Boys') : e.level === 'Mixed' ? '' : ' · Mixed') + (e.kind === 'relay' ? ' · Relay' : '') + ' · ' + esc(e.status) + '</small></h3><div class="event-chart"><span class="chart-label">POINTS BY HOUSE</span>' + chart(housePoints(e), e.name + ' points by house') + '</div>' + (rows ? '<table><tbody>' + rows + '</tbody></table>' : '<p class="empty">No results.</p>') + '</div>';
      }).join('') || '<p class="empty">No events.</p>') + '</div>' +
      '<h2>Points system</h2><p>' + s.settings.scheme.points.map(function (p, i) { return ord(i + 1) + ' = ' + p; }).join(', ') + ', ' + ord(s.settings.scheme.points.length + 1) + ' and below = ' + s.settings.scheme.rest + '. DNS, DNF and DQ score 0. Relays use the same scale. Equal performances share a position.</p>' +
      '<footer>Generated ' + esc(new Date(s.generatedAt).toLocaleString()) + ' · Machabeng College Computer Science CAS project</footer>';
  }
  function load() {
    fetch('/api/state', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (s) { if (!last || s.v !== last) { last = s.v; state = s; render(s); preparePdf(); } }).catch(function () { /* keep what is shown */ });
  }
  load(); setInterval(function () { if (!matchMedia('print').matches) load(); }, 20000);
})();
