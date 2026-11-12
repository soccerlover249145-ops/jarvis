/* quick.js: small things answered at once on this device, with no call to Claude.
   "flip a coin", "roll a die", "roll two dice", "roll a d20", "pick a number between 1 and 10",
   "start a stopwatch", "stop the stopwatch", "how long has the stopwatch been running", "reset the stopwatch",
   "how many days until Christmas", "how long until Friday", "what day is March 3", "what's the date in 3 weeks".
   Chance uses the browser's cryptographic random numbers. Dates are worked out here (the reminder parser reads the
   date words when it is loaded). Nothing is sent anywhere.
   Public surface (window.Kin.quick): instant(text) -> { say, show } | null, until(when, now) -> { at, label } | null */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var DAY = 864e5, SW = 'kin.sw';

  /* ---------------------------------------------------------------- chance */
  /** a whole number from lo to hi, both included, without bias */
  function rand(lo, hi) {
    var span = hi - lo + 1; if (!(span >= 1) || span > 4294967296) return lo;
    var c = window.crypto || window.msCrypto, lim = Math.floor(4294967296 / span) * span, x;
    if (!c || !c.getRandomValues) return lo + Math.floor(Math.random() * span);
    var a = new Uint32Array(1);
    for (var g = 0; g < 64; g++) { c.getRandomValues(a); x = a[0]; if (x < lim) return lo + (x % span); }
    return lo + (x % span);
  }
  var NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a_pair_of: 2 };
  function num(w) { w = String(w || '').toLowerCase().trim().replace(/\s+/g, '_'); return Object.prototype.hasOwnProperty.call(NUMW, w) ? NUMW[w] : /^\d+$/.test(w) ? +w : NaN; }
  function joinAnd(a) { return a.length <= 1 ? String(a[0]) : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  /* ---------------------------------------------------------------- the stopwatch (kept across a reload, and seen by other tabs) */
  var cur = null;
  function swLoad() { if (Kin.shared) return; try { var o = JSON.parse(localStorage.getItem(SW) || 'null'); cur = o && isFinite(o.start) && (!o.stop || isFinite(o.stop)) ? { start: +o.start, stop: o.stop ? +o.stop : 0 } : null; } catch (e) { cur = null; } }
  swLoad();
  try { window.addEventListener('storage', function (e) { if (e.key === SW) swLoad(); }); } catch (e) {}
  function sw() { return cur; }
  function swSet(o) { cur = o; if (Kin.shared) return; try { if (o) localStorage.setItem(SW, JSON.stringify(o)); else localStorage.removeItem(SW); } catch (e) {} }
  function span(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, out = [];
    if (h) out.push(h + (h === 1 ? ' hour' : ' hours')); if (m) out.push(m + (m === 1 ? ' minute' : ' minutes')); if (x || !out.length) out.push(x + (x === 1 ? ' second' : ' seconds'));
    return joinAnd(out);
  }
  function clockText(ms) { var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, p = function (n) { return ('0' + n).slice(-2); }; return (h ? h + ':' + p(m) : m) + ':' + p(x); }

  /* ---------------------------------------------------------------- dates */
  function startOf(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d; }
  function nthWeekday(y, mo, wd, n) { var d = new Date(y, mo, 1); d.setDate(1 + (wd - d.getDay() + 7) % 7 + (n - 1) * 7); return d; }
  function lastWeekday(y, mo, wd) { var d = new Date(y, mo + 1, 0); d.setDate(d.getDate() - (d.getDay() - wd + 7) % 7); return d; }
  function easter(y) { var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
  /* the days people count down to; the US dates where countries differ */
  var HOLI = [
    [/^(?:christmas(?: day)?|xmas)$/, 'Christmas', function (y) { return new Date(y, 11, 25); }],
    [/^christmas eve$/, 'Christmas Eve', function (y) { return new Date(y, 11, 24); }],
    [/^new year'?s eve$/, 'New Year’s Eve', function (y) { return new Date(y, 11, 31); }],
    [/^(?:new year'?s(?: day)?|the new year)$/, 'New Year’s Day', function (y) { return new Date(y, 0, 1); }],
    [/^(?:halloween)$/, 'Halloween', function (y) { return new Date(y, 9, 31); }],
    [/^(?:valentine'?s(?: day)?)$/, 'Valentine’s Day', function (y) { return new Date(y, 1, 14); }],
    [/^(?:the )?(?:4th|fourth) of july$|^independence day$/, 'the Fourth of July', function (y) { return new Date(y, 6, 4); }],
    [/^(?:st\.? |saint )?patrick'?s day$/, 'St Patrick’s Day', function (y) { return new Date(y, 2, 17); }],
    [/^thanksgiving(?: day)?$/, 'Thanksgiving', function (y) { return nthWeekday(y, 10, 4, 4); }],
    [/^easter(?: sunday)?$/, 'Easter', easter],
    [/^mother'?s day$/, 'Mother’s Day', function (y) { return nthWeekday(y, 4, 0, 2); }],
    [/^father'?s day$/, 'Father’s Day', function (y) { return nthWeekday(y, 5, 0, 3); }],
    [/^memorial day$/, 'Memorial Day', function (y) { return lastWeekday(y, 4, 1); }],
    [/^labou?r day$/, 'Labor Day', function (y) { return nthWeekday(y, 8, 1, 1); }]
  ];
  function dayName(d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
  /** "Christmas", "March 3", "the 25th", "next Friday", "Friday": the day it next falls (today counts), or null */
  function until(when, now) {
    now = typeof now === 'number' ? now : Date.now();
    var w = String(when || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[?.!]+$/, '').trim().replace(/^(?:the\s+)?(?=next|this|coming)/, '');
    if (!w) return null;
    var today = startOf(now), y = today.getFullYear();
    for (var i = 0; i < HOLI.length; i++) if (HOLI[i][0].test(w)) { var d = HOLI[i][2](y); if (d < today) d = HOLI[i][2](y + 1); return { at: d.getTime(), label: HOLI[i][1], named: true }; }
    if (/^(?:today|tonight)$/.test(w)) return { at: today.getTime(), label: 'today' };
    /* the end of the working day is 5pm, as for reminders */
    if (/^(?:the )?end of (?:the )?(?:work(?:ing)? |business )?day$|^eod$|^close of business$/.test(w)) { var e5 = new Date(today); e5.setHours(17, 0, 0, 0); return { at: today.getTime(), exact: e5.getTime(), label: '' }; }
    /* by the calendar, so a day when the clocks change is still one day */
    if (w === 'tomorrow') return { at: new Date(y, today.getMonth(), today.getDate() + 1).getTime(), label: 'tomorrow' };
    if (/^(?:the )?weekend$/.test(w)) { var s = new Date(today); if (s.getDay() !== 0) s.setDate(s.getDate() + (6 - s.getDay() + 7) % 7); return { at: s.getTime(), label: 'the weekend' }; }
    /* the reminder parser reads the rest: dates, "next Friday", "the 25th", "in 3 weeks" */
    if (!Kin.remind || !Kin.remind.parse) return null;
    /* a day with no clock time is counted from the start of today, so the answer does not change at 9 in the morning */
    var timed = TIMEISH.test(Kin.mind && Kin.mind.numify ? Kin.mind.numify(w) : w);
    var r = Kin.remind.parse('remind me ' + (/^(?:on|in|at|next|this|the|this coming)\b/.test(w) || /^\d/.test(w) && !/^\d+(?:st|nd|rd|th)?\s/.test(w) ? '' : 'on ') + w + ' to x', timed ? now : today.getTime());
    /* the whole phrase has to be the time: "how long to get to Boston by 5pm" is a question for Claude */
    if (!r || !isFinite(r.at) || r.repeat || r.also || !/^(?:on\s+)?(?:to\s+)?x$/i.test(String(r.text || ''))) return null;
    /* "March 3" said in November is next March: the parser already moves it on */
    return { at: startOf(r.at).getTime(), exact: r.at, label: '' };
  }
  function days(a, b) { return Math.round((startOf(b) - startOf(a)) / DAY); }
  function weeksText(n) { var w = Math.floor(n / 7), d = n % 7; return w + (w === 1 ? ' week' : ' weeks') + (d ? ' and ' + d + (d === 1 ? ' day' : ' days') : ''); }

  var TIMEISH = /\d\s*[ap]\.?\s?m\b|\d:\d\d|\b(?:noon|midnight|o'?clock|half past|quarter (?:past|to)|end of the (?:work ?)?day|eod)\b/i;
  /* ---------------------------------------------------------------- the words */
  var LEAD = /^(?:(?:hey|ok|okay)\s+)?(?:(?:jarvis|kin)[,!.]?\s+)?(?:(?:please|can you|could you|would you|will you|quickly)\s+)*/;
  function instant(raw) { try { return answer(raw); } catch (e) { return null; } }
  function answer(raw) {
    var t0 = String(raw || ''); if (!t0 || t0.length > 120) return null;
    var t = t0.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[?!.]+$/, '').replace(/,? (?:jarvis|sir|please)$/, '').replace(LEAD, '');
    var m;
    /* a coin */
    if (/^(?:flip|toss)(?: me)? a coin$|^heads or tails$|^coin (?:flip|toss)$/.test(t)) { var hd = rand(0, 1) === 0 ? 'Heads' : 'Tails'; return { say: hd + ', sir.', show: 'Coin: ' + hd + '.' }; }
    /* dice: "roll a die", "roll two dice", "roll 3d6", "roll a d20" */
    if ((m = /^roll(?: me)?(?: (a|an|one|two|three|four|five|six|a pair of|\d{1,2}))?(?: (?:six[- ]sided )?(?:dice|die)| ?d(\d{1,3}))$/.exec(t)) || (m = /^roll(?: me)? (\d{1,2})d(\d{1,3})$/.exec(t))) {
      var n = m[1] ? num(m[1].replace(/ /g, '_')) : 1, sides = m[2] ? +m[2] : 6;
      if (!(n >= 1 && n <= 10) || !(sides >= 2 && sides <= 1000)) return null;
      var rolls = []; for (var k = 0; k < n; k++) rolls.push(rand(1, sides));
      var sum = rolls.reduce(function (a, b) { return a + b; }, 0), what = sides === 6 ? (n === 1 ? 'a die' : n + ' dice') : (n === 1 ? 'a d' + sides : n + ' d' + sides + 's');
      return { say: n === 1 ? 'You rolled a ' + rolls[0] + ', sir.' : joinAnd(rolls) + ', sir. ' + sum + ' in all.', show: 'Rolled ' + what + ': ' + rolls.join(', ') + (n > 1 ? ' (total ' + sum + ')' : '') + '.' };
    }
    /* a number: "pick a number between 1 and 10", "random number from 1 to 100", "a random number up to 50" */
    if ((m = /^(?:pick|choose|give me|say|think of)? ?(?:a )?(?:random )?number (?:between|from) (-?\d{1,9}) (?:and|to) (-?\d{1,9})$/.exec(t)) || (m = /^(?:pick|choose|give me)? ?(?:a )?random number(?: (up to|to|under|below|less than) (\d{1,9}))?$/.exec(t))) {
      var two = /number (?:between|from)/.test(t), lo = two ? +m[1] : 1, hi = two ? +m[2] : (m[2] ? +m[2] - (/^(?:under|below|less than)$/.test(m[1]) ? 1 : 0) : 100);
      if (!two && hi < 1) return null;
      if (lo > hi) { var tmp = lo; lo = hi; hi = tmp; }
      var v = rand(lo, hi); return { say: v + ', sir.', show: 'A random number from ' + lo + ' to ' + hi + ': ' + v + '.' };
    }
    /* the stopwatch */
    if (/^(?:start|begin)(?: a| the| my)?(?: new)? stop ?watch$/.test(t)) { var cur = sw(); if (cur && !cur.stop) return { say: 'It is already running, sir: ' + span(Date.now() - cur.start) + '.', show: 'Stopwatch running: ' + clockText(Date.now() - cur.start) + '.' }; var was = cur && cur.stop ? cur.stop - cur.start : 0; swSet({ start: Date.now() }); return { say: was ? 'A new stopwatch, from zero, sir. The last one stopped at ' + span(was) + '.' : 'Stopwatch started, sir.', show: (was ? 'Started again from zero (the last one stopped at ' + clockText(was) + '). ' : 'Stopwatch started. ') + 'Say "stop the stopwatch" to stop it' + (was ? '' : ', or "resume the stopwatch" after a stop') + '.' }; }
    if (/^(?:resume|continue|unpause|restart)(?: the| my)? stop ?watch$/.test(t)) { var s0 = sw(); if (!s0) return { say: 'No stopwatch is running, sir.', show: 'No stopwatch is running. Say "start a stopwatch".' }; if (!s0.stop) return { say: 'It is already running, sir: ' + span(Date.now() - s0.start) + '.', show: 'Stopwatch running: ' + clockText(Date.now() - s0.start) + '.' }; swSet({ start: Date.now() - (s0.stop - s0.start) }); return { say: 'Carrying on from ' + span(s0.stop - s0.start) + ', sir.', show: 'Stopwatch carrying on from ' + clockText(s0.stop - s0.start) + '.' }; }
    if (/^(?:stop|pause|end)(?: the| my)? stop ?watch$/.test(t)) { var s1 = sw(); if (!s1) return { say: 'No stopwatch is running, sir.', show: 'No stopwatch is running. Say "start a stopwatch".' }; var el1 = (s1.stop || Date.now()) - s1.start; if (!s1.stop) swSet({ start: s1.start, stop: Date.now() }); return { say: span(el1) + ', sir.', show: 'Stopwatch: ' + clockText(el1) + '.' }; }
    if (/^(?:reset|clear)(?: the| my)? stop ?watch$/.test(t)) { swSet(null); return { say: 'Stopwatch cleared, sir.', show: 'Stopwatch cleared.' }; }
    if (/^(?:how long has the stop ?watch been (?:running|going)|(?:what's|what is|check)(?: on)? the stop ?watch|stop ?watch(?: time)?)$/.test(t)) { var s2 = sw(); if (!s2) return { say: 'No stopwatch is running, sir.', show: 'No stopwatch is running. Say "start a stopwatch".' }; var el2 = (s2.stop || Date.now()) - s2.start; return { say: (s2.stop ? 'Stopped at ' : '') + span(el2) + ', sir.', show: 'Stopwatch: ' + clockText(el2) + (s2.stop ? ' (stopped)' : '') + '.' }; }
    /* days until: "how many days until Christmas", "how long until Friday", "how many weeks until March 3" */
    if ((m = /^(?:how many (days|weeks|sleeps)(?: are there| is it| left| to go)?|how long(?: is it| is there)?) (?:until|till|til|to|before) (.{2,40})$/.exec(t)) || (m = /^(?:countdown|count down) to (.{2,40})$/.exec(t))) {
      var unit = m.length === 3 ? m[1] || '' : '', target = m.length === 3 ? m[2] : m[1];
      if (/\b(?:my|our|your|his|her|their|the launch|the meeting|the deadline|the trip|the wedding|the party)\b/.test(target) && !/^the (?:weekend|\d)/.test(target)) return null;
      var u = until(target); if (!u) return null;
      /* "how long until 5pm": hours and minutes */
      if (TIMEISH.test(Kin.mind && Kin.mind.numify ? Kin.mind.numify(target) : target) && u.exact) { var left = u.exact - Date.now(); if (!(left > 0) || left > 2 * DAY) return null; var at0 = new Date(u.exact).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); return { say: span(Math.round(left / 60000) * 60000) + ' until ' + at0 + ', sir.', show: span(Math.round(left / 60000) * 60000) + ' until ' + at0 + (days(Date.now(), u.exact) === 1 ? ' tomorrow' : '') + '.' }; }
      var n0 = days(Date.now(), u.at), when = new Date(u.at), lab = u.label || dayName(when);
      if (n0 === 0) return { say: 'That’s today, sir.', show: (u.label ? cap(u.label) + ' is ' : '') + 'Today, ' + dayName(when) + '.' };
      var say = unit === 'weeks' ? (n0 < 7 ? n0 + (n0 === 1 ? ' day' : ' days') : weeksText(n0)) : n0 + (n0 === 1 ? ' day' : ' days') + (unit !== 'days' && n0 >= 14 ? ' (' + weeksText(n0) + ')' : '');
      if (unit === 'sleeps') say = n0 + (n0 === 1 ? ' sleep' : ' sleeps');
      return { say: say.replace(/ \(.*\)$/, '') + ' until ' + lab + ', sir' + (u.label ? ', ' + dayName(when) : '') + '.', show: say + ' until ' + (u.label ? lab + ' (' + dayName(when) + ')' : lab) + '.', card: { kind: 'count', at: u.at, n: n0, unit: unit === 'sleeps' ? 'sleeps' : 'days', label: u.label ? lab : '' } };
    }
    /* which day: "what day is Christmas", "what day of the week is March 3", "what day does Thanksgiving fall on" */
    if ((m = /^what day (?:of the week )?(?:is|will be) (.{2,40})$/.exec(t)) || (m = /^what day (?:does|will) (.{2,40}) (?:fall on|be on|land on|be)$/.exec(t))) {
      if (/^(?:it|today|it today|tomorrow)$/.test(m[1])) return null;
      var u2 = until(m[1]); if (!u2) return null;
      var d2 = new Date(u2.at), wd = d2.toLocaleDateString(undefined, { weekday: 'long' });
      return { say: (u2.label ? cap(u2.label) : d2.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })) + ' is a ' + wd + ', sir' + (u2.named ? ', ' + d2.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : '') + '.', show: (u2.label ? cap(u2.label) + ': ' : '') + dayName(d2) + ', ' + d2.getFullYear() + '.' };
    }
    /* "what's the date in 3 weeks", "what date is 10 days from now", "what's the date next Friday" */
    if ((m = /^(?:what(?:'s| is) the date|what date is it|what date will it be|what date is) (in .{2,30}|.{2,30} from (?:now|today)|next .{2,20}|this .{2,20})$/.exec(t))) {
      var ph = m[1].replace(/ from (?:now|today)$/, '').replace(/^(?!in |next |this )/, 'in ');
      var u3 = until(ph); if (!u3) return null;
      var d3 = new Date(u3.at);
      return { say: 'It will be ' + dayName(d3) + ', sir.', show: dayName(d3) + ', ' + d3.getFullYear() + '.' };
    }
    return null;
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  Kin.quick = { instant: instant, until: until, rand: rand,
    /** { running, ms } or null: for the status line */
    stopwatch: function () { return cur ? { running: !cur.stop, ms: (cur.stop || Date.now()) - cur.start } : null; } };
})();
