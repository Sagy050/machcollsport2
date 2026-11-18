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
  var UI = { filter: 'live', q: '', heat: {}, last: {}, ahouse: 'all', aq: '' };
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
    return api('GET', '/api/staff/state').then(function (s) { ST = s; overlay(); setConn(true); chrome(); if (['home', 'event', 'standings'].indexOf(route().name) > -1) render(); })
      .catch(function (e) { if (e.network) setConn(false); }).then(function () { loading = false; if (again) { again = false; load(); } });
  }
  function setConn(on) { var c = $('#conn'); if (!c) return; c.className = 'conn ' + (on ? 'on' : ''); c.lastChild.textContent = on ? 'Live' : 'Offline'; }
  var es = null;
  function connect() {
    if (es || !window.EventSource) return;
    es = new (window.SDLiveSource || EventSource)('/api/stream');
    es.addEventListener('v', function () { setConn(true); load(); });
    es.onopen = function () { setConn(true); };
    es.onerror = function () { setConn(false); };
  }
  var evOf = function (id) { return ST && ST.events.filter(function (e) { return e.id === +id; })[0]; };
  var houseOf = function (id) { return (ST && ST.houses.filter(function (h) { return h.id === id; })[0]) || { name: '?', color: '#999' }; };
  var entryOf = function (id) { for (var i = 0; ST && i < ST.events.length; i++) { var e = ST.events[i].entries.filter(function (x) { return x.id === +id; })[0]; if (e) return { ev: ST.events[i], e: e }; } return null; };
  var isAdmin = function () { return ME && ME.role === 'admin'; };
  var shortName = function (n) { var p = String(n).trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0]; };
  var label = function (ev) { return ev.level + (ev.gender ? (ev.gender === 'F' ? ' girls' : ' boys') : ''); };
  var pill = function (s) { return '<span class="pill ' + s + '">' + ({ scheduled: 'Up next', live: 'Live', completed: 'Done', final: 'Final' }[s] || s) + '</span>'; };

  /* ------------------------------------------------------------------ modal helpers */
  var dlg = $('#dlg');
  function modal(title, html, wire) {
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
  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; var f = $('#loginf'); f.password.value = ''; setTimeout(function () { f.username.focus(); }, 50); }
  function signedOut() { if (ME) { ME = null; closeModal(); showLogin(); } }
  $('#loginf').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target; $('#loginerr').textContent = '';
    api('POST', '/api/login', { username: f.username.value.trim(), password: f.password.value }).then(function (r) { ME = r.user; start(); }, function (er) { $('#loginerr').textContent = er.message; });
  });
  function start() {
    $('#login').hidden = true; $('#app').hidden = false; $('#whoami').textContent = ME.display_name + ' · ' + (ME.role === 'admin' ? 'Admin' : 'Recorder');
    syncTime(); setInterval(syncTime, 60000); offlineBar();
    load().then(function () { connect(); render(); flush(); });
    setInterval(load, 20000);
  }

  /* ------------------------------------------------------------------ router + chrome */
  function route() { var p = location.hash.replace(/^#\/?/, '').split('/'); return { name: p[0] || 'home', a: p[1], b: p[2] }; }
  addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
  function chrome() {
    if (!ST) return;
    $('#hchips').innerHTML = ST.standings.map(function (h) { return '<span class="hchip" style="--c:' + esc(h.color) + '">' + esc(h.name) + ' <b>' + h.points + '</b></span>'; }).join('');
    var r = route().name, tabs = [['home', 'Record'], ['standings', 'Standings']].concat(isAdmin() ? [['setup', 'Setup']] : []);
    $('#tabs').innerHTML = tabs.map(function (t) { var on = t[0] === r || (t[0] === 'home' && r === 'event'); return '<a href="#/' + (t[0] === 'home' ? '' : t[0]) + '"' + (on ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('');
  }
  function render() {
    if (!ME || !ST) return;
    var r = route(), y = window.scrollY, html;
    chrome();
    if (r.name === 'event') html = eventView(+r.a);
    else if (r.name === 'standings') html = standingsView();
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
    var chip = function (k, t) { return '<button data-act="filter" data-k="' + k + '" aria-pressed="' + (f === k) + '">' + t + ' (' + counts[k] + ')</button>'; };
    var body = list.map(function (e) {
      var pct = e.count ? Math.round(e.finished / e.count * 100) : 0;
      return '<a class="evc ' + e.status + '" href="#/event/' + e.id + '"><span class="tm">' + esc(e.time || '–') + '</span><span><b>' + esc(e.name) + '</b><small>' + esc(label(e)) + (e.kind === 'relay' ? ' · relay' : '') + (e.measure === 'distance' ? ' · distance' : '') + '</small><span class="bar"><i style="width:' + pct + '%"></i></span></span><span class="go">' + pill(e.status) + '<b>' + e.finished + '/' + e.count + '</b></span></a>';
    }).join('');
    var empty = !ST.events.length ? '<div class="empty card">No events yet.' + (isAdmin() ? ' <a href="#/setup/events">Set up events</a>' : ' Ask an admin to set them up.') + '</div>' : (!list.length ? '<div class="empty">Nothing here. Try another filter.</div>' : '');
    return '<div class="row sp"><div class="chips">' + chip('live', 'Live') + chip('next', 'Up next') + chip('done', 'Done') + chip('all', 'All') + '</div></div><input id="evq" type="search" placeholder="Find an event, e.g. 100m girls" value="' + esc(UI.q) + '" aria-label="Find an event" style="margin-bottom:12px">' + body + empty;
  }

  /* ------------------------------------------------------------------ EVENT: the recording screen */
  function eventView(id) {
    var ev = evOf(id); if (!ev) return '<div class="empty card">That event no longer exists. <a href="#/">Back to events</a></div>';
    var heats = ev.heats || 1, heat = UI.heat[id] || 1; if (heat > heats) heat = 1;
    var timed = ev.measure === 'time', locked = ev.status === 'final' && !isAdmin();
    var cur = ev.entries.filter(function (e) { return e.heat === heat; }).sort(function (a, b) { return (a.bib || '').localeCompare(b.bib || '', undefined, { numeric: true }) || a.name.localeCompare(b.name); });
    var st = timed ? clockStart(id, heat) : null;
    var head = '<div class="ehead"><a class="btn sm" href="#/">‹ Events</a><div class="grow"><h2>' + esc(ev.name) + '</h2><small>' + esc(label(ev)) + ' · ' + ev.finished + ' of ' + ev.count + ' done</small></div>' + pill(ev.status) + '<button class="btn sm" data-act="evmenu" data-id="' + id + '" aria-label="More">⋯</button></div>';
    var heatBar = heats > 1 ? '<div class="heats">' + Array.apply(null, Array(heats)).map(function (_, i) { var n = i + 1, d = ev.entries.filter(function (e) { return e.heat === n && (e.position !== null || e.status !== 'ok'); }).length, t = ev.entries.filter(function (e) { return e.heat === n; }).length; return '<button data-act="heat" data-n="' + n + '" data-id="' + id + '" aria-pressed="' + (n === heat) + '">Heat ' + n + ' · ' + d + '/' + t + '</button>'; }).join('') + '</div>' : '';
    var clock = timed ? '<div class="clock ' + (st ? 'run' : '') + '"><div class="t" id="clk" data-ev="' + id + '" data-heat="' + heat + '">' + fmtClock(st ? serverNow() - st : 0) + '</div>' +
      (st ? '<button class="btn" data-act="resetclock" data-id="' + id + '" data-heat="' + heat + '"' + (locked ? ' disabled' : '') + '>Reset clock</button>' : '<button class="btn primary big" data-act="startclock" data-id="' + id + '" data-heat="' + heat + '"' + (locked ? ' disabled' : '') + '>▶ Start clock</button>') + '</div>' : '<p class="help">Tap an athlete, type the distance on the keypad, then Save. Longest wins.</p>';
    var tiles = cur.length ? '<div class="tiles">' + cur.map(function (e) { return tile(ev, e); }).join('') + '</div>' : '<div class="empty card">No athletes in this ' + (heats > 1 ? 'heat' : 'event') + '.' + (isAdmin() ? ' <a href="#/setup/event/' + id + '">Add athletes</a>' : ' Ask an admin to add them.') + '</div>';
    var placed = ev.entries.filter(function (e) { return e.position !== null; }).sort(function (a, b) { return a.position - b.position; });
    var out = ev.entries.filter(function (e) { return e.status !== 'ok'; });
    var rows = placed.map(function (e, i) {
      var h = houseOf(e.house_id);
      return '<div class="ord"><span class="p">' + e.position + '</span><span><span class="dot" style="background:' + esc(h.color) + '"></span><b>' + esc(e.bib) + '</b> ' + esc(shortName(e.name)) + (heats > 1 ? ' <small>H' + e.heat + '</small>' : '') + '</span><span class="t">' + esc(e.performance) + '</span><span class="btns">' +
        (i > 0 ? '<button data-act="swap" data-a="' + e.id + '" data-b="' + placed[i - 1].id + '" aria-label="Move up" title="Swap with the one above">↑</button>' : '') + (i < placed.length - 1 ? '<button data-act="swap" data-a="' + e.id + '" data-b="' + placed[i + 1].id + '" aria-label="Move down" title="Swap with the one below">↓</button>' : '') + '<button data-act="entrymenu" data-id="' + e.id + '" aria-label="Options">⋯</button></span></div>';
    }).join('');
    var order = '<div class="sub">Finishing order</div>' + (placed.length ? '<div class="order">' + rows + '</div>' : '<div class="help">Results appear here as you tap. Use ↑ ↓ to fix the order if two were swapped.</div>') + (out.length ? '<p class="help">Not running: ' + out.map(function (e) { return esc(e.bib + ' ' + shortName(e.name)) + ' (' + e.status.toUpperCase() + ')'; }).join(', ') + '</p>' : '');
    var dock = locked ? '<div class="dock"><span class="bad">This event is finalised. Ask an admin to reopen it.</span></div>' : '<div class="dock"><button class="btn" data-act="undo" data-id="' + id + '">↶ Undo last</button>' + (ev.status === 'completed' || ev.status === 'final' ? '<button class="btn" data-act="reopen" data-id="' + id + '">Reopen event</button>' : '<button class="btn primary" data-act="finish" data-id="' + id + '">Finish event ✓</button>') + '</div>';
    return head + heatBar + clock + tiles + order + dock;
  }
  function tile(ev, e) {
    var h = houseOf(e.house_id), state = e.status !== 'ok' ? 'out' : e.position !== null ? 'done' : 'wait', rel = ev.kind === 'relay';
    var inner = (rel ? '<span class="bib">' + esc(h.name) + '</span><span class="nm">team</span>' : '<span class="bib">' + esc(e.bib) + '</span><span class="nm">' + esc(shortName(e.name)) + '</span><span class="hn">' + esc(h.name) + '</span>') +
      (state === 'done' ? '<span class="res">' + esc(e.performance) + '</span><span class="place">' + ord(e.position) + '</span>' : state === 'out' ? '<span class="res">' + esc(e.status.toUpperCase()) + '</span>' : '');
    return '<div class="tilew"><button class="tile ' + state + '" style="--c:' + esc(h.color) + '" data-act="tap" data-id="' + e.id + '" aria-label="' + esc((rel ? h.name : e.bib + ' ' + e.name) + (state === 'done' ? ', ' + ord(e.position) + ', ' + e.performance : '')) + '">' + inner + '</button><button class="more" data-act="entrymenu" data-id="' + e.id + '" aria-label="Options for ' + esc(e.name) + '">⋯</button></div>';
  }
  var raf = 0;
  function tickClock() {
    cancelAnimationFrame(raf);
    var el = $('#clk'); if (!el) return;
    (function f() { var c = $('#clk'); if (!c) return; var st = clockStart(+c.dataset.ev, +c.dataset.heat); c.textContent = fmtClock(st ? serverNow() - st : 0); raf = requestAnimationFrame(f); })();
  }

  function tapEntry(id) {
    var f = entryOf(id); if (!f) return; var ev = f.ev, e = f.e;
    if (ev.status === 'final' && !isAdmin()) return toast('This event is finalised', 'e');
    if (e.status !== 'ok' || e.position !== null) return entryMenu(id);               // already has a result: offer fixes instead of a second tap
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
    modal(title, '<div class="keyout" id="ko">0</div><div class="help" style="text-align:center">' + esc(ev.name) + ' · metres</div><div class="keys">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0, '⌫'].map(function (k) { return '<button type="button" data-k="' + k + '">' + k + '</button>'; }).join('') + '</div><div class="row"><button class="btn primary big grow" data-save>Save</button></div>', function (d) {
      var out = $('#ko', d), show = function () { out.textContent = val || '0'; };
      $$('.keys button', d).forEach(function (b) { b.onclick = function () { var k = b.dataset.k; if (k === '⌫') val = val.slice(0, -1); else if (k === '.') { if (val.indexOf('.') < 0) val = (val || '0') + '.'; } else if (val.replace('.', '').length < 6) val += k; show(); }; });
      $('[data-save]', d).onclick = function () {
        var v = parseFloat(val); if (!(v > 0)) return toast('Type a distance first', 'e');
        enqueue('/api/entries/' + e.id + '/mark', { value: v }, { k: 'mark', id: e.id, v: v }); (UI.last[ev.id] = UI.last[ev.id] || []).push(e.id); buzz(30); overlay(); closeModal(); render(); if (then) then();
      };
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
    modal((ev.kind === 'relay' ? h.name + ' team' : e.bib + ' ' + shortName(e.name)), '<p class="help" style="margin:0"><span class="dot" style="background:' + esc(h.color) + '"></span>' + esc(h.name) + (e.performance ? ' · ' + esc(e.performance) + (e.position ? ' · ' + ord(e.position) : '') : '') + '</p>' +
      opt('manual', ev.measure === 'time' ? 'Enter a time by hand' : 'Enter a distance') + opt('setstatus-dns', 'Did not start (DNS)') + opt('setstatus-dnf', 'Did not finish (DNF)') + opt('setstatus-dq', 'Disqualified (DQ)') + (has ? opt('clearresult', 'Clear this result', 'bad') : '') +
      '<div class="help" style="margin:4px 0 0">Move to heat</div>' + hb + (isAdmin() ? opt('removeentry', 'Remove from this event', 'bad') : ''));
  }

  /* ------------------------------------------------------------------ STANDINGS (read-only for recorders) */
  function standingsView() {
    var s = ST, max = Math.max(20, s.standings[0] ? s.standings[0].points : 0);
    var rows = s.standings.map(function (h) {
      return '<article class="stand-house-card" style="--house-color:' + esc(h.color) + '"><div class="stand-house-head"><span class="stand-house-rank">#' + h.rank + '</span><h3>' + esc(h.name) + '</h3></div><div class="stand-house-score">' + h.points + '<small>pts</small></div><div class="stand-house-bar"><i style="width:' + (h.points / max * 100) + '%"></i></div><div class="stand-house-medals"><span class="gold">Gold <b>' + h.gold + '</b></span><span class="silver">Silver <b>' + h.silver + '</b></span><span class="bronze">Bronze <b>' + h.bronze + '</b></span></div></article>';
    }).join('');
    var top = (s.awards.topAthletes || []).slice(0, 5).map(function (a) {
      var house = houseOf(a.house_id);
      return '<li class="athlete-leader-row"><span class="athlete-rank rank-' + a.rank + '">#' + a.rank + '</span><span class="athlete-name"><span class="dot" style="background:' + esc(house.color) + '"></span><b>' + esc(a.name) + '</b><small>' + esc(house.name) + '</small></span><span class="athlete-points">' + a.points + '<small>pts</small></span></li>';
    }).join('');
    return '<div class="row sp" style="margin-bottom:10px"><span class="mute">' + s.progress.done + ' of ' + s.progress.total + ' events done</span><span><a class="btn sm" href="/" target="_blank" rel="noopener">Public page</a> <a class="btn sm" href="/report" target="_blank" rel="noopener">Report</a></span></div>' +
      '<div class="standings-board">' + rows + '</div><div class="card athlete-leaderboard"><h3>Top athletes</h3>' + (top ? '<ol>' + top + '</ol>' : '<div class="empty">No results yet.</div>') + '</div>';
  }

  /* ------------------------------------------------------------------ SETUP (admin only) */
  var STD = [['60m', 'time'], ['100m', 'time'], ['200m', 'time'], ['400m', 'time'], ['800m', 'time'], ['1500m', 'time'], ['Long jump', 'distance'], ['High jump', 'distance'], ['Triple jump', 'distance'], ['Shot put', 'distance'], ['Discus', 'distance'], ['Javelin', 'distance'], ['4 x 100m Relay', 'relay']];
  var QA = { names: { '100m': 1, 'Long jump': 1 }, levels: { Junior: 1, Intermediate: 1, Senior: 1 }, genders: { F: 1, M: 1 }, fill: true, custom: [] };
  var LEVELS = ['Junior', 'Intermediate', 'Senior'];

  function setupView(r) {
    var tab = r.a || 'athletes', chip = function (k, t) { return '<a class="btn sm" href="#/setup/' + k + '"' + (tab === k || (k === 'events' && tab === 'event') ? ' style="background:var(--brand);color:#fff;border-color:var(--brand)"' : '') + '>' + t + '</a>'; };
    var nav = '<div class="row" style="margin-bottom:12px">' + chip('athletes', '1 · Athletes') + chip('events', '2 · Events') + chip('team', '3 · Team') + chip('day', '4 · Day') + '</div>';
    if (tab === 'events') return nav + eventsSetup();
    if (tab === 'event') return nav + eventManage(+r.b);
    if (tab === 'team') return nav + teamSetup();
    if (tab === 'day') return nav + daySetup();
    return nav + athletesSetup();
  }
  function setupAfter(r) {
    var tab = r.a || 'athletes';
    if ((tab === 'athletes' || tab === 'event') && !ATH) api('GET', '/api/athletes').then(function (d) { ATH = d.athletes; render(); }, fail);
    if (tab === 'team' && !USERS) api('GET', '/api/users').then(function (d) { USERS = d.users; render(); }, fail);
    if (tab === 'day' && !AUDIT) api('GET', '/api/admin/audit?limit=60').then(function (d) { AUDIT = d.audit; render(); }, fail);
  }
  var refreshAth = function () { return api('GET', '/api/athletes').then(function (d) { ATH = d.athletes; }); };
  var houseSelect = function (name, all) { return '<select name="' + name + '">' + (all ? '<option value="">All houses</option>' : '') + ST.houses.map(function (h) { return '<option value="' + h.id + '">' + esc(h.name) + '</option>'; }).join('') + '</select>'; };

  /* --- 1. athletes --- */
  function athletesSetup() {
    var imp = '<div class="card"><h2>Add your athletes</h2><p class="help">Paste a list from a spreadsheet or open a CSV file. One athlete per line: <b>Name, House, Age group, Gender</b> (optional fifth column: bib number). Age group is Junior, Intermediate or Senior; gender is F or M. Everyone gets a bib such as E07 automatically.</p>' +
      '<textarea id="paste" rows="6" placeholder="Thabo Mokoena, Eagles, Junior, M&#10;Lerato Kolo, Hawks, Senior, F" aria-label="Athlete list"></textarea><div class="row" style="margin-top:10px"><input type="file" id="csvfile" accept=".csv,.txt,text/csv,text/plain" style="max-width:280px" aria-label="Choose a CSV file"><button class="btn primary grow" data-act="import">Import athletes</button></div></div>';
    var one = '<div class="card"><h3>Add one athlete</h3><form id="addath" class="formrow"><label>Full name<input name="full_name" required autocomplete="off"></label><label>House' + houseSelect('house_id') + '</label><label>Age group<select name="level"><option value="">(none)</option>' + LEVELS.map(function (l) { return '<option>' + l + '</option>'; }).join('') + '</select></label><label>Gender<select name="gender"><option value="">(none)</option><option value="F">Girl</option><option value="M">Boy</option></select></label><button class="btn primary">Add</button></form></div>';
    if (!ATH) return imp + one + '<div class="empty">Loading the list…</div>';
    var q = UI.aq.toLowerCase(), hf = UI.ahouse;
    var per = ST.houses.map(function (h) { return ATH.filter(function (a) { return a.house_id === h.id; }).length; });
    var list = ATH.filter(function (a) { return (hf === 'all' || a.house_id === +hf) && (!q || (a.full_name + ' ' + a.bib).toLowerCase().indexOf(q) > -1); });
    var chips = '<div class="chips"><button data-act="ahouse" data-k="all" aria-pressed="' + (hf === 'all') + '">All (' + ATH.length + ')</button>' + ST.houses.map(function (h, i) { return '<button data-act="ahouse" data-k="' + h.id + '" aria-pressed="' + (hf === String(h.id) || hf === h.id) + '"><span class="dot" style="background:' + esc(h.color) + '"></span>' + esc(h.name) + ' (' + per[i] + ')</button>'; }).join('') + '</div>';
    var rows = list.slice(0, 400).map(function (a) { var h = houseOf(a.house_id); return '<tr><td><b>' + esc(a.bib) + '</b></td><td>' + esc(a.full_name) + '</td><td><span class="dot" style="background:' + esc(h.color) + '"></span>' + esc(h.name) + '</td><td>' + esc(a.level || '–') + '</td><td>' + (a.gender === 'F' ? 'Girl' : a.gender === 'M' ? 'Boy' : '–') + '</td><td class="num">' + a.entries + '</td><td class="num"><button class="btn sm" data-act="editath" data-id="' + a.id + '">Edit</button></td></tr>'; }).join('');
    var roster = '<div class="card"><div class="row sp"><h2 style="margin:0">Roster (' + ATH.length + ')</h2><a class="btn sm" href="/api/athletes.csv">Download CSV</a></div>' + chips + '<input id="aq" type="search" placeholder="Search name or bib" value="' + esc(UI.aq) + '" aria-label="Search athletes" style="margin-bottom:10px"><div class="tw"><table><thead><tr><th>Bib</th><th>Name</th><th>House</th><th>Age</th><th>Gender</th><th class="num">Events</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="empty">No athletes yet. Paste a list above.</td></tr>') + '</tbody></table></div>' + (list.length > 400 ? '<p class="help">Showing the first 400. Use search to narrow down.</p>' : '') + '</div>';
    return imp + one + roster;
  }
  function parseRoster(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean); if (!lines.length) return [];
    var delim = lines.some(function (l) { return l.indexOf('\t') > -1; }) ? '\t' : (lines[0].indexOf(';') > -1 && lines[0].indexOf(',') < 0 ? ';' : ',');
    var rows = lines.map(function (l) { return l.split(delim).map(function (x) { return x.replace(/^"|"$/g, '').trim(); }); });
    var map = { name: 0, house: 1, level: 2, gender: 3, bib: 4 }, head = rows[0].map(function (x) { return x.toLowerCase(); });
    if (head.some(function (h) { return /name/.test(h); }) && head.some(function (h) { return /house/.test(h); })) {
      head.forEach(function (h, i) { if (/name/.test(h)) map.name = i; else if (/house/.test(h)) map.house = i; else if (/age|group|level|categ/.test(h)) map.level = i; else if (/gender|sex/.test(h)) map.gender = i; else if (/bib|number|no\.?$/.test(h)) map.bib = i; });
      rows.shift();
    }
    return rows.map(function (r) { return { full_name: r[map.name] || '', house: r[map.house] || '', level: r[map.level] || '', gender: r[map.gender] || '', bib: r[map.bib] || '' }; });
  }
  function importAthletes() {
    var rows = parseRoster($('#paste').value); if (!rows.length) return toast('Paste your list first', 'e');
    api('POST', '/api/athletes/import', { rows: rows }).then(function (r) {
      $('#paste').value = ''; return Promise.all([refreshAth(), load()]).then(function () {
        render();
        modal('Import finished', '<p><b class="ok">' + r.created + ' added</b>' + (r.skipped ? ', ' + r.skipped + ' already on the list' : '') + (r.errorCount ? ', <b class="bad">' + r.errorCount + ' not added</b>' : '') + '.</p>' + (r.errors.length ? '<div class="help">' + r.errors.map(esc).join('<br>') + '</div>' : '') + '<button class="btn primary" data-close>OK</button>');
      });
    }, fail);
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
    var chip = function (k, t, on) { return '<label class="' + (on ? 'on' : '') + '"><input type="checkbox" data-qa="' + esc(k) + '"' + (on ? ' checked' : '') + '> ' + esc(t) + '</label>'; };
    var names = STD.map(function (s) { return chip('name:' + s[0], s[0], !!QA.names[s[0]]); }).join('') + QA.custom.map(function (c) { return chip('name:' + c[0], c[0], !!QA.names[c[0]]); }).join('');
    var quick = '<div class="card"><h2>Create events</h2><p class="help">Tick what you want. One event is made for every event × age group × gender, and the athletes who fit are entered automatically.</p>' +
      '<b>Events</b><div class="chips">' + names + '</div><div class="row"><input id="cname" placeholder="Another event, e.g. 300m hurdles" style="max-width:300px" aria-label="Custom event name"><select id="ctype" style="max-width:150px" aria-label="Type"><option value="time">Timed</option><option value="distance">Distance</option></select><button class="btn sm" data-act="addcustom">Add to list</button></div>' +
      '<b>Age groups</b><div class="chips">' + LEVELS.map(function (l) { return chip('level:' + l, l, !!QA.levels[l]); }).join('') + '</div><b>Gender</b><div class="chips">' + chip('gender:F', 'Girls', !!QA.genders.F) + chip('gender:M', 'Boys', !!QA.genders.M) + '</div>' +
      '<div class="chips">' + chip('fill', 'Enter everyone who fits from the roster', QA.fill) + '</div><button class="btn primary big" data-act="createevents">Create events</button><p class="help">Relays are one mixed event with the four houses. Running this twice never makes duplicates.</p></div>';
    var list = ST.events.slice().sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99') || a.id - b.id; }).map(function (e) {
      return '<div class="erow"><input type="time" value="' + esc(e.time) + '" data-change="evtime" data-id="' + e.id + '" aria-label="Start time for ' + esc(e.name) + '"><div class="grow"><b>' + esc(e.name) + '</b><br><small>' + esc(label(e)) + (e.kind === 'relay' ? ' · relay' : '') + ' · ' + (e.measure === 'time' ? 'timed' : 'distance') + ' · ' + e.count + ' athletes</small></div><a class="btn sm" href="#/setup/event/' + e.id + '">Manage</a></div>';
    }).join('');
    return quick + '<div class="card"><h2>Events (' + ST.events.length + ')</h2><p class="help">Set the start time of each event so the public page and recorders see the order of the day.</p>' + (list || '<div class="empty">No events yet.</div>') + '</div>';
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
    var heats = ev.heats || 1;
    var rows = ev.entries.slice().sort(function (a, b) { return a.heat - b.heat || (a.bib || '').localeCompare(b.bib || '', undefined, { numeric: true }); }).map(function (e) {
      var h = houseOf(e.house_id);
      return '<tr><td><b>' + esc(e.bib || '–') + '</b></td><td>' + esc(e.name) + '</td><td><span class="dot" style="background:' + esc(h.color) + '"></span>' + esc(h.name) + '</td><td style="width:90px"><select data-change="entryheat" data-id="' + e.id + '" aria-label="Heat for ' + esc(e.name) + '">' + Array.apply(null, Array(Math.max(heats, 1) + 1)).map(function (_, i) { return '<option' + (e.heat === i + 1 ? ' selected' : '') + '>' + (i + 1) + '</option>'; }).join('') + '</select></td><td class="num"><button class="btn sm" data-act="removeentry" data-id="' + e.id + '">Remove</button></td></tr>';
    }).join('');
    return '<div class="ehead"><a class="btn sm" href="#/setup/events">‹ Events</a><div class="grow"><h2>' + esc(ev.name) + '</h2><small>' + esc(label(ev)) + ' · ' + (ev.measure === 'time' ? 'timed' : 'distance') + ' · ' + ev.count + ' athletes' + (heats > 1 ? ' · ' + heats + ' heats' : '') + '</small></div>' + pill(ev.status) + '</div>' +
      '<div class="card"><div class="row"><button class="btn primary" data-act="addathletes" data-id="' + id + '">Add athletes…</button><button class="btn" data-act="addall" data-id="' + id + '">Add everyone who fits</button><button class="btn" data-act="editevent" data-id="' + id + '">Edit details</button><button class="btn danger" data-act="delevent" data-id="' + id + '">Delete event</button></div>' +
      (ev.kind === 'relay' ? '' : '<div class="row" style="margin-top:12px"><label style="max-width:230px">Split into heats of about<input id="hsize" type="number" min="2" max="30" value="8"></label><button class="btn" data-act="makeheats" data-id="' + id + '" style="margin-top:18px">Make heats</button></div><p class="help">Heats mix the houses so every heat is fair. Each heat has its own clock, and the final places are worked out from all the times together.</p>') + '</div>' +
      '<div class="card"><h3>Athletes in this event</h3><div class="tw"><table><thead><tr><th>Bib</th><th>Name</th><th>House</th><th>Heat</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">Nobody yet. Add athletes above.</td></tr>') + '</tbody></table></div></div>';
  }
  function addAthletesDialog(id) {
    var ev = evOf(id); if (!ev) return;
    var have = {}; ev.entries.forEach(function (e) { if (e.athlete_id) have[e.athlete_id] = 1; });
    var cand = ATH.filter(function (a) { return !have[a.id]; });
    var fits = function (a) { return (ev.level === 'Mixed' || a.level === ev.level) && (!ev.gender || a.gender === ev.gender); };
    modal('Add athletes to ' + ev.name, '<input id="cq" type="search" placeholder="Search" aria-label="Search athletes"><div class="row"><button class="btn sm" type="button" data-sel="fit">Select who fits</button><button class="btn sm" type="button" data-sel="all">Select all</button><button class="btn sm" type="button" data-sel="none">None</button></div><div id="clist" style="max-height:46vh;overflow:auto;display:grid;gap:4px">' +
      cand.map(function (a) { var h = houseOf(a.house_id); return '<label class="chips" style="margin:0;display:flex;font-weight:400;border:0;cursor:pointer" data-t="' + esc((a.full_name + ' ' + a.bib).toLowerCase()) + '"><input type="checkbox" value="' + a.id + '" data-fit="' + (fits(a) ? 1 : 0) + '"> <span class="dot" style="background:' + esc(h.color) + '"></span><b>' + esc(a.bib) + '</b>&nbsp;' + esc(a.full_name) + ' <small>&nbsp;' + esc((a.level || '') + ' ' + (a.gender || '')) + '</small></label>'; }).join('') + (cand.length ? '' : '<div class="empty">Everyone is already in this event.</div>') + '</div><button class="btn primary big" data-go>Add selected</button>', function (d) {
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
      '<p class="help">Changing the points re-scores every event straight away. DNS, DNF and DQ always score 0.</p><b>House colours</b><form id="hform" class="formrow" style="margin-top:6px">' + ST.houses.map(function (h) { return '<label>' + esc(h.name) + '<input type="color" name="c' + h.id + '" value="' + esc(h.color) + '" style="padding:2px"></label>'; }).join('') + '<button class="btn">Save colours</button></form></div>';
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
      while (stack.length && !pick) { var c = stack.pop(), en = ev.entries.filter(function (x) { return x.id === c; })[0]; if (en && (en.position !== null || en.status !== 'ok')) pick = en; }
      if (!pick) { var l = ev.entries.filter(function (x) { return x.position !== null; }).sort(function (a, b) { return b.at - a.at; })[0]; pick = l; }
      if (!pick) return toast('Nothing to undo');
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
    ahouse: function (el) { UI.ahouse = el.dataset.k; render(); },
    editath: function (el) { editAthlete(el.dataset.id); },
    addcustom: function () { var n = $('#cname').value.trim(); if (!n) return; QA.custom.push([n, $('#ctype').value]); QA.names[n] = 1; render(); },
    createevents: createEvents,
    addathletes: function (el) { if (ATH) addAthletesDialog(+el.dataset.id); else refreshAth().then(function () { addAthletesDialog(+el.dataset.id); }, fail); },
    addall: function (el) { api('POST', '/api/events/' + el.dataset.id + '/entries', { all: true }).then(function (r) { toast(r.added + ' added'); return Promise.all([load(), refreshAth()]); }).then(render, fail); },
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
    if (t.id === 'csvfile' && t.files[0]) { var fr = new FileReader(); fr.onload = function () { $('#paste').value = String(fr.result).replace(/^\ufeff/, ''); toast('File loaded. Press Import.'); }; fr.readAsText(t.files[0]); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'evq') { UI.q = e.target.value; var p = e.target.selectionStart; render(); var n = $('#evq'); if (n) { n.focus(); n.setSelectionRange(p, p); } }
    if (e.target.id === 'aq') { UI.aq = e.target.value; var p2 = e.target.selectionStart; render(); var n2 = $('#aq'); if (n2) { n2.focus(); n2.setSelectionRange(p2, p2); } }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'addath') { e.preventDefault(); api('POST', '/api/athletes', { full_name: f.full_name.value, house_id: +f.house_id.value, level: f.level.value, gender: f.gender.value }).then(function (r) { toast('Added ' + r.athlete.bib); f.reset(); return Promise.all([refreshAth(), load()]); }).then(render, fail); }
    if (f.id === 'adduser') { e.preventDefault(); api('POST', '/api/users', { display_name: f.display_name.value, username: f.username.value, password: f.password.value, role: f.role.value }).then(function () { toast('Account created'); f.reset(); USERS = null; render(); }, fail); }
    if (f.id === 'setf') {
      e.preventDefault(); var pts = f.points.value.split(/[ ,;]+/).filter(Boolean).map(Number);
      api('PATCH', '/api/settings', { title: f.title.value, venue: f.venue.value, date: f.date.value, start: f.start.value, nameDisplay: f.nameDisplay.value, scheme: { points: pts, rest: +f.rest.value } }).then(function () { toast('Saved'); return load(); }).then(render, fail);
    }
    if (f.id === 'hform') { e.preventDefault(); api('PATCH', '/api/settings', { houses: ST.houses.map(function (h) { return { id: h.id, name: h.name, color: f['c' + h.id].value }; }) }).then(function () { toast('Colours saved'); return load(); }).then(render, fail); }
  });

  /* ------------------------------------------------------------------ account menu */
  $('#menu').addEventListener('click', function () {
    modal(ME.display_name, '<p class="help" style="margin:0">' + esc(ME.username) + ' · ' + (ME.role === 'admin' ? 'Admin' : 'Recorder') + '</p><a class="opt" href="/" target="_blank" rel="noopener">Open the public page</a><a class="opt" href="/report" target="_blank" rel="noopener">Printable report</a><form id="mypw" class="formrow" style="grid-template-columns:1fr"><b>Change my password</b><label>Current password<input name="cur" type="password" autocomplete="current-password" required></label><label>New password (8+ characters)<input name="pw" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn">Change password</button></form><button class="btn danger" data-act-out>Sign out</button>', function (d) {
      $('#mypw', d).onsubmit = function (e) { e.preventDefault(); api('POST', '/api/me/password', { current: e.target.cur.value, password: e.target.pw.value }).then(function () { toast('Password changed. Sign in again.'); }, fail); };
      $('[data-act-out]', d).onclick = function () { api('POST', '/api/logout', {}).then(function () { ME = null; closeModal(); showLogin(); }, fail); };
    });
  });

  /* ------------------------------------------------------------------ go */
  api('GET', '/api/me').then(function (r) { if (r.user) { ME = r.user; start(); } else showLogin(); }, function () { showLogin(); });
})();
