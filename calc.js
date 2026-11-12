/* calc.js: sums, percentages, tips and unit conversions, answered at once on this device with no call to Claude.
   "what's 15% of 240", "what is 12 times 7", "1500 divided by 12", "square root of 144", "20% tip on 85",
   "convert 5 miles to km", "how many ounces in a pound", "72 fahrenheit in celsius", "3 cups in ml".
   The whole sentence has to be a sum or a conversion; anything else goes on to Claude as before. Dates, phone numbers,
   scores and fractions people say as names ("9/11", "24/7", "50/50", "1914-1918", "555-123-4567") are left alone.
   Nothing is evaluated as code: a small parser reads numbers and + - * / ^ and brackets only.
   Public surface (window.Kin.calc): instant(text) -> { say, show } | null, evaluate(expr) -> number | null, convert(n, from, to) */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};

  /* ---------------------------------------------------------------- arithmetic: a tiny parser, never eval */
  function evaluate(src) {
    var s = String(src || '').replace(/\s+/g, ''), i = 0;
    if (!s || s.length > 120 || /[^0-9.+\-*/^()]/.test(s)) return null;
    function num() { var m = /^\d+(?:\.\d+)?|^\.\d+/.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); }
    function atom() {
      if (s[i] === '(') { i++; var v = expr(); if (s[i] !== ')') throw 0; i++; return v; }
      return num();
    }
    /* -2^2 is -4 and 2^-1 is 0.5, as on a calculator */
    function pow() { var b = atom(); if (s[i] === '^') { i++; return Math.pow(b, unary()); } return b; }
    function unary() { if (s[i] === '-') { i++; return -unary(); } if (s[i] === '+') { i++; return unary(); } return pow(); }
    function term() { var v = unary(); while (s[i] === '*' || s[i] === '/') { var o = s[i++], r = unary(); v = o === '*' ? v * r : v / r; } return v; }
    function expr() { var v = term(); while (s[i] === '+' || s[i] === '-') { var o = s[i++], r = term(); v = o === '+' ? v + r : v - r; } return v; }
    try { var v = expr(); return i === s.length && isFinite(v) ? v : null; } catch (e) { return null; }
  }
  /* "12 times 7", "1,500 divided by 12", "2 to the power of 10", "5 squared" become "12*7", "1500/12", "2^10", "5^2" */
  function words2expr(t) {
    var x = ' ' + t.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1') + ' ';
    x = x.replace(/(\d)\s*x\s*(?=\d)/g, '$1*').replace(/\bmultiplied by\b|\btimes\b|×/g, '*').replace(/\bdivided by\b|÷/g, '/').replace(/\bplus\b/g, '+').replace(/\bminus\b|−/g, '-')
      .replace(/\bto the power of\b|\bto the\b|\braised to\b/g, '^').replace(/\bsquared\b/g, '^2').replace(/\bcubed\b/g, '^3')
      .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*/g, '$1*0.01*');
    return x.trim();
  }
  /* very large and very small numbers as a power of ten: "1.2346 × 10^21", said "1.2346 times ten to the power of 21" */
  function sci(v) { var p = v.toExponential(4).split('e'); return { mant: Number(p[0]), ex: Number(p[1]) }; }
  function huge(v) { var a = Math.abs(v); return a >= 1e15 || (a > 0 && a < 1e-6); }
  /* shown in the way this device writes numbers; said in English, the language Jarvis speaks */
  function fmtIn(v, loc) {
    if (!isFinite(v)) return '';
    if (huge(v)) { var s = sci(v); return s.mant.toLocaleString(loc, { maximumFractionDigits: 4 }) + ' × 10^' + s.ex; }
    /* small results keep three significant figures: 0.00000133, not 0.000001 */
    if (v !== 0 && Math.abs(v) < 1e-3) return v.toLocaleString(loc, { maximumSignificantDigits: 3 });
    return (Math.round(v * 1e6) / 1e6).toLocaleString(loc, { maximumFractionDigits: 6 });
  }
  function fmt(v) { return fmtIn(v, undefined); }
  function said(v) {
    if (!isFinite(v)) return '';
    if (huge(v)) { var s = sci(v); return s.mant.toLocaleString('en-US', { maximumFractionDigits: 4 }) + ' times ten to the power of ' + (s.ex < 0 ? 'minus ' + -s.ex : s.ex); }
    return fmtIn(v, 'en-US');
  }
  /* money: the cents always shown when there are any ("1,500.90", not "1,500.9") */
  function money(v, loc) { return Math.round(v * 100) % 100 === 0 ? fmtIn(Math.round(v), loc) : (Math.round(v * 100) / 100).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* ---------------------------------------------------------------- units */
  var U = {
    /* length, in metres */
    mm: ['length', 0.001, 'millimetres'], cm: ['length', 0.01, 'centimetres'], m: ['length', 1, 'metres'], km: ['length', 1000, 'kilometres'],
    in: ['length', 0.0254, 'inches'], ft: ['length', 0.3048, 'feet'], yd: ['length', 0.9144, 'yards'], mi: ['length', 1609.344, 'miles'], nmi: ['length', 1852, 'nautical miles'],
    /* mass, in grams */
    mg: ['mass', 0.001, 'milligrams'], g: ['mass', 1, 'grams'], kg: ['mass', 1000, 'kilograms'], oz: ['mass', 28.349523125, 'ounces'], lb: ['mass', 453.59237, 'pounds'], st: ['mass', 6350.29318, 'stone'], t: ['mass', 1e6, 'tonnes'],
    /* volume, in millilitres: cups, pints, quarts and gallons are the US measures unless "imperial" or "UK" is said */
    ml: ['volume', 1, 'millilitres'], l: ['volume', 1000, 'litres'], tsp: ['volume', 4.92892159375, 'teaspoons'], tbsp: ['volume', 14.78676478125, 'tablespoons'], floz: ['volume', 29.5735295625, 'US fluid ounces'],
    cup: ['volume', 236.5882365, 'US cups'], pt: ['volume', 473.176473, 'US pints'], qt: ['volume', 946.352946, 'US quarts'], gal: ['volume', 3785.411784, 'US gallons'],
    ukpt: ['volume', 568.26125, 'imperial pints'], ukgal: ['volume', 4546.09, 'imperial gallons'],
    /* speed, in metres per second */
    kmh: ['speed', 1 / 3.6, 'kilometres per hour'], mph: ['speed', 0.44704, 'miles per hour'], mps: ['speed', 1, 'metres per second'], kn: ['speed', 1852 / 3600, 'knots'],
    /* temperature: handled apart */
    c: ['temp', 0, 'degrees Celsius'], f: ['temp', 0, 'degrees Fahrenheit'], k: ['temp', 0, 'kelvin'],
    /* time, in seconds */
    sec: ['time', 1, 'seconds'], min: ['time', 60, 'minutes'], hr: ['time', 3600, 'hours'], day: ['time', 86400, 'days'], wk: ['time', 604800, 'weeks']
  };
  var NAMES = [
    ['mm', /^(?:mm|millimet(?:er|re)s?)$/], ['cm', /^(?:cm|centimet(?:er|re)s?)$/], ['km', /^(?:km|kms|kilomet(?:er|re)s?|kilo ?met(?:er|re)s?)$/], ['m', /^(?:m|met(?:er|re)s?)$/],
    ['in', /^(?:in|inch|inches|")$/], ['ft', /^(?:ft|foot|feet|')$/], ['yd', /^(?:yd|yds|yards?)$/], ['nmi', /^(?:nmi|nautical miles?)$/], ['mi', /^(?:mi|miles?)$/],
    ['mg', /^(?:mg|milligrams?)$/], ['kg', /^(?:kg|kgs|kilos?|kilograms?)$/], ['g', /^(?:g|grams?|gr)$/], ['oz', /^(?:oz|ounces?)$/], ['lb', /^(?:lb|lbs|pounds?)$/], ['st', /^(?:st|stones?)$/], ['t', /^(?:tonnes?|metric tons?)$/],
    ['ml', /^(?:ml|millilit(?:er|re)s?)$/], ['l', /^(?:l|lit(?:er|re)s?)$/], ['tsp', /^(?:tsp|teaspoons?)$/], ['tbsp', /^(?:tbsp|tablespoons?)$/], ['floz', /^(?:(?:us )?fl ?oz|(?:us )?fluid ounces?)$/],
    ['ukpt', /^(?:(?:imperial|uk|british) pints?)$/], ['ukgal', /^(?:(?:imperial|uk|british) gallons?)$/],
    ['cup', /^(?:(?:us )?cups?)$/], ['pt', /^(?:(?:us )?(?:pt|pints?))$/], ['qt', /^(?:(?:us )?(?:qt|quarts?))$/], ['gal', /^(?:(?:us )?(?:gal|gallons?))$/],
    ['kmh', /^(?:km\/h|kmh|kph|kilomet(?:er|re)s (?:per|an) hour)$/], ['mph', /^(?:mph|miles (?:per|an) hour)$/], ['mps', /^(?:m\/s|met(?:er|re)s per second)$/], ['kn', /^(?:knots?|kt|kts)$/],
    ['c', /^(?:c|°c|celsius|centigrade|degrees? c(?:elsius)?)$/], ['f', /^(?:f|°f|fahrenheit|degrees? f(?:ahrenheit)?)$/], ['k', /^(?:kelvin)$/],
    ['sec', /^(?:s|secs?|seconds?)$/], ['min', /^(?:mins?|minutes?)$/], ['hr', /^(?:h|hrs?|hours?)$/], ['day', /^(?:days?)$/], ['wk', /^(?:wks?|weeks?)$/]
  ];
  function unit(w) { w = String(w || '').toLowerCase().trim().replace(/\.$/, ''); for (var i = 0; i < NAMES.length; i++) if (NAMES[i][1].test(w)) return NAMES[i][0]; return ''; }
  function convert(n, from, to) {
    var a = U[from], b = U[to]; if (!a || !b || a[0] !== b[0]) return null;
    if (a[0] === 'temp') { var c = from === 'c' ? n : from === 'f' ? (n - 32) * 5 / 9 : n - 273.15; return to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15; }
    return n * a[1] / b[1];
  }
  /* "1 mile", "2 miles", "1 degree Celsius", "1 US cup", "1 foot" */
  function label(u, v) {
    var nm = U[u][2]; if (Math.abs(v) !== 1 || u === 'k' || u === 'st') return nm;
    if (U[u][0] === 'temp') return nm.replace(/^degrees/, 'degree');
    if (/ per /.test(nm)) return nm.replace(/s(?= per )/, '');
    return nm === 'inches' ? 'inch' : nm === 'feet' ? 'foot' : nm.replace(/s$/, '');
  }
  function round(v) { var a = Math.abs(v); return a >= 100 ? Math.round(v * 10) / 10 : a >= 1 ? Math.round(v * 100) / 100 : Number(v.toPrecision(3)); }
  function cents(v) { return Math.round(v * 100) / 100; }
  /* "an 8 percent tip", "an 18 percent tip", "a 15 percent tip" */
  function an(n) { var ip = Math.floor(Math.abs(n)); return /^8/.test(String(ip)) || ip === 11 || ip === 18 ? 'An' : 'A'; }

  /* ---------------------------------------------------------------- the words Jarvis answers to */
  var LEAD = /^(?:(?:hey|ok|okay)\s+)?(?:(?:jarvis|kin)[,!.]?\s+)?(?:(?:please|can you|could you|quickly)\s+)*(?:(?:what'?s|what is|whats|calculate|compute|work out|how much is|tell me)\s+)?/;
  /* an amount: 85, 64.50, 1,250 or 1,250.75 (a comma only between thousands: "64,50" is not read as 6450) */
  var AMT = '\\$?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  var PCT = '(\\d+(?:\\.\\d+)?)\\s*(?:%|percent)';
  var TIP1 = new RegExp('^(?:(?:an?|the)\\s+)?(?:tip\\s+of\\s+' + PCT + '|' + PCT + '\\s+tip)\\s+(?:on|for)\\s+' + AMT + '$');
  var TIP2 = new RegExp('^(?:(?:an?|the)\\s+)?tip\\s+(?:on|for)\\s+' + AMT + '\\s+at\\s+' + PCT + '$');
  function instant(raw) { try { return answer(raw); } catch (e) { return null; } }
  function answer(raw) {
    /* the length first: nothing long is read at all */
    var t = String(raw || ''); if (!t || t.length > 160) return null;
    t = t.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[?!]+$/, '').replace(/\.$/, '').replace(/,? (?:jarvis|sir|please)$/, '');
    if (!t || t.length > 120) return null;
    t = t.replace(LEAD, '');
    var m;
    /* a tip: "20% tip on 85", "tip of 18 percent on 64.50", "what's a 15 percent tip on 40", "the tip on 85 at 20%" */
    if ((m = TIP1.exec(t)) || (m = TIP2.exec(t))) {
      var pct = +(m.length === 4 ? m[1] || m[2] : m[2]), amt = +(m.length === 4 ? m[3] : m[1]).replace(/,/g, ''), tip = amt * pct / 100;
      if (!(amt > 0) || !(pct > 0) || pct > 100) return null;
      return { say: an(pct) + ' ' + said(pct) + ' percent tip on ' + money(amt, 'en-US') + ' is ' + money(tip, 'en-US') + ', sir, so ' + money(amt + tip, 'en-US') + ' in all.', show: fmt(pct) + '% tip on ' + money(amt) + ': ' + money(tip) + ' (total ' + money(amt + tip) + ')', card: { kind: 'calc', big: money(tip), sub: fmt(pct) + '% tip on ' + money(amt), extra: 'Total ' + money(amt + tip), copy: (+tip).toFixed(2) } };
    }
    /* conversions: "convert 5 miles to km", "5 miles in km", "how many ounces in a pound", "72 f in c" */
    var cv = /^(?:convert\s+)?(-?\d+(?:\.\d+)?|an?|one)\s*([a-z°"' /.]+?)\s+(?:to|in|into|as)\s+([a-z°"' /.]+)$/.exec(t) || (function () { var h = /^how many\s+([a-z°"' /.]+?)\s+(?:are\s+)?(?:in|to)\s+(?:an?|one|(-?\d+(?:\.\d+)?))\s+([a-z°"' /.]+)$/.exec(t); return h ? [h[0], h[2] || '1', h[3], h[1]] : null; })();
    if (cv) {
      var n = /^(?:an?|one)$/.test(cv[1]) ? 1 : +cv[1], from = unit(cv[2]), to = unit(cv[3]);
      if (from && to && from !== to) {
        var v = convert(n, from, to); if (v == null) return null;
        var vr = round(v), fl = label(from, n), tl = label(to, vr);
        return { say: said(n) + ' ' + fl + ' is ' + said(vr) + ' ' + tl + ', sir.', show: fmt(n) + ' ' + fl + ' = ' + fmt(vr) + ' ' + tl, card: { kind: 'calc', big: fmt(vr) + ' ' + tl, sub: fmt(n) + ' ' + fl, copy: String(+(+vr).toPrecision(15)) } };
      }
      return null;
    }
    /* "square root of 144" */
    if ((m = /^(?:the\s+)?square root of\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)$/.exec(t))) { var sq = +m[1].replace(/,/g, ''); if (sq < 0) return null; var r0 = Math.sqrt(sq); return { say: 'The square root of ' + said(sq) + ' is ' + said(round(r0)) + ', sir.', show: '√' + fmt(sq) + ' = ' + fmt(round(r0)), card: { kind: 'calc', big: fmt(round(r0)), sub: '√' + fmt(sq), copy: String(+(+r0).toPrecision(15)) } }; }
    /* sums: only digits and operators once the words are swapped */
    if (/\b0x[0-9a-f]/.test(t)) return null;
    var e = words2expr(t);
    if (!/\d/.test(e) || !/[+\-*/^]/.test(e.replace(/^-/, '')) || /[a-z,]/.test(e)) return null;
    /* not a phone number, a date, a year range, a score or digits said apart ("+44 20 7946", "11/12/2026", "1914-1918", "007") */
    var e0 = e.replace(/\s+/g, '');
    if (/^\+/.test(e) || /\d\s+\.?\d/.test(e) || /(^|[^\d.])0\d/.test(e) || /^\d{1,2}([\/-])\d{1,2}\1\d{2,4}$|^\d{4}-\d{1,2}-\d{1,2}$|^\d{3}-\d{3,4}(?:-\d{4})?$|^\d+(?:-\d+){2,}$/.test(e0) || /^\d{4}-\d{2,4}$/.test(e)) return null;
    if (/^(?:9\/11|24\/7|50\/50|365\/24\/7|4\/20|7\/11)$/.test(e0)) return null;
    var val = evaluate(e); if (val == null) return null;
    var shown = e.replace(/\s+/g, '').replace(/\*0\.01\*/g, '\u0001').replace(/(\d|\))-/g, '$1\u0002').replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\+/g, ' + ').replace(/\u0002/g, ' − ').replace(/\u0001/g, '% of ').replace(/\s+/g, ' ').trim();
    return { say: 'That is ' + said(val) + ', sir.', show: shown + ' = ' + fmt(val), card: { kind: 'calc', big: fmt(val), sub: shown, copy: String(+(+val).toPrecision(15)) } };
  }
  Kin.calc = { instant: instant, evaluate: evaluate, convert: convert, unit: unit };
})();
