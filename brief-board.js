/* brief-board.js: the morning brief board for the Jarvis page.

   Say "give me a morning brief" and the page shows a board of holographic glass cards over the stage:
   the weather with a graph of the day, the company's numbers from the pack, what is coming up, the founder's top
   priorities, and (when a Claude key is set) what the market did. Every number comes from real data:
   Open-Meteo for the weather, the imported pack for the company, the web for the market. Nothing is
   invented. A card with no data says so plainly, or stays hidden.

   Public surface (window.Kin.briefBoard):
     gather(opts)      -> Promise<data>  collects everything, each source with its own time limit.
     show(data, opts)  -> shows the board. hide() -> takes it away.
     summary(data)     -> one or two sentences for the voice.
     isBriefRequest(t) -> true for "give me a morning brief", "brief me" and the like.
     settings          -> { get, set, cards, place, setPlace(p), geocode(name) }  (the town and units are the page's one
                          weather setting, kept by chart.js: Kin.chart.place / setPlace / units)
     settingsUI(el)    -> draws the "which cards, in what order" control into el.

   Privacy: only the coordinates of the place the founder sets are sent, to Open-Meteo. The pack never
   leaves the device from here. Everything is drawn with textContent: no pack, web or model text is
   ever parsed as HTML. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};

  /* ------------------------------------------------------------ small helpers */
  var ls = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  var SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  function s(tag, attrs, kids) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); (kids || []).forEach(function (c) { e.appendChild(c); }); return e; }
  function stxt(x, y, str, attrs) { var t = s('text', Object.assign({ x: x, y: y }, attrs || {})); t.textContent = str; return t; }
  function withTimeout(p, ms, what) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error((what || 'That') + ' took too long.')); }, ms); p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); }
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function fromIso(v) { return new Date(v + 'T00:00:00'); }
  function daysBetween(a, b) { return Math.round((dayStart(b) - dayStart(a)) / 864e5); }
  function hourLabel(hr) { var h12 = hr % 12 || 12; return h12 + (hr < 12 ? ' AM' : ' PM'); }
  function clock(d) { return hourLabel(d.getHours()).replace(' ', ':' + String(d.getMinutes()).padStart(2, '0') + ' '); }
  function dueLabel(v, now) {
    var n = daysBetween(now, fromIso(v)), d = fromIso(v), short = DAYS[d.getDay()].slice(0, 3) + ' ' + MON[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
    if (n < 0) return { top: 'Overdue', sub: short, late: true }; if (n === 0) return { top: 'Today', sub: short }; if (n === 1) return { top: 'Tomorrow', sub: short };
    return { top: DAYS[d.getDay()].slice(0, 3), sub: MON[d.getMonth()].slice(0, 3) + ' ' + d.getDate() };
  }

  /* ------------------------------------------------------------ settings */
  var CARDS = [
    { id: 'weather', name: 'Weather' }, { id: 'nok', name: 'Your company' }, { id: 'start', name: 'Jarvis can start' }, { id: 'today', name: 'Coming up' },
    { id: 'priorities', name: 'Top priorities' }, { id: 'market', name: 'Market watch' }, { id: 'footer', name: 'On this day' }
  ];
  var DEF = { order: ['weather', 'nok', 'start', 'today', 'priorities', 'market', 'footer'], on: { weather: true, nok: true, start: true, today: true, priorities: true, market: true, footer: false }, units: 'F', owner: '', autoSmall: true, autoCap: 0.25, autoDay: 1 };
  var settings = {
    get: function () { var v = ls.get('kin.bb.settings', null) || {}; var order = (v.order || []).filter(function (id) { return DEF.order.indexOf(id) >= 0; }); DEF.order.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); }); return { order: order, on: Object.assign({}, DEF.on, v.on || {}), units: v.units === 'C' ? 'C' : 'F', owner: typeof v.owner === 'string' ? v.owner.slice(0, 60) : '', autoSmall: v.autoSmall !== false, autoCap: isFinite(v.autoCap) && v.autoCap >= 0 && v.autoCap <= 2 ? +v.autoCap : DEF.autoCap, autoDay: v.autoDay != null && isFinite(v.autoDay) && v.autoDay >= 0 && v.autoDay <= 20 ? +v.autoDay : DEF.autoDay }; },
    set: function (patch) { var v = Object.assign(settings.get(), patch || {}); ls.set('kin.bb.settings', v); return v; },
    cards: CARDS,
    /* the town and the units are the page's single weather setting, kept by chart.js (Settings, under Weather) */
    place: function () { return Kin.chart ? Kin.chart.place() : null; },
    geocode: function (name) { return Kin.chart ? Kin.chart.findPlace(name) : Promise.resolve([]); },
    setPlace: function (p) { return Kin.chart ? Kin.chart.setPlace(p) : false; },
    units: function () { return Kin.chart ? Kin.chart.units() : 'C'; }
  };

  /* ------------------------------------------------------------ weather (Open-Meteo) */
  var WMO = function (c) {
    c = +c;
    if (c === 0) return { k: 'sun', t: 'Clear' }; if (c === 1) return { k: 'sun', t: 'Mostly clear' }; if (c === 2) return { k: 'partly', t: 'Partly cloudy' }; if (c === 3) return { k: 'cloud', t: 'Overcast' };
    if (c === 45 || c === 48) return { k: 'fog', t: 'Fog' }; if (c >= 51 && c <= 57) return { k: 'rain', t: 'Drizzle' }; if (c >= 61 && c <= 67) return { k: 'rain', t: c >= 65 ? 'Heavy rain' : 'Rain' };
    if (c >= 71 && c <= 77) return { k: 'snow', t: 'Snow' }; if (c >= 80 && c <= 82) return { k: 'rain', t: 'Showers' }; if (c === 85 || c === 86) return { k: 'snow', t: 'Snow showers' }; if (c >= 95) return { k: 'storm', t: 'Thunderstorms' };
    return { k: 'cloud', t: 'Cloudy' };
  };
  /* the forecast comes from chart.js (Kin.chart.forecast), the same fetch the chart tool uses */
  function weather() {
    return Kin.chart.forecast().then(function (f) {
      var j = f.raw, place = f.place, units = f.units;
      if (!j || !j.current || !j.hourly || !j.daily) throw new Error('The weather service sent something unexpected.');
      var Hc = j.hourly; if (!Hc.weather_code) Hc.weather_code = []; if (!Hc.precipitation_probability) Hc.precipitation_probability = [];
      var cur = j.current, H = j.hourly, D = j.daily, today = String(cur.time || '').slice(0, 10), hours = [];
      for (var i = 0; i < H.time.length; i++) hours.push({ t: H.time[i], hr: +String(H.time[i]).slice(11, 13), day: String(H.time[i]).slice(0, 10), temp: H.temperature_2m[i], rain: H.precipitation_probability ? H.precipitation_probability[i] : null, code: H.weather_code ? H.weather_code[i] : null });
      var sr = D.sunrise && D.sunrise[0] ? +String(D.sunrise[0]).slice(11, 13) : 6, ss = D.sunset && D.sunset[0] ? +String(D.sunset[0]).slice(11, 13) : 18;
      var nowHr = +String(cur.time || '').slice(11, 13);
      return {
        place: place.name || '', unit: units === 'C' ? 'C' : 'F', wind: units === 'C' ? 'km/h' : 'mph',
        now: { temp: cur.temperature_2m, feels: cur.apparent_temperature, code: cur.weather_code, wind: cur.wind_speed_10m, day: cur.is_day !== 0, hr: nowHr },
        hi: D.temperature_2m_max ? D.temperature_2m_max[0] : null, lo: D.temperature_2m_min ? D.temperature_2m_min[0] : null,
        rainMax: D.precipitation_probability_max ? D.precipitation_probability_max[0] : null, sunrise: sr, sunset: ss,
        today: hours.filter(function (x) { return x.day === today; }), next: hours.filter(function (x) { return x.t >= String(cur.time).slice(0, 13); }).slice(0, 6)
      };
    });
  }

  /* ------------------------------------------------------------ the pack */
  var DONE = /^(done|archived|cancelled)$/;
  function owner(n) {
    var all = [n.s || ''].concat(n.f || []);
    for (var i = 0; i < all.length; i++) { var m = /(?:^|\n|\.\s)(owner|who|assigned to|assignee|lead)\s*[:\-]\s*([^.\n]{1,40})/i.exec(all[i]); if (m) return m[2].trim(); }
    return '';
  }
  function fromPack(pack, now, opts) {
    if (!pack || !pack.nodes) return null;
    var today = dayStart(now), t0 = iso(today), wk = iso(new Date(today.getTime() + 6 * 864e5)), set = opts || {};
    var dated = pack.nodes.filter(function (n) { return n.d && !DONE.test(n.st || ''); });
    var up = dated.filter(function (n) { return n.d >= t0 && n.d <= wk; }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    var bars = []; for (var i = 0; i < 7; i++) { var dd = new Date(today.getTime() + i * 864e5), key = iso(dd); bars.push({ label: i === 0 ? 'Today' : DAYS[dd.getDay()].slice(0, 3), n: up.filter(function (x) { return x.d === key; }).length }); }
    var rank = { blocked: 0, waiting: 1, active: 2, open: 2, live: 3, planned: 4, draft: 5 };
    var who = String(set.owner || '').trim().toLowerCase();
    var tasks = dated.filter(function (n) { return n.k === 'task'; }).map(function (n) { return { n: n, who: owner(n) }; })
      .filter(function (x) { return !who || x.who.toLowerCase().indexOf(who) >= 0; })
      .sort(function (a, b) { if (a.n.d !== b.n.d) return a.n.d < b.n.d ? -1 : 1; return (rank[a.n.st] == null ? 9 : rank[a.n.st]) - (rank[b.n.st] == null ? 9 : rank[b.n.st]); });
    var lateBlocked = tasks.filter(function (x) { return x.n.d < t0 && x.n.st === 'blocked'; })[0];
    var first = lateBlocked || tasks.filter(function (x) { return x.n.d >= t0; })[0] || tasks[0] || (up[0] ? { n: up[0], who: owner(up[0]) } : null);
    var stats = [], st = pack.stats || {}, pref = ['Days to the pick', 'Open tasks', 'Due in the next seven days'];
    pref.concat(Object.keys(st)).forEach(function (k) { if (stats.length < 3 && st[k] != null && typeof st[k] === 'number' && !stats.some(function (x) { return x.k === k; })) stats.push({ k: k, v: st[k] }); });
    var md = t0.slice(5), past = pack.nodes.filter(function (n) { return n.d && n.d.slice(5) === md && n.d < t0; }).sort(function (a, b) { return a.d < b.d ? 1 : -1; })[0] || null;
    var openTasks = pack.nodes.filter(function (n) { return n.k === 'task' && !DONE.test(n.st || ''); });
    var needs = { overdue: tasks.filter(function (x) { return x.n.d < t0; }).length, blocked: openTasks.filter(function (n) { return n.st === 'blocked'; }).length, waiting: openTasks.filter(function (n) { return n.st === 'waiting'; }).length };
    var pri = tasks.slice(0, 4), priIds = {}; pri.forEach(function (x) { priIds[x.n.id] = 1; });
    var coming = up.filter(function (n) { return n.k !== 'task'; }); up.forEach(function (n) { if (coming.length < 5 && n.k === 'task' && !priIds[n.id]) coming.push(n); });
    coming.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    return {
      needs: needs,
      name: pack.name || 'Your pack', exported: pack.exported || '', stats: stats, bars: bars,
      first: first ? { t: first.n.t, d: first.n.d, st: first.n.st || '', who: first.who || owner(first.n), k: first.n.k } : null,
      today: coming.slice(0, 5).map(function (n) { return { t: n.t, d: n.d, st: n.st || '', k: n.k || '', who: owner(n) }; }),
      priorities: pri.map(function (x) { return { id: x.n.id, t: x.n.t, d: x.n.d, st: x.n.st || '', who: x.who }; }),
      tasksTotal: tasks.length, onThisDay: past ? { t: past.t, d: past.d } : null
    };
  }

  /* ------------------------------------------------------------ what Kin can start on
     Two or three concrete next jobs from the pack: the nearest open tasks Jarvis can actually help with.
     A job may start on its own only when it is local (a draft or a plan written on this page from the pack: no web
     search, no pictures, nothing sent anywhere), its estimate is under the cap, and the founder's "Start small
     jobs on my own" setting is on. Research (the web), designs (pictures and credits) and anything whose task
     would send, post, buy, book, call, pay or spend are only offered and wait for a tap. */
  var JOBS = [
    { kind: 'design', lead: /^(design|sketch|mock)$/i, re: /\b(design|invite|poster|flyer|label|logo|mock ?up|deck|slides?|visual|artwork|table card)\b/i, ing: 'designing', est: 1.6, local: false },
    { kind: 'draft', lead: /^(write|draft|email|reply|message|text|answer|thank|announce|pitch)$/i, re: /\b(draft|write|email|e-mail|note|message|follow[- ]?up|reply|letter|caption|copy|pitch|script|announce)\b/i, ing: 'drafting', est: 0.12, local: true },
    { kind: 'research', lead: /^(research|find|compare|look|check|scout|review|explore|investigate|benchmark)$/i, re: /\b(research|compare|look (into|up)|competitor|pricing|quotes?|suppliers?|co-?packers?|options|survey results?|benchmark)\b/i, ing: 'researching', est: 0.3, local: false },
    { kind: 'plan', lead: /^(plan|prepare|prep|schedule|organi[sz]e|map|outline|budget)$/i, re: /\b(plan|schedule|prepare|agenda|roadmap|outline|timeline|checklist|budget)\b/i, ing: 'planning', est: 0.15, local: true }
  ];
  /* words that mean the task itself acts on the world: Kin may prepare for it, never do it on its own */
  var OUTWARD = /\b(send|call|phone|ring|book|reserve|buy|order|pay|purchase|post|publish|submit|sign|file|deploy|ship|wire|transfer|deposit|spend|launch)\b/i;
  function offers(pack, opts) {
    opts = opts || {}; var set = settings.get(), now = opts.now || new Date(), t0 = iso(dayStart(now)), cap = opts.cap != null ? opts.cap : set.autoCap;
    if (!pack || !pack.nodes) return [];
    var who = String(opts.owner != null ? opts.owner : set.owner || '').trim().toLowerCase(), done = ls.get('kin.bb.ticks', {});
    var tasks = pack.nodes.filter(function (n) { return n.k === 'task' && !DONE.test(n.st || '') && !done[n.id]; })
      .map(function (n) { return { n: n, who: owner(n) }; })
      .filter(function (x) { return !who || x.who.toLowerCase().indexOf(who) >= 0; })
      .sort(function (a, b) { var ad = a.n.d || '9999', bd = b.n.d || '9999'; return ad < bd ? -1 : ad > bd ? 1 : 0; });
    var out = [], kinds = {};
    for (var i = 0; i < tasks.length && out.length < (opts.limit || 3); i++) {
      var n = tasks[i].n, job = null, lead = (/^\s*([a-z-]+)/i.exec(n.t) || [])[1] || '';
      /* the task's own first word wins ("Write the note to the supplier" is a draft, not research) */
      for (var j = 0; j < JOBS.length && !job; j++) if (JOBS[j].lead.test(lead)) job = JOBS[j];
      for (j = 0; j < JOBS.length && !job; j++) if (JOBS[j].re.test(n.t)) job = JOBS[j];
      for (j = 0; j < JOBS.length && !job; j++) if (JOBS[j].re.test(n.s || '')) job = JOBS[j];
      if (!job) continue; if (kinds[job.kind] >= 2) continue; kinds[job.kind] = (kinds[job.kind] || 0) + 1;
      var outward = OUTWARD.test(n.t), est = opts.estimate ? opts.estimate(job.kind, n) : job.est;
      var title = n.t.replace(/\s*\(#\d+\)\s*$/, '').replace(/[.\s]+$/, '');
      /* "Write the follow-up note to the supplier" -> "drafting the follow-up note to the supplier" */
      var obj = job.lead.test(lead) ? title.replace(/^\s*[a-z-]+\s+/i, '') : title.charAt(0).toLowerCase() + title.slice(1);
      if (/^(look|check)$/i.test(lead)) obj = obj.replace(/^(into|up|on)\s+/i, '');
      var phrase = job.ing + ' ' + obj, labelTxt = phrase.charAt(0).toUpperCase() + phrase.slice(1);
      var auto = !!(set.autoSmall && job.local && !outward && est <= cap);
      out.push({ id: 'job-' + n.id + '-' + job.kind, taskId: n.id, kind: job.kind, task: title, due: n.d || null,
        label: labelTxt, say: phrase, est: est, auto: auto,
        why: auto ? 'Small and local (written here, nothing sent), so it can start on its own.' : !job.local && !outward ? (job.kind === 'research' ? 'Uses the web, so it waits for your tap.' : 'Uses pictures and credits, so it waits for your tap.') : outward ? 'This task acts outside the page, so Jarvis only prepares for it and waits for you.' : est > cap ? 'Bigger than your auto-start limit, so it waits for your tap.' : 'Waits for your tap.',
        prompt: (job.kind === 'draft' ? 'Draft the writing for' : job.kind === 'research' ? 'Research' : job.kind === 'plan' ? 'Make a plan for' : 'Design concepts for') + ' this task from the pack and put the result on the Made shelf. Do not send, post, buy, book or contact anyone. Task: ' + title + (n.d ? ' (due ' + n.d + ')' : '') + '.' });
    }
    var ran = started.all();
    out.forEach(function (o) { var r = ran[o.id]; if (!r) return; o.ranToday = r; if (r.st === 'done') o.state = 'done'; else if (r.st === 'stopped' || r.st === 'failed') o.state = r.st; });
    return out;
  }

  /* ------------------------------------------------------------ what already ran today
     kin.bb.started: { offerId: { d: day, st: running|done|stopped|failed, auto } }. A task starts on its own at most once a
     day: reopening the brief or Refresh shows what it already made instead of starting it again.
     kin.bb.autospend: { d: day, usd }: what jobs that started on their own spent today, held under the daily cap. */
  function todayKey() { return iso(dayStart(new Date())); }
  var started = {
    all: function () { var v = ls.get('kin.bb.started', {}) || {}, t = todayKey(), out = {}; Object.keys(v).forEach(function (k) { if (v[k] && v[k].d === t) out[k] = v[k]; }); return out; },
    get: function (id) { return started.all()[id] || null; },
    set: function (id, st, auto) { var v = started.all(), prev = v[id]; v[id] = { d: todayKey(), st: st, auto: !!(auto || (prev && prev.auto)) }; ls.set('kin.bb.started', v); }
  };
  var autoSpend = {
    get: function () { var v = ls.get('kin.bb.autospend', null); return v && v.d === todayKey() ? +v.usd || 0 : 0; },
    add: function (usd) { if (!(usd > 0)) return; ls.set('kin.bb.autospend', { d: todayKey(), usd: Math.round((autoSpend.get() + usd) * 1e4) / 1e4 }); }
  };

  /* ------------------------------------------------------------ gather */
  /** opts: { pack, place, units, owner, market: function () -> Promise<[{title, source, url, date}]>, fetchJSON, timeoutMs, now } */
  function gather(opts) {
    opts = opts || {}; var set = settings.get(), now = opts.now || new Date(), ms = opts.timeoutMs || 7000;
    var pack = opts.pack !== undefined ? opts.pack : (Kin.pack && Kin.pack.get ? Kin.pack.get() : null);
    var place = opts.place !== undefined ? opts.place : settings.place();
    var data = { now: now, settings: set, nok: fromPack(pack, now, { owner: opts.owner != null ? opts.owner : set.owner }), offers: offers(pack, { now: now, owner: opts.owner, estimate: opts.estimate }), weather: null, market: null, test: !!opts.test };
    var jobs = [];
    if (set.on.weather) {
      if (!place) data.weather = { error: 'noplace' };
      else jobs.push(withTimeout(weather(), ms, 'The weather').then(function (w) { data.weather = w; }, function (e) { data.weather = { error: 'fail', why: String(e && e.message || e) }; }));
    }
    if (set.on.market && typeof opts.market === 'function') {
      jobs.push(withTimeout(Promise.resolve().then(opts.market), Math.max(ms, 25000), 'The market search').then(function (list) {
        data.market = { items: (Array.isArray(list) ? list : []).filter(function (x) { return x && x.title; }).slice(0, 4).map(function (x) { return { title: String(x.title).slice(0, 160), source: String(x.source || '').slice(0, 40), url: /^https:\/\//.test(x.url || '') ? x.url : '', date: String(x.date || '').slice(0, 24) }; }) };
      }, function (e) { data.market = { error: String(e && e.message || e) }; }));
    }
    return Promise.all(jobs).then(function () { return data; });
  }

  /* ------------------------------------------------------------ voice */
  function summary(d) {
    if (!d) return ''; var hr = (d.now || new Date()).getHours(), out = [(hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + ', sir.'];
    var w = d.weather; if (w && !w.error && isFinite(w.now.temp)) out.push('It\'s ' + Math.round(w.now.temp) + ' degrees and ' + WMO(w.now.code).t.toLowerCase() + (isFinite(w.hi) ? ', with a high of ' + Math.round(w.hi) : '') + (w.rainMax >= 40 ? ' and a ' + w.rainMax + ' percent chance of rain' : '') + '.');
    var n = d.nok; if (n) { var pick = n.stats.filter(function (x) { return /pick/i.test(x.k); })[0]; if (pick && pick.v >= 0) out.push(pick.v + (pick.v === 1 ? ' day' : ' days') + ' to the pick.'); if (n.first) out.push('First up: ' + n.first.t + '.'); }
    if (!(w && !w.error) && !n) out.push('Set your town and import your pack in settings, and I\'ll have a full brief for you.');
    var o = d.offers || [], started = o.filter(function (x) { return x.state === 'running' || x.state === 'done'; }), next = o.filter(function (x) { return !x.state; })[0];
    if (started.length) out.push('I have started on ' + started.map(function (x) { return x.say; }).join(started.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ', and $1') + '.');
    if (next) out.push('By the way, sir, I can get started on ' + next.say + '. Want me to?');
    return out.join(' ');
  }
  /* the whole message must be the request: "what is today's date" is not a brief */
  var BRIEF = /^(?:(?:hey|ok|okay|good morning)[,!.]?\s+)?(?:(?:jarvis|kin)[,!.:]?\s+)?(?:please\s+|can you\s+|could you\s+)?(?:give me (?:my |a |the )?(?:morning |daily )?brief(?:ing)?|brief me|(?:show me )?(?:my |the )?(?:morning|daily) brief(?:ing)?|what(?:'s| is) on (?:my day|today|for today)|start my day)(?:,?\s+(?:please|sir|jarvis|kin))?[.!?]*$/i;
  function isBriefRequest(t) { return BRIEF.test(String(t || '').replace(/\u2019/g, "'").trim()); }

  /* ------------------------------------------------------------ drawing: weather icons */
  function icon(kind, day, size) {
    var id = 'bbi' + Math.random().toString(36).slice(2, 8), g = s('svg', { viewBox: '0 0 64 64', width: size || 64, height: size || 64, 'aria-hidden': 'true' });
    var defs = s('defs');
    defs.appendChild(s('radialGradient', { id: id + 's', cx: '40%', cy: '35%', r: '70%' }, [s('stop', { offset: '0', 'stop-color': '#FFF3C4' }), s('stop', { offset: '.55', 'stop-color': '#FFC870' }), s('stop', { offset: '1', 'stop-color': '#FF9E45' })]));
    defs.appendChild(s('linearGradient', { id: id + 'c', x1: '0', y1: '0', x2: '0', y2: '1' }, [s('stop', { offset: '0', 'stop-color': '#FFFFFF' }), s('stop', { offset: '1', 'stop-color': '#B9D3EE' })]));
    defs.appendChild(s('radialGradient', { id: id + 'm', cx: '35%', cy: '35%', r: '75%' }, [s('stop', { offset: '0', 'stop-color': '#F4F8FF' }), s('stop', { offset: '1', 'stop-color': '#A9C3E6' })]));
    g.appendChild(defs);
    var sun = function (cx, cy, r) { var grp = s('g'); for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; grp.appendChild(s('line', { x1: cx + Math.cos(a) * (r + 4), y1: cy + Math.sin(a) * (r + 4), x2: cx + Math.cos(a) * (r + 9), y2: cy + Math.sin(a) * (r + 9), stroke: '#FFC870', 'stroke-width': 2.6, 'stroke-linecap': 'round', opacity: .9 })); } grp.appendChild(s('circle', { cx: cx, cy: cy, r: r, fill: 'url(#' + id + 's)' })); return grp; };
    var moon = function (cx, cy, r) { return s('path', { d: 'M' + (cx + r * .3) + ' ' + (cy - r) + 'a' + r + ' ' + r + ' 0 1 0 ' + (r * .9) + ' ' + (r * 1.5) + 'a' + (r * .85) + ' ' + (r * .85) + ' 0 1 1 ' + (-r * .9) + ' ' + (-r * 1.5) + 'z', fill: 'url(#' + id + 'm)' }); };
    var cloud = function (x, y, sc, op) { return s('path', { d: 'M' + x + ' ' + y + 'h' + 30 * sc + 'a' + 9 * sc + ' ' + 9 * sc + ' 0 0 0 0 -18 a' + 13 * sc + ' ' + 13 * sc + ' 0 0 0 -24 -5 a' + 9 * sc + ' ' + 9 * sc + ' 0 0 0 -6 23z', fill: 'url(#' + id + 'c)', opacity: op == null ? 1 : op }); };
    var drops = function (n, col) { var grp = s('g'); for (var i = 0; i < n; i++) grp.appendChild(s('line', { x1: 22 + i * 9, y1: 48, x2: 19 + i * 9, y2: 56, stroke: col || '#6FE3FF', 'stroke-width': 2.6, 'stroke-linecap': 'round' })); return grp; };
    if (kind === 'sun') g.appendChild(day === false ? moon(30, 30, 15) : sun(32, 32, 13));
    else if (kind === 'partly') { g.appendChild(day === false ? moon(36, 22, 11) : sun(38, 22, 10)); g.appendChild(cloud(14, 48, 1.15)); }
    else if (kind === 'cloud') { g.appendChild(cloud(22, 40, .9, .55)); g.appendChild(cloud(12, 50, 1.2)); }
    else if (kind === 'fog') { g.appendChild(cloud(12, 40, 1.15, .85)); for (var f = 0; f < 3; f++) g.appendChild(s('line', { x1: 12 + f * 3, y1: 47 + f * 6, x2: 52 - f * 3, y2: 47 + f * 6, stroke: '#B9D3EE', 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: .8 - f * .2 })); }
    else if (kind === 'rain') { g.appendChild(cloud(12, 42, 1.2)); g.appendChild(drops(3)); }
    else if (kind === 'snow') { g.appendChild(cloud(12, 42, 1.2)); for (var k = 0; k < 3; k++) g.appendChild(s('circle', { cx: 22 + k * 9, cy: 53, r: 2.4, fill: '#EAF4FF' })); }
    else if (kind === 'storm') { g.appendChild(cloud(12, 42, 1.2)); g.appendChild(s('path', { d: 'M34 44 l-6 9 h5 l-3 8 l9 -11 h-5 l3 -6z', fill: '#FFC870' })); }
    return g;
  }

  /* ------------------------------------------------------------ drawing: the day's temperature graph */
  function smooth(pts) {
    if (pts.length < 2) return ''; var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) { var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6, c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1); }
    return d;
  }
  function chart(w) {
    var hrs = w.today.filter(function (x) { return x.hr >= 6 && isFinite(x.temp); }); if (hrs.length < 3) hrs = w.today.filter(function (x) { return isFinite(x.temp); });
    if (hrs.length < 2) return null;
    var narrow = (window.innerWidth || 1024) < 760, W = narrow ? 360 : 640, Hh = narrow ? 178 : 188, L = 8, R = 8, T = 32, B = 46, iw = W - L - R, ih = Hh - T - B, FS = narrow ? 11 : 12;
    var temps = hrs.map(function (x) { return x.temp; }), mn = Math.min.apply(null, temps), mx = Math.max.apply(null, temps), pad = Math.max(2, (mx - mn) * .18); mn -= pad; mx += pad;
    var X = function (i) { return L + iw * i / (hrs.length - 1); }, Y = function (t) { return T + ih * (1 - (t - mn) / (mx - mn)); };
    var pts = hrs.map(function (x, i) { return [X(i), Y(x.temp)]; }), id = 'bbg' + Math.random().toString(36).slice(2, 8);
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + Hh, role: 'img', 'aria-label': 'Temperature through the day, from ' + Math.round(Math.min.apply(null, temps)) + ' to ' + Math.round(Math.max.apply(null, temps)) + ' degrees' });
    var defs = s('defs');
    defs.appendChild(s('linearGradient', { id: id + 'a', x1: 0, y1: 0, x2: 0, y2: 1 }, [s('stop', { offset: 0, 'stop-color': '#6FE3FF', 'stop-opacity': '.42' }), s('stop', { offset: 1, 'stop-color': '#3FB6FF', 'stop-opacity': '0' })]));
    /* the line is coloured by temperature, not by time: the warmest point of the day is amber, the coolest blue */
    var tHi = Math.max.apply(null, temps), tLo = Math.min.apply(null, temps);
    defs.appendChild(s('linearGradient', { id: id + 'l', gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: Y(tHi), y2: tHi === tLo ? Y(tHi) + 1 : Y(tLo) }, [s('stop', { offset: 0, 'stop-color': '#FFC870' }), s('stop', { offset: .5, 'stop-color': '#6FE3FF' }), s('stop', { offset: 1, 'stop-color': '#7FC8FF' })]));
    defs.appendChild(s('filter', { id: id + 'f', x: '-20%', y: '-50%', width: '140%', height: '200%' }, [s('feGaussianBlur', { stdDeviation: 4 })]));
    svg.appendChild(defs);
    for (var gI = 0; gI < 3; gI++) { var gy = T + ih * gI / 2; svg.appendChild(s('line', { x1: L, x2: W - R, y1: gy, y2: gy, stroke: 'rgba(150,210,255,.10)', 'stroke-dasharray': '2 6' })); }
    var line = smooth(pts);
    svg.appendChild(s('path', { d: line + ' L' + pts[pts.length - 1][0] + ' ' + (T + ih) + ' L' + pts[0][0] + ' ' + (T + ih) + 'Z', fill: 'url(#' + id + 'a)' }));
    svg.appendChild(s('path', { d: line, fill: 'none', stroke: 'url(#' + id + 'l)', 'stroke-width': 6, 'stroke-linecap': 'round', opacity: .45, filter: 'url(#' + id + 'f)' }));
    svg.appendChild(s('path', { d: line, fill: 'none', stroke: 'url(#' + id + 'l)', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    /* rain chance as soft rounded bars along the floor, only when there is any */
    var rainy = hrs.some(function (x) { return x.rain > 0; });
    if (rainy) {
      var rmax = 0, rI = -1; hrs.forEach(function (x, i) { if (x.rain > rmax) { rmax = x.rain; rI = i; } });
      hrs.forEach(function (x, i) { if (!(x.rain > 0)) return; var bh = Math.max(3, 22 * x.rain / 100); svg.appendChild(s('rect', { x: X(i) - 3.5, y: Hh - 20 - bh, width: 7, height: bh, rx: 3.5, fill: i === rI ? 'rgba(111,227,255,.8)' : 'rgba(111,227,255,.42)' })); });
      svg.appendChild(stxt(Math.max(L + 2, Math.min(W - R - 2, X(rI))), Hh - 20 - Math.max(3, 22 * rmax / 100) - 6, rmax + '% rain', { 'text-anchor': X(rI) + 34 > W - R ? 'end' : X(rI) - 34 < L ? 'start' : 'middle', fill: '#9FE9FF', 'font-size': FS - 1, 'font-family': 'IBM Plex Mono, monospace' }));
    }
    /* hour labels every three hours */
    var every = narrow ? 6 : 3;
    hrs.forEach(function (x, i) { if (x.hr % every !== 0) return; svg.appendChild(stxt(X(i), Hh - 4, hourLabel(x.hr).replace(' ', '').toLowerCase(), { 'text-anchor': i === 0 ? 'start' : i === hrs.length - 1 ? 'end' : 'middle', fill: '#8FA9C6', 'font-size': FS, 'font-family': 'IBM Plex Mono, monospace' })); });
    /* high and low callouts */
    var hiI = temps.indexOf(Math.max.apply(null, temps)), loI = temps.indexOf(Math.min.apply(null, temps)), ni0 = hrs.map(function (x) { return x.hr; }).indexOf(w.now.hr);
    var pill = function (i, label, warm) { var px = Math.min(W - R - 34, Math.max(L + 34, X(i))), py = Y(hrs[i].temp) + (warm ? -20 : 22), grp = s('g');
      grp.appendChild(s('rect', { x: px - 30, y: py - 13, width: 60, height: 24, rx: 12, fill: warm ? 'rgba(255,200,112,.16)' : 'rgba(111,227,255,.14)', stroke: warm ? 'rgba(255,200,112,.55)' : 'rgba(111,227,255,.5)' }));
      grp.appendChild(stxt(px, py + 4, label, { 'text-anchor': 'middle', fill: warm ? '#FFE2B8' : '#CFF6FF', 'font-size': FS + .5, 'font-family': 'IBM Plex Mono, monospace', 'font-weight': 500 }));
      grp.appendChild(s('circle', { cx: X(i), cy: Y(hrs[i].temp), r: 4.5, fill: warm ? '#FFC870' : '#6FE3FF', stroke: '#0A1B33', 'stroke-width': 2 })); return grp; };
    /* a callout that would sit on the "now" marker is left out: the big number above already says it */
    var near = function (i) { return ni0 >= 0 && Math.abs(X(i) - X(ni0)) < (narrow ? 54 : 60); };
    if (hiI !== loI) { if (!near(loI)) svg.appendChild(pill(loI, 'L ' + Math.round(temps[loI]) + '°', false)); if (!near(hiI)) svg.appendChild(pill(hiI, 'H ' + Math.round(temps[hiI]) + '°', true)); }
    /* now marker */
    var ni = hrs.map(function (x) { return x.hr; }).indexOf(w.now.hr);
    if (ni >= 0) { var nx = X(ni), ny = Y(hrs[ni].temp);
      svg.appendChild(s('line', { x1: nx, x2: nx, y1: T - 8, y2: T + ih, stroke: 'rgba(234,244,255,.45)', 'stroke-dasharray': '3 4' }));
      svg.appendChild(s('circle', { cx: nx, cy: ny, r: 9, fill: 'rgba(234,244,255,.18)' })); svg.appendChild(s('circle', { cx: nx, cy: ny, r: 5, fill: '#FFFFFF' }));
      svg.appendChild(stxt(Math.min(W - R - 2, Math.max(L + 2, nx)), T - 14, 'NOW ' + Math.round(w.now.temp) + '°', { 'text-anchor': nx < L + 40 ? 'start' : nx > W - R - 40 ? 'end' : 'middle', fill: '#EAF4FF', 'font-size': FS, 'letter-spacing': '2', 'font-family': 'IBM Plex Mono, monospace', 'font-weight': 500 })); }
    return svg;
  }

  /* ------------------------------------------------------------ drawing: cards */
  function card(id, span, i, data) {
    var c = h('section', 'bb-card bb-' + span); c.dataset.card = id; c.style.setProperty('--i', i);
    if (data.test) c.appendChild(h('span', 'bb-test', 'Test data'));
    return c;
  }
  function head(c, title, sub) { var hd = h('div', 'bb-ch'), l = h('div'); l.appendChild(h('div', 'bb-h', title)); if (sub) l.appendChild(h('div', 'bb-sub', sub)); hd.appendChild(l); c.appendChild(hd); return hd; }
  function empty(c, text, strong) { var p = h('p', 'bb-empty'); if (strong) { p.appendChild(h('b', '', strong)); p.appendChild(document.createTextNode(' ' + text)); } else p.textContent = text; c.appendChild(p); }

  var DRAW = {
    weather: function (c, d) {
      var w = d.weather;
      head(c, 'Weather', w && w.place ? w.place + (w.place ? ' · today' : '') : 'Today');
      var b = h('div', 'bb-body'); c.appendChild(b);
      if (!w || w.error === 'noplace') { empty(b, 'in Settings and the weather for it will appear here. Only its coordinates are sent to Open-Meteo.', 'Set your town'); return; }
      if (w.error) { empty(b, 'The weather could not be loaded just now. ' + (w.why || ''), ''); return; }
      var cond = WMO(w.now.code), top = h('div', 'bb-wtop'), l = h('div');
      var t = h('div', 'bb-temp'); t.appendChild(document.createTextNode(Math.round(w.now.temp))); t.appendChild(h('sup', '', '°' + w.unit)); l.appendChild(t);
      l.appendChild(h('div', 'bb-cond', cond.t)); if (isFinite(w.now.feels)) l.appendChild(h('div', 'bb-feels', 'Feels like ' + Math.round(w.now.feels) + '°'));
      top.appendChild(l); var ic = icon(cond.k, w.now.day, 112); ic.setAttribute('class', 'bb-wicon'); top.appendChild(ic); b.appendChild(top);
      var chips = h('div', 'bb-chips');
      var chip = function (label, val, cls) { var x = h('span', 'bb-chip' + (cls ? ' ' + cls : '')); x.appendChild(document.createTextNode(label + ' ')); x.appendChild(h('b', '', val)); chips.appendChild(x); };
      if (isFinite(w.hi)) chip('High', Math.round(w.hi) + '°'); if (isFinite(w.lo)) chip('Low', Math.round(w.lo) + '°');
      if (w.rainMax != null) chip('Rain', w.rainMax + '%', w.rainMax >= 50 ? 'bb-warn' : ''); if (isFinite(w.now.wind)) chip('Wind', Math.round(w.now.wind) + ' ' + w.wind);
      b.appendChild(chips);
      var g = chart(w); if (g) { var cw = h('div', 'bb-chart'); cw.appendChild(g); b.appendChild(cw); }
      if (w.next && w.next.length) { var hs = h('div', 'bb-hours');
        w.next.forEach(function (x, i) { var hr = h('div', 'bb-hour' + (i === 0 ? ' bb-now' : '')); hr.appendChild(h('span', '', i === 0 ? 'Now' : hourLabel(x.hr)));
          var dayish = i === 0 ? w.now.day : x.hr >= w.sunrise && x.hr < w.sunset; hr.appendChild(icon(WMO(i === 0 ? w.now.code : x.code).k, dayish, 26)); hr.appendChild(h('b', '', Math.round(i === 0 ? w.now.temp : x.temp) + '°'));
          hr.appendChild(h('i', x.rain > 0 ? '' : 'bb-dry', x.rain > 0 ? x.rain + '%' : 'dry')); hs.appendChild(hr); });
        b.appendChild(hs); }
      b.appendChild(h('div', 'bb-source', 'Open-Meteo forecast'));
    },
    nok: function (c, d) {
      var n = d.nok; head(c, n ? n.name : 'Your company', n && n.exported ? 'From your pack, exported ' + n.exported.slice(0, 10) : 'From your pack');
      var b = h('div', 'bb-body'); c.appendChild(b);
      if (!n) { empty(b, 'from the Atlas (Kin settings, Your data, Export everything), then import it here.', 'Load your data'); return; }
      var SHORT = { 'Days to the pick': 'Days to the pick', 'Open tasks': 'Open tasks', 'Due in the next seven days': 'Due this week' };
      if (n.stats.length) { var g = h('div', 'bb-stats'); n.stats.forEach(function (x) { var t = h('div', 'bb-stat' + (/due/i.test(x.k) && x.v > 0 ? ' bb-hot' : '')); t.appendChild(h('div', 'bb-n', x.v)); t.appendChild(h('div', 'bb-l', SHORT[x.k] || x.k)); g.appendChild(t); }); b.appendChild(g); }
      var nd = n.needs; if (nd && (nd.overdue || nd.blocked || nd.waiting)) { var ch = h('div', 'bb-chips bb-needs'); ch.appendChild(h('span', 'bb-needs-l', 'Needs you'));
        if (nd.overdue) ch.appendChild(h('span', 'bb-chip bb-bad', nd.overdue + ' overdue')); if (nd.blocked) ch.appendChild(h('span', 'bb-chip bb-bad', nd.blocked + ' blocked')); if (nd.waiting) ch.appendChild(h('span', 'bb-chip bb-warn', nd.waiting + ' waiting')); b.appendChild(ch); }
      var tot = n.bars.reduce(function (a, x) { return a + x.n; }, 0), mx = Math.max.apply(null, n.bars.map(function (x) { return x.n; }).concat([1]));
      var wk = h('div', 'bb-week'), wh = h('div', 'bb-week-h'); wh.appendChild(h('span', '', 'The next seven days')); wh.appendChild(h('span', '', tot + (tot === 1 ? ' dated item' : ' dated items'))); wk.appendChild(wh);
      var bars = h('div', 'bb-bars'); n.bars.forEach(function (x, j) { var col = h('div', 'bb-bar' + (x.n ? '' : ' bb-zero')); col.appendChild(h('b', '', x.n || '')); var tr = h('div', 'bb-track'), bar = h('i'); bar.style.height = (x.n ? Math.round(18 + 82 * x.n / mx) : 0) + '%'; bar.style.setProperty('--j', j); tr.appendChild(bar); col.appendChild(tr); col.appendChild(h('span', '', x.label)); bars.appendChild(col); });
      wk.appendChild(bars); b.appendChild(wk);
      if (n.first) { var f = h('div', 'bb-first'), due = dueLabel(n.first.d, d.now); f.appendChild(h('div', 'bb-l', 'First thing')); f.appendChild(h('div', 'bb-t', n.first.t));
        f.appendChild(h('div', 'bb-m', [due.top + (due.top === 'Overdue' || due.top === 'Today' || due.top === 'Tomorrow' ? ' · ' + due.sub : ' ' + due.sub), n.first.st && n.first.st !== 'open' ? n.first.st : '', n.first.who].filter(Boolean).join('  ·  '))); b.appendChild(f); }
    },
    today: function (c, d) {
      var n = d.nok; head(c, 'Coming up', 'The next seven days'); var b = h('div', 'bb-body'); c.appendChild(b);
      if (!n) { empty(b, 'Import your pack to see what is coming up.'); return; } if (!n.today.length) { empty(b, 'Nothing dated in the next seven days.'); return; }
      var ul = h('ul', 'bb-list'); n.today.forEach(function (x) { var li = h('li', 'bb-row'), due = dueLabel(x.d, d.now), wd = h('div', 'bb-when2'); wd.appendChild(h('b', '', due.top)); wd.appendChild(h('span', '', due.sub)); li.appendChild(wd);
        var r = h('div'); r.appendChild(h('div', 'bb-rt', x.t)); var m = h('div', 'bb-rm'); if (x.who) m.appendChild(h('span', '', x.who)); if (x.k && x.k !== 'task') m.appendChild(h('span', 'bb-chip', x.k)); if (x.st === 'blocked') m.appendChild(h('span', 'bb-chip bb-bad', 'Blocked')); else if (x.st === 'waiting') m.appendChild(h('span', 'bb-chip bb-warn', 'Waiting'));
        if (m.childNodes.length) r.appendChild(m); li.appendChild(r); ul.appendChild(li); });
      b.appendChild(ul);
    },
    priorities: function (c, d) {
      var n = d.nok, set = d.settings; head(c, 'Top priorities', set.owner ? 'Open tasks for ' + set.owner + ', soonest first' : 'Open tasks, soonest first'); var b = h('div', 'bb-body'); c.appendChild(b);
      if (!n) { empty(b, 'Import your pack to see your priorities.'); return; } if (!n.priorities.length) { empty(b, set.owner ? 'No open dated tasks for ' + set.owner + '.' : 'No open dated tasks.'); return; }
      var ticks = ls.get('kin.bb.ticks', {}), ul = h('ul', 'bb-list');
      n.priorities.forEach(function (x) { var li = h('li', 'bb-task' + (ticks[x.id] ? ' bb-done' : '')), bt = h('button', 'bb-check'); bt.type = 'button'; bt.setAttribute('role', 'checkbox'); bt.setAttribute('aria-checked', ticks[x.id] ? 'true' : 'false'); bt.setAttribute('aria-label', 'Mark done on this device: ' + x.t);
        bt.appendChild(s('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, [s('path', { d: 'M3.5 8.5l3 3 6-7' })]));
        bt.addEventListener('click', function () { var t = ls.get('kin.bb.ticks', {}); if (t[x.id]) delete t[x.id]; else t[x.id] = Date.now(); ls.set('kin.bb.ticks', t); var on = !!t[x.id]; bt.setAttribute('aria-checked', on ? 'true' : 'false'); li.classList.toggle('bb-done', on); });
        li.appendChild(bt); var r = h('div'); r.appendChild(h('div', 'bb-rt', x.t)); var due = dueLabel(x.d, d.now), m = h('div', 'bb-rm');
        m.appendChild(h('span', 'bb-chip' + (due.late ? ' bb-bad' : due.top === 'Today' ? ' bb-warn' : ''), due.late ? 'Overdue · ' + due.sub : due.top === 'Today' || due.top === 'Tomorrow' ? due.top : due.top + ' ' + due.sub));
        if (x.st === 'blocked') m.appendChild(h('span', 'bb-chip bb-bad', 'Blocked')); else if (x.st === 'waiting') m.appendChild(h('span', 'bb-chip bb-warn', 'Waiting')); if (x.who && !set.owner) m.appendChild(h('span', '', x.who));
        r.appendChild(m); li.appendChild(r); ul.appendChild(li); });
      b.appendChild(ul); b.appendChild(h('p', 'bb-local', 'Ticks stay on this device. They do not change the Atlas.'));
    },
    market: function (c, d) {
      var m = d.market; head(c, 'Market watch', 'Competitors and the category, from the web'); var b = h('div', 'bb-body'); c.appendChild(b);
      if (m.error) { empty(b, 'The web search did not come back in time. Ask again in a minute.'); return; }
      if (!m.items.length) { empty(b, 'Nothing new found today.'); return; }
      b.classList.add('bb-newsgrid'); b.style.setProperty('--n', m.items.length);
      m.items.forEach(function (x) { var a = h(x.url ? 'a' : 'div', 'bb-news'); if (x.url) { a.href = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        a.appendChild(h('div', 'bb-rt', x.title)); var meta = h('div', 'bb-rm'); if (x.source) meta.appendChild(h('span', 'bb-chip', x.source)); if (x.date) meta.appendChild(h('span', '', x.date)); if (meta.childNodes.length) a.appendChild(meta); b.appendChild(a); });
    },
    start: function (c, d, ctx) {
      head(c, 'Jarvis can start', d.settings.autoSmall ? 'Small local drafts and plans start on their own; the rest wait for your tap' : 'Tap Start and Jarvis gets going'); var b = h('div', 'bb-body'); c.appendChild(b);
      var ul = h('ul', 'bb-list');
      d.offers.forEach(function (o) { var li = h('li', 'bb-job'); li.dataset.job = o.id;
        var r = h('div', 'bb-job-t'); r.appendChild(h('div', 'bb-rt', o.label)); var m = h('div', 'bb-rm');
        m.appendChild(h('span', 'bb-chip', o.kind)); m.appendChild(h('span', 'bb-chip', o.est < 0.1 ? 'under 10¢' : '~$' + o.est.toFixed(2)));
        if (o.due) { var du = dueLabel(o.due, d.now); m.appendChild(h('span', '', du.late ? 'Overdue' : du.top === 'Today' || du.top === 'Tomorrow' ? du.top : du.top + ' ' + du.sub)); }
        if (!o.auto) m.appendChild(h('span', 'bb-why', o.why));
        r.appendChild(m); li.appendChild(r); var act = h('div', 'bb-job-a'); li.appendChild(act); ul.appendChild(li);
        ctx.paintJob(o, li, act); });
      b.appendChild(ul);
      b.appendChild(h('p', 'bb-local', 'Jarvis never sends, posts, buys, books or calls on its own. Results land on the Made shelf.'));
    },
    footer: function (c, d) { var x = d.nok.onThisDay; c.appendChild(h('div', 'bb-h', 'On this day')); c.appendChild(h('div', 'bb-ft', x.t + ' (' + x.d.slice(0, 4) + ')')); }
  };
  /** which cards have something honest to show */
  function shows(id, d) {
    if (!d.settings.on[id]) return false;
    if (id === 'market') return !!d.market; if (id === 'footer') return !!(d.nok && d.nok.onThisDay); if (id === 'start') return !!(d.offers && d.offers.length); return true;
  }

  /* ------------------------------------------------------------ the board */
  var root = null, lastFocus = null, keyH = null, live = [];
  function show(d, opts) {
    opts = opts || {}; hide(true); if (!d) return null; d.settings = d.settings || settings.get();
    lastFocus = document.activeElement; var now = d.now || new Date();
    root = h('div', 'bb'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); var period = now.getHours() < 12 ? 'Morning brief' : now.getHours() < 18 ? 'Afternoon brief' : 'Evening brief'; root.setAttribute('aria-label', period);
    var panel = h('div', 'bb-panel'); panel.tabIndex = -1; root.appendChild(panel);
    var hd = h('header', 'bb-head'), l = h('div');
    /* the eyebrow names the board; the title says which part of the day it is, so the two never disagree */
    l.appendChild(h('div', 'bb-eyebrow', (opts.brand || 'Jarvis') + ' · Daily brief'));
    l.appendChild(h('h2', 'bb-title', period));
    var wplace = d.weather && d.weather.place ? '  ·  ' + d.weather.place : '';
    l.appendChild(h('div', 'bb-when', DAYS[now.getDay()] + ', ' + MON[now.getMonth()] + ' ' + now.getDate() + '  ·  ' + clock(now) + wplace));
    l.appendChild(h('p', 'bb-greet', opts.greeting || ((now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening') + ', sir. Here\'s your brief.')));
    hd.appendChild(l);
    var act = h('div', 'bb-actions');
    var pillBtn = function (label, path, fn) { var b = h('button', 'bb-pill'); b.type = 'button'; b.appendChild(s('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, [s('path', { d: path })])); b.appendChild(document.createTextNode(label)); b.addEventListener('click', fn); act.appendChild(b); return b; };
    if (typeof opts.onRefresh === 'function') pillBtn('Refresh', 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3', opts.onRefresh);
    if (typeof opts.onSettings === 'function') pillBtn('Cards', 'M3 4h10M3 8h10M3 12h6', opts.onSettings);
    var close = pillBtn('Close', 'M4 4l8 8M12 4l-8 8', function () { hide(); });
    hd.appendChild(act); panel.appendChild(hd);

    var grid = h('div', 'bb-grid'), ids = d.settings.order.filter(function (id) { return id !== 'footer' && shows(id, d); });
    /* desktop: the first two side by side, then the rest in a row; the footer always spans */
    /* Market watch is a full-width row of headline tiles at the end (no tall card with empty space under three lines);
       the other cards go two by two, and an odd one out spans the row */
    var mi = ids.indexOf('market'); if (mi >= 0) { ids.splice(mi, 1); ids.push('market'); }
    var paired = ids.filter(function (id) { return id !== 'market'; });
    var spans = ids.map(function (id) { if (id === 'market') return 'span6'; var k = paired.indexOf(id); return k === paired.length - 1 && paired.length % 2 === 1 ? 'span6' : 'span3'; });
    /* jobs: a Start pill, a running chip with Stop, and the result. The page decides how a job runs (opts.onStart). */
    var ctx = { paintJob: function (o, li, act) {
      act.textContent = '';
      if (o.state === 'running') { var ch = h('span', 'bb-chip bb-run', 'Running'); ch.insertBefore(h('i', 'bb-spin'), ch.firstChild); act.appendChild(ch);
        var st = h('button', 'bb-pill bb-stop', 'Stop'); st.type = 'button'; st.addEventListener('click', function () { if (o.ctl) try { o.ctl.abort(); } catch (e) {} o.state = 'stopped'; ctx.paintJob(o, li, act); }); act.appendChild(st); return; }
      if (o.state === 'done') { var dn = h('button', 'bb-pill bb-ok', 'On the Made shelf'); dn.type = 'button'; if (typeof opts.onOpenMade === 'function') dn.addEventListener('click', function () { opts.onOpenMade(o); }); act.appendChild(dn); return; }
      if (o.state === 'failed') { act.appendChild(h('span', 'bb-chip bb-bad', o.err ? 'Failed: ' + String(o.err).slice(0, 60) : 'Failed')); }
      if (o.state === 'stopped') act.appendChild(h('span', 'bb-chip', 'Stopped'));
      var go = h('button', 'bb-pill bb-go', o.state ? 'Start again' : 'Start'); go.type = 'button';
      go.disabled = typeof opts.onStart !== 'function'; if (go.disabled) go.title = 'Jobs can start once the page is connected to Claude.';
      go.addEventListener('click', function () { ctx.run(o, li, act); }); act.appendChild(go);
    }, run: function (o, li, act, auto) {
      if (typeof opts.onStart !== 'function') return; o.ctl = typeof AbortController === 'function' ? new AbortController() : null; o.state = 'running'; o.auto = !!auto; ctx.paintJob(o, li, act);
      started.set(o.id, 'running', auto); live.push(o);
      function end(st, cost) { live = live.filter(function (x) { return x !== o; }); if (o.auto) autoSpend.add(cost); started.set(o.id, st); }
      Promise.resolve().then(function () { return opts.onStart(o, { signal: o.ctl && o.ctl.signal, auto: !!auto }); })
        .then(function (r) { end('done', r && r.cost); if (o.state === 'running') { o.state = 'done'; ctx.paintJob(o, li, act); } },
              function (e) { var st = (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError')) ? 'stopped' : 'failed'; end(st, e && e.cost); if (o.state === 'running') { o.state = st; o.err = e && e.message; ctx.paintJob(o, li, act); } });
    } };
    ids.forEach(function (id, i) { var c = card(id, spans[i], i, d); try { DRAW[id](c, d, ctx); } catch (e) { c.textContent = ''; empty(c, 'This card could not be drawn.'); }
      /* the "Test data" badge marks sample content only; an honest empty card carries no badge */
      if (c.querySelector('.bb-empty')) { var tb = c.querySelector('.bb-test'); if (tb) tb.remove(); } grid.appendChild(c); });
    if (shows('footer', d)) { var f = card('footer', 'span6', ids.length, d); f.classList.add('bb-foot'); DRAW.footer(f, d); grid.appendChild(f); }
    panel.appendChild(grid);
    (opts.container || document.body).appendChild(root);
    root.addEventListener('click', function (e) { if (e.target === root) hide(); });
    keyH = function (e) { if (e.key === 'Escape') { e.stopPropagation(); hide(); } }; document.addEventListener('keydown', keyH, true);
    requestAnimationFrame(function () { root && root.classList.add('bb-in'); try { if (Kin.focusPanel) Kin.focusPanel(panel); else panel.focus({ preventScroll: true }); } catch (e) {} });
    /* small, drafting-only jobs start on their own when the founder allows it (at most two per brief) */
    if (d.settings.autoSmall && opts.autoStart !== false && typeof opts.onStart === 'function' && d.settings.on.start) {
      /* each job's limit is reserved against today's cap before it starts, so the cap holds even if every job spends its limit */
      var room = d.settings.autoDay - autoSpend.get();
      (d.offers || []).filter(function (o) { return o.auto && !o.state && !o.ranToday && o.est <= d.settings.autoCap && (o.kind === 'draft' || o.kind === 'plan'); }).slice(0, 2).forEach(function (o) {
        if (room < d.settings.autoCap) { o.why = 'Today\'s limit for jobs that start on their own is reached, so it waits for your tap.';
          var w = root.querySelector('[data-job="' + (window.CSS && CSS.escape ? CSS.escape(o.id) : o.id) + '"] .bb-rm'); if (w) w.appendChild(h('span', 'bb-why bb-capped', o.why)); return; }
        room -= d.settings.autoCap;
        var li = root.querySelector('[data-job="' + (window.CSS && CSS.escape ? CSS.escape(o.id) : o.id) + '"]'); if (li) ctx.run(o, li, li.querySelector('.bb-job-a'), true); });
    }
    return root;
  }
  function hide(now) {
    if (keyH) { document.removeEventListener('keydown', keyH, true); keyH = null; }
    live.slice().forEach(function (o) { if (o.ctl) try { o.ctl.abort(); } catch (e) {} });
    var r = root; root = null; if (!r) return;
    if (now) { r.remove(); return; } r.classList.remove('bb-in'); r.classList.add('bb-out');
    setTimeout(function () { r.remove(); }, 340);
    try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ------------------------------------------------------------ settings control */
  function settingsUI(el) {
    if (!el) return; el.textContent = ''; var wrap = h('div', 'bb-set');
    var draw = function () { wrap.textContent = ''; var v = settings.get();
      v.order.forEach(function (id, i) { var meta = CARDS.filter(function (c) { return c.id === id; })[0]; if (!meta) return;
        var row = h('div', 'bb-set-row'), sw = h('button', 'bb-switch'); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', v.on[id] ? 'true' : 'false'); sw.setAttribute('aria-label', 'Show ' + meta.name);
        sw.addEventListener('click', function () { var on = Object.assign({}, v.on); on[id] = !on[id]; settings.set({ on: on }); draw(); });
        var lab = h('label', '', meta.name), mv = h('div', 'bb-move'), up = h('button', '', '↑'), dn = h('button', '', '↓'); up.type = dn.type = 'button'; up.setAttribute('aria-label', 'Move ' + meta.name + ' up'); dn.setAttribute('aria-label', 'Move ' + meta.name + ' down');
        up.disabled = i === 0; dn.disabled = i === v.order.length - 1;
        var swap = function (j) { var o = v.order.slice(), t = o[i]; o[i] = o[j]; o[j] = t; settings.set({ order: o }); draw(); };
        up.addEventListener('click', function () { swap(i - 1); }); dn.addEventListener('click', function () { swap(i + 1); });
        mv.appendChild(up); mv.appendChild(dn); row.appendChild(sw); row.appendChild(lab); row.appendChild(mv); wrap.appendChild(row); });
      var v2 = settings.get(), row = h('div', 'bb-set-row'), sw2 = h('button', 'bb-switch'); sw2.type = 'button'; sw2.setAttribute('role', 'switch'); sw2.setAttribute('aria-checked', v2.autoSmall ? 'true' : 'false'); sw2.setAttribute('aria-label', 'Start small jobs on my own');
      sw2.addEventListener('click', function () { settings.set({ autoSmall: !settings.get().autoSmall }); draw(); });
      row.appendChild(sw2); row.appendChild(h('label', '', 'Start small jobs on my own (drafts and plans written here, under $' + v2.autoCap.toFixed(2) + ' each, each task once a day; never the web, pictures or anything sent)')); row.appendChild(h('span')); wrap.appendChild(row);
      var r3 = h('div', 'bb-set-row bb-set-cap'), inp = h('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.id = 'bbAutoDay'; inp.maxLength = 5; inp.value = v2.autoDay.toFixed(2); inp.setAttribute('aria-label', 'Most jobs that start on their own may spend in a day, in dollars');
      inp.addEventListener('change', function () { var n = parseFloat(String(inp.value).replace(/[^0-9.]/g, '')); if (isFinite(n) && n >= 0 && n <= 20) settings.set({ autoDay: Math.round(n * 100) / 100 }); draw(); });
      r3.appendChild(h('span', 'bb-cap-l', '$')); r3.appendChild(inp); r3.appendChild(h('label', '', 'a day in all for jobs that start on their own (spent today: $' + autoSpend.get().toFixed(2) + ')')); wrap.appendChild(r3); };
    draw(); el.appendChild(wrap);
  }

  Kin.briefBoard = { started: started, autoSpend: autoSpend, offers: offers, gather: gather, show: show, hide: hide, summary: summary, isBriefRequest: isBriefRequest, settings: settings, settingsUI: settingsUI, isOpen: function () { return !!root; }, _fromPack: fromPack, _wmo: WMO };
})();
