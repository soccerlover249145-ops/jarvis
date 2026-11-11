/* home.js: the home dashboard ("Quiet Command"). Glanceable cards built only from what this page already holds:
   the pack (what is due), the saved town's forecast (Open-Meteo, coordinates only, the same request the brief and
   charts use), what Jarvis is working on and has made, anything waiting for the founder's OK in the conversation,
   connected devices and away mode. Nothing here is invented: a card with nothing to show says so.
   Every button only opens something; nothing is sent, spent or changed from this board.
   Built with textContent and SVG nodes only, so no text from the pack or a reply can become markup. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var SVGNS = 'http://www.w3.org/2000/svg';
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var root = null, cards = null, when = null, wx = null, wxAt = 0, sig = '', timer = 0, renderT = 0;

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function s(tag, a) { var e = document.createElementNS(SVGNS, tag); for (var k in a) e.setAttribute(k, a[k]); return e; }
  function chip(text, kind) { var c = h('span', 'qchip' + (kind ? ' ' + kind : '')); c.appendChild(h('i', 'qdot')); c.appendChild(document.createTextNode(text)); return c; }
  function btn(text, kind, fn, label) { var b = h('button', 'qbtn' + (kind ? ' ' + kind : ''), text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); b.addEventListener('click', function (e) { if (!e.isTrusted) return; fn(); }); return b; }
  function go(k) { if (Kin.go) Kin.go(k); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function clock(d) { var hr = d.getHours() % 12 || 12; return hr + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'); }
  function part(d) { var hr = d.getHours(); return hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening'; }
  function shortHr(hr) { return hr === 0 ? '12a' : hr < 12 ? hr + 'a' : hr === 12 ? '12p' : (hr - 12) + 'p'; }
  function money(v) { return '$' + (v || 0).toFixed(2); }

  /* ------------------------------------------------------------ the weather: watched, not invented */
  function wmo(c) { var W = Kin.briefBoard && Kin.briefBoard._wmo; return W ? W(c) : { k: 'cloud', t: 'Cloudy' }; }
  function takeForecast(f) {
    var j = f && f.raw; if (!j || !j.current || !j.hourly || !Array.isArray(j.hourly.time)) return;
    var H = j.hourly, cur = j.current, D = j.daily || {}, day = String(cur.time || '').slice(0, 10), hours = [];
    for (var i = 0; i < H.time.length; i++) if (String(H.time[i]).slice(0, 10) === day) hours.push({ hr: +String(H.time[i]).slice(11, 13), temp: H.temperature_2m ? H.temperature_2m[i] : null, rain: H.precipitation_probability ? H.precipitation_probability[i] : null });
    var rainAt = null, nowHr = +String(cur.time || '').slice(11, 13);
    hours.forEach(function (x) { if (rainAt == null && x.hr >= nowHr && x.rain >= 50) rainAt = x.hr; });
    wx = { place: (f.place && f.place.name) || '', unit: f.units === 'C' ? 'C' : 'F', temp: cur.temperature_2m, code: cur.weather_code, day: cur.is_day !== 0, nowHr: nowHr,
      hi: D.temperature_2m_max ? D.temperature_2m_max[0] : null, lo: D.temperature_2m_min ? D.temperature_2m_min[0] : null, rainMax: D.precipitation_probability_max ? D.precipitation_probability_max[0] : null, rainAt: rainAt, hours: hours };
    wxAt = Date.now(); soon();
  }
  /* every forecast the page asks for (the brief, a chart, this board) is shown here too */
  function watchForecast() {
    var C = Kin.chart; if (!C || C.__homeWatch) return; var orig = C.forecast;
    C.forecast = function () { var p = orig.apply(C, arguments); p.then(takeForecast, function () {}); return p; };
    C.__homeWatch = true;
  }
  /* the board never asks for the weather on its own: it shows the forecast the brief or a chart fetched, and asks
     Open-Meteo (coordinates only) only when the founder taps "Get the forecast" */
  var asking = false;
  function askWeather() {
    if (asking || Kin.shared || !Kin.chart || !Kin.chart.place || !Kin.chart.place()) return;
    asking = true; soon(); Kin.chart.forecast().then(function () { asking = false; soon(); }, function () { asking = false; wxErr = true; sig = ''; soon(); });
  }
  var wxErr = false;

  /* ------------------------------------------------------------ what the page holds right now */
  function gather() {
    var now = new Date(), pack = null, B = Kin.briefBoard, nok = null;
    try { pack = Kin.shared ? null : Kin.pack && Kin.pack.get(); } catch (e) { pack = null; }
    try { nok = pack && B && B._fromPack ? B._fromPack(pack, now, B.settings && B.settings.get ? B.settings.get() : {}) : null; } catch (e) { nok = null; }
    var t = document.getElementById('thread'), jobs = [], asks = [];
    if (t) {
      Array.prototype.forEach.call(t.querySelectorAll('.msg.card.job'), function (c, i) {
        var title = c.querySelector('.asktitle'), now1 = c.querySelector('.jnow'), sp = c.querySelector('.jspent');
        jobs.push({ i: i, title: title ? title.textContent : 'A job', now: now1 ? now1.textContent : '', spent: sp ? sp.textContent : '', live: c.classList.contains('live'), done: c.classList.contains('done'), bad: c.classList.contains('bad') });
      });
      Array.prototype.forEach.call(t.querySelectorAll('.msg.ask:not(.job)'), function (c, i) {
        if (!c.querySelector('.askyes:not([disabled])')) return;
        var title = c.querySelector('.asktitle'), line = c.querySelector('.cline');
        asks.push({ i: i, title: title ? title.textContent : 'Jarvis is asking before it goes on', line: line ? line.textContent : '' });
      });
    }
    var made = [], spent = 0, away = { on: false, call: false }, devs = [], gaunt = false;
    try { made = (Kin.mind && Kin.mind.made ? Kin.mind.made() : []).slice(-3).reverse().map(function (m) { return { id: m.id, title: m.title || 'Untitled', kind: m.kind || '' }; }); } catch (e) {}
    try { var sp = Kin.mind && Kin.mind.spendToday ? Kin.mind.spendToday() : null; spent = sp && isFinite(sp.usd) ? +sp.usd : 0; } catch (e) {}
    if (!Kin.shared) { try { var v = JSON.parse(localStorage.getItem('kin.away') || 'null'); away.on = !!(v && v.settings && v.settings.on); away.call = !!(v && v.settings && v.settings.allowCallMe); } catch (e) {} }
    try { devs = Kin.devices && Kin.devices.latest ? Kin.devices.latest() : []; } catch (e) {}
    try { gaunt = !!(Kin.gauntlet && Kin.gauntlet.running && Kin.gauntlet.running()); } catch (e) {}
    var place = null; try { place = !Kin.shared && Kin.chart && Kin.chart.place ? Kin.chart.place() : null; } catch (e) {}
    return { now: now, pack: pack ? pack.name || 'Your pack' : '', nok: nok, jobs: jobs, asks: asks, made: made, spent: spent, away: away, devs: devs.slice(0, 2), devCount: (Kin.devices && Kin.devices.list ? Kin.devices.list().length : 0), gaunt: gaunt, wx: wx, place: place ? place.name : '', hasKey: !!(Kin.brain && Kin.brain.hasKey && Kin.brain.hasKey()), shared: !!Kin.shared };
  }

  /* ------------------------------------------------------------ the cards */
  function card(cls, title, more) {
    var c = h('article', 'qcard ' + cls);
    if (title) { var hd = h('div', 'qcard-h'); hd.appendChild(h('h2', 'qt', title)); if (more) hd.appendChild(h('span', 'qmore', more)); c.appendChild(hd); }
    return c;
  }
  function empty(c, text, act) { var p = h('p', 'qempty', text); c.appendChild(p); if (act) { var r = h('div', 'qrow'); r.appendChild(act); c.appendChild(r); } }

  function hero(d) {
    var c = card('qhero', null), lab = h('div', 'qlabel', d.now.getHours() < 12 ? 'Morning brief' : d.now.getHours() < 18 ? 'Afternoon brief' : 'Evening brief');
    c.appendChild(lab);
    var h1 = h('h1', 'qgreet'); h1.appendChild(document.createTextNode('Good ' + part(d.now) + ', ')); h1.appendChild(h('em', '', 'sir.')); c.appendChild(h1);
    var p = h('p', 'qsum'), bits = [];
    if (d.shared) bits.push(['', 'This page is open inside another site, so nothing of yours is shown here. Open Jarvis at its own address.']);
    else if (!d.pack) bits.push(['', 'Once your pack is loaded, this page shows what is due, what I am working on and anything waiting for your OK.']);
    else if (d.nok) {
      var n = d.nok.needs || {}, todayN = (d.nok.priorities || []).concat(d.nok.today || []).filter(function (x) { return x.d === iso(d.now); }).length;
      if (todayN) bits.push([todayN === 1 ? 'One thing is due today.' : todayN + ' things are due today.', '']);
      else bits.push(['Nothing is due today.', '']);
      if (n.overdue) bits.push(['', ' ' + n.overdue + (n.overdue === 1 ? ' is' : ' are') + ' overdue.']);
      if (d.nok.first) bits.push(['', ' First up: ' + d.nok.first.t + '.']);
    }
    if (d.wx && d.wx.rainAt != null && d.wx.rainAt >= d.wx.nowHr) bits.push(['', ' Rain is likely from ' + clock(new Date(2000, 0, 1, d.wx.rainAt)).replace(':00', '') + '.']);
    if (d.asks.length) bits.push(['', ' ' + (d.asks.length === 1 ? 'One thing is waiting' : d.asks.length + ' things are waiting') + ' for your OK.']);
    bits.forEach(function (b) { if (b[0]) p.appendChild(h('b', '', b[0])); if (b[1]) p.appendChild(document.createTextNode(b[1])); });
    c.appendChild(p);
    var a = h('div', 'qacts');
    a.appendChild(btn('Open the brief', 'primary lg', function () { go('brief'); }));
    a.appendChild(btn('What’s new', 'lg', function () { go('whatsnew'); }));
    a.appendChild(btn('Away mode', 'ghost lg hide-sm', function () { go('away'); }));
    c.appendChild(a);
    return c;
  }

  function sky(kind, day) {
    var i = h('div', 'qsky ' + (kind === 'sun' && !day ? 'moon' : kind)); i.setAttribute('aria-hidden', 'true');
    i.appendChild(h('i', 'qsun')); i.appendChild(h('i', 'qcloud')); i.appendChild(h('i', 'qdrops')); return i;
  }
  function weather(d) {
    var c = card('qwx', null);
    if (!d.wx) {
      c.appendChild(h('div', 'qlabel', 'Weather'));
      if (!d.place) { empty(c, 'Set your town under Settings, Brief, and the forecast shows here. Only its coordinates are sent to Open-Meteo.', btn('Set your town', 'sm', function () { go('weather'); })); return c; }
      empty(c, asking ? 'Asking Open-Meteo for ' + d.place + '…' : (wxErr ? 'The forecast did not come through. ' : '') + 'The forecast for ' + d.place + ' shows here once you ask for it or open the brief.', asking ? null : btn('Get the forecast', 'sm', function () { wxErr = false; askWeather(); }));
      return c;
    }
    var w = d.wx, k = wmo(w.code), top = h('div', 'qwx-now'), l = h('div');
    var t = h('div', 'qtemp num', isFinite(w.temp) ? Math.round(w.temp) : '–'); t.appendChild(h('sup', '', '°' + w.unit)); l.appendChild(t);
    l.appendChild(h('div', 'qcond', k.t));
    l.appendChild(h('div', 'qhl num', [isFinite(w.hi) ? 'H ' + Math.round(w.hi) + '°' : '', isFinite(w.lo) ? 'L ' + Math.round(w.lo) + '°' : '', w.rainMax != null ? 'Rain ' + w.rainMax + '%' + (w.rainAt != null ? ' at ' + shortHr(w.rainAt) : '') : ''].filter(Boolean).join(' · ')));
    top.appendChild(l); top.appendChild(sky(k.k, w.day)); c.appendChild(top);
    var hrs = w.hours.filter(function (x) { return isFinite(x.temp); });
    if (hrs.length > 3) {
      var W = 300, Hh = 64, lo = Math.min.apply(null, hrs.map(function (x) { return x.temp; })), hi = Math.max.apply(null, hrs.map(function (x) { return x.temp; })), span = Math.max(1, hi - lo);
      var X = function (hr) { return hr / 23 * W; }, Y = function (v) { return 8 + (1 - (v - lo) / span) * 34; };
      var line = hrs.map(function (x, i) { return (i ? 'L' : 'M') + X(x.hr).toFixed(1) + ' ' + Y(x.temp).toFixed(1); }).join(' ');
      var sv = s('svg', { 'class': 'qspark', viewBox: '0 0 ' + W + ' ' + Hh, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      var g = s('linearGradient', { id: 'qwxg', x1: 0, x2: 0, y1: 0, y2: 1 }); g.appendChild(s('stop', { offset: 0, 'stop-color': '#74d4ff', 'stop-opacity': '.32' })); g.appendChild(s('stop', { offset: 1, 'stop-color': '#74d4ff', 'stop-opacity': '0' }));
      var defs = s('defs', {}); defs.appendChild(g); sv.appendChild(defs);
      sv.appendChild(s('path', { d: line + ' L' + X(hrs[hrs.length - 1].hr) + ' ' + Hh + ' L' + X(hrs[0].hr) + ' ' + Hh + 'Z', fill: 'url(#qwxg)' }));
      sv.appendChild(s('path', { d: line, fill: 'none', stroke: '#74d4ff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
      var bars = s('g', { fill: '#3aa6e8', opacity: '.6' });
      w.hours.forEach(function (x) { if (x.rain >= 30) { var bh = Math.max(4, x.rain / 100 * 22); bars.appendChild(s('rect', { x: (X(x.hr) - 3).toFixed(1), y: (Hh - bh).toFixed(1), width: 6, height: bh.toFixed(1), rx: 3 })); } });
      sv.appendChild(bars);
      var cur = hrs.filter(function (x) { return x.hr === w.nowHr; })[0];
      if (cur) sv.appendChild(s('circle', { cx: X(cur.hr), cy: Y(cur.temp), r: 4, fill: '#eef1f6' }));
      c.appendChild(sv);
      var lab = h('div', 'qhours'); [0, 6, 12, 18, 23].forEach(function (hr) { lab.appendChild(h('span', '', hr === 23 ? '12a' : shortHr(hr))); }); c.appendChild(lab);
    }
    c.setAttribute('aria-label', 'Weather in ' + (w.place || 'your town') + ': ' + Math.round(w.temp) + ' degrees, ' + k.t);
    return c;
  }

  function today(d) {
    var rows = [], t0 = iso(d.now), seen = {};
    if (d.nok) (d.nok.priorities || []).concat(d.nok.today || []).forEach(function (x) { var key = x.t + '|' + x.d; if (seen[key]) return; seen[key] = 1; rows.push(x); });
    rows.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    var late = rows.filter(function (x) { return x.d < t0; }).slice(0, 2), next = rows.filter(function (x) { return x.d >= t0; }).slice(0, 5 - late.length);
    var c = card('qtoday', 'Today', d.nok ? (next.filter(function (x) { return x.d === t0; }).length + ' due today') : '');
    if (!d.pack) { empty(c, d.shared ? 'Nothing is shown at a shared address.' : 'Nothing to show until your pack is loaded.'); return c; }
    if (!rows.length) { empty(c, 'Nothing dated in your pack for this week.'); return c; }
    var ul = h('ul', 'qtl');
    function row(x, past) {
      var li = h('li', past ? 'past' : ''), dd = new Date(x.d + 'T00:00:00'), diff = Math.round((dd - new Date(t0 + 'T00:00:00')) / 864e5);
      li.appendChild(h('span', 'qtl-t num', diff === 0 ? 'Today' : diff === 1 ? 'Tmrw' : diff < 0 ? MON[dd.getMonth()] + ' ' + dd.getDate() : DAYS[dd.getDay()].slice(0, 3)));
      var w = h('span', 'qtl-w'); w.appendChild(h('b', '', x.t)); var sub = [x.k === 'task' || !x.k ? '' : x.k[0].toUpperCase() + x.k.slice(1), x.who || '', x.st && x.st !== 'open' ? x.st[0].toUpperCase() + x.st.slice(1) : ''].filter(Boolean).join(' · '); if (sub) w.appendChild(h('span', '', sub)); li.appendChild(w);
      li.appendChild(diff < 0 ? chip('Late', 'bad') : diff === 0 ? chip('Today', 'live') : h('i', 'qchk'));
      ul.appendChild(li);
    }
    late.forEach(function (x) { row(x, true); });
    var nl = h('li', 'qnow'); nl.setAttribute('aria-label', 'Now'); var tag = h('span', 'qnow-tag num', 'Now · ' + clock(d.now)); nl.appendChild(tag); ul.appendChild(nl);
    next.forEach(function (x) { row(x, false); });
    c.appendChild(ul);
    return c;
  }

  function ring(frac, ok) {
    var sv = s('svg', { 'class': 'qring', viewBox: '0 0 44 44', 'aria-hidden': 'true' });
    sv.appendChild(s('circle', { cx: 22, cy: 22, r: 18, fill: 'none', stroke: ok ? '#4fdc9c' : '#1b1f29', 'stroke-width': 4 }));
    if (ok) sv.appendChild(s('path', { d: 'm15 22 5 5 9-10', fill: 'none', stroke: '#4fdc9c', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    else sv.appendChild(s('circle', { 'class': 'qring-arc', cx: 22, cy: 22, r: 18, fill: 'none', stroke: '#74d4ff', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-dasharray': '113', 'stroke-dashoffset': String(Math.round(113 * (1 - frac))), transform: 'rotate(-90 22 22)' }));
    return sv;
  }
  function working(d) {
    var c = card('qjobs', 'Jarvis is working on', d.spent ? money(d.spent) + ' today' : ''), any = false;
    d.jobs.filter(function (j) { return j.live; }).slice(0, 2).forEach(function (j) {
      any = true; var r = h('button', 'qjob on'); r.type = 'button'; r.appendChild(ring(0.5)); var w = h('span', 'qjob-w'); w.appendChild(h('b', '', j.title)); w.appendChild(h('span', '', j.now || 'Working')); r.appendChild(w); r.appendChild(h('span', 'qcost num', (j.spent || '').replace(/^Spent\s*/i, '')));
      r.addEventListener('click', function (e) { if (e.isTrusted) show('.msg.card.job', j.i); }); c.appendChild(r);
    });
    if (d.gaunt) { any = true; var g = h('button', 'qjob on'); g.type = 'button'; g.appendChild(ring(0.4)); var gw = h('span', 'qjob-w'); gw.appendChild(h('b', '', 'The Gauntlet')); gw.appendChild(h('span', '', 'Running the self-test')); g.appendChild(gw); g.addEventListener('click', function (e) { if (e.isTrusted) go('gauntlet'); }); c.appendChild(g); }
    d.made.slice(0, any ? 2 : 3).forEach(function (m) {
      any = true; var r = h('button', 'qjob'); r.type = 'button'; r.appendChild(ring(1, true)); var w = h('span', 'qjob-w'); w.appendChild(h('b', '', m.title)); w.appendChild(h('span', '', 'Saved to the Made shelf')); r.appendChild(w);
      r.addEventListener('click', function (e) { if (e.isTrusted) go('made:' + m.id); }); c.appendChild(r);
    });
    if (!any) empty(c, d.hasKey ? 'Nothing running. Ask for a document, a plan or a design and it shows here.' : 'Nothing running. Add your Claude key in Settings, Brain, and Jarvis can start making things.');
    return c;
  }

  function approvals(d) {
    if (!d.asks.length) { var c0 = card('qok quiet', 'Needs your OK'); empty(c0, 'Nothing is waiting for you. Anything that would send, post, buy, book, call or spend asks here first.'); return c0; }
    var a = d.asks[d.asks.length - 1], c = card('qok', null);
    c.appendChild(chip(d.asks.length > 1 ? d.asks.length + ' need your OK' : 'Needs your OK', 'warm'));
    c.appendChild(h('h3', 'qok-t', a.title));
    if (a.line) c.appendChild(h('p', 'qok-p', a.line));
    var r = h('div', 'qrow'); r.appendChild(btn('Review it', 'warm', function () { show('.msg.ask:not(.job)', a.i); })); c.appendChild(r);
    return c;
  }

  function devices(d) {
    var c = card('qdev', 'Devices', d.devCount ? d.devCount + ' connected' : '');
    if (!d.devs.length) { empty(c, d.devCount ? 'Connected. Readings show here as they arrive.' : 'Nothing connected. Heart-rate straps, scales and boards connect in the device lab, in Chrome or Edge.', btn('Open the device lab', 'sm ghost', function () { go('devices'); })); return c; }
    var g = h('div', 'qtiles');
    d.devs.forEach(function (x) { var t = h('div', 'qtile'); var l = h('div', 'qlabel'); l.appendChild(h('i', 'qdot ok')); l.appendChild(document.createTextNode(x.metric || x.device)); t.appendChild(l); var v = h('div', 'qv num', typeof x.value === 'number' ? (Math.round(x.value * 10) / 10) : String(x.value)); if (x.unit) v.appendChild(h('small', '', x.unit)); t.appendChild(v); t.appendChild(h('div', 'qtile-s', x.device)); g.appendChild(t); });
    c.appendChild(g);
    return c;
  }

  function away(d) {
    var c = card('qaway', 'Away', d.away.on ? 'On' : 'Off');
    c.appendChild(h('p', 'qempty', d.away.on ? 'Jarvis is minding things and keeps routine items for your summary.' : 'Off. Say “I’m heading out” and Jarvis minds things while you are gone.'));
    var lad = h('div', 'qladder'); lad.setAttribute('aria-hidden', 'true');
    [d.away.on, d.away.on, d.away.on, d.away.on && d.away.call].forEach(function (on) { lad.appendChild(h('span', on ? 'on' : '')); });
    c.appendChild(lad);
    c.appendChild(h('div', 'qlabel qnote', d.away.call ? 'Calls you only for big things' : 'Never calls you until you allow it'));
    var r = h('div', 'qrow'); r.appendChild(btn(d.away.on ? 'See the summary' : 'Open away mode', 'sm ghost', function () { go(d.away.on ? 'awaysummary' : 'away'); })); c.appendChild(r);
    return c;
  }

  /* scroll the dock (or the phone's conversation sheet) to a card waiting in the conversation */
  function show(sel, i) {
    if (Kin.showThread) Kin.showThread();
    var t = document.getElementById('thread'), all = t ? t.querySelectorAll(sel) : [], el = all[i] || all[all.length - 1];
    if (el && el.scrollIntoView) setTimeout(function () { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('qpulse'); setTimeout(function () { el.classList.remove('qpulse'); }, 1600); }, 60);
  }

  /* the board is only a view: a fault in any module it reads leaves the last good board on screen and is never thrown */
  function render() { try { draw(); } catch (e) {} }
  function draw() {
    if (!cards) return;
    var d = gather(), key = JSON.stringify([d.pack, d.nok && d.nok.needs, d.nok && d.nok.priorities, d.nok && d.nok.today, d.jobs, d.asks, d.made, Math.round(d.spent * 100), d.away, d.devs, d.devCount, d.gaunt, wxAt, d.place, d.hasKey, d.shared, asking, wxErr, iso(d.now), d.now.getHours(), Math.floor(d.now.getMinutes() / 5)]);
    if (when) {
      when.textContent = '';
      when.appendChild(h('b', '', DAYS[d.now.getDay()].slice(0, 3) + ', ' + MON[d.now.getMonth()] + ' ' + d.now.getDate()));
      when.appendChild(document.createTextNode(' · ' + clock(d.now) + (d.place ? ' · ' + d.place : '')));
    }
    if (key === sig) return; sig = key;
    var frag = document.createDocumentFragment();
    [hero(d), weather(d), today(d), working(d), approvals(d), devices(d), away(d)].forEach(function (c) { frag.appendChild(c); });
    cards.textContent = ''; cards.appendChild(frag);
  }
  function soon() { clearTimeout(renderT); renderT = setTimeout(render, 120); }

  function init() {
    root = document.getElementById('board'); cards = document.getElementById('homeCards'); when = document.getElementById('when');
    if (!root || !cards) return;
    watchForecast();
    var t = document.getElementById('thread');
    if (t && window.MutationObserver) new MutationObserver(soon).observe(t, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
    clearInterval(timer); timer = setInterval(function () { if (!document.hidden) render(); }, 20000);
    render();
  }

  Kin.home = { init: init, render: function () { sig = ''; render(); }, refresh: soon, _take: takeForecast };
})();
