/* weather-now.js: "what's the weather", "is it going to rain", "do I need an umbrella", "how cold is it",
   "weather tomorrow": answered from Open-Meteo for the saved place (the same forecast the brief and the chart tool
   use, chart.js), with no call to Claude. The forecast request carries only the place's rounded coordinates.
   Public surface (window.Kin.weatherNow): instant(text) -> { say, show, pending? } | null, words(forecast, ask) */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var LEAD = '^(?:(?:hey|ok|okay)\\s+)?(?:(?:jarvis|kin)[,!.]?\\s+)?(?:(?:please|can you|could you|tell me)\\s+)*';
  var WHEN = '(?:\\s+(today|now|outside|right now|out there|later|later today|this morning|this afternoon|this evening|tonight|tomorrow|for tomorrow|tomorrow morning|tomorrow afternoon|tomorrow evening|tomorrow night|in the morning|in the afternoon|in the evening))?';
  /* the hours a part of the day covers */
  var PARTS = { morning: [6, 12], afternoon: [12, 18], evening: [18, 22], night: [18, 24], tonight: [18, 24] };
  var TAIL = '(?:,?\\s+(?:jarvis|sir|please))?$';
  var RE = {
    general: new RegExp(LEAD + '(?:(?:what\'?s|what is|how\'?s|how is|what\'?s the|check the)\\s+(?:the\\s+)?(?:weather|forecast)(?:\\s+like)?|(?:the\\s+)?weather|(?:the\\s+)?forecast|weather report)' + WHEN + TAIL),
    temp: new RegExp(LEAD + '(?:(?:what\'?s|what is)\\s+the\\s+temperature|how\\s+(?:hot|cold|warm|chilly)\\s+is\\s+it|how\\s+(?:hot|cold|warm)\\s+will\\s+it\\s+(?:be|get))' + WHEN + TAIL),
    rain: new RegExp(LEAD + '(?:is\\s+it\\s+(?:going\\s+to|gonna)\\s+rain|will\\s+it\\s+rain|(?:is|will)\\s+there\\s+be\\s+rain|any\\s+rain|chance\\s+of\\s+rain|do\\s+i\\s+need\\s+(?:an?\\s+)?umbrella|should\\s+i\\s+(?:take|bring)\\s+(?:an?\\s+)?umbrella)' + WHEN + TAIL),
    coat: new RegExp(LEAD + '(?:do\\s+i\\s+need\\s+(?:an?\\s+)?(?:jacket|coat|sweater|jumper)|should\\s+i\\s+(?:wear|take|bring)\\s+(?:an?\\s+)?(?:jacket|coat|sweater|jumper))' + WHEN + TAIL)
  };
  /* the sky in words, from the WMO weather code (the brief board's own table when it is loaded) */
  function wmo(c) {
    if (Kin.briefBoard && Kin.briefBoard._wmo) return Kin.briefBoard._wmo(c).t;
    c = +c; return c === 0 ? 'Clear' : c === 1 ? 'Mostly clear' : c === 2 ? 'Partly cloudy' : c === 3 ? 'Overcast' : c === 45 || c === 48 ? 'Fog' : c >= 51 && c <= 57 ? 'Drizzle' : c >= 61 && c <= 67 ? (c >= 65 ? 'Heavy rain' : 'Rain') : c >= 71 && c <= 77 ? 'Snow' : c >= 80 && c <= 82 ? 'Showers' : c === 85 || c === 86 ? 'Snow showers' : c >= 95 ? 'Thunderstorms' : 'Cloudy';
  }
  function r0(x) { return Math.round(+x); }
  function hourName(t) { var h = +String(t).slice(11, 13); return (h % 12 || 12) + (h < 12 ? ' AM' : ' PM'); }
  /** the words for one answer, from the raw Open-Meteo forecast: { say, show } */
  function words(f, ask) {
    var j = f.raw, cur = j.current || {}, H = j.hourly || {}, D = j.daily || {}, unit = f.units === 'F' ? 'F' : 'C';
    var name = f.place && f.place.name && f.place.name !== 'Your location' ? ' in ' + f.place.name : '';
    /* "in the morning" said after noon is tomorrow morning */
    var nowH = String(cur.time || '').slice(0, 13), w = String(ask.when || ''), hNow = +nowH.slice(11, 13), tomorrow = /tomorrow/.test(w) || (w === 'in the morning' && hNow >= 12) || (w === 'in the afternoon' && hNow >= 18) || (w === 'in the evening' && hNow >= 22), di = tomorrow ? 1 : 0;
    var pk = /morning/.test(w) ? 'morning' : /afternoon/.test(w) ? 'afternoon' : /evening/.test(w) ? 'evening' : /night/.test(w) ? 'night' : '';
    var day = String((D.time || [])[di] || (cur.time || '')).slice(0, 10);
    var hi = (D.temperature_2m_max || [])[di], lo = (D.temperature_2m_min || [])[di];
    if (tomorrow && hi == null && lo == null) return { say: 'I have no forecast for tomorrow yet, sir.', show: 'Open-Meteo sent no forecast for tomorrow yet.' };
    /* the hours asked about: the rest of today, a part of the day ("this afternoon", "tomorrow morning"), or tomorrow.
       The chance of rain is the most of those hours, never a morning shower that has already passed */
    var span = pk ? PARTS[pk] : [0, 24], when = (tomorrow ? 'tomorrow' : pk === 'night' ? 'tonight' : pk ? 'this' : 'today') + (pk && pk !== 'night' ? ' ' + pk : pk === 'night' && tomorrow ? ' night' : '');
    var pick = function (a, b) { var out = []; (H.time || []).forEach(function (t, i) { var hh = +String(t).slice(11, 13); if (String(t).slice(0, 10) === day && hh >= a && hh < b && (tomorrow || String(t).slice(0, 13) >= nowH)) out.push({ t: t, p: (H.precipitation_probability || [])[i], c: (H.weather_code || [])[i], temp: (H.temperature_2m || [])[i] }); }); return out; };
    var hrs = pick(span[0], span[1]);
    /* "this morning" asked in the afternoon: the rest of today instead */
    if (!hrs.length && !tomorrow && pk) { hrs = pick(0, 24); when = 'the rest of today'; }
    var known = hrs.filter(function (x) { return x.p != null && isFinite(x.p); });
    var wet = known.filter(function (x) { return x.p >= 40; }), peak = known.reduce(function (a, x) { return a == null || x.p > a.p ? x : a; }, null);
    var pmax = peak ? peak.p : (!pk && (D.precipitation_probability_max || [])[di] != null && tomorrow ? (D.precipitation_probability_max || [])[di] : null);
    var rainLine = pmax == null ? 'Open-Meteo sent no chance of rain for ' + when + '.' : pmax >= 60 ? 'Rain is likely ' + when + (peak ? ', about ' + peak.p + ' percent around ' + hourName(peak.t) : '') + '.' : pmax >= 30 ? 'There is a ' + pmax + ' percent chance of rain ' + when + (peak && peak.p >= 30 ? ', most likely around ' + hourName(peak.t) : '') + '.' : 'No rain to speak of ' + when + (pmax > 0 ? ' (' + pmax + ' percent at most)' : '') + '.';
    var sky = tomorrow ? (hrs.length ? wmo(mode(hrs.map(function (x) { return x.c; }))) : '') : wmo(cur.weather_code);
    var say, show;
    if (ask.kind === 'rain') {
      say = (pmax == null ? 'I can\'t tell, sir. ' : pmax >= 60 ? 'Yes, sir. ' : pmax >= 30 ? 'Possibly, sir. ' : 'No, sir. ') + rainLine + (pmax >= 40 ? ' Take an umbrella.' : '');
      show = (tomorrow ? 'Tomorrow' : 'Today') + name + ': ' + rainLine + (wet.length ? ' Wettest hours: ' + wet.slice(0, 4).map(function (x) { return hourName(x.t) + ' ' + x.p + '%'; }).join(', ') + '.' : '');
    } else if (ask.kind === 'coat') {
      var feels = tomorrow ? lo : (cur.apparent_temperature != null ? cur.apparent_temperature : cur.temperature_2m), cold = unit === 'F' ? 60 : 15, chilly = unit === 'F' ? 68 : 20;
      say = (feels < cold ? 'Yes, sir. ' : feels < chilly ? 'A light one, sir. ' : 'No, sir. ') + (tomorrow ? 'Tomorrow runs from ' + r0(lo) + ' to ' + r0(hi) + ' degrees.' : 'It feels like ' + r0(feels) + ' degrees' + name + ', with a low of ' + r0(lo) + '.') + (pmax >= 40 ? ' ' + rainLine : '');
      show = say.replace(/^(Yes|No|A light one), sir\. /, '');
    } else if (tomorrow) {
      say = 'Tomorrow' + name + ': ' + (sky ? sky.toLowerCase() + ', ' : '') + 'a high of ' + r0(hi) + ' and a low of ' + r0(lo) + ' degrees. ' + rainLine;
      show = say;
    } else {
      var t = cur.temperature_2m;
      say = 'It\'s ' + r0(t) + ' degrees and ' + wmo(cur.weather_code).toLowerCase() + name + ', sir' + (ask.kind === 'temp' && cur.apparent_temperature != null && Math.abs(cur.apparent_temperature - t) >= 3 ? ', feeling like ' + r0(cur.apparent_temperature) : '') + '. ' + (hi != null ? 'High of ' + r0(hi) + ', low of ' + r0(lo) + '. ' : '') + rainLine;
      show = say.replace(', sir', '');
    }
    return { say: say.trim(), show: (show.trim() + ' (Open-Meteo, ' + unit + ')') };
  }
  function mode(a) { var n = {}, best = null; a.forEach(function (x) { n[x] = (n[x] || 0) + 1; if (best == null || n[x] > n[best]) best = x; }); return best; }
  function instant(raw) { try { return answer(raw); } catch (e) { return null; } }
  function answer(raw) {
    var t = String(raw || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '');
    if (!t || t.length > 90 || !Kin.chart || !Kin.chart.forecast) return null;
    var kind = '', m = null;
    ['rain', 'coat', 'temp', 'general'].some(function (k) { m = RE[k].exec(t); if (m) kind = k; return !!m; });
    if (!m) return null;
    if (!Kin.chart.place()) return { say: 'Tell me your town first, sir: Settings, Brief, then Weather. Or tap Use my location there.', show: 'No town is set for the weather yet. Settings, Brief, Weather: type your town or tap Use my location. The town name goes to Open-Meteo once, to find it; the forecast is then asked for by its coordinates.' };
    var ask = { kind: kind, when: m[1] || '' };
    return { say: '', show: 'Checking the forecast…', label: 'Weather', pending: Kin.chart.forecast().then(function (f) { return words(f, ask); }, function () { return { say: 'I could not reach the forecast just now, sir.', show: 'The forecast could not be reached just now (Open-Meteo). Try again in a minute.' }; }) };
  }
  Kin.weatherNow = { instant: instant, words: words };
})();
