/* Staff app: record results by tapping. Plain JavaScript, no build step.
   Recorders: pick an event, start the clock, tap each athlete as they cross the line (or type a distance).
   Admins also get Setup: import athletes, create events, fill entries, heats, team, day settings. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ord = function (n) { var v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  var ME = null, ST = null, ATH = null, USERS = null, AUDIT = null, skew = 0;
  var UI = { filter: 'live', q: '', heat: {}, last: {}, ahouse: 'all', aq: '', qacat: 'track' };
  var PENDING_ROSTER = null, PENDING_FILE = '', PARSING_ROSTER = false, IMPORTING_ROSTER = false, SEEDING_ROSTER = false, ROSTER_SUMMARY = null;
  var LOCALSTART = {};                     // clock starts pressed on this phone, until the server confirms them

  /* ------------------------------------------------------------------ helpers */
  function toast(msg, cls) {
    var d = document.createElement('div'); if (cls) d.className = cls; d.textContent = msg; $('#toast').appendChild(d);
    setTimeout(function () { d.remove(); }, 2600);
  }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 25); } catch (e) { /* not supported */ } }
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: Object.assign({ 'X-Requested-With': 'sportsday' }, body !== undefined ? { 'Content-Type': 'application/json' } : {}), body: body !== undefined ? JSON.stringify(body) : undefined })
      .catch(function () { var e = new Error('No connection'); e.network = true; throw e; })
      .then(function (r) {
        return r.text().then(function (t) {
          var d = null; try { d = JSON.parse(t); } catch (_) { d = null; }
          if (r.ok) return d || {};
          var e = new Error((d && d.error) || ('Error ' + r.status)); e.status = r.status; e.data = d;
          if (r.status === 401 && url !== '/api/login' && url !== '/api/me') signedOut();
          throw e;
        });
      });
  }
  var fail = function (e) { if (e && e.status !== 401) toast(e.message || 'Something went wrong', 'e'); };

  /* ------------------------------------------------------------------ time */
  function fmtTime(sec) { var cs = Math.floor(sec * 100 + 1e-6), m = Math.floor(cs / 6000), s = (cs % 6000) / 100; return m > 0 ? m + ':' + (s < 10 ? '0' : '') + s.toFixed(2) : s.toFixed(2); }
  function fmtClock(ms) { if (ms < 0) ms = 0; var cs = Math.floor(ms / 10); return pad(Math.floor(cs / 6000)) + ':' + pad(Math.floor((cs % 6000) / 100)) + '.' + pad(cs % 100); }
  function parseTime(t) {                    // "12.34", "12,34", "1:02.5"  ->  milliseconds, or null
    t = String(t).trim().replace(',', '.'); var m = /^(?:(\d{1,2}):)?(\d{1,2}(?:\.\d{1,3})?)$/.exec(t); if (!m) return null;
    var s = (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2]); return s > 0 ? Math.round(s * 1000) : null;
  }
  function syncTime() {                      // how far is this phone's clock from the server's? (best of 4 quick samples)
    var best = null, n = 0;
    (function one() {
      var t0 = Date.now();
      fetch('/api/time', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        var t1 = Date.now(), rtt = t1 - t0, sk = d.now - (t0 + rtt / 2); if (!best || rtt < best.rtt) best = { rtt: rtt, sk: sk };
        if (++n < 4) setTimeout(one, 80); else skew = best.sk;
      }).catch(function () { /* keep the old value */ });
    })();
  }
  var serverNow = function () { return Date.now() + skew; };
  function clockStart(evId, heat) {
    var ev = evOf(evId), k = evId + '-' + heat;
    return (ev && ev.heatStarts && ev.heatStarts[heat]) || LOCALSTART[k] || null;
  }

  /* ------------------------------------------------------------------ taps are queued, saved on the phone, and sent in order */
  var Q = []; try { Q = JSON.parse(localStorage.getItem('sd.q') || '[]'); } catch (e) { Q = []; }
  var saveQ = function () { try { localStorage.setItem('sd.q', JSON.stringify(Q)); } catch (e) { /* storage full or blocked */ } };
  var flushing = false;
  function enqueue(url, body, op) { Q.push({ url: url, body: body, op: op }); saveQ(); offlineBar(); flush(); }
  function flush() {
    if (flushing) return; flushing = true;
    (function next() {
      if (!Q.length) { flushing = false; offlineBar(); return; }
      var it = Q[0];
      api('POST', it.url, it.body).then(function () { Q.shift(); saveQ(); offlineBar(); next(); }, function (e) {
        if (e.network || e.status === 401 || e.status >= 500) { flushing = false; offlineBar(); setTimeout(flush, 3000); }
        else { Q.shift(); saveQ(); toast('Not saved: ' + e.message, 'e'); load(); next(); }
      });
    })();
  }
  function offlineBar() {
    var b = $('#offline'); if (!b) return;
    var off = navigator.onLine === false;
    if (Q.length) { b.hidden = false; b.textContent = Q.length + ' result' + (Q.length === 1 ? '' : 's') + ' saved on this phone, waiting to send' + (off ? ' (no connection)' : '…'); }
    else if (off) { b.hidden = false; b.textContent = 'No connection. You can keep recording; results are kept on this phone.'; }
    else b.hidden = true;
  }
  addEventListener('online', function () { offlineBar(); flush(); load(); }); addEventListener('offline', offlineBar);

  /* Show queued taps on screen straight away, before the server has confirmed them. */
  var numOf = function (ev, e) { if (e._v != null) return e._v; if (!e.performance) return null; if (ev.measure === 'distance') return parseFloat(e.performance); var m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(e.performance); return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2]) : null; };
  function rankLocal(ev) {
    var list = ev.entries.filter(function (e) { return e.status === 'ok' && numOf(ev, e) != null; });
    list.sort(function (a, b) { return ev.measure === 'distance' ? numOf(ev, b) - numOf(ev, a) : numOf(ev, a) - numOf(ev, b); });
    ev.entries.forEach(function (e) { e.position = null; });
    list.forEach(function (e, i) { e.position = i && numOf(ev, e) === numOf(ev, list[i - 1]) ? list[i - 1].position : i + 1; });
    ev.finished = ev.entries.filter(function (x) { return x.position !== null || x.status !== 'ok'; }).length;
  }
  function clockEnd(ev, heat) {
    var started = clockStart(ev.id, heat);
    if (!started) return null;
    if (ev.heatEnds && ev.heatEnds[heat]) return ev.heatEnds[heat];
    var runners = ev.entries.filter(function (e) { return e.heat === heat; });
    if (!runners.length || runners.some(function (e) { return e.position === null && e.status === 'ok'; })) return null;
    var lastElapsed = Math.max.apply(null, [0].concat(runners.map(function (e) {
      var splits = e.relaySplits || [];
      return Math.max(numOf(ev, e) || 0, 0, ...splits.map(function (s) { return s.cumulativeMs / 1000; }));
    })));
    return started + Math.round(lastElapsed * 1000);
  }
  function overlay() {
    if (!ST || !Q.length) return;
    var touched = {};
    Q.forEach(function (it) {
      var op = it.op; if (!op) return;
      ST.events.forEach(function (ev) {
        ev.entries.forEach(function (e) {
          if (e.id !== op.id) return; touched[ev.id] = ev;
          if (op.k === 'time') { e.performance = fmtTime(op.ms / 1000); e._v = op.ms / 1000; e.status = 'ok'; }
          else if (op.k === 'mark') { e.performance = (+op.v).toFixed(2); e._v = +op.v; e.status = 'ok'; }
          else if (op.k === 'relay') {
            e.relaySplits = e.relaySplits || [];
            var previous = e.relaySplits.length ? e.relaySplits[e.relaySplits.length - 1].cumulativeMs : 0;
            if (op.leg === e.relaySplits.length + 1) e.relaySplits.push({ leg: op.leg, cumulativeMs: op.elapsedMs, splitMs: op.elapsedMs - previous });
            if (op.leg === 4) { e.performance = fmtTime(op.elapsedMs / 1000); e._v = op.elapsedMs / 1000; e.status = 'ok'; }
          }
          else if (op.k === 'relayUndo') {
            e.relaySplits = e.relaySplits || [];
            var removed = e.relaySplits.pop();
            if (removed && removed.leg === 4) { e.performance = ''; e._v = null; e.status = 'ok'; }
          }
          else if (op.k === 'clear') { e.performance = ''; e._v = null; e.status = 'ok'; }
          else if (op.k === 'status') { e.status = op.s; e.performance = op.s === 'ok' ? e.performance : ''; e._v = null; }
        });
      });
    });
    Object.keys(touched).forEach(function (k) { rankLocal(touched[k]); });
  }

  /* ------------------------------------------------------------------ data */
  var loading = false, again = false;
  function load() {
    if (loading) { again = true; return Promise.resolve(); }
    loading = true;
    return api('GET', '/api/staff/state').then(function (s) { ST = s; overlay(); setConn(true); chrome(); if (['home', 'event', 'standings', 'schedule'].indexOf(route().name) > -1) render(); })
      .catch(function (e) { if (e.network) setConn(false); }).then(function () { loading = false; if (again) { again = false; load(); } });
  }
  function setConn(on) { var c = $('#conn'); if (!c) return; c.className = 'meet-live ' + (on ? 'on' : 'off'); c.lastChild.textContent = on ? 'LIVE MEET' : 'OFFLINE'; }
  var es = null;
  function connect() {
    var Source = window.SDLiveSource || window.EventSource;
    if (es || !Source) return;
    es = new Source('/api/stream');
    es.addEventListener('v', function () { setConn(true); load(); });
    es.onopen = function () { setConn(true); };
    es.onerror = function () { setConn(false); };
  }
  var evOf = function (id) { return ST && ST.events.filter(function (e) { return e.id === +id; })[0]; };
  var houseColor = window.SportsDayHousePalette.color;
  var houseKey = window.SportsDayHousePalette.key;
  var scheduleTime = function (value) {
    var match = /^(\d{1,2}):(\d{2})$/.exec(value || '');
    if (!match) return value || 'Scheduled';
    var hours = +match[1];
    return (hours % 12 || 12) + ':' + match[2] + ' ' + (hours >= 12 ? 'PM' : 'AM');
  };
  var eventCategory = function (ev) {
    if (ev.kind === 'relay') return 'Track · Relay';
    if (ev.measure === 'distance') {
      if (/jump/i.test(ev.name)) return 'Field · Jump';
      if (/shot|discus|javelin/i.test(ev.name)) return 'Field · Throw';
      return 'Field · Event';
    }
    return /\b(60|80|100|200|400)m\b/i.test(ev.name) ? 'Track · Sprint' : 'Track · Distance';
  };
  var houseOf = function (id) { return (ST && ST.houses.filter(function (h) { return h.id === id; })[0]) || { name: '?', color: '#999' }; };
  var entryOf = function (id) { for (var i = 0; ST && i < ST.events.length; i++) { var e = ST.events[i].entries.filter(function (x) { return x.id === +id; })[0]; if (e) return { ev: ST.events[i], e: e }; } return null; };
  var isAdmin = function () { return ME && ME.role === 'admin'; };
  var shortName = function (n) { var p = String(n).trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0]; };
  var label = function (ev) { return ev.level + (ev.gender ? (ev.gender === 'F' ? ' girls' : ' boys') : ''); };
  var pill = function (s) { return '<span class="pill ' + s + '">' + ({ scheduled: 'Up next', live: 'Live', completed: 'Done', final: 'Final' }[s] || s) + '</span>'; };

  /* ------------------------------------------------------------------ modal helpers */
  var dlg = $('#dlg');
  var keypadKeys = null;
  document.addEventListener('keydown', function (event) {
    if (!keypadKeys || !dlg.open) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); keypadKeys.save(); }
    else if (/^\d$/.test(event.key) || event.key === '.' || event.key === ',' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation(); keypadKeys.press(event.key);
    }
  }, true);
  function modal(title, html, wire) {
    keypadKeys = null;
    dlg.innerHTML = '<div class="dh"><h3>' + esc(title) + '</h3><button class="btn ghost sm" data-close aria-label="Close">✕</button></div><div class="db">' + html + '</div>';
    if (!dlg.open) dlg.showModal();
    if (wire) wire(dlg);
  }
  var closeModal = function () { if (dlg.open) dlg.close(); };
  dlg.addEventListener('click', function (e) { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  function ask(title, msg, okLabel, danger) {
    return new Promise(function (resolve) {
      modal(title, '<p>' + esc(msg) + '</p><div class="row"><button class="btn ' + (danger ? 'danger' : 'primary') + ' grow" data-yes>' + esc(okLabel || 'OK') + '</button><button class="btn grow" data-close>Cancel</button></div>', function (d) {
        $('[data-yes]', d).onclick = function () { resolve(true); closeModal(); };
        d.addEventListener('close', function once() { d.removeEventListener('close', once); resolve(false); });
      });
    });
  }

  /* ------------------------------------------------------------------ sign in / out */
  function setBootstrapPanel(open) {
    var panel = $('#bootstrap-panel');
    panel.hidden = !open;
    panel.querySelectorAll('input').forEach(function (input) { input.disabled = !open; });
  }
  function checkBootstrapStatus() {
    api('GET', '/api/bootstrap/status').then(function (status) {
      var open = status.required && status.configured;
      $('#bootstrap-open').hidden = !open;
      $('#bootstrap-not-configured').hidden = !status.required || status.configured;
      if (!open) setBootstrapPanel(false);
    }).catch(function () {
      $('#bootstrap-open').hidden = true;
      $('#bootstrap-not-configured').hidden = true;
      setBootstrapPanel(false);
    });
  }
  function showLogin() {
    $('#app').hidden = true; $('#login').hidden = false;
    var f = $('#loginf'); f.password.value = '';
    checkBootstrapStatus();
    setTimeout(function () { f.username.focus(); }, 50);
  }
  function signedOut() { if (ME) { ME = null; closeModal(); showLogin(); } }
  $('#loginf').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target; $('#loginerr').textContent = '';
    api('POST', '/api/login', { username: f.username.value.trim(), password: f.password.value }).then(function (r) { ME = r.user; start(); }, function (er) { $('#loginerr').textContent = er.message; });
  });
  $('#bootstrap-open').addEventListener('click', function () {
    setBootstrapPanel($('#bootstrap-panel').hidden);
    $('#bootstrap-error').textContent = '';
  });
  $('#bootstrap-create').addEventListener('click', function () {
    var fields = ['#setup-key', '#setup-name', '#setup-username', '#setup-password'].map(function (selector) { return $(selector); });
    for (var i = 0; i < fields.length; i++) if (!fields[i].reportValidity()) return;
    var button = $('#bootstrap-create');
    button.disabled = true;
    $('#bootstrap-error').textContent = '';
    api('POST', '/api/bootstrap', {
      setup_key: fields[0].value,
      display_name: fields[1].value,
      username: fields[2].value,
      password: fields[3].value
    }).then(function (r) {
      ME = r.user;
      $('#setup-key').value = '';
      start();
    }, function (error) {
      $('#bootstrap-error').textContent = error.message;
      checkBootstrapStatus();
    }).then(function () { button.disabled = false; });
  });
  function start() {
    $('#login').hidden = true; $('#app').hidden = false;
    var profileName = ME.role === 'admin' ? 'Administrator' : ME.display_name;
    $('#whoami').textContent = profileName;
    $('#profile-role').textContent = ME.role === 'admin' ? 'Admin' : 'Recorder';
    $('#profile-avatar').textContent = String(ME.display_name || profileName).trim().split(/\s+/).slice(0, 2).map(function (part) { return part.charAt(0); }).join('').toUpperCase();
    $('#profile-menu summary').setAttribute('aria-label', 'Open ' + profileName + ' profile menu');
    $('#profile-menu summary').setAttribute('title', 'Signed in as ' + profileName);
    syncTime(); setInterval(syncTime, 60000); offlineBar();
    load().then(function () { connect(); render(); flush(); });
    setInterval(load, 20000);
  }

  /* ------------------------------------------------------------------ router + chrome */
  function route() { var p = location.hash.replace(/^#\/?/, '').split('/'); return { name: p[0] || 'home', a: p[1], b: p[2] }; }
  addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
  function chrome() {
    if (!ST) return;
    var standings = ST.standings.slice().sort(function (a, b) { return (a.rank || Infinity) - (b.rank || Infinity) || b.points - a.points; });
    $('#hchips').innerHTML = standings.map(function (h) {
      return '<span class="hchip house-' + houseKey(h) + '" aria-label="' + esc(h.name) + ', ' + h.points + ' points"><i class="hchip-dot" style="background:' + esc(houseColor(h)) + '" aria-hidden="true"></i><span class="house-name">' + esc(h.name) + '</span><b>' + h.points + '</b></span>';
    }).join('');
    var r = route().name, items = [
      ['home', '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6m-3 0v3m5.5 1.5L19 5"/></svg>', 'Record'],
      ['standings', '<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v2a4 4 0 0 0 4 4m9-6h3v2a4 4 0 0 1-4 4"/></svg>', 'Standings'],
      ['schedule', '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2"/></svg>', 'Schedule'],
    ];
    if (isAdmin()) items.push(['setup', '<svg viewBox="0 0 24 24"><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-6h4m4 6h4"/></svg>', 'Setup']);
    $('#dock-links').innerHTML = items.map(function (t) {
      var on = t[0] === r || (t[0] === 'home' && r === 'event');
      var href = t[0] === 'home' ? '#/' : '#/' + t[0];
      return '<a class="quick-nav-link"' + (on ? ' aria-current="page"' : '') + ' href="' + href + '"><span class="dock-icon" aria-hidden="true">' + t[1] + '</span><span>' + t[2] + '</span></a>';
    }).join('');
  }
  function render() {
    if (!ME || !ST) return;
    var r = route(), y = window.scrollY, html;
    chrome();
    if (r.name === 'event') html = eventView(+r.a);
    else if (r.name === 'standings') html = standingsView();
    else if (r.name === 'schedule') html = scheduleView();
    else if (r.name === 'setup' && isAdmin()) html = setupView(r);
    else html = homeView();
    $('#view').innerHTML = html; window.scrollTo(0, y);
    if (r.name === 'setup' && isAdmin()) setupAfter(r);
    tickClock();
  }

  /* ------------------------------------------------------------------ HOME: events to record */
  function homeView() {
    var f = UI.filter, q = UI.q.toLowerCase();
    var list = ST.events.slice().sort(function (a, b) { var w = { live: 0, scheduled: 1, completed: 2, final: 3 }; return w[a.status] - w[b.status] || (a.time || '99').localeCompare(b.time || '99') || a.id - b.id; });
    var counts = { live: 0, next: 0, done: 0, all: list.length };
    list.forEach(function (e) { if (e.status === 'live') counts.live++; else if (e.status === 'scheduled') counts.next++; else counts.done++; });
    list = list.filter(function (e) { return (f === 'all' || (f === 'live' && e.status === 'live') || (f === 'next' && e.status === 'scheduled') || (f === 'done' && (e.status === 'completed' || e.status === 'final'))) && (!q || (e.name + ' ' + label(e)).toLowerCase().indexOf(q) > -1); });
    var chip = function (k, t) { return '<button data-act="filter" data-k="' + k + '" aria-pressed="' + (f === k) + '">' + t + '<span>' + counts[k] + '</span></button>'; };
    var body = list.map(function (e) {
      var pct = e.count ? Math.round(e.finished / e.count * 100) : 0;
      var action = e.status === 'live' ? 'Record results' : (e.status === 'scheduled' ? 'Start event' : 'View results');
      return '<a class="evc ' + e.status + '" href="#/event/' + e.id + '"><span class="evc-head"><span class="event-category">' + esc(eventCategory(e)) + '</span><span class="tm"><svg class="clock-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"></circle><path d="M8 4.5V8l2.4 1.5"></path></svg>' + esc(scheduleTime(e.time)) + '</span>' + pill(e.status) + '</span><span class="evc-main"><b>' + esc(e.name) + '</b><small>' + esc(label(e)) + (e.heats > 1 ? ' · ' + e.heats + ' heats' : '') + '</small></span><span class="evc-progress"><span class="progress-label"><span>Recorded:</span><b>' + e.finished + ' / ' + e.count + ' athletes</b></span><span class="bar"><i style="width:' + pct + '%"></i></span></span><span class="event-action">' + action + '<span aria-hidden="true">→</span></span></a>';
    }).join('');
    var empty = !ST.events.length ? '<div class="empty card">No events yet.' + (isAdmin() ? ' <a href="#/setup/events">Set up events</a>' : ' Ask an admin to set them up.') + '</div>' : (!list.length ? '<div class="empty card">Nothing here. Try another filter.</div>' : '');
    var board = list.length ? '<div class="events-grid">' + body + '</div>' : empty;
    if (f === 'live' && !q) {
      var upcoming = ST.events.filter(function (e) { return e.status === 'scheduled'; }).sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99') || a.id - b.id; }).slice(0, 3);
      var nextUp = '<aside class="next-up"><div class="next-up-heading"><span class="eyebrow"><span></span> ON DECK</span><h2>Coming up</h2><p>Next on the programme</p></div>' +
        (upcoming.length ? upcoming.map(function (e) { return '<a class="next-event" href="#/event/' + e.id + '"><span class="tm">' + esc(scheduleTime(e.time)) + '</span><span><b>' + esc(e.name) + '</b><small class="next-age">' + esc(label(e)) + '</small></span><span class="next-arrow" aria-hidden="true">›</span></a>'; }).join('') : '<p class="help">No events are waiting in the schedule.</p>') +
        '<a class="next-all" href="#/schedule">View Complete Programme <span aria-hidden="true">→</span></a></aside>';
      board = '<div class="home-board"><div class="events-grid">' + (list.length ? body : empty) + '</div>' + nextUp + '</div>';
    }
    return '<div class="record-toolbar"><div class="filter-tabs" role="group" aria-label="Filter events">' + chip('live', 'Live') + chip('next', 'Up next') + chip('done', 'Done') + chip('all', 'All') + '</div><label class="event-search"><svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"></circle><path d="m13 13 4 4"></path></svg><input id="evq" type="search" placeholder="Find an event, e.g. 100m girls" value="' + esc(UI.q) + '" aria-label="Find an event"></label></div>' + board;
  }

  function scheduleView() {
    var events = ST.events.slice().sort(function (a, b) {
      return (a.time || '99').localeCompare(b.time || '99') || a.id - b.id;
    });
    var items = events.map(function (ev) {
      var action = ev.status === 'scheduled' ? 'Open event' : ev.status === 'live' ? 'Record now' : 'View results';
      return '<article class="schedule-card programme-card"><div class="programme-time"><span>' + esc(scheduleTime(ev.time)) + '</span></div><div class="schedule-copy"><span class="schedule-kicker">' + (ev.kind === 'relay' ? 'RELAY' : ev.measure === 'distance' ? 'FIELD' : 'TRACK') + ' · ' + esc(label(ev)) + '</span><b>' + esc(ev.name) + '</b><small>' + ev.count + (ev.kind === 'relay' ? ' teams' : ' athletes entered') + '</small></div><div class="programme-status">' + pill(ev.status) + '</div><div class="schedule-actions"><a class="btn sm primary" href="#/event/' + ev.id + '">' + action + '</a>' + (isAdmin() ? '<a class="btn sm" href="#/setup/event/' + ev.id + '">Manage entries</a>' : '') + '</div></article>';
    }).join('');
    return '<section class="programme-view"><header class="programme-heading"><div><p class="eyebrow"><span></span> LIVE RUNNING ORDER</p><h1>Schedule & Entries</h1><p>Every event, division and entry in one place.</p></div><span class="programme-total"><b>' + ST.events.length + '</b><small>events</small></span></header><div class="programme-list">' + (items || '<div class="empty card">No events scheduled yet.' + (isAdmin() ? ' <a href="#/setup/events">Build the programme</a>' : '') + '</div>') + '</div></section>';
  }

  /* ------------------------------------------------------------------ EVENT: the recording screen */
  function eventView(id) {
    var ev = evOf(id); if (!ev) return '<div class="empty card">That event no longer exists. <a href="#/">Back to events</a></div>';
    var heats = ev.heats || 1, heat = UI.heat[id] || 1; if (heat > heats) heat = 1;
    var timed = ev.measure === 'time', locked = ev.status === 'final' && !isAdmin();
    var cur = ev.entries.filter(function (e) { return e.heat === heat; }).sort(function (a, b) { return (a.bib || '').localeCompare(b.bib || '', undefined, { numeric: true }) || a.name.localeCompare(b.name); });
    var st = timed ? clockStart(id, heat) : null;
    var end = timed ? clockEnd(ev, heat) : null;
    var head = '<div class="ehead"><a class="btn sm" href="#/">‹ Events</a><div class="grow"><h2>' + esc(ev.name) + '</h2><small>' + esc(label(ev)) + ' · ' + ev.finished + ' of ' + ev.count + ' done</small></div>' + pill(ev.status) + '<button class="btn sm" data-act="evmenu" data-id="' + id + '" aria-label="More">⋯</button></div>';
    var heatBar = heats > 1 ? '<div class="heats">' + Array.apply(null, Array(heats)).map(function (_, i) { var n = i + 1, d = ev.entries.filter(function (e) { return e.heat === n && (e.position !== null || e.status !== 'ok'); }).length, t = ev.entries.filter(function (e) { return e.heat === n; }).length; return '<button data-act="heat" data-n="' + n + '" data-id="' + id + '" aria-pressed="' + (n === heat) + '">Heat ' + n + ' · ' + d + '/' + t + '</button>'; }).join('') + '</div>' : '';
    var clock = timed ? '<div class="clock ' + (st && !end ? 'run' : '') + '"><div class="t" id="clk" data-ev="' + id + '" data-heat="' + heat + '">' + fmtClock(st ? (end || serverNow()) - st : 0) + '</div>' +
      (st ? '<button class="btn" data-act="resetclock" data-id="' + id + '" data-heat="' + heat + '"' + (locked ? ' disabled' : '') + '>Reset clock</button>' : '<button class="btn primary big" data-act="startclock" data-id="' + id + '" data-heat="' + heat + '"' + (locked ? ' disabled' : '') + '>▶ Start clock</button>') + '</div>' : '<p class="help">Tap an athlete, type the distance on the keypad, then Save. Longest wins.</p>';
    var tiles = cur.length ? '<div class="tiles">' + cur.map(function (e) { return tile(ev, e); }).join('') + '</div>' : '<div class="empty card">No athletes in this ' + (heats > 1 ? 'heat' : 'event') + '.' + (isAdmin() ? ' <a href="#/setup/event/' + id + '">Add athletes</a>' : ' Ask an admin to add them.') + '</div>';
    var placed = ev.entries.filter(function (e) { return e.position !== null; }).sort(function (a, b) { return a.position - b.position; });
    var out = ev.entries.filter(function (e) { return e.status !== 'ok'; });
    var rows = placed.map(function (e, i) {
      var h = houseOf(e.house_id);
      return '<div class="ord house-' + houseKey(h) + '"><span class="p">' + e.position + '</span><span><span class="dot" style="background:' + esc(houseColor(h)) + '"></span><b>' + esc(e.bib) + '</b> ' + esc(shortName(e.name)) + (heats > 1 ? ' <small>H' + e.heat + '</small>' : '') + '</span><span class="t">' + esc(e.performance) + '</span><span class="btns">' +
        (ev.kind !== 'relay' && i > 0 ? '<button data-act="swap" data-a="' + e.id + '" data-b="' + placed[i - 1].id + '" aria-label="Move up" title="Swap with the one above">↑</button>' : '') + (ev.kind !== 'relay' && i < placed.length - 1 ? '<button data-act="swap" data-a="' + e.id + '" data-b="' + placed[i + 1].id + '" aria-label="Move down" title="Swap with the one below">↓</button>' : '') + '<button data-act="entrymenu" data-id="' + e.id + '" aria-label="Options">⋯</button></span></div>';
    }).join('');
    var order = '<div class="sub">Finishing order</div>' + (placed.length ? '<div class="order">' + rows + '</div>' : '<div class="help">Results appear here as you tap. Use ↑ ↓ to fix the order if two were swapped.</div>') + (out.length ? '<p class="help">Not running: ' + out.map(function (e) { return esc(e.bib + ' ' + shortName(e.name)) + ' (' + e.status.toUpperCase() + ')'; }).join(', ') + '</p>' : '');
    var dock = locked ? '<div class="dock"><span class="bad">This event is finalised. Ask an admin to reopen it.</span></div>' : '<div class="dock"><button class="btn" data-act="undo" data-id="' + id + '">↶ Undo last</button>' + (ev.status === 'completed' || ev.status === 'final' ? '<button class="btn" data-act="reopen" data-id="' + id + '">Reopen event</button>' : '<button class="btn primary" data-act="finish" data-id="' + id + '">Finish event ✓</button>') + '</div>';
    return head + heatBar + clock + tiles + order + dock;
  }
  function tile(ev, e) {
    var h = houseOf(e.house_id), state = e.status !== 'ok' ? 'out' : e.position !== null ? 'done' : 'wait', rel = ev.kind === 'relay';
    var members = (e.relayMembers || []).slice().sort(function (a, b) { return a.leg - b.leg; });
    var relayLeg = (e.relaySplits || []).length + 1;
    var runner = members[relayLeg - 1];
    var relayDone = (e.relaySplits || []).map(function (s) { return 'L' + s.leg + ' ' + fmtTime(s.splitMs / 1000); }).join(' · ');
    var inner = (rel ? '<span class="bib">' + esc(h.name) + '</span><span class="nm">4 × 100m team</span>' +
      (members.length === 4 ? '<span class="hn">' + (state === 'done' || state === 'out' ? 'Runners: ' : 'Next: Leg ' + relayLeg + ' · ') + esc(state === 'done' || state === 'out' ? members.map(function (m) { return m.name; }).join(', ') : runner.name) + '</span>' : '<span class="hn">Lineup not set</span>') +
      (relayDone ? '<span class="relay-splits">' + esc(relayDone) + '</span>' : '') :
      '<span class="bib">' + esc(e.bib) + '</span><span class="nm">' + esc(shortName(e.name)) + '</span><span class="hn">' + esc(h.name) + '</span>') +
      (state === 'done' ? '<span class="res">' + esc(e.performance) + '</span><span class="place">' + ord(e.position) + '</span>' : state === 'out' ? '<span class="res">' + esc(e.status.toUpperCase()) + '</span>' : '');
    return '<div class="tilew"><button class="tile ' + state + ' house-' + houseKey(h) + '" style="--c:' + esc(houseColor(h)) + '" data-act="tap" data-id="' + e.id + '"' + (rel && state === 'wait' && members.length !== 4 ? ' disabled' : '') + ' aria-label="' + esc((rel ? h.name + ' relay team' : e.bib + ' ' + e.name) + (state === 'done' ? ', ' + ord(e.position) + ', ' + e.performance : '')) + '">' + inner + '</button><button class="more" data-act="entrymenu" data-id="' + e.id + '" aria-label="Options for ' + esc(e.name) + '">⋯</button></div>';
  }
  var raf = 0;
  function tickClock() {
    cancelAnimationFrame(raf);
    var el = $('#clk'); if (!el) return;
    (function f() {
      var c = $('#clk'); if (!c) return;
      var ev = evOf(+c.dataset.ev), heat = +c.dataset.heat, st = clockStart(+c.dataset.ev, heat), end = ev && clockEnd(ev, heat);
      c.textContent = fmtClock(st ? (end || serverNow()) - st : 0);
      raf = requestAnimationFrame(f);
    })();
  }

  function tapEntry(id) {
    var f = entryOf(id); if (!f) return; var ev = f.ev, e = f.e;
    if (ev.status === 'final' && !isAdmin()) return toast('This event is finalised', 'e');
    if (e.status !== 'ok' || e.position !== null) return entryMenu(id);               // already has a result: offer fixes instead of a second tap
    if (ev.kind === 'relay') {
      if ((e.relayMembers || []).length !== 4) return toast('Ask an admin to set four runners for this team', 'e');
      var start = clockStart(ev.id, e.heat); if (!start) return toast('Start the clock first');
      var leg = (e.relaySplits || []).length + 1;
      if (leg > 4) return toast('All four relay legs are already recorded', 'e');
      var elapsedMs = Math.max(1, Math.round(serverNow() - start));
      (UI.last[ev.id] = UI.last[ev.id] || []).push(e.id);
      buzz(30);
      enqueue('/api/entries/' + e.id + '/relay-split', { leg: leg, elapsedMs: elapsedMs }, { k: 'relay', id: e.id, leg: leg, elapsedMs: elapsedMs });
      overlay(); render();
      return;
    }
    if (ev.measure === 'distance') return keypad(e, ev);
    var st = clockStart(ev.id, e.heat); if (!st) return toast('Start the clock first');
    var ms = Math.max(1, Math.round(serverNow() - st));
    (UI.last[ev.id] = UI.last[ev.id] || []).push(e.id);
    buzz(30);
    enqueue('/api/entries/' + e.id + '/time', { ms: ms }, { k: 'time', id: e.id, ms: ms });
    overlay(); render();
    var t = $('.tile[data-id="' + e.id + '"]'); if (t) t.classList.add('flash');
  }

  function keypad(e, ev, then) {
    var val = '';
    var title = (ev.kind === 'relay' ? houseOf(e.house_id).name : e.bib + ' ' + shortName(e.name));
    modal(title, '<div class="keyout" id="ko">0</div><div class="help" style="text-align:center">' + esc(ev.name) + ' · metres</div><div class="keys">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0, '⌫'].map(function (k) { return '<button type="button" data-k="' + k + '">' + k + '</button>'; }).join('') + '</div><p class="help">Keyboard: numbers, . or , · Backspace to delete · Enter to save</p><div class="row"><button class="btn primary big grow" data-save>Save</button></div>', function (d) {
      var out = $('#ko', d), show = function () { out.textContent = val || '0'; };
      var press = function (k) {
        if (k === '⌫' || k === 'Backspace') val = val.slice(0, -1);
        else if (k === '.' || k === ',') { if (val.indexOf('.') < 0) val = (val || '0') + '.'; }
        else if (/^\d$/.test(k) && val.replace('.', '').length < 6) val += k;
        show();
      };
      var save = function () {
        var v = parseFloat(val); if (!(v > 0)) return toast('Type a distance first', 'e');
        enqueue('/api/entries/' + e.id + '/mark', { value: v }, { k: 'mark', id: e.id, v: v }); (UI.last[ev.id] = UI.last[ev.id] || []).push(e.id); buzz(30); overlay(); closeModal(); render(); if (then) then();
      };
      $$('.keys button', d).forEach(function (b) { b.onclick = function () { press(b.dataset.k); }; });
      $('[data-save]', d).onclick = save;
      keypadKeys = { press: press, save: save };
      d.addEventListener('close', function () { keypadKeys = null; }, { once: true });
    });
  }
  function manualTime(e, ev) {
    modal(e.bib + ' ' + shortName(e.name), '<label>Time (for example 12.34 or 1:02.50)<input id="mt" inputmode="decimal" autocomplete="off" placeholder="12.34"></label><div class="row"><button class="btn primary grow" data-save>Save time</button></div>', function (d) {
      setTimeout(function () { $('#mt', d).focus(); }, 60);
      $('[data-save]', d).onclick = function () {
        var ms = parseTime($('#mt', d).value); if (!ms) return toast('Type a time like 12.34', 'e');
        enqueue('/api/entries/' + e.id + '/time', { ms: ms }, { k: 'time', id: e.id, ms: ms }); overlay(); closeModal(); render();
      };
    });
  }
  function entryMenu(id) {
    var f = entryOf(id); if (!f) return; var ev = f.ev, e = f.e, has = e.position !== null || e.status !== 'ok', h = houseOf(e.house_id), heats = (ev.heats || 1) + 1;
    var opt = function (a, t, cls) { return '<button class="opt ' + (cls || '') + '" data-act="' + a + '" data-id="' + id + '">' + t + '</button>'; };
    var hb = '<div class="chips" style="margin:0">' + Array.apply(null, Array(Math.min(heats, 30))).map(function (_, i) { return '<button data-act="moveheat" data-id="' + id + '" data-n="' + (i + 1) + '" aria-pressed="' + (e.heat === i + 1) + '">Heat ' + (i + 1) + '</button>'; }).join('') + '</div>';
    modal((ev.kind === 'relay' ? h.name + ' team' : e.bib + ' ' + shortName(e.name)), '<p class="help" style="margin:0"><span class="dot" style="background:' + esc(houseColor(h)) + '"></span>' + esc(h.name) + (e.performance ? ' · ' + esc(e.performance) + (e.position ? ' · ' + ord(e.position) : '') : '') + '</p>' +
      (ev.kind === 'relay' ? '' : opt('manual', ev.measure === 'time' ? 'Enter a time by hand' : 'Enter a distance')) + opt('setstatus-dns', 'Did not start (DNS)') + opt('setstatus-dnf', 'Did not finish (DNF)') + opt('setstatus-dq', 'Disqualified (DQ)') + (has ? opt('clearresult', 'Clear this result and relay splits', 'bad') : '') +
      '<div class="help" style="margin:4px 0 0">Move to heat</div>' + hb + (isAdmin() ? opt('removeentry', 'Remove from this event', 'bad') : ''));
  }

  /* ------------------------------------------------------------------ STANDINGS (read-only for recorders) */
  function standingsView() {
    var s = ST, ordered = s.standings.slice().sort(function (a, b) { return b.points - a.points || b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze; });
    var leader = ordered[0] || { points: 0 };
    var medalIcon = '<svg class="medal-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="5"></circle><path d="m8.7 12.2-1.2 8 4.5-2.6 4.5 2.6-1.2-8"></path></svg>';
    var crownIcon = '<svg class="podium-award-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 8 4 3 5-7 5 7 4-3-2 12H5L3 8Z"></path><path d="M5 17h14"></path></svg>';
    var disciplinePoints = {};
    s.events.forEach(function (ev) {
      ev.entries.forEach(function (entry) {
        var stats = disciplinePoints[entry.house_id] || (disciplinePoints[entry.house_id] = { track: 0, field: 0 });
        stats[ev.measure === 'distance' ? 'field' : 'track'] += Number(entry.points) || 0;
      });
    });
    var card = function (h, i, compact) {
      var gap = leader.points - h.points;
      var isLeader = i === 0, gapText = gap ? '-' + gap + ' pts from lead' : 'LEVEL';
      if (compact) {
        return '<article class="house-card runner-up-card house-' + houseKey(h) + '"><span class="house-rank">#' + (i + 1) + '</span><span class="runner-up-house"><i class="house-orb" aria-hidden="true"></i><b>' + esc(h.name) + '</b></span><b class="runner-up-score">' + h.points + ' pts</b><span class="runner-up-gap">' + esc(gapText) + '</span></article>';
      }
      var stats = disciplinePoints[h.house_id] || { track: 0, field: 0 }, total = stats.track + stats.field;
      var trackPct = total ? Math.round(stats.track / total * 100) : 0, fieldPct = total ? 100 - trackPct : 0;
      var placeLabel = isLeader ? 'CHAMPION' : (i === 1 ? 'RUNNER UP' : 'THIRD PLACE');
      var placeIcon = isLeader ? crownIcon : medalIcon.replace('class="medal-icon"', 'class="podium-award-icon"');
      return '<article class="house-card house-' + houseKey(h) + (compact ? ' compact' : ' podium-' + (['first', 'second', 'third'][i] || 'runner')) + '">' +
        '<div class="podium-card-top"><span class="podium-rank' + (isLeader ? ' leader-rank' : '') + '">' + placeIcon + '#' + (i + 1) + ' ' + placeLabel + '</span><span class="podium-gap' + (isLeader ? ' leader-gap' : '') + '">' + (isLeader ? (h.points ? 'PACE SETTER' : 'AWAITING RESULTS') : esc(gap ? '-' + gap + ' pts' : 'LEVEL')) + '</span></div>' +
        '<div class="house-identity"><span class="house-orb" aria-hidden="true"></span><h2>' + esc(h.name) + '</h2><b class="house-score">' + h.points + '</b></div>' +
        '<div class="medal-row" aria-label="Medals: ' + h.gold + ' gold, ' + h.silver + ' silver, ' + h.bronze + ' bronze"><span class="medal gold">' + medalIcon + '<span>Gold</span> <b>' + h.gold + '</b></span><span class="medal silver">' + medalIcon + '<span>Silver</span> <b>' + h.silver + '</b></span><span class="medal bronze">' + medalIcon + '<span>Bronze</span> <b>' + h.bronze + '</b></span></div>' +
        '<div class="discipline-bar" role="img" aria-label="Track ' + stats.track + ' points, field ' + stats.field + ' points"><i class="track-segment" style="width:' + trackPct + '%"></i><i class="field-segment" style="width:' + fieldPct + '%"></i></div><div class="discipline-label"><span>Track <b>' + stats.track + ' pts</b></span><span>Field <b>' + stats.field + ' pts</b></span></div>' +
        '</article>';
    };
    var podium = ordered.slice(0, 3).map(function (h, i) { return card(h, i, false); }).join('');
    var runnersUp = ordered.slice(3).map(function (h, i) { return card(h, i + 3, true); }).join('');
    var top = (s.awards.topAthletes || []).slice(0, 5).map(function (a) {
      var h = houseOf(a.house_id), rankClass = a.rank <= 3 ? ' rank-' + a.rank : '';
      return '<li class="athlete-leaderboard-row"><span class="athlete-rank' + rankClass + '">#' + a.rank + '</span><span class="athlete-main"><b class="athlete-name">' + esc(a.name) + '</b><span class="athlete-house"><i class="dot" style="background:' + esc(houseColor(h)) + '" aria-hidden="true"></i>' + esc(h.name) + '</span></span><b class="athlete-points">' + a.points + ' pts</b></li>';
    }).join('');
    return '<div class="leaderboard-head"><div><p class="eyebrow"><span></span> LIVE HOUSE TELEMETRY</p><h1>Championship standings</h1><p>' + s.progress.done + ' of ' + s.progress.total + ' events complete · points update as results are recorded</p></div><div class="leaderboard-links"><a class="btn sm" href="/" target="_blank" rel="noopener">Public page</a><a class="btn sm" href="/report" target="_blank" rel="noopener">Full report</a></div></div>' +
      '<section class="leaderboard-podium" aria-label="Top three houses">' + podium + '</section>' + (runnersUp ? '<section class="runner-up-list" aria-label="Remaining houses">' + runnersUp + '</section>' : '') +
      '<section class="top-athletes card"><header class="top-athletes-heading"><div><h2>Top Athletes</h2><p>INDIVIDUAL POINTS</p></div></header>' + (top ? '<ol class="athlete-leaderboard">' + top + '</ol>' : '<div class="empty">No results yet.</div>') + '</section>';
  }

  /* ------------------------------------------------------------------ SETUP (admin only) */
  var STD = [['60m', 'time'], ['100m', 'time'], ['200m', 'time'], ['400m', 'time'], ['800m', 'time'], ['1500m', 'time'], ['Long jump', 'distance'], ['High jump', 'distance'], ['Triple jump', 'distance'], ['Shot put', 'distance'], ['Discus', 'distance'], ['Javelin', 'distance'], ['4 x 100m Relay', 'relay']];
  var QA = { names: { '100m': 1, 'Long jump': 1 }, levels: { Junior: 1, Intermediate: 1, Senior: 1 }, genders: { F: 1, M: 1 }, fill: true, custom: [] };
  var LEVELS = ['Junior', 'Intermediate', 'Senior'];

  function setupView(r) {
    var tab = r.a || 'athletes', current = tab === 'event' ? 'events' : tab;
    var sections = [
      { key: 'athletes', n: '01', title: 'Athlete roster', note: ATH ? ATH.length + ' on the list' : 'People & houses' },
      { key: 'events', n: '02', title: 'Events & entries', note: ST.events.length + ' scheduled' },
      { key: 'team', n: '03', title: 'Staff team', note: 'Accounts & access' },
      { key: 'day', n: '04', title: 'Meet settings', note: 'Scoring & results' }
    ];
    var titles = { athletes: 'Athlete roster', events: 'Event programme', event: 'Event control', team: 'Officials', day: 'Scoring & results' };
    var descriptions = {
      athletes: 'Import the school roster once, then place athletes into events from one list.',
      events: 'Choose disciplines and divisions, then generate a live-ready programme from the roster.',
      event: 'Manage entries, relay lineups and heats for this event.',
      team: 'Add recorders and give each official the access they need.',
      day: 'Set house points, meet details and final-results controls.'
    };
    var nav = '<nav class="setup-rail" aria-label="Meet setup">' + sections.map(function (s) {
      var active = s.key === current;
      return '<a class="setup-step' + (active ? ' active' : '') + '" href="#/setup/' + s.key + '"' + (active ? ' aria-current="step"' : '') + '><span class="step-n">' + s.n + '</span><span class="step-copy"><b>' + s.title + '</b><small>' + s.note + '</small></span><span class="step-arrow" aria-hidden="true">↗</span></a>';
    }).join('') + '<div class="rail-note"><span class="rail-dot"></span><span><b>One meet. One live picture.</b><small>Changes show up across the event screens as you work.</small></span></div></nav>';
    var content = tab === 'events' ? eventsSetup() : tab === 'event' ? eventManage(+r.b) : tab === 'team' ? teamSetup() : tab === 'day' ? daySetup() : athletesSetup();
    var scheduled = ST.events.filter(function (e) { return e.status === 'scheduled'; }).length;
    return '<div class="setup-shell setup-command-center"><header class="setup-intro"><div class="intro-copy"><p class="eyebrow"><span></span> SPORTS DAY 2026 · COMMAND CENTER</p><h1>' + titles[tab] + '</h1><p>' + descriptions[tab] + '</p></div><div class="setup-stats"><span><i></i><b>' + scheduled + '</b><small>Scheduled</small></span><span><i></i><b>' + (ATH ? ATH.length : '–') + '</b><small>Athletes</small></span><span><i></i><b>' + ST.houses.length + '</b><small>Houses</small></span></div></header><div class="setup-grid">' + nav + '<div class="setup-content">' + content + '</div></div></div>';
  }
  function setupAfter(r) {
    var tab = r.a || 'athletes';
    if (!ATH) api('GET', '/api/athletes').then(function (d) { ATH = d.athletes; render(); }, fail);
    if (tab === 'team' && !USERS) api('GET', '/api/users').then(function (d) { USERS = d.users; render(); }, fail);
    if (tab === 'day' && !AUDIT) api('GET', '/api/admin/audit?limit=60').then(function (d) { AUDIT = d.audit; render(); }, fail);
  }
  var refreshAth = function () { return api('GET', '/api/athletes').then(function (d) { ATH = d.athletes; }); };
  var houseSelect = function (name, all) { return '<select name="' + name + '">' + (all ? '<option value="">All houses</option>' : '') + ST.houses.map(function (h) { return '<option value="' + h.id + '">' + esc(h.name) + '</option>'; }).join('') + '</select>'; };

  /* --- 1. athletes --- */
  function athletesSetup() {
    var fileDetails = PENDING_ROSTER ? '<div class="file-preview"><div><b>' + esc(PENDING_FILE) + '</b><small>' + PENDING_ROSTER.length + ' athlete rows detected · ' + PENDING_ROSTER.filter(function (row) { return row.events; }).length + ' with event requests</small></div><div class="file-preview-actions"><button class="btn sm" data-act="cancelimport">Remove file</button><button class="btn primary sm" data-act="import"' + (IMPORTING_ROSTER ? ' disabled' : '') + '>' + (IMPORTING_ROSTER ? 'Importing…' : 'Import ' + PENDING_ROSTER.length + ' athletes') + '</button></div><ul>' + PENDING_ROSTER.slice(0, 4).map(function (row) { return '<li>' + esc(row.full_name || 'Name missing') + ' · ' + esc(row.house || 'House missing') + ' · ' + esc(row.level || 'Age group missing') + '</li>'; }).join('') + (PENDING_ROSTER.length > 4 ? '<li>and ' + (PENDING_ROSTER.length - 4) + ' more…</li>' : '') + '</ul></div>' : '';
    var upload = '<section class="roster-upload card"><div class="dropzone-wrap"><label class="dropzone" id="roster-dropzone" for="csvfile" tabindex="0"><span class="upload-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4"></path></svg></span><span class="upload-title"><b>' + (PARSING_ROSTER ? 'Reading your roster…' : 'Drop your roster here or browse files') + '</b><small>Excel workbook or delimited text · up to 8 MB</small></span><span class="file-types">XLSX <i>·</i> XLS <i>·</i> CSV <i>·</i> TXT</span><input type="file" id="csvfile" accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain" aria-label="Choose an Excel or CSV roster"' + (PARSING_ROSTER ? ' disabled' : '') + '></label><div class="column-hint"><b>Columns we recognize</b><span>Name</span><span>House</span><span>Age Group</span><span>Gender</span><span>Events <small>optional</small></span></div></div><div class="roster-upload-copy"><p class="eyebrow">ROSTER INTAKE</p><h2>Bring your team in.</h2><p>We read the first worksheet, match column headings, and prepare category-ready athletes. Houses, age groups and gender values are checked when you import.</p><a class="template-link" href="/api/athletes/template.xlsx">Download sample Excel template <span aria-hidden="true">↓</span></a><small>Events can contain names such as <b>100m, Long jump</b>. Bibs are generated automatically if omitted.</small></div></section>' + fileDetails;
    if (!ATH) return upload + '<div class="empty">Loading the roster…</div>';

    var scheduled = ST.events.filter(function (ev) { return ev.status === 'scheduled'; }).length;
    var quick = '<div class="quick-add-strip"><span><b>Adding one athlete?</b><small>Keep the roster tidy with a single quick entry.</small></span><button class="btn sm" data-act="quickadd">+ Quick add athlete</button></div>';
    var seedIcon = '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 2-3 8h7l-6 12 1-9H5l8-11Z"/></svg>';
    var seed = '<section class="auto-seed-card"><div><p class="eyebrow">CATEGORY SEEDING</p><h2>Fill the programme in one pass</h2><p>Every scheduled event is matched to athletes by age group and gender. Existing entries are left alone.</p></div><button class="btn primary seed-button" data-act="seedall"' + (!ATH.length || !scheduled || SEEDING_ROSTER ? ' disabled' : '') + '>' + seedIcon + (SEEDING_ROSTER ? 'Seeding events…' : 'Auto-Seed All Events by Category') + '</button></section>';
    var notice = '';
    if (ROSTER_SUMMARY) {
      var summaryText = ROSTER_SUMMARY.athletes + ' athletes loaded · ' + ROSTER_SUMMARY.events + ' events seeded · ' + ROSTER_SUMMARY.entries + ' total entries created';
      notice = '<div class="roster-summary" role="status"><span class="summary-check" aria-hidden="true">✓</span><span><b>' + esc(summaryText) + '</b>' + (ROSTER_SUMMARY.skipped ? '<small>' + ROSTER_SUMMARY.skipped + ' existing athletes were skipped as duplicates.</small>' : '') + (ROSTER_SUMMARY.errorCount ? '<small class="summary-warning">' + esc(ROSTER_SUMMARY.errorCount + ' item(s) need attention: ' + ROSTER_SUMMARY.failures.slice(0, 3).join('; ')) + '</small>' : '') + '</span></div>';
    }

    var q = UI.aq.toLowerCase(), hf = UI.ahouse;
    var per = ST.houses.map(function (h) { return ATH.filter(function (a) { return a.house_id === h.id; }).length; });
    var list = ATH.filter(function (a) { return (hf === 'all' || a.house_id === +hf) && (!q || (a.full_name + ' ' + a.bib).toLowerCase().indexOf(q) > -1); });
    var chips = '<div class="chips"><button data-act="ahouse" data-k="all" aria-pressed="' + (hf === 'all') + '">All (' + ATH.length + ')</button>' + ST.houses.map(function (h, i) { return '<button class="house-' + houseKey(h) + '" data-act="ahouse" data-k="' + h.id + '" aria-pressed="' + (hf === String(h.id) || hf === h.id) + '"><span class="dot" style="background:' + esc(houseColor(h)) + '"></span>' + esc(h.name) + ' (' + per[i] + ')</button>'; }).join('') + '</div>';
    var rows = list.slice(0, 400).map(function (a) {
      var h = houseOf(a.house_id), eventCount = Number(a.entries) || 0;
      return '<tr class="roster-row"><td><b class="roster-bib">' + esc(a.bib) + '</b></td><td><b class="roster-name">' + esc(a.full_name) + '</b></td><td><span class="dot" style="background:' + esc(houseColor(h)) + '"></span>' + esc(h.name) + '</td><td>' + esc(a.level || '–') + '</td><td>' + (a.gender === 'F' ? 'Girl' : a.gender === 'M' ? 'Boy' : '–') + '</td><td><span class="entry-count">' + eventCount + ' event' + (eventCount === 1 ? '' : 's') + ' entered</span></td><td><div class="roster-actions"><button class="btn sm" data-act="editath" data-id="' + a.id + '">Edit</button><button class="btn sm danger" data-act="deleteath" data-id="' + a.id + '">Remove</button></div></td></tr>';
    }).join('');
    var roster = '<section class="roster-table-card card"><div class="roster-table-heading"><div><p class="eyebrow">ATHLETE DIRECTORY</p><h2>Roster <span>' + ATH.length + '</span></h2></div><div class="roster-table-actions"><a class="btn sm" href="/api/athletes.csv">Export Roster CSV</a><button class="btn sm danger" data-act="clearroster"' + (!ATH.length ? ' disabled' : '') + '>Clear Roster</button></div></div><div class="roster-filters"><label class="roster-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"></circle><path d="m13 13 4 4"></path></svg><input id="aq" type="search" placeholder="Search athlete or bib..." value="' + esc(UI.aq) + '" aria-label="Search athlete or bib"></label>' + chips + '</div><div class="tw roster-table-wrap"><table><thead><tr><th>Bib</th><th>Name</th><th>House</th><th>Age group</th><th>Gender</th><th>Events entered</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="empty">No athletes match this view. Add a roster or change the search/filter.</td></tr>') + '</tbody></table></div>' + (list.length > 400 ? '<p class="help">Showing the first 400. Use search to narrow down.</p>' : '') + '</section>';
    return upload + quick + seed + notice + roster;
  }
  function parseRosterFile(file) {
    if (!/\.(xlsx|xls|csv|txt)$/i.test(file.name)) return toast('Choose an .xlsx, .xls, .csv or .txt file', 'e');
    if (file.size > 8 * 1024 * 1024) return toast('Roster files must be 8 MB or smaller', 'e');
    PARSING_ROSTER = true; PENDING_ROSTER = null; PENDING_FILE = file.name; render();
    file.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer), binary = '';
      for (var i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
      return api('POST', '/api/athletes/parse-file', { filename: file.name, data: btoa(binary) });
    }).then(function (result) {
      PENDING_ROSTER = result.rows; PARSING_ROSTER = false; ROSTER_SUMMARY = null;
      render(); toast(PENDING_ROSTER.length + ' athletes ready to import');
    }).catch(function (error) {
      PARSING_ROSTER = false; PENDING_FILE = ''; render(); fail(error);
    });
  }
  function normalizedText(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function seedNamedEvents(rows) {
    var groups = {}, failures = [];
    rows.forEach(function (row, index) {
      var requested = String(row.events || '').split(/[,;|\n]/).map(function (name) { return name.trim(); }).filter(Boolean);
      if (!requested.length) return;
      var houseName = normalizedText(row.house);
      var house = ST.houses.filter(function (h) { return normalizedText(h.name) === houseName || (houseName.length === 1 && normalizedText(h.name.charAt(0)) === houseName); })[0];
      var athlete = house && ATH.filter(function (a) { return a.house_id === house.id && normalizedText(a.full_name) === normalizedText(row.full_name); })[0];
      if (!athlete) { failures.push('Row ' + (index + 1) + ': could not match this athlete to the imported roster'); return; }
      requested.forEach(function (name) {
        var matches = ST.events.filter(function (ev) {
          return ev.status === 'scheduled' && normalizedText(ev.name) === normalizedText(name) &&
            (ev.level === 'Mixed' || ev.level === athlete.level) && (!ev.gender || ev.gender === athlete.gender);
        });
        if (!matches.length) { failures.push(row.full_name + ': no scheduled eligible event named "' + name + '"'); return; }
        matches.forEach(function (ev) {
          if (ev.kind === 'relay') { failures.push(row.full_name + ': relay entries are seeded by team, not individual'); return; }
          groups[ev.id] = groups[ev.id] || { name: ev.name, ids: [] };
          if (groups[ev.id].ids.indexOf(athlete.id) < 0) groups[ev.id].ids.push(athlete.id);
        });
      });
    });
    var eventIds = Object.keys(groups);
    var addedEntries = 0, eventsSeeded = 0, chain = Promise.resolve();
    eventIds.forEach(function (id) {
      chain = chain.then(function () {
        return api('POST', '/api/events/' + id + '/entries', { athlete_ids: groups[id].ids }).then(function (result) {
          addedEntries += result.added; if (result.added) eventsSeeded++;
        }).catch(function (error) { failures.push(groups[id].name + ': ' + error.message); });
      });
    });
    return chain.then(function () { return { entries: addedEntries, events: eventsSeeded, failures: failures }; });
  }
  function importAthletes() {
    if (!PENDING_ROSTER || !PENDING_ROSTER.length) return toast('Choose a roster file first', 'e');
    if (IMPORTING_ROSTER) return;
    var rows = PENDING_ROSTER.slice();
    IMPORTING_ROSTER = true; render();
    api('POST', '/api/athletes/import', { rows: rows }).then(function (result) {
      return Promise.all([refreshAth(), load()]).then(function () { return seedNamedEvents(rows); }).then(function (direct) {
        PENDING_ROSTER = null; PENDING_FILE = ''; IMPORTING_ROSTER = false;
        ROSTER_SUMMARY = { athletes: result.created, skipped: result.skipped, events: direct.events, entries: direct.entries, errorCount: result.errorCount + direct.failures.length, failures: direct.failures.concat(result.errors || []) };
        render(); toast(result.created + ' athletes loaded · ' + direct.entries + ' event entries created');
      });
    }).catch(function (error) {
      IMPORTING_ROSTER = false; render(); fail(error);
    });
  }
  function autoSeedEvents() {
    var events = ST.events.filter(function (ev) { return ev.status === 'scheduled'; });
    if (!ATH.length) return toast('Import athletes before seeding events', 'e');
    if (!events.length) return toast('Create scheduled events before seeding the roster', 'e');
    if (SEEDING_ROSTER) return;
    SEEDING_ROSTER = true; render();
    var seeded = 0, entries = 0, failures = [], chain = Promise.resolve();
    events.forEach(function (ev) {
      chain = chain.then(function () {
        return api('POST', '/api/events/' + ev.id + '/entries', { all: true }).then(function (result) {
          if (result.total) seeded++;
          entries += result.added;
        }).catch(function (error) {
          failures.push(ev.name + ' · ' + label(ev) + ': ' + error.message);
          if (error.status === 401 || error.network) throw error;
        });
      });
    });
    chain.then(function () {
      return Promise.all([load(), refreshAth()]).then(function () {
        SEEDING_ROSTER = false; ROSTER_SUMMARY = { athletes: ATH.length, events: seeded, entries: entries, errorCount: failures.length, failures: failures };
        render(); toast(seeded + ' events seeded · ' + entries + ' entries created');
      });
    }).catch(function (error) {
      SEEDING_ROSTER = false; render(); fail(error);
    });
  }
  function quickAddAthlete() {
    modal('Quick add athlete', '<form id="addath" class="formrow quick-add-form"><label>Full name<input name="full_name" required autocomplete="off"></label><label>House' + houseSelect('house_id') + '</label><label>Age group<select name="level"><option value="">Choose age group</option>' + LEVELS.map(function (level) { return '<option>' + level + '</option>'; }).join('') + '</select></label><label>Gender<select name="gender"><option value="">Choose gender</option><option value="F">Girl</option><option value="M">Boy</option></select></label><button class="btn primary">Add athlete</button></form>', function (dialog) {
      $('#addath input', dialog).focus();
    });
  }
  function removeAthlete(id) {
    var athlete = ATH.filter(function (a) { return a.id === +id; })[0];
    if (!athlete) return;
    ask('Remove ' + athlete.full_name + '?', 'This removes the athlete and their event entries. Recorded results must be cleared first.', 'Remove athlete', true).then(function (confirmed) {
      if (!confirmed) return;
      api('DELETE', '/api/athletes/' + athlete.id).then(function () { return Promise.all([refreshAth(), load()]); }).then(render, fail);
    });
  }
  function clearRoster() {
    if (!ATH.length) return;
    ask('Clear the entire roster?', 'All athletes and their event entries will be removed. A database backup is saved first. Clear results before clearing a roster that already has recorded results.', 'Clear roster', true).then(function (confirmed) {
      if (!confirmed) return;
      api('POST', '/api/athletes/clear', {}).then(function (result) {
        ATH = []; PENDING_ROSTER = null; PENDING_FILE = ''; ROSTER_SUMMARY = null;
        return Promise.all([load(), refreshAth()]).then(function () { render(); toast(result.athletes + ' athletes removed · backup saved'); });
      }, fail);
    });
  }
  function editAthlete(id) {
    var a = ATH.filter(function (x) { return x.id === +id; })[0]; if (!a) return;
    modal('Edit ' + a.bib, '<form id="edath" class="formrow" style="grid-template-columns:1fr"><label>Full name<input name="full_name" value="' + esc(a.full_name) + '" required></label><label>House' + houseSelect('house_id') + '</label><label>Age group<select name="level"><option value="">(none)</option>' + LEVELS.map(function (l) { return '<option' + (a.level === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></label><label>Gender<select name="gender"><option value="">(none)</option><option value="F"' + (a.gender === 'F' ? ' selected' : '') + '>Girl</option><option value="M"' + (a.gender === 'M' ? ' selected' : '') + '>Boy</option></select></label><label>Bib<input name="bib" value="' + esc(a.bib) + '"></label><div class="row"><button class="btn primary grow">Save</button><button type="button" class="btn danger" data-del>Delete</button></div></form>', function (d) {
      var f = $('#edath', d); f.house_id.value = a.house_id;
      f.onsubmit = function (e) { e.preventDefault(); api('PATCH', '/api/athletes/' + a.id, { full_name: f.full_name.value, house_id: +f.house_id.value, level: f.level.value, gender: f.gender.value, bib: f.bib.value }).then(function () { closeModal(); return Promise.all([refreshAth(), load()]); }).then(render, fail); };
      $('[data-del]', d).onclick = function () { ask('Delete ' + a.full_name + '?', 'They are removed from the list and from every event they were entered in.', 'Delete', true).then(function (y) { if (y) api('DELETE', '/api/athletes/' + a.id).then(function () { return Promise.all([refreshAth(), load()]); }).then(render, fail); }); };
    });
  }

  /* --- 2. events --- */
  function eventsSetup() {
    var allNames = STD.concat(QA.custom);
    var category = function (s) { return s[1] === 'relay' ? 'relays' : s[1] === 'distance' ? 'field' : 'track'; };
    var categoryNames = { track: 'Track', field: 'Field', relays: 'Relays' };
    var categoryCounts = { track: 0, field: 0, relays: 0 };
    allNames.forEach(function (s) { if (QA.names[s[0]]) categoryCounts[category(s)]++; });
    var option = function (k, t, on, extra) { return '<label class="selection-chip' + (on ? ' on' : '') + (extra || '') + '"><input type="checkbox" data-qa="' + esc(k) + '"' + (on ? ' checked' : '') + '><span class="selection-check" aria-hidden="true">✓</span><span>' + esc(t) + '</span></label>'; };
    var names = allNames.filter(function (s) { return category(s) === UI.qacat; }).map(function (s) { return option('name:' + s[0], s[0], !!QA.names[s[0]], ' event-choice'); }).join('');
    var tabs = ['track', 'field', 'relays'].map(function (key) { return '<button class="category-tab" type="button" data-act="qacat" data-k="' + key + '" aria-pressed="' + (UI.qacat === key) + '">' + categoryNames[key] + '<small>' + categoryCounts[key] + ' selected</small></button>'; }).join('');
    var selected = allNames.filter(function (s) { return !!QA.names[s[0]]; }).length;
    var levels = LEVELS.filter(function (l) { return QA.levels[l]; }).length, genders = Object.keys(QA.genders).filter(function (g) { return QA.genders[g]; }).length;
    var quick = '<div class="card command-card"><div class="command-heading"><div><p class="eyebrow">PROGRAMME BUILDER</p><h2>Create events</h2><p>Pick disciplines and divisions. Eligible athletes can be entered automatically.</p></div><span class="selection-summary"><b>' + selected + '</b><small>event types selected</small></span></div>' +
      '<div class="category-tabs" role="tablist" aria-label="Event category">' + tabs + '</div><div class="event-choice-grid">' + (names || '<p class="empty">No events in this category yet.</p>') + '</div>' +
      '<div class="custom-event-row"><input id="cname" placeholder="Add a custom event, e.g. 300m hurdles" aria-label="Custom event name"><select id="ctype" aria-label="Custom event type"><option value="time">Track · timed</option><option value="distance">Field · distance</option></select><button class="btn sm" data-act="addcustom">Add event type</button></div>' +
      '<div class="division-grid"><section><p class="micro-label">AGE GROUPS</p><div class="selection-row">' + LEVELS.map(function (l) { return option('level:' + l, l, !!QA.levels[l]); }).join('') + '</div></section><section><p class="micro-label">DIVISIONS</p><div class="selection-row">' + option('gender:F', 'Girls', !!QA.genders.F) + option('gender:M', 'Boys', !!QA.genders.M) + '</div></section></div>' +
      '<div class="autofill-toggle">' + option('fill', 'Auto-enter every eligible athlete from the roster', QA.fill) + '<small>Relay teams use the first four eligible athletes per house in bib order.</small></div>' +
      '<div class="batch-dock"><span><b>' + selected + ' event types</b><small>' + levels + ' age groups · ' + genders + ' divisions</small></span><button class="btn primary big" data-act="createevents"' + (selected && (levels || allNames.some(function (s) { return QA.names[s[0]] && category(s) === 'relays'; })) ? '' : ' disabled') + '>Generate selected events <span aria-hidden="true">→</span></button></div></div>';
    var list = ST.events.slice().sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99') || a.id - b.id; }).map(function (e) {
      return '<article class="schedule-card"><label class="schedule-time"><span>START</span><input type="time" value="' + esc(e.time) + '" data-change="evtime" data-id="' + e.id + '" aria-label="Start time for ' + esc(e.name) + '"></label><div class="schedule-copy"><span class="schedule-kicker">' + (e.kind === 'relay' ? 'RELAY' : e.measure === 'distance' ? 'FIELD' : 'TRACK') + ' · ' + esc(label(e)) + '</span><b>' + esc(e.name) + '</b><small>' + e.count + (e.kind === 'relay' ? ' teams' : ' athletes') + ' · ' + (e.measure === 'time' ? 'timed' : 'distance') + '</small></div><div class="schedule-actions"><a class="btn sm" href="#/setup/event/' + e.id + '">Manage <span aria-hidden="true">→</span></a><button class="btn sm icon-btn" data-act="evmenu" data-id="' + e.id + '" aria-label="More actions for ' + esc(e.name) + '">⋯</button></div></article>';
    }).join('');
    return quick + '<div class="card schedule-panel"><div class="schedule-heading"><div><p class="eyebrow">LIVE RUNNING ORDER</p><h2>Event schedule <span>' + ST.events.length + '</span></h2></div><small>Times update across the public and staff screens.</small></div><div class="schedule-list">' + (list || '<div class="empty">No events yet.</div>') + '</div></div>';
  }
  function createEvents() {
    var items = STD.concat(QA.custom).filter(function (s) { return QA.names[s[0]]; }).map(function (s) { return { name: s[0], kind: s[1] === 'relay' ? 'relay' : 'individual', measure: s[1] === 'distance' ? 'distance' : 'time' }; });
    if (!items.length) return toast('Tick at least one event', 'e');
    var levels = LEVELS.filter(function (l) { return QA.levels[l]; }), genders = ['F', 'M'].filter(function (g) { return QA.genders[g]; });
    if (!levels.length && items.some(function (i) { return i.kind !== 'relay'; })) return toast('Tick at least one age group', 'e');
    api('POST', '/api/events/bulk', { items: items, levels: levels, genders: genders, autofill: QA.fill }).then(function (r) { toast(r.created + ' events created' + (r.skipped ? ', ' + r.skipped + ' already existed' : '') + (r.entries ? ', ' + r.entries + ' entries' : '')); return load(); }).then(render, fail);
  }
  function eventManage(id) {
    var ev = evOf(id); if (!ev) return '<div class="empty card">Event not found. <a href="#/setup/events">Back</a></div>';
    var heats = ev.heats || 1, relay = ev.kind === 'relay';
    var relayHelp = ev.level === 'Mixed' ? 'This existing Mixed relay accepts every age group and gender; add everyone who fits to fill each house team from the roster. New relays created from Setup Events follow the selected age group and gender.' :
      'The first four eligible athletes in each house, ordered by bib, are assigned automatically.';
    var rows = ev.entries.slice().sort(function (a, b) { return a.heat - b.heat || (a.bib || '').localeCompare(b.bib || '', undefined, { numeric: true }); }).map(function (e) {
      var h = houseOf(e.house_id);
      if (relay) {
        var members = (e.relayMembers || []).slice().sort(function (a, b) { return a.leg - b.leg; });
        var eligible = ATH ? ATH.filter(function (a) { return a.house_id === e.house_id && (ev.level === 'Mixed' || a.level === ev.level) && (!ev.gender || a.gender === ev.gender); }) : [];
        var names = members.length === 4 ? members.map(function (m) { return 'Leg ' + m.leg + ': ' + esc(m.name); }).join('<br>') :
          eligible.length < 4 ? '<span class="bad">Only ' + eligible.length + ' eligible runners; need 4</span>' : '<span class="bad">Four runners not selected</span>';
        return '<tr><td>' + esc(h.name) + '</td><td colspan="2">' + names + '</td><td><button class="btn sm" data-act="relaylineup" data-id="' + e.id + '" data-house="' + e.house_id + '"' + (eligible.length < 4 ? ' disabled' : '') + '>' + (members.length === 4 ? 'Change runners' : 'Set four runners') + '</button></td><td></td></tr>';
      }
      return '<tr><td><b>' + esc(e.bib || '–') + '</b></td><td>' + esc(e.name) + '</td><td><span class="dot" style="background:' + esc(houseColor(h)) + '"></span>' + esc(h.name) + '</td><td style="width:90px"><select data-change="entryheat" data-id="' + e.id + '" aria-label="Heat for ' + esc(e.name) + '">' + Array.apply(null, Array(Math.max(heats, 1) + 1)).map(function (_, i) { return '<option' + (e.heat === i + 1 ? ' selected' : '') + '>' + (i + 1) + '</option>'; }).join('') + '</select></td><td class="num"><button class="btn sm" data-act="removeentry" data-id="' + e.id + '">Remove</button></td></tr>';
    }).join('');
    return '<div class="ehead"><a class="btn sm" href="#/setup/events">‹ Events</a><div class="grow"><h2>' + esc(ev.name) + '</h2><small>' + esc(label(ev)) + ' · ' + (ev.measure === 'time' ? 'timed' : 'distance') + ' · ' + ev.count + ' athletes' + (heats > 1 ? ' · ' + heats + ' heats' : '') + '</small></div>' + pill(ev.status) + '</div>' +
      '<div class="card"><div class="row">' + (relay ? '<button class="btn primary" data-act="addall" data-id="' + id + '">Add everyone who fits</button>' : '<button class="btn primary" data-act="addathletes" data-id="' + id + '">Add athletes…</button><button class="btn" data-act="addall" data-id="' + id + '">Add everyone who fits</button>') + '<button class="btn" data-act="editevent" data-id="' + id + '">Edit details</button><button class="btn danger" data-act="delevent" data-id="' + id + '">Delete event</button></div>' +
      (ev.kind === 'relay' ? '' : '<div class="row" style="margin-top:12px"><label style="max-width:230px">Split into heats of about<input id="hsize" type="number" min="2" max="30" value="8"></label><button class="btn" data-act="makeheats" data-id="' + id + '" style="margin-top:18px">Make heats</button></div><p class="help">Heats mix the houses so every heat is fair. Each heat has its own clock, and the final places are worked out from all the times together.</p>') + '</div>' +
      (relay ? '<div class="card"><h3>Relay teams and runners</h3><p class="help">' + relayHelp + ' If there are fewer than four eligible athletes, add more to the roster and choose Add everyone who fits. During recording, tap that team at each baton handoff and again when the last runner finishes.</p><div class="tw"><table><thead><tr><th>House</th><th colspan="2">Leg assignments</th><th></th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">No relay teams. Recreate this event after adding houses.</td></tr>') + '</tbody></table></div></div>' :
        '<div class="card"><h3>Athletes in this event</h3><div class="tw"><table><thead><tr><th>Bib</th><th>Name</th><th>House</th><th>Heat</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">Nobody yet. Add athletes above.</td></tr>') + '</tbody></table></div></div>');
  }
  function relayLineupDialog(entryId, houseId) {
    var ev = evOf(+route().b), entry = entryOf(entryId);
    if (!ev || !entry || !ATH) return;
    var current = (entry.e.relayMembers || []).slice().sort(function (a, b) { return a.leg - b.leg; });
    var candidates = ATH.filter(function (a) {
      return a.house_id === houseId && (ev.level === 'Mixed' || a.level === ev.level) && (!ev.gender || a.gender === ev.gender);
    });
    var options = '<option value="">Choose a runner</option>' + candidates.map(function (a) {
      return '<option value="' + a.id + '">' + esc(a.bib + ' · ' + a.full_name) + '</option>';
    }).join('');
    modal(houseOf(houseId).name + ' relay lineup', '<form id="relaylineup">' + [1, 2, 3, 4].map(function (leg) {
      return '<label>Leg ' + leg + '<select name="leg' + leg + '" required>' + options + '</select></label>';
    }).join('') + '<p class="help">Each runner must be different and belong to ' + esc(houseOf(houseId).name) + '.</p><button class="btn primary">Save lineup</button></form>', function (d) {
      var form = $('#relaylineup', d);
      current.forEach(function (m) { if (form['leg' + m.leg]) form['leg' + m.leg].value = m.athlete_id; });
      form.onsubmit = function (event) {
        event.preventDefault();
        var ids = [1, 2, 3, 4].map(function (leg) { return +form['leg' + leg].value; });
        if (ids.some(function (id) { return !id; }) || new Set(ids).size !== 4) return toast('Choose four different runners', 'e');
        api('POST', '/api/events/' + ev.id + '/relay-lineup', { house_id: houseId, athlete_ids: ids })
          .then(function () { closeModal(); return load(); }).then(render, fail);
      };
    });
  }
  function addAthletesDialog(id) {
    var ev = evOf(id); if (!ev) return;
    var have = {}; ev.entries.forEach(function (e) { if (e.athlete_id) have[e.athlete_id] = 1; });
    var cand = ATH.filter(function (a) { return !have[a.id]; });
    var fits = function (a) { return (ev.level === 'Mixed' || a.level === ev.level) && (!ev.gender || a.gender === ev.gender); };
    modal('Add athletes to ' + ev.name, '<input id="cq" type="search" placeholder="Search" aria-label="Search athletes"><div class="row"><button class="btn sm" type="button" data-sel="fit">Select who fits</button><button class="btn sm" type="button" data-sel="all">Select all</button><button class="btn sm" type="button" data-sel="none">None</button></div><div id="clist" style="max-height:46vh;overflow:auto;display:grid;gap:4px">' +
      cand.map(function (a) { var h = houseOf(a.house_id); return '<label class="chips" style="margin:0;display:flex;font-weight:400;border:0;cursor:pointer" data-t="' + esc((a.full_name + ' ' + a.bib).toLowerCase()) + '"><input type="checkbox" value="' + a.id + '" data-fit="' + (fits(a) ? 1 : 0) + '"> <span class="dot" style="background:' + esc(houseColor(h)) + '"></span><b>' + esc(a.bib) + '</b>&nbsp;' + esc(a.full_name) + ' <small>&nbsp;' + esc((a.level || '') + ' ' + (a.gender || '')) + '</small></label>'; }).join('') + (cand.length ? '' : '<div class="empty">Everyone is already in this event.</div>') + '</div><button class="btn primary big" data-go>Add selected</button>', function (d) {
      var boxes = $$('#clist input', d);
      $$('[data-sel]', d).forEach(function (b) { b.onclick = function () { boxes.forEach(function (x) { x.checked = b.dataset.sel === 'all' || (b.dataset.sel === 'fit' && x.dataset.fit === '1'); }); }; });
      $('#cq', d).oninput = function (e) { var q = e.target.value.toLowerCase(); $$('#clist label', d).forEach(function (l) { l.style.display = l.dataset.t.indexOf(q) > -1 ? '' : 'none'; }); };
      $('[data-go]', d).onclick = function () {
        var ids = boxes.filter(function (x) { return x.checked; }).map(function (x) { return +x.value; }); if (!ids.length) return toast('Select at least one athlete', 'e');
        api('POST', '/api/events/' + id + '/entries', { athlete_ids: ids }).then(function (r) { closeModal(); toast(r.added + ' added'); return Promise.all([load(), refreshAth()]); }).then(render, fail);
      };
    });
  }
  function editEvent(id) {
    var ev = evOf(id);
    modal('Edit event', '<form id="edev" class="formrow" style="grid-template-columns:1fr"><label>Name<input name="name" value="' + esc(ev.name) + '" required></label><label>Age group<select name="level">' + LEVELS.concat(['Mixed']).map(function (l) { return '<option' + (ev.level === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></label><label>Gender<select name="gender"><option value="">Mixed</option><option value="F"' + (ev.gender === 'F' ? ' selected' : '') + '>Girls</option><option value="M"' + (ev.gender === 'M' ? ' selected' : '') + '>Boys</option></select></label><label>Measured in<select name="measure"><option value="time"' + (ev.measure === 'time' ? ' selected' : '') + '>Time (stopwatch)</option><option value="distance"' + (ev.measure === 'distance' ? ' selected' : '') + '>Distance (metres)</option></select></label><label>Start time<input name="sched_time" type="time" value="' + esc(ev.time) + '"></label><button class="btn primary">Save</button></form>', function (d) {
      var f = $('#edev', d); f.onsubmit = function (e) { e.preventDefault(); api('PATCH', '/api/events/' + id, { name: f.name.value, level: f.level.value, gender: f.gender.value, measure: f.measure.value, sched_time: f.sched_time.value }).then(function () { closeModal(); return load(); }).then(render, fail); };
    });
  }

  /* --- 3. team --- */
  function teamSetup() {
    var form = '<div class="card"><h2>Add a recorder</h2><p class="help">One account per official, so you can see who recorded what. Share the password in person.</p><form id="adduser" class="formrow"><label>Name<input name="display_name" required placeholder="Mr Mokoena" autocomplete="off"></label><label>Username<input name="username" required placeholder="mokoena" autocapitalize="none" autocomplete="off"></label><label>Password (8+ characters)<input name="password" required minlength="8" autocomplete="off"></label><label>Role<select name="role"><option value="recorder">Recorder</option><option value="admin">Admin</option></select></label><button class="btn primary">Add</button><button type="button" class="btn" data-act="genpw">Make a password</button></form></div>';
    if (!USERS) return form + '<div class="empty">Loading…</div>';
    var rows = USERS.map(function (u) { return '<tr><td><b>' + esc(u.display_name) + '</b><br><small>' + esc(u.username) + '</small></td><td>' + (u.role === 'admin' ? 'Admin' : 'Recorder') + (u.active ? '' : ' <span class="bad">(disabled)</span>') + '</td><td class="num"><button class="btn sm" data-act="userpw" data-id="' + u.id + '">Password</button> <button class="btn sm" data-act="usertoggle" data-id="' + u.id + '">' + (u.active ? 'Disable' : 'Enable') + '</button> <button class="btn sm danger" data-act="userdel" data-id="' + u.id + '">Delete</button></td></tr>'; }).join('');
    return form + '<div class="card"><h3>People (' + USERS.length + ')</h3><div class="tw"><table><tbody>' + rows + '</tbody></table></div></div>';
  }

  /* --- 4. the day --- */
  function daySetup() {
    var s = ST.settings, sc = s.scheme;
    var settings = '<div class="card"><h2>Day settings</h2><form id="setf" class="formrow"><label>Title<input name="title" value="' + esc(s.title) + '"></label><label>Venue<input name="venue" value="' + esc(s.venue) + '"></label><label>Date<input name="date" type="date" value="' + esc(s.date) + '"></label><label>Start<input name="start" type="time" value="' + esc(s.start) + '"></label>' +
      '<label>Points for 1st, 2nd, 3rd…<input name="points" value="' + esc(sc.points.join(', ')) + '"></label><label>Points for everyone after<input name="rest" type="number" min="0" max="100" value="' + sc.rest + '"></label>' +
      '<label>Names on the public page<select name="nameDisplay"><option value="full"' + (s.nameDisplay === 'full' ? ' selected' : '') + '>Full names</option><option value="initial"' + (s.nameDisplay === 'initial' ? ' selected' : '') + '>First name and initial</option></select></label><button class="btn primary">Save settings</button></form>' +
      '<p class="help">Changing the points re-scores every event straight away. DNS, DNF and DQ always score 0.</p><div class="palette-lock"><b>House identity palette</b><div class="palette-swatches">' + ST.houses.map(function (h) { return '<span class="house-' + houseKey(h) + '"><i></i>' + esc(h.name) + '</span>'; }).join('') + '</div><small>These broadcast colors stay consistent across staff, live standings and reports.</small></div></div>';
    var fin = '<div class="card"><h2>' + (s.finalised ? 'The day is finalised' : 'Finish the day') + '</h2><p class="help">' + (s.finalised ? 'Results are locked for recorders. The printable report shows FINAL.' : 'When every event is done, finalise the day. Recorders can no longer change results; you still can.') + '</p><div class="row">' + (s.finalised ? '<button class="btn" data-act="reopenday">Reopen the day</button>' : '<button class="btn primary" data-act="finaliseday">Finalise the day</button>') + '<a class="btn" href="/report" target="_blank" rel="noopener">Printable report</a><a class="btn" href="/api/export/results.csv">All results (CSV)</a><a class="btn" href="/api/admin/backup">Download a backup</a></div></div>';
    var danger = '<div class="card"><h3>Start again</h3><p class="help">A safety copy is saved automatically before anything is deleted.</p><div class="row"><button class="btn" data-act="reset" data-scope="results">Clear all results (keep athletes and events)</button><button class="btn danger" data-act="reset" data-scope="all">Delete everything</button></div></div>';
    var log = '<div class="card"><h3>Recent activity</h3>' + (AUDIT ? '<div class="tw"><table><tbody>' + AUDIT.map(function (a) { return '<tr><td style="white-space:nowrap"><small>' + new Date(a.ts).toLocaleTimeString() + '</small></td><td>' + esc(a.username || '–') + '</td><td>' + esc(a.action) + '</td><td><small>' + esc(String(a.detail || '').slice(0, 90)) + '</small></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">Loading…</div>') + '</div>';
    return settings + fin + danger + log;
  }

  /* ------------------------------------------------------------------ actions (one click handler for everything) */
  var ACT = {
    filter: function (el) { UI.filter = el.dataset.k; render(); },
    heat: function (el) { UI.heat[el.dataset.id] = +el.dataset.n; render(); },
    tap: function (el) { tapEntry(+el.dataset.id); },
    entrymenu: function (el) { entryMenu(+el.dataset.id); },
    manual: function (el) { var f = entryOf(el.dataset.id); closeModal(); if (f.ev.measure === 'time') manualTime(f.e, f.ev); else keypad(f.e, f.ev); },
    clearresult: function (el) { var id = +el.dataset.id; enqueue('/api/entries/' + id + '/clear', {}, { k: 'clear', id: id }); overlay(); closeModal(); render(); },
    moveheat: function (el) { api('PATCH', '/api/entries/' + el.dataset.id, { heat: +el.dataset.n }).then(function () { closeModal(); return load(); }).then(render, fail); },
    removeentry: function (el) { var id = +el.dataset.id; ask('Remove from this event?', 'Any result they have in this event is deleted.', 'Remove', true).then(function (y) { if (y) api('DELETE', '/api/entries/' + id).then(function () { closeModal(); return Promise.all([load(), refreshAth()]); }).then(render, fail); }); },
    startclock: function (el) {
      var id = +el.dataset.id, heat = +el.dataset.heat, at = Math.round(serverNow()); LOCALSTART[id + '-' + heat] = at; buzz(60); render();
      api('POST', '/api/events/' + id + '/start', { heat: heat, at: at }).then(function (r) { LOCALSTART[id + '-' + heat] = r.started_at; return load(); }, function (e) { delete LOCALSTART[id + '-' + heat]; render(); fail(e); });
    },
    relaylineup: function (el) {
      if (ATH) relayLineupDialog(+el.dataset.id, +el.dataset.house);
      else refreshAth().then(function () { relayLineupDialog(+el.dataset.id, +el.dataset.house); }, fail);
    },
    resetclock: function (el) {
      var id = +el.dataset.id, heat = +el.dataset.heat;
      ask('Reset the clock?', 'Use this only if the start was a mistake. If times were already recorded in this heat they will be cleared.', 'Reset clock', true).then(function (y) {
        if (!y) return;
        api('POST', '/api/events/' + id + '/reset-clock', { heat: heat, force: true }).then(function () { delete LOCALSTART[id + '-' + heat]; return load(); }).then(render, fail);
      });
    },
    swap: function (el) { var f = entryOf(el.dataset.a); api('POST', '/api/events/' + f.ev.id + '/swap', { a: +el.dataset.a, b: +el.dataset.b }).then(load, fail); },
    undo: function (el) {
      var ev = evOf(+el.dataset.id), stack = UI.last[ev.id] || [], pick = null;
      while (stack.length && !pick) { var c = stack.pop(), en = ev.entries.filter(function (x) { return x.id === c; })[0]; if (en && ((en.relaySplits || []).length || en.position !== null || en.status !== 'ok')) pick = en; }
      if (!pick) { var l = ev.entries.filter(function (x) { return (x.relaySplits || []).length || x.position !== null; }).sort(function (a, b) { return b.at - a.at; })[0]; pick = l; }
      if (!pick) return toast('Nothing to undo');
      if (ev.kind === 'relay' && (pick.relaySplits || []).length) {
        var leg = pick.relaySplits[pick.relaySplits.length - 1].leg;
        enqueue('/api/entries/' + pick.id + '/relay-split/undo', {}, { k: 'relayUndo', id: pick.id });
        overlay(); render(); toast('Undid relay leg ' + leg); return;
      }
      enqueue('/api/entries/' + pick.id + '/clear', {}, { k: 'clear', id: pick.id }); overlay(); render(); toast('Undid ' + pick.bib + ' ' + shortName(pick.name));
    },
    finish: function (el) {
      var ev = evOf(+el.dataset.id), missing = ev.entries.filter(function (e) { return e.status === 'ok' && e.position === null; }).length, done = ev.finished;
      modal('Finish ' + ev.name + '?', '<p><b>' + done + '</b> have a result or a status.' + (missing ? ' <b>' + missing + '</b> have nothing recorded.' : ' Everyone is accounted for.') + '</p>' +
        (missing ? '<button class="opt" data-fin="dns">Mark the ' + missing + ' as “did not start” and finish</button><button class="opt" data-fin="none">Finish and leave them blank</button>' : '<button class="opt" data-fin="none">Finish event</button>') + '<button class="btn" data-close>Keep recording</button>', function (d) {
          $$('[data-fin]', d).forEach(function (b) { b.onclick = function () { api('POST', '/api/events/' + ev.id + '/complete', { rest: b.dataset.fin }).then(function () { closeModal(); toast('Event finished'); location.hash = '#/'; return load(); }).then(render, fail); }; });
        });
    },
    reopen: function (el) { api('POST', '/api/events/' + el.dataset.id + '/reopen', {}).then(load, fail); },
    evmenu: function (el) {
      var id = +el.dataset.id, ev = evOf(id), heat = UI.heat[id] || 1;
      modal(ev.name, (ev.measure === 'time' && clockStart(id, heat) ? '<button class="opt bad" data-act="resetclock" data-id="' + id + '" data-heat="' + heat + '">Reset the clock (heat ' + heat + ')</button>' : '') + (ev.status === 'completed' || ev.status === 'final' ? '<button class="opt" data-act="reopen" data-id="' + id + '">Reopen this event</button>' : '<button class="opt" data-act="finish" data-id="' + id + '">Finish this event</button>') + (isAdmin() ? '<a class="opt" href="#/setup/event/' + id + '" data-close>Manage athletes and heats</a>' : '') + '<a class="opt" href="/api/export/results.csv">Download all results (CSV)</a>');
    },
    /* setup */
    import: importAthletes,
    cancelimport: function () { PENDING_ROSTER = null; PENDING_FILE = ''; render(); },
    ahouse: function (el) { UI.ahouse = el.dataset.k; render(); },
    editath: function (el) { editAthlete(el.dataset.id); },
    deleteath: function (el) { removeAthlete(el.dataset.id); },
    clearroster: clearRoster,
    quickadd: quickAddAthlete,
    seedall: autoSeedEvents,
    qacat: function (el) { UI.qacat = el.dataset.k; render(); },
    addcustom: function () { var n = $('#cname').value.trim(); if (!n) return; var type = $('#ctype').value; QA.custom.push([n, type]); QA.names[n] = 1; UI.qacat = type === 'distance' ? 'field' : 'track'; render(); },
    createevents: createEvents,
    addathletes: function (el) { if (ATH) addAthletesDialog(+el.dataset.id); else refreshAth().then(function () { addAthletesDialog(+el.dataset.id); }, fail); },
    addall: function (el) { var ev = evOf(+el.dataset.id); api('POST', '/api/events/' + el.dataset.id + '/entries', { all: true }).then(function (r) { toast(ev.kind === 'relay' ? r.configured + ' relay lineups ready' : r.added + ' added'); return Promise.all([load(), refreshAth()]); }).then(render, fail); },
    editevent: function (el) { editEvent(+el.dataset.id); },
    delevent: function (el) { var ev = evOf(+el.dataset.id); ask('Delete ' + ev.name + '?', 'Its ' + ev.count + ' entries and any results are deleted too.', 'Delete event', true).then(function (y) { if (y) api('DELETE', '/api/events/' + ev.id).then(function () { location.hash = '#/setup/events'; return load(); }).then(render, fail); }); },
    makeheats: function (el) { api('POST', '/api/events/' + el.dataset.id + '/heats', { size: +$('#hsize').value }).then(function (r) { toast(r.heats + ' heat' + (r.heats === 1 ? '' : 's')); return load(); }).then(render, fail); },
    genpw: function () { var w = ['Hawk', 'Eagle', 'Raven', 'Falcon', 'Track', 'Sprint', 'Maseru', 'Jump'], p = w[Math.floor(Math.random() * w.length)] + '-' + (1000 + Math.floor(Math.random() * 9000)) + '-' + w[Math.floor(Math.random() * w.length)]; $('#adduser input[name=password]').value = p; toast('Password: ' + p); },
    userpw: function (el) { var u = USERS.filter(function (x) { return x.id === +el.dataset.id; })[0]; modal('New password for ' + u.display_name, '<form id="pwf"><label>New password (8+ characters)<input name="pw" minlength="8" required autocomplete="off"></label><button class="btn primary" style="margin-top:10px">Set password</button></form>', function (d) { $('#pwf', d).onsubmit = function (e) { e.preventDefault(); api('POST', '/api/users/' + u.id + '/password', { password: e.target.pw.value }).then(function () { closeModal(); toast('Password changed; they are signed out'); }, fail); }; }); },
    usertoggle: function (el) { var u = USERS.filter(function (x) { return x.id === +el.dataset.id; })[0]; api('PATCH', '/api/users/' + u.id, { active: !u.active }).then(function () { USERS = null; render(); }, fail); },
    userdel: function (el) { var u = USERS.filter(function (x) { return x.id === +el.dataset.id; })[0]; ask('Delete ' + u.display_name + '?', 'Their account is removed. Results they recorded stay.', 'Delete', true).then(function (y) { if (y) api('DELETE', '/api/users/' + u.id).then(function () { USERS = null; render(); }, fail); }); },
    finaliseday: function () {
      api('POST', '/api/day/finalise', {}).then(load, function (e) { if (e.status === 409) ask('Some events are not finished', e.message + '. Finalise anyway?', 'Finalise anyway').then(function (y) { if (y) api('POST', '/api/day/finalise', { force: true }).then(load, fail); }); else fail(e); }).then(render);
    },
    reopenday: function () { api('POST', '/api/day/reopen', {}).then(load, fail).then(render); },
    reset: function (el) {
      var scope = el.dataset.scope;
      modal(scope === 'all' ? 'Delete everything?' : 'Clear all results?', '<p>' + (scope === 'all' ? 'Athletes, events, entries and results are deleted.' : 'Every time and distance is cleared. Athletes and events stay.') + ' A backup is saved first. Type <b>RESET</b> to continue.</p><input id="rc" autocomplete="off"><button class="btn danger" data-go>Do it</button>', function (d) {
        $('[data-go]', d).onclick = function () { api('POST', '/api/admin/reset', { scope: scope, confirm: $('#rc', d).value.trim() }).then(function (r) { closeModal(); toast('Done. Backup ' + r.backup); ATH = null; return load(); }).then(render, fail); };
      });
    },
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    var act = el.dataset.act;
    if (act.indexOf('setstatus-') === 0) {                 // DNS / DNF / DQ
      e.preventDefault(); var id = +el.dataset.id, s = act.slice(10);
      enqueue('/api/entries/' + id + '/status', { status: s }, { k: 'status', id: id, s: s }); overlay(); closeModal(); render(); return;
    }
    if (ACT[act]) { e.preventDefault(); ACT[act](el, e); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.qa) {                       // quick-add checkboxes
      var p = t.dataset.qa.split(':'), k = p[0], v = p.slice(1).join(':');
      if (k === 'name') QA.names[v] = t.checked ? 1 : 0; else if (k === 'level') QA.levels[v] = t.checked ? 1 : 0; else if (k === 'gender') QA.genders[v] = t.checked ? 1 : 0; else if (k === 'fill') QA.fill = t.checked;
      t.parentNode.classList.toggle('on', t.checked); return;
    }
    if (t.dataset && t.dataset.change === 'evtime') api('PATCH', '/api/events/' + t.dataset.id, { sched_time: t.value }).then(load, fail);
    if (t.dataset && t.dataset.change === 'entryheat') api('PATCH', '/api/entries/' + t.dataset.id, { heat: +t.value }).then(load, fail).then(render);
    if (t.id === 'csvfile' && t.files[0]) parseRosterFile(t.files[0]);
  });
  document.addEventListener('dragover', function (e) {
    var zone = e.target.closest('#roster-dropzone');
    if (zone) { e.preventDefault(); zone.classList.add('dragging'); }
  });
  document.addEventListener('dragleave', function (e) {
    var zone = e.target.closest('#roster-dropzone');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('dragging');
  });
  document.addEventListener('drop', function (e) {
    var zone = e.target.closest('#roster-dropzone');
    if (!zone) return;
    e.preventDefault(); zone.classList.remove('dragging');
    if (e.dataTransfer.files[0]) parseRosterFile(e.dataTransfer.files[0]);
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'evq') { UI.q = e.target.value; var p = e.target.selectionStart; render(); var n = $('#evq'); if (n) { n.focus(); n.setSelectionRange(p, p); } }
    if (e.target.id === 'aq') { UI.aq = e.target.value; var p2 = e.target.selectionStart; render(); var n2 = $('#aq'); if (n2) { n2.focus(); n2.setSelectionRange(p2, p2); } }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'addath') { e.preventDefault(); api('POST', '/api/athletes', { full_name: f.full_name.value, house_id: +f.house_id.value, level: f.level.value, gender: f.gender.value }).then(function (r) { closeModal(); toast('Added ' + r.athlete.bib); return Promise.all([refreshAth(), load()]); }).then(render, fail); }
    if (f.id === 'adduser') { e.preventDefault(); api('POST', '/api/users', { display_name: f.display_name.value, username: f.username.value, password: f.password.value, role: f.role.value }).then(function () { toast('Account created'); f.reset(); USERS = null; render(); }, fail); }
    if (f.id === 'setf') {
      e.preventDefault(); var pts = f.points.value.split(/[ ,;]+/).filter(Boolean).map(Number);
      api('PATCH', '/api/settings', { title: f.title.value, venue: f.venue.value, date: f.date.value, start: f.start.value, nameDisplay: f.nameDisplay.value, scheme: { points: pts, rest: +f.rest.value } }).then(function () { toast('Saved'); return load(); }).then(render, fail);
    }
  });

  /* ------------------------------------------------------------------ account menu */
  var profileMenu = $('#profile-menu');
  profileMenu.addEventListener('click', function (event) {
    var link = event.target.closest('a');
    if (link) { profileMenu.open = false; return; }
    var action = event.target.closest('[data-profile]');
    if (!action) return;
    event.preventDefault(); profileMenu.open = false;
    if (action.dataset.profile === 'password') {
      modal('Change password', '<form id="mypw" class="formrow" style="grid-template-columns:1fr"><label>Current password<input name="cur" type="password" autocomplete="current-password" required></label><label>New password (8+ characters)<input name="pw" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn primary">Update password</button></form>', function (dialog) {
        $('#mypw', dialog).onsubmit = function (e) { e.preventDefault(); api('POST', '/api/me/password', { current: e.target.cur.value, password: e.target.pw.value }).then(function () { toast('Password changed. Sign in again.'); closeModal(); }, fail); };
      });
    } else if (action.dataset.profile === 'logout') {
      api('POST', '/api/logout', {}).then(function () { ME = null; showLogin(); }, fail);
    }
  });
  document.addEventListener('click', function (event) {
    if (profileMenu.open && !profileMenu.contains(event.target)) profileMenu.open = false;
  });
  var quickNav = $('#quick-nav'), quickNavTrigger = $('#quick-nav-trigger'), dockLinks = $('#dock-links');
  var quickNavOpen = false, quickNavPinned = false;
  function setQuickNavOpen(open) {
    quickNavOpen = open;
    dockLinks.hidden = !open;
    quickNav.classList.toggle('open', open);
    quickNavTrigger.setAttribute('aria-expanded', String(open));
    quickNavTrigger.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  }
  quickNavTrigger.addEventListener('click', function () {
    quickNavPinned = !quickNavPinned;
    setQuickNavOpen(quickNavPinned);
  });
  quickNav.addEventListener('mouseenter', function () {
    if (!quickNavPinned) setQuickNavOpen(true);
  });
  quickNav.addEventListener('mouseleave', function () {
    if (!quickNavPinned) setQuickNavOpen(false);
  });
  dockLinks.addEventListener('click', function (event) {
    if (event.target.closest('a')) { quickNavPinned = false; setQuickNavOpen(false); }
  });
  document.addEventListener('click', function (event) {
    if (quickNavOpen && !quickNav.contains(event.target)) { quickNavPinned = false; setQuickNavOpen(false); }
  });

  /* ------------------------------------------------------------------ go */
  api('GET', '/api/me').then(function (r) { if (r.user) { ME = r.user; start(); } else showLogin(); }, function () { showLogin(); });
})();
