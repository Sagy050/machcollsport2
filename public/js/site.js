/* Public, read-only site. Fetches /api/state and re-renders whenever the server says something changed.
   Nothing here can write: there are no forms and no write requests. All user text goes through esc(). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ord = function (n) { var v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
  var state = null, prevRank = {}, prevPts = {}, lastPts = {}, dv = {}, moved = {}, open = {}, fStatus = 'all', fLevel = 'all';

  /* ---------- fetching ---------- */
  var inflight = false, again = false;
  function load() {
    if (inflight) { again = true; return; }
    inflight = true;
    fetch('/api/state', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (s) {
      if (!state || s.v !== state.v) { state = s; render(); }
      setConn(true);
    }).catch(function () { setConn(false); }).then(function () { inflight = false; if (again) { again = false; load(); } });
  }
  var live = false;
  function setConn(ok) {
    var c = $('conn'); c.className = 'conn ' + (ok ? 'on' : 'off');
    c.lastChild.textContent = ok ? (live ? 'Live' : 'Updating') : 'Reconnecting…';
    $('stale').hidden = ok;
  }
  function connect() {
    var Source = window.SDLiveSource || window.EventSource;
    if (!Source) return;
    var es = new Source('/api/stream');
    es.addEventListener('v', function () { live = true; load(); });
    es.onopen = function () { live = true; setConn(true); };
    es.onerror = function () { live = false; setConn(false); };
  }
  load(); connect();
  setInterval(load, 20000);                       // safety net if a proxy buffers the live stream
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });

  /* ---------- helpers ---------- */
  var houseColor = window.SportsDayHousePalette.color;
  var houseOf = function (id) { return (state.houses.filter(function (h) { return h.id === id; })[0]) || { name: '?', color: '#999' }; };
  var medals = function (h) { return '<span class="md"><span class="medal gold">🥇 ' + h.gold + '</span><span class="medal silver">🥈 ' + h.silver + '</span><span class="medal bronze">🥉 ' + h.bronze + '</span></span>'; };
  function arrow(id) { var m = moved[id]; return m > 0 ? '<span class="mv up" title="Moved up">▲</span>' : m < 0 ? '<span class="mv dn" title="Moved down">▼</span>' : ''; }
  var fmtDate = function (iso) { var p = iso.split('-'); return new Date(+p[0], p[1] - 1, +p[2]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };
  var startAt = function () { var p = state.settings.date.split('-'), t = state.settings.start.split(':'); return new Date(+p[0], p[1] - 1, +p[2], +t[0], +t[1]); };

  /* ---------- render ---------- */
  function render() {
    var s = state, st = s.standings, pr = s.progress;
    moved = {};
    st.forEach(function (h, i) { if (prevRank[h.house_id] !== undefined && prevRank[h.house_id] !== h.rank) moved[h.house_id] = prevRank[h.house_id] - h.rank; prevRank[h.house_id] = h.rank; });
    var best = null;                                 // who just scored? -> fireworks in that house's colour
    st.forEach(function (h) { var p = prevPts[h.house_id]; if (p !== undefined && h.points > p && (!best || h.points - p > best.d)) best = { d: h.points - p, c: houseColor(h) }; prevPts[h.house_id] = h.points; });
    if (best && window.sdResult) window.sdResult(best.c);
    document.title = s.settings.title + ' · Machabeng College';
    $('lpill').textContent = fmtDate(s.settings.date) + (s.settings.venue ? ' · ' + s.settings.venue : '');
    $('lhs').innerHTML = s.houses.map(function (h) { return '<b style="--c:' + esc(houseColor(h)) + '">' + esc(h.name) + '</b>'; }).join('');
    var anyScore = st.some(function (h) { return h.points > 0; });

    // phase text in the hero
    var phase, h1 = 'Live results', sub = 'Standings update as recorders enter results from the field.';
    if (s.settings.finalised) { phase = 'Final results'; h1 = 'Final results'; sub = 'The day is complete. Congratulations to every house.'; }
    else if (pr.live > 0) phase = 'Live now · ' + pr.live + (pr.live === 1 ? ' event' : ' events') + ' on the field';
    else if (pr.done > 0 || anyScore) phase = 'Sports Day in progress';
    else { phase = 'Starts ' + fmtDate(s.settings.date) + ' at ' + s.settings.start; sub = 'Results will appear here as soon as the first event finishes.'; }
    $('phase').textContent = phase; $('h1').textContent = h1; $('sub').textContent = sub;
    $('livelbl').textContent = s.settings.finalised ? 'Final' : pr.live > 0 ? 'Live now' : 'Standings';
    $('livetitle').textContent = s.settings.finalised ? 'Final standings' : 'Who’s winning right now?';
    $('venueh').textContent = s.settings.venue || 'The venue';
    $('venuep').textContent = (s.settings.venue || 'The venue') + ' is the venue for Sports Day on ' + fmtDate(s.settings.date) + '.';

    // HUD + standings
    var r1 = rec($('hud'), '.card'), r2 = rec($('standings'), '.row'), chg = function (h) { return lastPts[h.house_id] !== undefined && lastPts[h.house_id] !== h.points ? ' chg' : ''; };
    $('hud').innerHTML = st.map(function (h) {
      var leader = h === st[0], level = h.points === st[0].points;
      var status = leader ? 'Pace Setter' : (level ? 'Level' : st[0].points > h.points ? '-' + (st[0].points - h.points) + ' pts' : 'In range');
      var statusClass = leader ? 'leader' : (level ? 'level' : 'chasing');
      var pct = st[0].points ? Math.max(2, h.points / st[0].points * 100) : 0;
      return '<div class="card' + chg(h) + '" data-k="' + h.house_id + '" style="--c:' + esc(houseColor(h)) + '"><div class="nm"><i class="house-dot" style="background:' + esc(houseColor(h)) + '"></i><span>' + esc(h.name) + arrow(h.house_id) + '</span></div><span class="status-pill ' + statusClass + '">' + esc(status) + '</span><div class="pt" data-h="' + h.house_id + '">' + Math.round(dv[h.house_id] || 0) + '</div>' + medals(h) + '<div class="card-progress"><i style="width:' + pct + '%"></i></div></div>';
    }).join('');
    var mx = Math.max(20, st[0] ? st[0].points : 0);
    $('standings').innerHTML = st.map(function (h) {
      var leader = h === st[0], level = h.points === st[0].points;
      var status = leader ? 'Pace Setter' : (level ? 'Level' : st[0].points > h.points ? '-' + (st[0].points - h.points) + ' pts' : 'In range');
      var statusClass = leader ? 'leader' : (level ? 'level' : 'chasing');
      var pct = Math.max(2, h.points / mx * 100);
      return '<div class="row' + chg(h) + '" data-k="' + h.house_id + '" style="--c:' + esc(houseColor(h)) + '"><div class="standing-main"><div class="standing-head"><i class="house-dot" style="background:' + esc(houseColor(h)) + '"></i><span class="name">' + esc(h.name) + arrow(h.house_id) + '</span><span class="status-pill ' + statusClass + '">' + esc(status) + '</span></div>' + medals(h) + '<div class="bar"><i style="width:' + pct + '%;background:' + esc(houseColor(h)) + '"></i></div></div><div class="pts" data-h="' + h.house_id + '">' + Math.round(dv[h.house_id] || 0) + '</div></div>';
    }).join('');
    st.forEach(function (h) { lastPts[h.house_id] = h.points; });
    play($('hud'), '.card', r1); play($('standings'), '.row', r2);
    if (window.sdPoints) window.sdPoints(s.houses.map(function (h) { return (st.filter(function (x) { return x.house_id === h.id; })[0] || {}).points || 0; }));

    // champion banner
    $('champ').innerHTML = s.settings.finalised && s.winner.length
      ? '<div class="banner"><span style="font-size:38px" aria-hidden="true">🏆</span><div><b>' + s.winner.map(function (id) { return esc(houseOf(id).name); }).join(' &amp; ') + (s.winner.length > 1 ? ' share the title' : ' win Sports Day 2026') + '</b><small>Final result confirmed by the officials.</small></div></div>' : '';

    // progress
    var pct = pr.total ? pr.done / pr.total * 100 : 0;
    $('pg').style.width = pct + '%';
    $('pgt').textContent = pr.total ? pr.done + ' of ' + pr.total + ' events complete' + (pr.live ? ' · ' + pr.live + ' live' : '') : 'No events scheduled yet';

    // feed
    $('feed').innerHTML = s.recent.length ? s.recent.slice(0, 7).map(function (r) {
      var h = houseOf(r.house_id);
      var photo = r.photoUrl ? '<img class="result-athlete-photo" src="' + esc(r.photoUrl) + '" alt="" loading="lazy">' : '';
      return '<li>' + photo + '<span class="dot" style="background:' + esc(houseColor(h)) + '"></span><span><b>' + esc(r.name) + '</b> (' + esc(h.name) + ') ' + ord(r.position) + ' in ' + esc(r.level) + ' ' + esc(r.event) + (r.performance ? ' · ' + esc(r.performance) : '') + '</span></li>';
    }).join('') : '<li class="empty">No results yet.</li>';

    renderEvents(); renderAwards();
    $('ptab').innerHTML = '<tr><th>Position</th><th>Points</th><th>Note</th></tr>' + s.settings.scheme.points.map(function (p, i) {
      return '<tr><td>' + ord(i + 1) + '</td><td><b>' + p + '</b></td><td>' + (i === 0 ? 'Gold' : i === 1 ? 'Silver' : i === 2 ? 'Bronze' : 'Counts toward house total') + '</td></tr>';
    }).join('') + '<tr><td>' + ord(s.settings.scheme.points.length + 1) + ' and below</td><td><b>' + s.settings.scheme.rest + '</b></td><td>Finished the event</td></tr><tr><td>DNS / DNF / DQ</td><td><b>0</b></td><td>Did not start, finish or was disqualified</td></tr>';
    tick();
  }

  function pill(ev, nextId) {
    if (ev.status === 'live') return '<span class="stt live">Live</span>';
    if (ev.status === 'completed' || ev.status === 'final') {
      var w = ev.entries.filter(function (e) { return e.position === 1 && e.status === 'ok'; });
      if (w.length) { var h = houseOf(w[0].house_id); return '<span class="stt done"><i class="dot" style="background:' + esc(houseColor(h)) + '"></i>' + esc(h.name) + ' won</span>'; }
      return '<span class="stt done">Completed</span>';
    }
    return ev.id === nextId ? '<span class="stt next">Up next</span>' : '<span class="stt sch">Scheduled</span>';
  }
  function relayDetails(r) {
    if (!r.relayMembers || !r.relayMembers.length) return '';
    var splits = r.relaySplits || [];
    return '<small>' + r.relayMembers.map(function (m) {
      var split = splits.filter(function (s) { return s.leg === m.leg; })[0];
      return 'Leg ' + m.leg + ': ' + esc(m.name) + (split ? ' · ' + (split.splitMs / 1000).toFixed(2) + 's' : '');
    }).join(' · ') + '</small>';
  }
  function renderEvents() {
    var evs = state.events, nextId = (evs.filter(function (e) { return e.status === 'scheduled'; })[0] || {}).id;
    var sets = [['all', 'All'], ['live', 'Live'], ['upcoming', 'Upcoming'], ['done', 'Finished']];
    $('fstatus').innerHTML = sets.map(function (x) { return '<button type="button" data-s="' + x[0] + '" aria-pressed="' + (fStatus === x[0]) + '">' + x[1] + '</button>'; }).join('');
    var levels = ['all'].concat(['Lower Junior', 'Junior', 'Intermediate', 'Senior', 'Open', 'Mixed'].filter(function (l) { return evs.some(function (e) { return e.level === l; }); }));
    $('flevel').innerHTML = levels.map(function (l) { return '<button type="button" data-l="' + l + '" aria-pressed="' + (fLevel === l) + '">' + (l === 'all' ? 'All levels' : l) + '</button>'; }).join('');
    var shown = evs.filter(function (e) {
      var d = e.status === 'completed' || e.status === 'final';
      return (fStatus === 'all' || (fStatus === 'live' && e.status === 'live') || (fStatus === 'upcoming' && e.status === 'scheduled') || (fStatus === 'done' && d)) && (fLevel === 'all' || e.level === fLevel);
    });
    $('evs').innerHTML = shown.length ? shown.map(function (e) {
      var metricHeader = e.measure === 'time' ? '' : '<th>' + (e.measure === 'distance' ? 'Distance' : e.measure === 'score' ? 'Score' : 'Result') + '</th>';
      var timeBadge = e.measure === 'time' ? '' : '<span class="tm">' + esc(e.time || '—') + '</span>';
      var rows = e.entries.length ? '<table><tr><th>Pos</th><th>' + (e.kind === 'relay' ? 'Team' : 'Athlete') + '</th><th>House</th>' + metricHeader + '<th>Pts</th></tr>' +
        e.entries.map(function (r) {
          var h = houseOf(r.house_id);
          var photo = r.photoUrl ? '<img class="result-athlete-photo" src="' + esc(r.photoUrl) + '" alt="" loading="lazy">' : '';
          return '<tr><td class="pos">' + (r.status !== 'ok' ? r.status.toUpperCase() : r.position === null ? '–' : r.position) + '</td><td>' + photo + esc(r.name) + relayDetails(r) + '</td><td><i class="hd" style="background:' + esc(houseColor(h)) + '"></i>' + esc(h.name) + '</td>' + (e.measure === 'time' ? '' : '<td>' + esc(r.performance) + '</td>') + '<td>' + r.points + '</td></tr>';
        }).join('') + '</table>' : '<div class="empty">No results recorded yet.</div>';
      var isOpen = !!open[e.id];
      return '<div class="evwrap' + (isOpen ? ' open' : '') + '"><button type="button" class="ev' + (e.measure === 'time' ? ' no-time' : '') + '" data-e="' + e.id + '" aria-expanded="' + isOpen + '">' + timeBadge + '<span class="en">' + esc(e.name) + '<small>' + esc(e.level) + (e.kind === 'relay' ? ' · Relay' : '') + '</small></span><span>' + pill(e, nextId) + '<span class="chev" aria-hidden="true">›</span></span></button><div class="evres">' + rows + '</div></div>';
    }).join('') : '<div class="empty">' + (evs.length ? 'No events match these filters.' : 'The schedule will appear here once the officials add events.') + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-e],[data-s],[data-l]'); if (!b || !state) return;
    if (b.dataset.e) open[b.dataset.e] = !open[b.dataset.e];
    if (b.dataset.s) fStatus = b.dataset.s;
    if (b.dataset.l) fLevel = b.dataset.l;
    renderEvents();
  });

  function awardCard(a, label, sub) {
    var h = houseOf(a.house_id);
    var photo = a.photoUrl ? '<img class="award-athlete-photo" src="' + esc(a.photoUrl) + '" alt="Photo of ' + esc(a.name) + '" loading="lazy">' : '';
    return '<div class="panel award" style="border-top:4px solid ' + esc(houseColor(h)) + '">' + photo + '<h3>' + esc(a.name) + '</h3><p>' + esc(h.name) + ' · ' + esc(sub) + (a.joint ? ' · joint' : '') + '</p><div class="pts" style="margin-top:8px">' + a.points + ' pts</div>' +
      '<div class="stat"><span><b>' + a.gold + '</b><small>gold</small></span><span><b>' + a.silver + '</b><small>silver</small></span><span><b>' + a.bronze + '</b><small>bronze</small></span></div></div>';
  }
  function renderAwards() {
    var a = state.awards, none = '<div class="empty">Awards appear once results are in.</div>';
    $('ath').innerHTML = a.topAthletes.length ? a.topAthletes.slice(0, 4).map(function (x) { return awardCard(x, '', '#' + x.rank + (x.level ? ' · ' + x.level : '')); }).join('') : none;
    var bp = a.bestPerHouse.filter(function (x) { return x.athlete; });
    $('bph').innerHTML = bp.length ? bp.map(function (x) { return awardCard(x.athlete, '', 'best in house'); }).join('') : none;
    $('agc').innerHTML = a.ageGroups.length ? a.ageGroups.map(function (x) { return awardCard(x, '', x.label + ' champion'); }).join('') : none;
  }

  /* ---------- motion: numbers count up, cards glide to their new place, sections slide in ---------- */
  function rec(c, sel) { var m = {}; $a(sel, c).forEach(function (e) { var b = e.getBoundingClientRect(); if (b.width) m[e.dataset.k] = b; }); return m; }
  function play(c, sel, m) {
    $a(sel, c).forEach(function (e) {
      var o = m[e.dataset.k]; if (!o) return; var b = e.getBoundingClientRect(), dx = o.left - b.left, dy = o.top - b.top;
      if (dx || dy) { e.style.transition = 'none'; e.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; requestAnimationFrame(function () { requestAnimationFrame(function () { e.style.transition = 'transform .7s cubic-bezier(.2,.8,.2,1)'; e.style.transform = ''; }); }); }
    });
  }
  function $a(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  (function tween() {
    requestAnimationFrame(tween); if (!state) return;
    state.standings.forEach(function (h) { var d = dv[h.house_id] || 0; d += (h.points - d) * .1; dv[h.house_id] = Math.abs(h.points - d) < .05 ? h.points : d; });
    $a('[data-h]').forEach(function (e) { e.textContent = Math.round(dv[e.dataset.h] || 0); });
  })();
  var io = window.IntersectionObserver && new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: .1 });
  $a('#homev section, #about .grid > .panel').forEach(function (e, i) { e.classList.add('rv'); if (e.tagName === 'DIV') e.style.transitionDelay = (i % 3) * .1 + 's'; if (io) io.observe(e); else e.classList.add('in'); });
  addEventListener('pointermove', function (e) { var d = document.documentElement.style; d.setProperty('--px', (e.clientX / innerWidth - .5).toFixed(3)); d.setProperty('--py', (e.clientY / innerHeight - .5).toFixed(3)); });

  /* ---------- countdown ---------- */
  function tick() {
    if (!state) return;
    var t = startAt() - new Date();
    var liveBox = $('count');
    var landingBox = $('landing-count');
    liveBox.hidden = !(t > 0 && state.progress.done === 0 && !state.progress.live);
    landingBox.hidden = !(t > 0);
    if (liveBox.hidden && landingBox.hidden) return;
    var v = [t / 864e5, t / 36e5 % 24, t / 6e4 % 60, t / 1e3 % 60];
    var lb = ['days', 'hours', 'minutes', 'seconds'];
    [['d', 'h', 'm', 's'], ['ld', 'lh', 'lm', 'ls']].forEach(function (ids) {
      ids.forEach(function (k, i) { if ($(k)) $(k).innerHTML = (v[i] | 0) + '<small>' + lb[i] + '</small>'; });
    });
  }
  setInterval(tick, 1000);

  /* ---------- two pages in one: landing (default) and home (#home, #live, ...) ---------- */
  var HID = ['home', 'live', 'events', 'athletes', 'points', 'about', 'signin'], lv = $('landv'), hv = $('homev');
  function route() {
    var h = location.hash.slice(1), home = HID.indexOf(h) > -1;
    document.body.className = home ? 'home' : 'land'; lv.hidden = home; hv.hidden = !home; if (!home && window.sdIntro) window.sdIntro();
    var el = home ? $(h === 'home' ? 'hometop' : h) : null;
    scrollTo({ top: el ? el.getBoundingClientRect().top + scrollY - (h === 'home' ? 0 : 70) : 0, behavior: 'instant' });
  }
  addEventListener('hashchange', route); route();
})();
