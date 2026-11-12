/* remind.js: reminders, understood and kept on this device.
   "remind me at 3pm to call Sam", "remind me in 20 minutes to check the oven", "remind me tomorrow at 9 to send the
   invoice", "remind me every weekday at 8 to stretch", "remind me every Monday evening to call mum", "remind me on
   March 3 to renew the lease", "what are my reminders (today)", "cancel the reminder to call Sam", "cancel the 4pm
   reminder", "cancel that reminder", "stop reminding me to drink water", "snooze", "remind me on the 1st of every month to
   pay rent", "remind me every other Friday to send the invoices", "remind me first thing tomorrow to call the bank".
   A phrase with a time is understood here, with no call to Claude. "remind me to call Sam" asks when, and the very next
   answer ("at 5", "in 20 minutes", "tomorrow") finishes it. Questions ("remind me what Sam said", "remind me, do I have
   a meeting at 3?") and times that hang on something else ("15 minutes before my 3pm call") are left to Claude, which
   can set one with set_reminder and cancel one with cancel_reminder (brain.js), only when the founder asks.
   When one is due while Jarvis is open it chimes, says it, and shows it with Done and Snooze (app.js); one missed while
   Jarvis was closed shows when it opens again, up to a day late. Reminders are kept only on this device (only in memory
   at a shared address) and their words never go to Claude; if a cloud voice is on, it speaks them like any other reply.
   Public surface (window.Kin.remind): instant(text), parse(text, now), waiting(), dropAsk(), list(), pending(),
   add(at, text, repeat, dom), done(id), snooze(id, minutes, text), cancel(id), restore(items), find(words), onDue(fn),
   check(), describe(r, now), when(at, now), today(now), error() */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var KEY = 'kin.reminders', MAX = 100, DAY = 864e5, AHEAD = 366 * DAY, MIN_EVERY = 300000, RECENT = 15 * 60000;
  var subs = [], iv = 0, tmo = 0, askFor = null, mem = null, lastErr = '', firedMem = {}, lastFired = null;
  var DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var WD = DAYS.join('|');
  var MON = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  var MONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var N = '(?:\\d+(?:\\.\\d+)?|an?|one|half(?:\\s+an?)?|a couple of|a couple|couple of|a few|few)';
  var UNIT = '(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)';
  var PART = '(morning|afternoon|evening|night)';
  var PART_H = { morning: 9, afternoon: 15, evening: 18, night: 20 };

  /* ---------------------------------------------------------------- kept on this device */
  function valid(r) { return r && typeof r.id === 'string' && isFinite(r.at) && typeof r.text === 'string'; }
  function list() {
    var raw = '[]';
    if (Kin.shared) raw = JSON.stringify(mem || []);
    else { try { raw = localStorage.getItem(KEY) || '[]'; } catch (e) { raw = '[]'; } }
    try { var a = JSON.parse(raw); return Array.isArray(a) ? a.filter(valid) : []; } catch (e) { return []; }
  }
  /* finished ones stay a day (a card on screen can still be snoozed), then go; true when it was kept */
  function save(a) {
    var old = Date.now() - DAY, keep = a.filter(function (r) { return !r.done || r.done > old; });
    if (keep.length > MAX + 60) { var open = keep.filter(function (r) { return !r.done; }), fin = keep.filter(function (r) { return r.done; }); keep = open.concat(fin.slice(-(MAX + 60 - open.length))); }
    /* at an address shared with other pages nothing private is written down: reminders live in memory only */
    if (Kin.shared) { mem = keep; return true; }
    try { localStorage.setItem(KEY, JSON.stringify(keep)); return true; } catch (e) { return false; }
  }
  function pending() { return list().filter(function (r) { return !r.done; }).sort(function (x, y) { return x.at - y.at; }); }
  function find(a, id) { for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  /* the words, one line, at most 200 characters, and never a clickable link where they are shown */
  function clean(t) { return String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\]\s*\(/g, '] (').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Reminder'; }
  /** repeat: 'day', 'weekday' (Monday to Friday), 'week' or 'month' (dom: its day of the month, 31 for the last day; the
      day of `at` when not given); or a number of milliseconds, from every 5 minutes to every week, or every 2 to 4 weeks.
      Returns the reminder, or null (error() says why: 'full' or 'storage') */
  function add(at, text, repeat, dom) {
    at = Math.round(+at); if (!isFinite(at)) { lastErr = 'time'; return null; }
    var a = list();
    if (a.filter(function (r) { return !r.done; }).length >= MAX) { lastErr = 'full'; return null; }
    var r = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: at, text: clean(text), made: Date.now() }, d = new Date(at);
    if (repeat === 'day' || repeat === 'weekday' || repeat === 'week' || repeat === 'month') { r.repeat = repeat; r.hm = [d.getHours(), d.getMinutes()]; if (repeat === 'month') r.dom = dom >= 1 && dom <= 31 ? Math.floor(dom) : d.getDate(); }
    else if (typeof repeat === 'number' && repeat >= MIN_EVERY && (repeat <= 7 * DAY || (repeat % (7 * DAY) === 0 && repeat <= 28 * DAY))) { r.every = Math.round(repeat); if (r.every % DAY === 0) r.hm = [d.getHours(), d.getMinutes()]; }
    a.push(r);
    if (!save(a)) { lastErr = 'storage'; return null; }
    lastErr = ''; plan(); return r;
  }
  function done(id) { var a = list(), r = find(a, id); if (r && !r.repeat && !r.every && !r.done) { r.done = Date.now(); save(a); } plan(); }
  /** a one-off comes back in a few minutes; a repeating one keeps its schedule and a one-off copy comes back instead */
  function snooze(id, min, text) {
    var a = list(), r = find(a, id), at = Date.now() + Math.max(1, Math.min(1440, +min || 10)) * 60000;
    if (!r || r.repeat || r.every) return add(at, r ? r.text : text);
    r.at = at; r.done = 0; r.fired = 0;
    if (!save(a)) { lastErr = 'storage'; return null; }
    plan(); return r;
  }
  function cancel(id) { var a = list(), b = a.filter(function (r) { return r.id !== id; }), gone = b.length !== a.length; if (gone) save(b); plan(); return gone; }
  /** puts cancelled reminders back (Undo) */
  function restore(items) {
    var a = list(); (Array.isArray(items) ? items : [items]).forEach(function (r) { if (valid(r) && !find(a, r.id)) a.push(r); });
    var ok = save(a); plan(); return ok;
  }
  /** the waiting reminder whose words fit: every word given (two letters or more, small words aside) is in it */
  var SMALL = { the: 1, a: 1, an: 1, to: 1, my: 1, me: 1, of: 1, and: 1, for: 1, about: 1, that: 1, on: 1, at: 1, in: 1, it: 1 };
  function words(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(function (w) { return w.length > 1 && !SMALL[w]; }); }
  var KINDW = { daily: function (r) { return r.repeat === 'day'; }, nightly: function (r) { return r.repeat === 'day'; }, weekly: function (r) { return r.repeat === 'week' || r.every === 7 * DAY; }, monthly: function (r) { return r.repeat === 'month'; },
    fortnightly: function (r) { return r.every === 14 * DAY; }, biweekly: function (r) { return r.every === 14 * DAY; }, weekday: function (r) { return r.repeat === 'weekday'; }, weekdays: function (r) { return r.repeat === 'weekday'; },
    repeating: function (r) { return !!(r.repeat || r.every); }, recurring: function (r) { return !!(r.repeat || r.every); } };
  function kindOk(r, kinds) { return kinds.every(function (k) { return KINDW[k](r); }); }
  function findBy(text) {
    var ws0 = words(text), kinds = ws0.filter(function (w) { return Object.prototype.hasOwnProperty.call(KINDW, w); }), ws = ws0.filter(function (w) { return kinds.indexOf(w) < 0; });
    if (!ws.length) { var only = kinds.length ? pending().filter(function (r) { return kindOk(r, kinds); }) : []; return only.length === 1 ? only[0] : null; }
    var has = function (have, w) { return have.indexOf(w) >= 0 || (w.length > 3 && have.some(function (h) { return h.indexOf(w) === 0; })); };
    var all = pending().filter(function (r) { var have = words(r.text); return kindOk(r, kinds) && ws.every(function (w) { return has(have, w); }); })[0];
    if (all) return all;
    /* "the reminder to call Sam about the contract" for "Call Sam": the one clear best fit, two words or more */
    var scored = pending().filter(function (r) { return kindOk(r, kinds); }).map(function (r) { var have = words(r.text); return { r: r, n: ws.filter(function (w) { return has(have, w); }).length, of: have.length }; }).filter(function (x) { return x.n >= 2 && x.n >= Math.ceil(x.of * 0.6); }).sort(function (a, b) { return b.n - a.n; });
    return scored.length && (scored.length === 1 || scored[0].n > scored[1].n) ? scored[0].r : null;
  }
  /** the waiting reminders at a time ("4pm", "at 3:30") and/or on a day ("tomorrow", "Friday") named in the words */
  function byWhen(ph) {
    var p = ' ' + String(ph || '').toLowerCase() + ' ', tm = /\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s)/.exec(p), dy = new RegExp('\\s(today|tonight|tomorrow|' + WD + ')\\s').exec(p);
    if (!tm && !dy) return null;
    var mid = new Date(); mid.setHours(0, 0, 0, 0);
    return pending().filter(function (r) {
      var d = new Date(r.at), h = d.getHours();
      if (tm) { var h0 = +tm[1], m0 = +(tm[2] || 0), apm = (tm[3] || '').charAt(0); if (d.getMinutes() !== m0) return false; if (apm === 'p' ? h !== (h0 % 12) + 12 : apm === 'a' ? h !== h0 % 12 : h % 12 !== h0 % 12) return false; }
      if (dy) { var dd = new Date(d); dd.setHours(0, 0, 0, 0); var k = Math.round((dd - mid) / DAY), w = dy[1]; if (w === 'today' || w === 'tonight') { if (k !== 0) return false; } else if (w === 'tomorrow') { if (k !== 1) return false; } else if (DAYS[d.getDay()] !== w || k > 7) return false; }
      return true;
    });
  }
  /* "the reminder about lunch with Sam, it moved": the words before a comma or a "because" if all of them fit nothing */
  function findLoose(t) { var x = findBy(t); if (x) return x; var head = String(t || '').split(/\s*(?:[,;]|\s-\s|\bbecause\b|\bsince\b|\bas it\b)\s*/)[0]; return head && head !== t ? findBy(head) : null; }
  function recentFired() { return lastFired && Date.now() - lastFired.at < RECENT ? lastFired : null; }

  /* ---------------------------------------------------------------- when they are due */
  function step(r, at) {
    var d = new Date(at);
    if (r.every && r.every % DAY !== 0) return at + r.every;
    /* the same day each month; the 31st (or the 29th, the 30th) is the last day of a shorter month */
    if (r.repeat === 'month') { var dom = r.dom || d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(dom, daysIn(d))); }
    else d.setDate(d.getDate() + (r.every ? r.every / DAY : r.repeat === 'week' ? 7 : 1));
    if (r.repeat === 'weekday') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    /* the clock time it was set for, so a day when the clocks change does not move it for good */
    if (r.hm) d.setHours(r.hm[0], r.hm[1], 0, 0);
    return d.getTime();
  }
  /* each due one fires once (a repeating one moves on to its next time). One missed while Jarvis was closed fires when it
     opens again, marked late, if it is less than a day late, and for a repeating one only if its next time is not close.
     Two tabs: a lock lets one of them do it. If saving fails, what fired is remembered here so it does not fire again. */
  function check() {
    if (!subs.length) return;
    try { if (navigator.locks && typeof navigator.locks.request === 'function') { navigator.locks.request(KEY, { ifAvailable: true }, function (lock) { if (lock) checkNow(); }).catch(function () {}); return; } } catch (e) {}
    checkNow();
  }
  function checkNow() {
    var now = Date.now(), a = list(), due = [], changed = false;
    a.forEach(function (r) {
      if (r.done || !(r.at <= now)) return;
      var key = r.id + '@' + r.at; if (firedMem[key]) return;
      firedMem[key] = now; changed = true;
      var last = r.at;
      if (r.every && r.every % DAY !== 0) { var k = Math.floor((now - r.at) / r.every); last = r.at + k * r.every; r.at = last + r.every; }
      else if (r.repeat || r.every) { for (var g = 0; r.at <= now && g < 1000; g++) { last = r.at; r.at = step(r, r.at); } if (r.at <= now) r.at = step(r, now); }
      else { r.done = now; r.fired = now; }
      var late = now - last > 90000;
      if (now - last >= DAY) return;
      if (late && (r.repeat || r.every) && r.at - now < Math.min(3600000, (r.every || DAY) / 2)) return;
      due.push({ id: r.id, text: r.text, at: last, late: late, repeat: r.repeat || (r.every ? 'every' : ''), every: r.every || 0, next: r.repeat || r.every ? r.at : 0 });
    });
    if (changed) save(a);
    plan();
    due.forEach(function (x) { lastFired = { id: x.id, at: Date.now(), repeat: !!x.repeat, text: x.text }; subs.forEach(function (f) { try { f(x); } catch (e) {} }); });
  }
  /* a timer for the next one, so it fires on time; the 15-second check covers sleep, clock changes and other tabs */
  function plan() {
    clearTimeout(tmo); tmo = 0; if (!subs.length) return;
    var p = pending().filter(function (r) { return !firedMem[r.id + '@' + r.at]; })[0]; if (!p) return;
    var ms = p.at - Date.now(); if (ms > 2e9) return;
    tmo = setTimeout(check, Math.max(0, ms) + 60 + Math.floor(Math.random() * 400));
  }
  function onDue(f) {
    subs.push(f);
    if (!iv) {
      iv = setInterval(check, 15000);
      try { window.addEventListener('storage', function (e) { if (e.key === KEY) plan(); }); document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); }); } catch (e) {}
    }
    /* the page settles first; anything missed while Jarvis was closed shows then */
    setTimeout(check, 1500);
  }

  /* ---------------------------------------------------------------- words for times */
  function clock(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function dayWord(at, now) {
    var a = new Date(now); a.setHours(0, 0, 0, 0); var b = new Date(at); b.setHours(0, 0, 0, 0); var k = Math.round((b - a) / DAY);
    return k === 0 ? 'today' : k === 1 ? 'tomorrow' : new Date(at).toLocaleDateString(undefined, k > 1 && k < 7 ? { weekday: 'long' } : { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function when(at, now) { return dayWord(at, now || Date.now()) + ' at ' + clock(new Date(at)); }
  function span(ms) { var m = Math.round(ms / 60000); if (m % 1440 === 0) { var dd = m / 1440; if (dd % 7 === 0) { var wk = dd / 7; return wk === 1 ? 'week' : wk === 2 ? 'other week' : wk + ' weeks'; } return dd === 1 ? 'day' : dd === 2 ? 'other day' : dd + ' days'; } if (m % 60 === 0) { var h = m / 60; return h === 1 ? 'hour' : h + ' hours'; } return m + ' minutes'; }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function describe(r, now) {
    now = now || Date.now(); var d = new Date(r.at);
    if (r.repeat === 'month') { var dm = r.dom || d.getDate(); return 'every month on the ' + (dm >= 31 ? 'last day' : ord(dm)) + ' at ' + clock(d) + (dm > 28 && dm < 31 ? ' (the last day in a shorter month)' : ''); }
    if (r.every) {
      /* "every other Friday at 9:00 AM, from tomorrow"; "every 2 hours, from today at 10:10 AM" */
      if (r.every % (7 * DAY) === 0) { var nwk = r.every / (7 * DAY), wdn = d.toLocaleDateString(undefined, { weekday: 'long' }); if (nwk === 1) return 'every ' + wdn + ' at ' + clock(d); return (nwk === 2 ? 'every other ' + wdn : 'every ' + nwk + ' weeks on ' + wdn) + ' at ' + clock(d) + ', from ' + dayWord(r.at, now); }
      return 'every ' + span(r.every) + ', from ' + when(r.at, now);
    }
    if (r.repeat === 'day') return 'every day at ' + clock(d);
    if (r.repeat === 'weekday') return 'every weekday at ' + clock(d);
    if (r.repeat === 'week') return 'every ' + d.toLocaleDateString(undefined, { weekday: 'long' }) + ' at ' + clock(d);
    return when(r.at, now);
  }
  /** what is due between now and midnight, soonest first (for the morning brief) */
  function today(now) { now = now || Date.now(); var end = new Date(now); end.setHours(24, 0, 0, 0); return pending().filter(function (r) { return r.at >= now - 60000 && r.at < end.getTime(); }); }

  /* ---------------------------------------------------------------- reading the time out of the words */
  function amount(w) {
    w = String(w || '').toLowerCase().trim();
    if (!w || /^(?:an?|one)$/.test(w)) return 1; if (/^half/.test(w)) return 0.5; if (/couple/.test(w)) return 2; if (/few/.test(w)) return 3;
    return parseFloat(w);
  }
  function unitMs(u) { u = String(u || '').toLowerCase(); return /^h/.test(u) ? 3600000 : /^s/.test(u) ? 1000 : 60000; }
  function daysIn(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
  /* number words become digits only next to a time ("at three thirty", "in two hours"); "the blue one" stays as said */
  var NW = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty)';
  var RUN = NW + '(?:[\\s-]+' + NW + ')*';
  var NUM_HALF = new RegExp('\\b(half|quarter)(\\s+)(past|to|after|before)(\\s+)(' + RUN + ')\\b', 'gi');
  var NUM_PRE = new RegExp('\\b(at|by|around|after|in|every)(\\s+)(' + RUN + ')\\b', 'gi');
  var NUM_POST = new RegExp('\\b(' + RUN + ')(\\s*)(minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?|o\'?clock|am|pm|a\\.m\\.|p\\.m\\.)(?=\\s|$|[.,!?])', 'gi');
  function numTimes(t) {
    var nf = Kin.mind && Kin.mind.numify; if (!nf) return t;
    var f = function (n) { return nf(n.replace(/-/g, ' ')); };
    return t.replace(NUM_HALF, function (m, a, s1, b, s2, n) { return a + s1 + b + s2 + f(n); })
      .replace(NUM_PRE, function (m, a, s, n) { return a + s + f(n); })
      .replace(NUM_POST, function (m, n, s, u) { return f(n) + s + u; });
  }
  var LEAD = /^(?:(?:hey |ok |okay )?(?:jarvis|kin)[,!.]? )?(?:(?:please|can you|could you|would you|will you|i need you to|i want you to)[,]? )*/i;
  var VERB = /^(remind me|set (?:a |me a |up a )?reminder|add a reminder|create a reminder|make a reminder|new reminder|don't let me forget|do not let me forget|ping me|alert me|nudge me|wake me(?: up)?)\b(\s*:)?,?(?: (to|that|about|for|of)\b)?\s*([\s\S]*)$/i;
  /* a question ("remind me what", "remind me, do I have a meeting at 3?", "remind me Sam's number") is for Claude */
  var QUESTION = /^(?:what|who|whom|whose|how|why|where|which|whether|if|when|do|does|did|is|are|was|were|am|can|could|will|would|should|shall|have|has|had)\b/i;
  var DET = /^(?:the|my|your|his|her|their|our|a|an|its|this|that|these|those)\b(?!\s+(?:\d{1,2}(?:st|nd|rd|th)\b|(?:morning|afternoon|evening|night|weekend|week|coming|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|day\s+after\s+tomorrow\b(?!')|(?:last\s+day|end|start|beginning)\s+of\s+(?:(?:the|this|next|every|each)\s+)?(?:week|month)\b(?!')|(?:(?:twenty|thirty)[\s-]+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\s+(?:day\s+)?of\s+(?:every|each|the|this|next)\s+month\b))/i;
  /* "set a reminder", "make a reminder": only with to/for/about/that, or a time first ("set a reminder email" is not one) */
  var TIMEISH = new RegExp('^(?:at|in|on|by|around|after|every|each|tomorrow|today|tonight|this|next|daily|nightly|weekly|monthly|fortnightly|biweekly|noon|midnight|first\\s+thing|end\\s+of|eod|\\d|' + WD + '|weekdays|the\\s+(?:\\d|day\\s+after|end\\s+of|last\\s+day))\\b', 'i');
  /* "the first of every month", "the twenty-first of March": the ordinal in figures */
  var ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
  /* what may follow a date for it to be the time, not part of the task ("the end of the month report" is a report) */
  var TERM = '(?=\\s*$|\\s+(?:at|by|around|to|in|and|then|for|on|tomorrow|today|tonight|next|this|starting|from|every|each|please)\\b|\\s+\\d|\\s*[,;])';
  /* after "of every month", a month's name too: "on the 1st of every month starting January" */
  var TERMM = '(?=\\s*$|\\s+(?:at|by|around|to|in|and|then|for|on|tomorrow|today|tonight|next|this|starting|from|every|each|please|' + MON + ')\\b|\\s+\\d|\\s*[,;])';
  var ORDS = Object.keys(ORD).join('|');
  var ORD_RE = new RegExp('\\bthe\\s+(?:(twenty|thirty)[\\s-]+)?(' + ORDS + ')(\\s+day)?\\s+of\\s+(?=(?:every|each)\\s+month\\b|(?:the|this|next)\\s+month' + TERM + '|(?:' + MON + ')\\b)', 'gi');
  var ORD_ON = new RegExp('\\bon\\s+the\\s+(?:(twenty|thirty)[\\s-]+)?(' + ORDS + ')' + TERM, 'gi');
  var ORD_AND = new RegExp('\\b(the|and|&)\\s+(?:(twenty|thirty)[\\s-]+)?(' + ORDS + ')\\b', 'gi');
  function ordN(tens, w) { var n = ORD[String(w).toLowerCase()] + (tens ? (String(tens).toLowerCase() === 'thirty' ? 30 : 20) : 0); return n >= 1 && n <= 31 ? n : 0; }
  var RELATIVE = new RegExp('\\b' + N + '\\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?)\\s+(?:before|after|earlier than|prior to|ahead of)\\b|\\b(?:before|after|ahead of)\\s+(?:my|the|our|his|her|their|each|every)\\s', 'i');
  var AFTER_DATE = '(?=\\s*$|\\s+(?:at|by|around|to|in|and|from|of|for|starting|then)\\b|\\s+\\d)';
  /* a date or a day's name after one of these words is the subject of the reminder, not its time ("a gift for the 25th") */
  var TOPIC = { about: 1, for: 1, regarding: 1, re: 1, of: 1, from: 1, until: 1, since: 1, before: 1, after: 1 };
  var OWNER = { the: 1, a: 1, an: 1, my: 1, our: 1, your: 1, his: 1, her: 1, their: 1, and: 1, this: 1, that: 1 };

  /** "remind me at 3pm to call Sam" -> { at, text, repeat?, also? } | { ask: 'when' | 'often' | 'repeat', text, past?, far? } | null (not a reminder for this page) */
  function parse(raw, now) {
    now = typeof now === 'number' && isFinite(now) ? now : Date.now();
    var t = String(raw || ''); if (t.length > 300) return null;
    t = t.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim();
    t = t.slice(LEAD.exec(t)[0].length);
    var v = VERB.exec(t); if (!v) return null;
    var verb = v[1].toLowerCase(), conn = (v[3] || '').toLowerCase() || (v[2] ? 'to' : ''), body = v[4];
    var wake = /^wake me/.test(verb);
    /* "remind me again", "remind me, please", "remind me: what..." */
    for (var f0 = 0; f0 < 4; f0++) body = body.replace(/^[\s,:;\-–—…."'“”]+/, '').replace(/^(?:once again|again|please|real quick|quickly|quick|just|once more|one more time|jarvis|kin|sir)\b/i, '');
    body = body.replace(/^[\s,:;\-–—…."'“”]+/, '');
    if ((!conn || v[2] || conn === 'about' || conn === 'of') && QUESTION.test(body)) return null;
    if (!conn && (DET.test(body) || /^[\p{L}][\p{L}-]*'s\b/u.test(body))) return null;
    if (!/^(?:remind me|don't let me forget|do not let me forget|ping me|alert me|nudge me|wake me(?: up)?)$/.test(verb) && !conn && !TIMEISH.test(body)) return null;
    if (/\b(?:to|in|on|into)\s+(?:my\s+|the\s+|google\s+|apple\s+|outlook\s+)*calendar\b/i.test(body) || (conn && /^(?:my\s+|the\s+|google\s+|apple\s+|outlook\s+)*calendar\b/i.test(body))) return null;
    if (RELATIVE.test(body)) return null;
    var nb = numTimes(body).replace(ORD_RE, function (m, tens, w, day) { var n = ordN(tens, w); return n ? 'the ' + ord(n) + (day ? ' day' : '') + ' of ' : m; })
      .replace(ORD_ON, function (m, tens, w) { var n = ordN(tens, w); return n ? 'on the ' + ord(n) : m; });
    if (/\bof\s+(?:every|each)\s+month\b/i.test(nb)) nb = nb.replace(ORD_AND, function (m, pre, tens, w) { var n = ordN(tens, w); return n ? pre + ' ' + ord(n) : m; });
    /* "remind me 10 minutes" means in 10 minutes; "starting tomorrow" and "from Monday" are when a repeat begins */
    if (new RegExp('^' + N + '\\s*' + UNIT + '(?=\\s|$)', 'i').test(nb)) nb = 'in ' + nb;
    nb = nb.replace(new RegExp('\\b(?:starting|beginning|from)\\s+(?=(?:tomorrow|today|tonight|next|this|on|the\\s+\\d|' + WD + '|' + MON + ')\\b)', 'gi'), '');
    var rest = ' ' + nb + ' ', lc = rest.toLowerCase(), got = false, clocked = false;
    function cut(re) { var x = re.exec(lc); if (!x) return null; rest = rest.slice(0, x.index) + ' ' + rest.slice(x.index + x[0].length); lc = rest.toLowerCase(); got = true; return x; }
    /* the word just before position i */
    function prev(i) { var w = lc.slice(0, i).trim().split(/\s+/); return w[w.length - 1] || ''; }
    /* cut only when the word before the match is not one of these */
    function cutUnless(re, bad) { var x = re.exec(lc); if (!x || bad[prev(x.index)]) return null; return cut(re); }
    var base = new Date(now), dayset = false, todayWord = false, hh = null, mm = 0, ap = '', part = '', repeat = '', every = 0, wd = -1, also = [], rel = 0, weekly = false, endOfDay = false, early = false, thN = 0, monthDom = 0, monthDom2 = 0, endWord = false, lastDay = false;
    /* "every week on Fridays", "weekly on Friday mornings": the day */
    function onDay() { var o = cut(new RegExp('\\s(?:on\\s+(' + WD + ')s?|(' + WD + ')s)(?:\\s+' + PART + ')?(?=\\s)')); if (o) { wd = DAYS.indexOf(o[1] || o[2]); weekly = true; if (o[3]) part = o[3]; } }

    /* repeating: every 2 hours, every other day, every day, every Monday evening, every weekday, every weekend, daily, on Mondays */
    var ev = cut(new RegExp('\\s(?:every|each)\\s+(?:(' + N + ')\\s*)?(hours?|hrs?|minutes?|mins?)(?=\\s)'));
    if (ev) { every = Math.round(amount(ev[1]) * unitMs(ev[2])); if (!(every >= MIN_EVERY)) return { ask: 'often', text: tidy(rest) }; if (every > 7 * DAY) return { ask: 'repeat', text: tidy(rest) }; }
    else {
      var evd = cut(/\s(?:every|each)\s+(?:(other)|(\d+|two|three|four|five|six|seven))\s+days?(?=\s)/);
      if (evd) { var nd0 = evd[1] ? 2 : (+evd[2] || ['two', 'three', 'four', 'five', 'six', 'seven'].indexOf(evd[2]) + 2); if (nd0 === 1) repeat = 'day'; else if (nd0 === 7) repeat = 'week'; else if (nd0 >= 2 && nd0 <= 6) every = nd0 * DAY; else return { ask: 'repeat', text: tidy(rest) }; }
      else {
      /* every month: on the 1st of every month, every month on the 15th, monthly, on the last day of each month.
         "The first Monday of every month" is not one I can keep yet */
      if (new RegExp('\\b(?:first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\\s+(?:' + WD + '|weekday|weekend|week|business\\s+day|working\\s+day|work\\s+day)s?\\s+of\\s+(?:every|each)\\s+month\\b').test(lc)) return { ask: 'repeat', text: tidy(rest) };
      var MDAY = '(?:\\s+on\\s+the\\s+(?:(\\d{1,2})(?:st|nd|rd|th)|(last\\s+day)))?';
      var mo2 = cut(new RegExp('\\s(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\s+(?:and|&)\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\s+(?:day\\s+)?of\\s+(?:every|each)\\s+month' + TERMM));
      var mo1 = mo2 || cut(new RegExp('\\s(?:on\\s+|at\\s+|by\\s+)?(?:the\\s+)?(?:(\\d{1,2})(?:st|nd|rd|th)(?:\\s+day)?|(last\\s+day|end)|(start|beginning))\\s+of\\s+(?:every|each)\\s+month' + TERMM)) ||
        cutUnless(new RegExp('\\s(?:every|each)\\s+month' + MDAY + TERMM), TOPIC) ||
        cut(new RegExp('^\\s+monthly' + MDAY + '(?=\\s)')) || cutUnless(new RegExp('\\smonthly' + MDAY + '(?=\\s*$|\\s+(?:at|by|around|starting|from)\\b|\\s+on\\s+the\\b|\\s+\\d|\\s*[,;])'), OWNER) ||
        cut(new RegExp('\\s(?:every|each)\\s+(\\d{1,2})(?:st|nd|rd|th)()(?:\\s+of\\s+the\\s+month)?(?=\\s*$|\\s+(?:at|by|around|to|and|then|starting|from)\\b|\\s+\\d|\\s*[,;])'));
      if (mo1) {
        repeat = 'month';
        if (mo2) { monthDom = +mo2[1]; monthDom2 = +mo2[2]; if (monthDom2 === monthDom || monthDom2 < 1 || monthDom2 > 31) monthDom2 = 0; }
        else { monthDom = mo1[2] ? 31 : mo1[3] ? 1 : +(mo1[1] || 0); endWord = mo1[2] === 'end'; }
        if (monthDom > 31) return { ask: 'when', text: tidy(rest) };
      }
      else {
      /* every other Friday, every 2 weeks (on Monday), every fortnight, biweekly */
      var wk1 = cut(new RegExp('\\s(?:every|each)\\s+(?:other|second|2nd)\\s+(' + WD + ')(?:\\s+' + PART + ')?(?=\\s)'));
      var WDS = '((?:' + WD + ')s?(?:\\s*(?:,|and|&)\\s*(?:and\\s+)?(?:' + WD + ')s?)*)';
      var wk2 = wk1 ? null : cut(new RegExp('\\s(?:every|each)\\s+(?:(?:other|second|2nd)\\s+week|(\\d+|two|three|four|five|six)\\s+weeks?|fortnight)(?:\\s+on\\s+' + WDS + ')?(?=\\s)')) ||
        cut(new RegExp('^\\s+()(?:bi-?weekly|fortnightly)(?:\\s+on\\s+' + WDS + ')?(?=\\s)')) ||
        cutUnless(new RegExp('\\s()(?:bi-?weekly|fortnightly)(?:\\s+on\\s+' + WDS + ')?(?=\\s*$|\\s+(?:at|by|around|starting|from)\\b|\\s+(?:on\\s+)?(?:' + WD + ')s?\\b|\\s*[,;])'), OWNER);
      if (wk1) { every = 14 * DAY; wd = DAYS.indexOf(wk1[1]); weekly = true; if (wk1[2]) part = wk1[2]; }
      else if (wk2) {
        var nw = wk2[1] ? (+wk2[1] || ['two', 'three', 'four', 'five', 'six'].indexOf(wk2[1]) + 2) : 2;
        if (nw === 1) repeat = 'week'; else if (nw >= 2 && nw <= 4) every = nw * 7 * DAY; else return { ask: 'repeat', text: tidy(rest) };
        if (wk2[2]) { var ds2 = wk2[2].match(new RegExp(WD, 'g')).map(function (w) { return DAYS.indexOf(w); }).filter(function (x, i, arr) { return arr.indexOf(x) === i; }); wd = ds2[0]; also = ds2.slice(1); weekly = true; } else onDay();
      }
      else {
      var un = /\s(?:every|each)\s+(?:year|quarter|(?:\d+|two|three|four|five|six)\s+(?:months?|years?|quarters?))\b|\s(yearly|annually|quarterly)\b/.exec(lc);
      if (un && !(un[1] && OWNER[prev(un.index)])) return { ask: 'repeat', text: tidy(rest) };
        /* every Monday and Wednesday: one weekly reminder for each day */
        var mu = cut(new RegExp('\\s(?:every|each|on)\\s+((?:' + WD + ')s?(?:\\s*(?:,|and|&)\\s*(?:and\\s+)?(?:' + WD + ')s?)+)(?:\\s+' + PART + ')?(?=\\s)'));
        /* "on Monday and Tuesday" is once on each; "every Monday and Wednesday" or "on Mondays and Wednesdays" repeats */
        if (mu) { var ds = mu[1].match(new RegExp(WD, 'g')).map(function (w) { return DAYS.indexOf(w); }).filter(function (x, i, arr) { return arr.indexOf(x) === i; }); repeat = /^\s(?:every|each)\s/.test(mu[0]) || new RegExp('(?:' + WD + ')s\\b').test(mu[1]) ? 'week' : ''; weekly = true; wd = ds[0]; also = ds.slice(1); if (mu[2]) part = mu[2]; if (!repeat && cutUnless(/\s(?:(?:every|each)\s+week|weekly)(?=\s)/, OWNER)) repeat = 'week'; }
        else {
          var e1 = cut(new RegExp('\\s(?:every|each)\\s+(day|weekday|weeknight|week|weekend|' + WD + ')(?:\\s+' + PART + ')?(?=\\s)'));
          if (e1) {
            var k1 = e1[1];
            if (k1 === 'day') repeat = 'day'; else if (k1 === 'week') { repeat = 'week'; onDay(); } else if (k1 === 'weekend') { repeat = 'week'; wd = 6; weekly = true; }
            else if (k1 === 'weekday' || k1 === 'weeknight') { repeat = 'weekday'; if (k1 === 'weeknight') part = 'night'; }
            else { repeat = 'week'; wd = DAYS.indexOf(k1); weekly = true; }
            if (e1[2]) part = e1[2];
          } else {
            var e2 = cut(new RegExp('\\s(?:every|each)\\s+' + PART + '(?=\\s)'));
            if (e2) { repeat = 'day'; part = e2[1]; }
            else {
              /* daily, nightly, weekly: at the start, or before a time or at the end; not "the daily report" */
              var e3 = cut(/^\s+(daily|nightly|weekly)(?=\s)/) || cutUnless(new RegExp('\\s(daily|nightly|weekly)(?=\\s*$|\\s+(?:at|by|around|starting|from)\\b|\\s+\\d|\\s+(?:on\\s+)?(?:' + WD + ')s?\\b|\\s*[,;])'), OWNER);
              if (e3) { repeat = e3[1] === 'weekly' ? 'week' : 'day'; if (e3[1] === 'nightly') part = 'night'; if (repeat === 'week') onDay(); }
              else {
                var e4 = cut(/\s(?:on\s+)?(weekdays|weeknights)(?=\s)/);
                if (e4) { repeat = 'weekday'; if (e4[1] === 'weeknights') part = 'night'; }
                else { var e5 = cut(new RegExp('\\s(?:on\\s+)?(' + WD + ')s(?:\\s+' + PART + ')?(?=\\s)')); if (e5) { repeat = 'week'; wd = DAYS.indexOf(e5[1]); weekly = true; if (e5[2]) part = e5[2]; } }
              }
            }
          }
        }
      }
      }
      }
    }
    /* "on the 1st of every month starting (in) January": the first one is in January */
    if (repeat === 'month') {
      var sm = cut(new RegExp('\\s(?:starting\\s+|beginning\\s+|from\\s+)?(?:in\\s+)?(' + MON + ')\\.?(?:\\s+(\\d{4}))?(?=\\s*$|\\s+(?:to|at|on|and|for|then)\\b|\\s*[,;])', 'i'));
      if (sm) { var smi = MONS.indexOf(sm[1].slice(0, 3).toLowerCase()), smy = sm[2] ? +sm[2] : base.getFullYear(), b2 = new Date(smy, smi, 1); if (!sm[2] && b2.getTime() < new Date(base.getFullYear(), base.getMonth(), 1).getTime()) b2.setFullYear(smy + 1); base = b2; dayset = true; }
    }
    /* in 20 minutes, in an hour and a half, in 1 hour 30 minutes, in 10 (minutes) */
    var rx = cut(new RegExp('\\s(?:in|after)\\s+((?:' + N + ')\\s*' + UNIT + '(?:\\s+and\\s+a\\s+half)?(?:\\s*,?\\s*(?:and\\s+)?(?:' + N + ')\\s*' + UNIT + ')*)(?=\\s)'));
    if (rx) { var re2 = new RegExp('(' + N + ')\\s*(' + UNIT + ')(\\s+and\\s+a\\s+half)?', 'gi'), q, total = 0; while ((q = re2.exec(rx[1]))) { var u = unitMs(q[2]); total += amount(q[1]) * u + (q[3] ? u / 2 : 0); } rel = Math.round(total); clocked = true; }
    else { var rn = cut(/\sin\s+(\d{1,3})(?=\s*$|\s+(?:to|and|then|for)\b)/); if (rn) { rel = +rn[1] * 60000; clocked = true; } }
    /* in 3 days, in a week, next week, next month */
    var rd = cut(new RegExp('\\s(?:in|after)\\s+(' + N + ')\\s*(days?|weeks?|fortnights?)(?=\\s)'));
    if (rd) { var nd = Math.round(amount(rd[1]) * (/^w/i.test(rd[2]) ? 7 : /^f/i.test(rd[2]) ? 14 : 1)); if (nd > 0) { base.setDate(base.getDate() + nd); dayset = true; } }
    /* not "the end of next week": that is read below */
    var nx = cutUnless(/\s(?:next|in a)\s+(week|month)(?=\s)/, { of: 1 });
    if (nx) { if (nx[1] === 'week') base.setDate(base.getDate() + 7); else { var d0 = base.getDate(); base.setDate(1); base.setMonth(base.getMonth() + 1); base.setDate(Math.min(d0, daysIn(base))); } dayset = true; }
    /* the time: half past 3, quarter to 4 pm, at 3, at 3:30, at 1530, 3pm, after 5, at 12 noon, noon, midnight, at lunch.
       Not when "in 10 minutes" already said when: "in 10 minutes to check the 3pm slot" keeps "3pm" in the words */
    if (!rel || every) {
      var hp = cut(/\s(?:at\s+|by\s+|around\s+)?(half|quarter)\s+(past|after|to|before)\s+(\d{1,2})(?:\s*(a\.?m\.?|p\.?m\.?))?(?=\s)/);
      if (hp) { hh = +hp[3]; mm = hp[1] === 'half' ? 30 : 15; if (/^(?:to|before)$/.test(hp[2])) { mm = 60 - mm; hh = hh === 0 ? 23 : hh - 1; if (hh === 0 && !hp[4]) hh = 12; } ap = hp[4] ? hp[4].charAt(0).toLowerCase() : ''; clocked = true; }
      else {
        var PRE = '\\s(?:at\\s+about|at\\s+around|at|by|around|after|from)\\s+', SUF = '\\s*(a\\.?m\\.?|p\\.?m\\.?|o\'?clock|noon|midnight)';
        var ENDS = '(?=\\s*$|\\s+(?:to|and|then|for|please|tomorrow|today|tonight|on|every|this|next|in)\\b)';
        var tx = cut(new RegExp(PRE + '(\\d{1,2})(?:[:.h](\\d{2}))?(?:' + SUF + ')?(?=\\s)')) || cut(new RegExp(PRE + '(\\d{1,2})(\\d{2})(?:' + SUF + '(?=\\s)|' + ENDS + ')')) ||
          cut(new RegExp('\\s(\\d{1,2})(?::?(\\d{2}))?' + SUF + '(?=\\s)'));
        if (tx) {
          hh = +tx[1]; mm = +(tx[2] || 0); var suf = (tx[3] || '').toLowerCase(); clocked = true;
          ap = /^[ap]/.test(suf) ? suf.charAt(0) : '';
          if (suf === 'noon') { ap = 'x'; if (hh !== 12) return { ask: 'when', text: tidy(rest) }; }
          if (suf === 'midnight') { if (hh !== 12) return { ask: 'when', text: tidy(rest) }; hh = 0; ap = 'x'; endOfDay = true; }
          /* "at 00:30" and "at 0730" are on the 24-hour clock */
          if (/^0\d$/.test(tx[1]) && !ap) ap = 'x';
        } else {
          var nn = cut(/\s(?:(?:at|by|around)\s+)?(noon|midday|midnight|lunchtime)(?=\s)|\s(?:at|by)\s+(lunch)(?=\s)/);
          if (nn) { var w2 = (nn[1] || nn[2]).toLowerCase(); clocked = true; ap = 'x'; if (w2 === 'midnight') { hh = 0; endOfDay = true; } else hh = 12; mm = 0; }
        }
      }
    }
    /* the end of the day is 5pm; the end of the week is Friday at 5pm */
    var eod = cut(new RegExp('\\s(?:by\\s+|at\\s+)?(?:the\\s+)?(?:end\\s+of\\s+(?:the\\s+)?(?:work(?:ing)?\\s+|business\\s+)?day|eod|close\\s+of\\s+business)' + TERM, 'i'));
    if (eod && hh === null && !rel) { hh = 17; mm = 0; ap = 'x'; clocked = true; }
    var eow = cut(new RegExp('\\s(?:by\\s+|at\\s+)?(?:the\\s+)?end\\s+of\\s+(?:(the|this|next)\\s+)?week' + TERM, 'i'));
    if (eow) {
      /* next week's Friday: the Monday of this week, a week on, then Friday */
      if (eow[1] === 'next') { base.setDate(base.getDate() - (base.getDay() + 6) % 7 + 7); dayset = true; }
      if (wd < 0) { wd = 5; weekly = true; } if (hh === null && !rel) { hh = 17; mm = 0; ap = 'x'; clocked = true; }
    }
    /* dates: March 3, 3 March, the 3rd of March, on the 15th; not "the 4th chapter" or "a gift for the 25th" */
    var md = cutUnless(new RegExp('\\s(?:on\\s+)?(' + MON + ')\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?' + AFTER_DATE), TOPIC);
    var dm = md ? null : cutUnless(new RegExp('\\s(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + MON + ')\\.?(?:,?\\s+(\\d{4}))?' + AFTER_DATE), TOPIC);
    if (md || dm) {
      var mo = MONS.indexOf(String((md ? md[1] : dm[2])).slice(0, 3).toLowerCase()), dn = +(md ? md[2] : dm[1]), yr = +((md ? md[3] : dm[3]) || 0);
      var dd = new Date(yr || base.getFullYear(), mo, dn, 0, 0, 0, 0); if (dd.getMonth() !== mo || dn < 1) return { ask: 'when', text: tidy(rest) };
      if (!yr && dd.getTime() < new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()) dd.setFullYear(dd.getFullYear() + 1);
      base = dd; dayset = true;
    } else {
      var TH_AFTER = '(?=\\s*$|\\s+(?:at|by|around|to|in|and|from|for|starting|then)\\b|\\s+\\d|\\s*[,;]|\\s+of(?:\\s+(?:the|this|next)\\s+month)?' + TERM + ')';
      var th = cutUnless(new RegExp('\\s(?:on\\s+the|the)\\s+(\\d{1,2})(?:st|nd|rd|th)' + TH_AFTER), TOPIC);
      if (th) {
        /* "the 1st of next month" */
        var n3 = +th[1], ofNext = !!cut(/\s+of\s+next\s+month(?=\s)/), d3 = new Date(base); d3.setHours(0, 0, 0, 0); d3.setDate(1);
        if (n3 < 1 || n3 > 31) return { ask: 'when', text: tidy(rest) };
        if (ofNext) { d3 = new Date(now); d3.setHours(0, 0, 0, 0); d3.setDate(1); d3.setMonth(d3.getMonth() + 1); }
        else if (n3 < new Date(now).getDate() && !(nx && nx[1] === 'month')) d3.setMonth(d3.getMonth() + 1);
        if (n3 > daysIn(d3)) { d3.setMonth(d3.getMonth() + 1); if (n3 > daysIn(d3)) return { ask: 'when', text: tidy(rest) }; }
        d3.setDate(n3); base = d3; dayset = true; thN = n3; cut(/\s+of\s+(?:the|this)\s+month(?=\s)/);
      } else if (!repeat) {
        /* the end of the month: its last day */
        var eom = cut(new RegExp('\\s(?:by\\s+|at\\s+|on\\s+)?(?:the\\s+)?(last\\s+day|end)\\s+of\\s+(?:(the|this|next)\\s+)?month' + TERM, 'i'));
        if (eom) {
          var d5 = new Date(base); d5.setDate(1); if (eom[2] === 'next') d5.setMonth(d5.getMonth() + 1); d5.setDate(daysIn(d5)); base = d5; dayset = true; lastDay = true;
          if (hh === null && !rel && /^end/i.test(eom[1])) { hh = 17; mm = 0; ap = 'x'; clocked = true; }
        }
      }
    }
    /* the day after tomorrow; first thing (in the morning) */
    var dat = cut(new RegExp('\\s(?:on\\s+)?(?:the\\s+)?day\\s+after\\s+tomorrow(?:\\s+(morning|afternoon|evening|night))?' + TERM, 'i'));
    if (dat) { base.setDate(base.getDate() + 2); dayset = true; if (dat[1]) part = dat[1]; }
    if (cutUnless(/\sfirst\s+thing(?=\s)/, OWNER) && !part) part = 'morning';
    /* today, tonight, tomorrow (morning), this afternoon, in the morning, at night, this weekend */
    var dx = cut(/\s(today|tonight|tomorrow(?:\s+(morning|afternoon|evening|night))?|this\s+(morning|afternoon|evening)|in\s+the\s+(morning|afternoon|evening)|at\s+night)(?=\s)/);
    if (dx) {
      var w1 = dx[1].toLowerCase();
      if (/^tomorrow/.test(w1)) { base.setDate(base.getDate() + 1); dayset = true; part = dx[2] || part; }
      else if (w1 === 'today') { dayset = true; todayWord = true; }
      else if (w1 === 'tonight') { dayset = true; part = 'night'; }
      else if (dx[3]) { dayset = true; part = dx[3]; }
      else part = dx[4] || 'night';
    }
    var we = cut(/\s(?:this\s+|the\s+|next\s+)?weekend(?=\s)/);
    if (we) { var k2 = (6 - base.getDay() + 7) % 7; if (base.getDay() === 0) k2 = 0; if (/next/.test(we[0])) k2 += 7; base.setDate(base.getDate() + k2); dayset = true; }
    /* a day's name is a time only with on/next/this before it, a time after it, or at the start or end of the phrase:
       "remind me at 4 to prepare the Friday presentation" is about a presentation, "call Sam about Sunday" about Sunday */
    if (!weekly) {
      var DP = '(?:\\s+' + PART + ')?';
      var wx = cut(new RegExp('\\s(?:on\\s+|next\\s+|this\\s+coming\\s+|this\\s+|coming\\s+)(' + WD + ')' + DP + '(?=\\s)')) ||
        cut(new RegExp('^\\s+(' + WD + ')' + DP + '(?=\\s)')) || cutUnless(new RegExp('\\s(' + WD + ')' + DP + '\\s*$'), TOPIC) || cutUnless(new RegExp('\\s(' + WD + ')' + DP + '(?=\\s+(?:about|regarding|to)\\s)'), OWNER) ||
        (clocked ? null : cut(new RegExp('\\s(' + WD + ')' + DP + '(?=\\s+(?:at|by|around)\\s|\\s+\\d)')));
      if (wx) { wd = DAYS.indexOf(wx[1].toLowerCase()); if (wx[2]) part = wx[2]; }
    }

    /* "every weekday" with a weekend day's name: the weekdays win. "The first Monday of every month" is not one I can keep */
    if (repeat === 'weekday' && (wd === 0 || wd === 6)) { base.setDate(base.getDate() + (wd - base.getDay() + 7) % 7); dayset = true; wd = -1; }
    if (repeat === 'month' && (wd >= 0 || new RegExp('\\b(?:first|second|third|fourth|last)\\s+(?:' + WD + ')\\b').test(lc))) return { ask: 'repeat', text: tidy(rest) };
    var text = tidy(rest);
    if (wake && text === 'Reminder') text = 'Wake up';
    /* "wake me up at 7" is the morning */
    if (wake && !part && ap !== 'p') part = 'morning';
    /* "remind me about the dentist (tomorrow)" may be a question; with a clock time it is a reminder */
    if ((conn === 'of' || conn === 'about') && !clocked) return null;
    if (!got) return { ask: 'when', text: text };
    var at, d, anchored = dayset || wd >= 0 || !!part, alsoDom = null;
    if (every && every % DAY !== 0 && hh === null && !anchored) at = now + (rel || every);
    else if (rel && (!every || !anchored)) at = now + rel;
    else {
      if (hh !== null && (hh > 23 || mm > 59)) return { ask: 'when', text: text };
      if (hh !== null) {
        if (ap === 'p' && hh < 12) hh += 12; if (ap === 'a' && hh === 12) hh = 0;
        if (!ap && hh >= 1 && hh <= 12) {
          if (part === 'night' || part === 'evening') { if (hh === 12) { hh = 0; endOfDay = true; } else if (part === 'night' && hh <= 4) early = true; else hh += 12; }
          else if (part === 'afternoon') { if (hh < 12) hh += 12; }
          else if (part === 'morning') { if (hh === 12) hh = 0; }
          else if ((dayset && !todayWord) || wd >= 0 || repeat || every) { if (hh < 7) hh += 12; }
          else ap = 'n';   /* today, nothing else said: the next one coming */
        }
      } else if (part) hh = PART_H[part];
      else if (endWord) hh = 17;
      else if (dayset || repeat || wd >= 0 || every) hh = 9;
      else return (conn === 'of' || conn === 'about') ? null : { ask: 'when', text: text };
      if (ap === 'n') {
        var nowD = new Date(now), c1 = new Date(now); c1.setHours(hh === 12 ? 12 : hh, mm, 0, 0);
        if (hh === 12) { d = c1.getTime() > now ? c1 : new Date(new Date(now).setHours(24, mm, 0, 0)); }
        else if (hh <= 6) { if (nowD.getHours() < 7 && c1.getTime() > now) d = c1; else { d = new Date(now); d.setHours(hh + 12, mm, 0, 0); if (d.getTime() <= now) d.setDate(d.getDate() + 1); } }
        else if (c1.getTime() > now) d = c1;
        else { d = new Date(now); d.setHours(hh + 12, mm, 0, 0); if (d.getTime() <= now) { d = new Date(c1); d.setDate(d.getDate() + 1); } }
        /* "today at 9" said at 10 at night: not tomorrow */
        if (todayWord && new Date(d).toDateString() !== nowD.toDateString()) return { ask: 'when', text: text, past: true };
        if (every) { for (var g1 = 0; g1 < 10000 && d.getTime() <= now; g1++) d = every % DAY ? new Date(d.getTime() + every) : new Date(d.getFullYear(), d.getMonth(), d.getDate() + every / DAY, d.getHours(), d.getMinutes()); }
      } else if (repeat === 'month') {
        /* the day asked for (or the date said, or today's), this month or the next one that is still ahead */
        var dom1 = monthDom || thN || (dayset ? base.getDate() : new Date(now).getDate()), m1 = new Date(dayset ? base : now); m1.setDate(1); m1.setHours(0, 0, 0, 0);
        var nextOn = function (dom) { var x; for (var g5 = 0; g5 < 14; g5++) { x = new Date(m1.getFullYear(), m1.getMonth() + g5, 1); x.setDate(Math.min(dom, daysIn(x))); x.setHours(hh, mm, 0, 0); if (x.getTime() > now) break; } return x; };
        d = nextOn(dom1); monthDom = dom1;
        if (monthDom2) { also = [nextOn(monthDom2).getTime()]; alsoDom = [monthDom2]; }
      } else {
        d = new Date(base); d.setHours(hh, mm, 0, 0);
        if (endOfDay || early) d.setDate(d.getDate() + 1);
        if (wd >= 0) { d.setDate(d.getDate() + (wd - new Date(base).getDay() + 7) % 7); if (d.getTime() <= now && (!every || every % (7 * DAY) === 0)) d.setDate(d.getDate() + 7); }
        else if (repeat === 'weekday') { for (var g = 0; g < 9 && (d.getTime() <= now || d.getDay() === 0 || d.getDay() === 6); g++) d.setDate(d.getDate() + 1); }
        /* "every 2 hours starting at 9", "every 3 days from Monday": the next time in that series */
        if (every) { for (var g0 = 0; g0 < 10000 && d.getTime() <= now; g0++) d = every % DAY ? new Date(d.getTime() + every) : new Date(d.getFullYear(), d.getMonth(), d.getDate() + every / DAY, d.getHours(), d.getMinutes()); }
        else if (d.getTime() <= now) {
          /* "on the 12th" said on the 12th after the time: the next month that has that day */
          if (thN) { var d4 = new Date(d); for (var g2 = 0; g2 < 13; g2++) { d4.setDate(1); d4.setMonth(d4.getMonth() + 1); if (thN <= daysIn(d4)) { d4.setDate(thN); d4.setHours(hh, mm, 0, 0); if (d4.getTime() > now) { d = d4; break; } } } }
          if (d.getTime() <= now && lastDay) { var d6 = new Date(d); d6.setDate(1); d6.setMonth(d6.getMonth() + 1); d6.setDate(daysIn(d6)); d = d6; }
          if (d.getTime() <= now) { if (dayset && !repeat) return { ask: 'when', text: text, past: true }; d.setDate(d.getDate() + 1); }
        }
      }
      at = d.getTime();
    }
    if (!(at > now + 999)) return { ask: 'when', text: text, past: true };
    if (at - now > AHEAD) return { ask: 'when', text: text, far: true };
    var out = { at: at, text: text };
    if (every) out.repeat = every; else if (repeat) out.repeat = repeat;
    if (repeat === 'month') out.dom = monthDom;
    /* the other days of "every Monday and Wednesday", at the same time */
    if (alsoDom) { out.also = also; out.alsoDom = alsoDom; }
    else if (also.length) out.also = also.map(function (w) { var x = new Date(at); x.setDate(x.getDate() + (w - x.getDay() + 7) % 7); if (x.getTime() <= now) x.setDate(x.getDate() + 7); return x.getTime(); });
    return out;
  }
  function tidy(s) {
    var x = String(s || '').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < 4; i++) x = x.replace(/^(?:or so|or thereabouts|to|that|about|for|and|then|of|please|so|starting|beginning)\b\s*/i, '').replace(/\s*\b(?:please|sir|jarvis|starting|from now)$/i, '').replace(/,\s*(?:thanks|thank you)$/i, '').replace(/^[\s,;:\-]+|[\s,;:\-]+$/g, '');
    return x ? x.charAt(0).toUpperCase() + x.slice(1) : 'Reminder';
  }

  /* ---------------------------------------------------------------- the words Jarvis answers to */
  function lower(s) { return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function failed() {
    return lastErr === 'full' ? { say: 'You have ' + MAX + ' reminders waiting, sir. Cancel some first.', show: 'You have ' + MAX + ' reminders waiting. Cancel some in the Calendar panel first.', open: 'cal' }
      : { say: 'I could not keep that reminder on this device, sir.', show: 'The reminder could not be saved: this browser\'s storage for Jarvis is full or blocked.' };
  }
  function set(r) {
    /* "remind me again in 10 minutes" just after one went off: that one again */
    var lf = recentFired(), text = r.text === 'Reminder' && lf ? lf.text : r.text;
    var rem = add(r.at, text, r.repeat, r.dom); if (!rem) return failed();
    var more = (r.also || []).map(function (at2, i) { return add(at2, text, r.repeat, r.alsoDom ? r.alsoDom[i] : undefined); }).filter(Boolean);
    var w = describe(rem, Date.now()) + more.map(function (m) { return ' and ' + describe(m, Date.now()).replace(/^every (?:month )?/, ''); }).join('');
    return { say: 'I will remind you ' + w + ', sir.', show: (rem.text === 'Reminder' ? 'Reminder set for ' + w : 'Reminder: ' + rem.text + ', ' + w) + '. I chime and say it here while Jarvis is open.', remind: rem, remindMore: more };
  }
  function asks(r) {
    askFor = { text: r.text || 'Reminder', t: Date.now() };
    var what = r.text && r.text !== 'Reminder' ? ' to ' + lower(r.text) : '';
    if (r.ask === 'often') { askFor = null; return { say: 'The most often I can repeat a reminder is every 5 minutes, sir.', show: 'The most often a reminder can repeat is every 5 minutes.' }; }
    if (r.ask === 'repeat') { askFor = null; return { say: 'I can repeat a reminder every day, every weekday, on chosen days each week, every other week, on a day each month, every few days, or every few minutes or hours, sir. Not yearly, and not the first Monday of a month, yet.', show: 'Reminders repeat every day, every weekday, on chosen days each week (every Monday and Wednesday), every 2 to 4 weeks (every other Friday), on a day each month (the 1st of every month), every 2 to 7 days, or every few minutes or hours. Not yearly, and not the first Monday of a month, yet.' }; }
    if (r.far) return { say: 'I can only set reminders up to a year ahead, sir. When should I remind you?', show: 'Reminders go up to a year ahead. When should I remind you' + what + '?' };
    if (r.past) return { say: 'That time has passed, sir. When should I remind you?', show: 'That time has passed. When should I remind you' + what + '?' };
    return { say: 'When should I remind you, sir?', show: 'When should I remind you' + what + '? Say a time, like "at 3pm", "in 20 minutes" or "tomorrow at 9".' };
  }
  function cancelled(rs) { return { say: rs.length === 1 ? 'Cancelled the reminder to ' + lower(rs[0].text) + ', sir.' : rs.length + ' reminders cancelled, sir.', show: rs.length === 1 ? 'Cancelled: ' + rs[0].text + ', ' + describe(rs[0], Date.now()) + '.' : 'Cancelled ' + rs.length + ' reminders.', undoRemind: rs }; }
  function which(rs) { return { say: 'Which one, sir? ' + rs.length + ' reminders match.', show: 'Which one? Say "cancel the reminder to" and its words.\n' + rs.map(function (r) { return '- ' + r.text + ', ' + describe(r, Date.now()); }).join('\n'), open: 'cal' }; }
  function cancelOne(rs, none) { return !rs.length ? none : rs.length > 1 ? which(rs) : (cancel(rs[0].id), cancelled([rs[0]])); }
  function waiting() { return !!askFor && Date.now() - askFor.t < 180000; }
  function dropAsk() { askFor = null; }
  function instant(raw) {
    var t = String(raw || ''); if (t.length > 300) return null;
    t = t.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
    var lc = t.toLowerCase().replace(/[.!?]+$/, '').replace(/^(?:(?:hey |ok |okay )?(?:jarvis|kin)[,!.]? )/, '').replace(/,? (?:jarvis|sir)$/, '').replace(/,? please$/, '').trim();
    for (var p0 = 0; p0 < 3; p0++) lc = lc.replace(/^(?:please|can you|could you|would you|will you)[,]? /, '');
    /* the answer to "When should I remind you?": only the very next message, for three minutes */
    var asked = waiting() ? askFor : null; askFor = null;
    if (asked) {
      if (/^(?:no|nope|never ?mind|cancel(?: it| that)?|forget it|don't bother|no thanks|no thank you)$/.test(lc)) return { say: 'Very well, sir.', show: 'No reminder set.' };
      var a2 = Kin.mind && Kin.mind.numify ? Kin.mind.numify(lc) : lc;
      if (/^\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|a\.m\.|p\.m\.))?$/.test(a2)) a2 = 'at ' + a2;
      else if (new RegExp('^' + N + '\\s*' + UNIT + '(?:\\s+and\\s+a\\s+half)?$').test(a2)) a2 = 'in ' + a2;
      var f = parse('remind me ' + a2, Date.now());
      if (f && f.at && f.text === 'Reminder') { f.text = asked.text; return set(f); }
      if (f && f.ask && f.text === 'Reminder') { askFor = asked; return asks({ ask: f.ask, past: f.past, far: f.far, text: asked.text }); }
    }
    /* "snooze", "snooze it for 20 minutes": the one that just went off */
    var sz = /^snooze(?: it| that| this| the reminder)?(?: for)?(?: (\d+|an?|half an?) (minutes?|mins?|hours?|hrs?))?$/.exec(Kin.mind && Kin.mind.numify ? Kin.mind.numify(lc) : lc);
    if (sz) {
      var lf = recentFired(); if (!lf) return { say: 'Nothing has just gone off to snooze, sir.', show: 'No reminder has gone off in the last 15 minutes.' };
      var mins = sz[1] ? Math.round(amount(sz[1]) * unitMs(sz[2]) / 60000) : 10, s2 = snooze(lf.id, mins, lf.text);
      return s2 ? { say: 'Snoozed until ' + clock(new Date(s2.at)) + ', sir.', show: 'Snoozed: ' + s2.text + ', until ' + clock(new Date(s2.at)) + '.' } : failed();
    }
    /* what is waiting: all, today's, tomorrow's, or the next one */
    var ls = /^(?:(?:what are|what're|show|list|show me|read me|tell me|give me|read|open|see|view)(?: all)?(?: of)? (?:my |the )?(?:(today's|tomorrow's) )?reminders(?: (?:for )?(today|tomorrow|this week))?|(?:do i have )?any reminders(?: (?:for )?(today|tomorrow|this week))?|what reminders do i have(?: (?:for )?(today|tomorrow|this week))?|(?:my )?reminders(?: (?:for )?(today|tomorrow|this week))?|(when|what)(?:'s| is) my next reminder)$/.exec(lc);
    if (ls) {
      var now = Date.now(), dw = (ls[1] || ls[2] || ls[3] || ls[4] || ls[5] || '').replace(/'s$/, ''), p = pending(), mid = new Date(now); mid.setHours(0, 0, 0, 0);
      if (dw) { var off = dw === 'tomorrow' ? 1 : 0, from = new Date(mid); from.setDate(from.getDate() + off); var to = new Date(from); to.setDate(to.getDate() + (dw === 'this week' ? 7 - mid.getDay() || 7 : 1)); p = p.filter(function (r) { return r.at >= (dw === 'this week' ? now - 60000 : from.getTime()) && r.at < to.getTime(); }); }
      if (ls[6]) p = p.slice(0, 1);
      var span0 = dw ? ' ' + dw : '';
      if (!p.length) return { say: dw ? 'No reminders' + span0 + ', sir.' : 'You have no reminders, sir.', show: dw ? 'No reminders' + span0 + '.' : 'No reminders. Say "remind me at 3pm to call Sam".', open: 'cal' };
      if (ls[6]) return { say: 'Your next reminder, sir: ' + p[0].text + ', ' + describe(p[0], now) + '.', show: 'Next: ' + p[0].text + ', ' + describe(p[0], now) + '.', open: 'cal' };
      return { say: p.length === 1 ? 'One reminder' + span0 + ', sir: ' + p[0].text + ', ' + describe(p[0], now) + '.' : p.length + ' reminders' + span0 + ', sir. The next: ' + p[0].text + ', ' + describe(p[0], now) + '.',
        show: p.map(function (r) { return '- ' + r.text + ', ' + describe(r, now); }).join('\n'), open: 'cal' };
    }
    if (/^(?:cancel|clear|delete|remove|stop)(?: all)?(?: of)? (?:my |the )?reminders$/.test(lc)) {
      var all = pending(); all.forEach(function (r) { cancel(r.id); });
      return all.length ? cancelled(all) : { say: 'You have no reminders to cancel, sir.', show: 'No reminders.' };
    }
    /* "cancel that reminder": the one that just went off (if it repeats) or the one just set, whichever was last */
    var cl = /^(?:cancel|delete|remove|undo|forget|scrap|drop)(?: (that|the last|my last|this|the|my))? reminder$/.exec(lc);
    if (cl) {
      var pall = pending(), newest = pall.slice().sort(function (x, y) { return (y.made || 0) - (x.made || 0); })[0], lf2 = recentFired(), fr = lf2 && lf2.repeat ? find(pall, lf2.id) : null;
      var target0 = fr && (!newest || lf2.at > (newest.made || 0)) ? fr : newest;
      /* plain "the reminder" with several waiting and nothing just set or just gone off: ask which */
      if ((cl[1] === 'the' || cl[1] === 'my' || !cl[1]) && pall.length > 1 && !fr && !(newest && Date.now() - (newest.made || 0) < RECENT)) return which(pall);
      if (!target0) return { say: 'You have no reminders, sir.', show: 'No reminders.' };
      cancel(target0.id); return cancelled([target0]);
    }
    /* "cancel the 4pm reminder", "cancel tomorrow's reminder" */
    var ct = /^(?:cancel|delete|remove|stop)(?: the| my)? ((?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)|today's|tomorrow's|tonight's|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)'s) reminders?$/.exec(lc);
    if (ct) return cancelOne(byWhen(ct[1].replace(/'s$/, '')) || [], { say: 'I have no reminder then, sir.', show: 'No reminder at ' + ct[1].replace(/'s$/, '') + '.' });
    /* "stop reminding me (to drink water)", "don't remind me to drink water any more", "no more reminders about the gym" */
    var st = /^(?:stop|quit) reminding me(?:\s+(?:to|about|of|that))?(?:\s+(.+?))?(?: any ?more| again)?$/.exec(lc) || /^(?:don't|do not) remind me(?:\s+(?:to|about|of|that))?\s+(.+?)(?: any ?more| again)?$/.exec(lc) || /^no more reminders(?:\s+(?:to|about|for|of))?\s+(.+)$/.exec(lc);
    if (st) {
      if (!st[1]) {
        var lf3 = recentFired();
        if (lf3 && !lf3.repeat) return { say: 'That one will not come back, sir.', show: 'That reminder was a one-off; it will not come back.' };
        var reps = pending().filter(function (r) { return r.repeat || r.every; }), tg = lf3 ? find(pending(), lf3.id) : reps.length === 1 ? reps[0] : null;
        if (!tg) return reps.length ? which(reps) : { say: 'Nothing is set to remind you again, sir.', show: 'No repeating reminders.' };
        cancel(tg.id); return cancelled([tg]);
      }
      var hit0 = findLoose(st[1]); if (!hit0) return { say: 'I have no reminder like that, sir.', show: 'No reminder matches "' + st[1] + '".' };
      cancel(hit0.id); return cancelled([hit0]);
    }
    /* "cancel the reminder to call Sam", "... at 3pm", "... for tomorrow", "... on Friday" */
    var cw = /^(?:cancel|delete|remove|forget|stop|turn off|scrap|drop|never ?mind)(?: the| my)? (.+?) reminder$/.exec(lc);
    if (cw && !/^(?:that|this|last|the last|my last)$/.test(cw[1])) { var hw = findLoose(cw[1]) || null; if (hw) { cancel(hw.id); return cancelled([hw]); } var bw0 = byWhen(cw[1]); if (bw0) return cancelOne(bw0, { say: 'I have no reminder then, sir.', show: 'No reminder matches "' + cw[1] + '".' }); }
    var c = /^(?:cancel|delete|remove|forget|stop|turn off|scrap|drop|never ?mind)(?: the| my)? reminder(?: to| about| for| that| of| at| on)? (.+)$/.exec(lc);
    if (c) {
      var hit = findLoose(c[1]); if (hit) { cancel(hit.id); return cancelled([hit]); }
      var bw = byWhen(c[1]); if (bw) return cancelOne(bw, { say: 'I have no reminder then, sir.', show: 'No reminder matches "' + c[1] + '".' });
      return { say: 'I have no reminder like that, sir.', show: 'No reminder matches "' + c[1] + '".' };
    }
    var r = parse(t);
    if (!r) return null;
    if (r.ask) return asks(r);
    return set(r);
  }

  Kin.remind = { instant: instant, parse: parse, waiting: waiting, dropAsk: dropAsk, list: list, pending: pending, add: add, done: done, snooze: snooze, cancel: cancel, restore: restore, find: findBy,
    onDue: onDue, check: check, describe: describe, when: when, today: today, error: function () { return lastErr; } };
})();
