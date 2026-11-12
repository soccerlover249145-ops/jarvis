/* clock.js: the time and the date, here and in other cities, answered at once on this device with no call to Claude.
   "what time is it", "what's the date", "what day is it", "what time is it in Tokyo", "time in London".
   Public surface (window.Kin.clock): instant(text) -> { say, show } | null, zone(place) -> IANA name | '' */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var Z = {
    'new york': 'America/New_York', nyc: 'America/New_York', boston: 'America/New_York', miami: 'America/New_York', atlanta: 'America/New_York', washington: 'America/New_York', 'washington dc': 'America/New_York', dc: 'America/New_York', philadelphia: 'America/New_York', florida: 'America/New_York', 'east coast': 'America/New_York', toronto: 'America/Toronto', montreal: 'America/Toronto', detroit: 'America/Detroit',
    chicago: 'America/Chicago', texas: 'America/Chicago', dallas: 'America/Chicago', houston: 'America/Chicago', austin: 'America/Chicago', 'new orleans': 'America/Chicago', minneapolis: 'America/Chicago', 'mexico city': 'America/Mexico_City', mexico: 'America/Mexico_City',
    denver: 'America/Denver', colorado: 'America/Denver', utah: 'America/Denver', 'salt lake city': 'America/Denver', phoenix: 'America/Phoenix', arizona: 'America/Phoenix',
    'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles', seattle: 'America/Los_Angeles', portland: 'America/Los_Angeles', 'las vegas': 'America/Los_Angeles', 'san diego': 'America/Los_Angeles', california: 'America/Los_Angeles', 'west coast': 'America/Los_Angeles', vancouver: 'America/Vancouver',
    anchorage: 'America/Anchorage', alaska: 'America/Anchorage', honolulu: 'Pacific/Honolulu', hawaii: 'Pacific/Honolulu',
    'sao paulo': 'America/Sao_Paulo', 'são paulo': 'America/Sao_Paulo', 'rio de janeiro': 'America/Sao_Paulo', brazil: 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires', argentina: 'America/Argentina/Buenos_Aires', santiago: 'America/Santiago', lima: 'America/Lima', bogota: 'America/Bogota',
    london: 'Europe/London', uk: 'Europe/London', england: 'Europe/London', britain: 'Europe/London', edinburgh: 'Europe/London', manchester: 'Europe/London', dublin: 'Europe/Dublin', ireland: 'Europe/Dublin', lisbon: 'Europe/Lisbon', portugal: 'Europe/Lisbon',
    paris: 'Europe/Paris', france: 'Europe/Paris', berlin: 'Europe/Berlin', germany: 'Europe/Berlin', munich: 'Europe/Berlin', madrid: 'Europe/Madrid', barcelona: 'Europe/Madrid', spain: 'Europe/Madrid', rome: 'Europe/Rome', milan: 'Europe/Rome', italy: 'Europe/Rome', amsterdam: 'Europe/Amsterdam', brussels: 'Europe/Brussels', zurich: 'Europe/Zurich', geneva: 'Europe/Zurich', switzerland: 'Europe/Zurich', vienna: 'Europe/Vienna', prague: 'Europe/Prague', warsaw: 'Europe/Warsaw', stockholm: 'Europe/Stockholm', oslo: 'Europe/Oslo', copenhagen: 'Europe/Copenhagen', helsinki: 'Europe/Helsinki', athens: 'Europe/Athens', greece: 'Europe/Athens', istanbul: 'Europe/Istanbul', turkey: 'Europe/Istanbul', kyiv: 'Europe/Kyiv', kiev: 'Europe/Kyiv', moscow: 'Europe/Moscow',
    cairo: 'Africa/Cairo', egypt: 'Africa/Cairo', johannesburg: 'Africa/Johannesburg', 'cape town': 'Africa/Johannesburg', 'south africa': 'Africa/Johannesburg', lagos: 'Africa/Lagos', nigeria: 'Africa/Lagos', nairobi: 'Africa/Nairobi', kenya: 'Africa/Nairobi',
    dubai: 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', uae: 'Asia/Dubai', riyadh: 'Asia/Riyadh', 'tel aviv': 'Asia/Jerusalem', jerusalem: 'Asia/Jerusalem', israel: 'Asia/Jerusalem', tehran: 'Asia/Tehran', karachi: 'Asia/Karachi',
    mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', bangalore: 'Asia/Kolkata', bengaluru: 'Asia/Kolkata', india: 'Asia/Kolkata', kathmandu: 'Asia/Kathmandu', dhaka: 'Asia/Dhaka',
    bangkok: 'Asia/Bangkok', thailand: 'Asia/Bangkok', jakarta: 'Asia/Jakarta', bali: 'Asia/Makassar', singapore: 'Asia/Singapore', 'kuala lumpur': 'Asia/Kuala_Lumpur', manila: 'Asia/Manila', 'ho chi minh city': 'Asia/Ho_Chi_Minh', hanoi: 'Asia/Bangkok', vietnam: 'Asia/Ho_Chi_Minh',
    'hong kong': 'Asia/Hong_Kong', shanghai: 'Asia/Shanghai', beijing: 'Asia/Shanghai', shenzhen: 'Asia/Shanghai', china: 'Asia/Shanghai', taipei: 'Asia/Taipei', taiwan: 'Asia/Taipei', seoul: 'Asia/Seoul', korea: 'Asia/Seoul', 'south korea': 'Asia/Seoul', tokyo: 'Asia/Tokyo', osaka: 'Asia/Tokyo', japan: 'Asia/Tokyo',
    sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', brisbane: 'Australia/Brisbane', perth: 'Australia/Perth', adelaide: 'Australia/Adelaide', australia: 'Australia/Sydney', auckland: 'Pacific/Auckland', wellington: 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland',
    utc: 'UTC', gmt: 'UTC', zulu: 'UTC'
  };
  /* "são paulo" -> "São Paulo", "nyc" -> "NYC" */
  function title(s) { return s.length <= 3 ? s.toUpperCase() : s.split(' ').map(function (w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join(' '); }
  /* "Bogotá", "Zürich" and "Montréal" as well as without the accents; own names only ("constructor" is not a city) */
  function zone(place) {
    var k = String(place || '').toLowerCase().replace(/[.!?]+$/, '').replace(/^(?:the\s+)/, '').trim(), plain = k.normalize ? k.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : k;
    return Object.prototype.hasOwnProperty.call(Z, k) ? Z[k] : Object.prototype.hasOwnProperty.call(Z, plain) ? Z[plain] : '';
  }
  function fmtTime(d, tz) { return d.toLocaleTimeString(undefined, tz ? { hour: 'numeric', minute: '2-digit', timeZone: tz } : { hour: 'numeric', minute: '2-digit' }); }
  function fmtDay(d, tz) { var o = { weekday: 'long', month: 'long', day: 'numeric' }; if (tz) o.timeZone = tz; return d.toLocaleDateString(undefined, o); }
  /* the other place's date compared with ours: "tomorrow" or "yesterday" there */
  function dayOff(d, tz) {
    try { var f = function (z) { var o = { year: 'numeric', month: '2-digit', day: '2-digit' }; if (z) o.timeZone = z; return d.toLocaleDateString('en-CA', o); }; var a = f(''), b = f(tz); return a === b ? '' : b > a ? ' tomorrow' : ' yesterday'; } catch (e) { return ''; }
  }
  var TIME = /^(?:(?:hey|ok|okay)\s+)?(?:(?:jarvis|kin)[,!.]?\s+)?(?:(?:please|can you|could you)\s+)*(?:what(?:'?s| is)\s+the\s+time|what\s+time\s+is\s+it|what\s+time\s+it\s+is|tell\s+me\s+the\s+time|(?:the\s+)?(?:current\s+)?time|do you have the time|got the time)(?:\s+(?:now|right now))?(?:\s+(?:in|over in|for)\s+([\p{L} .'-]{2,40}?))?(?:\s+(?:now|right now))?(?:,?\s+(?:jarvis|sir|please))?$/u;
  var DATE = /^(?:(?:hey|ok|okay)\s+)?(?:(?:jarvis|kin)[,!.]?\s+)?(?:(?:please|can you|could you)\s+)*(?:what(?:'?s| is)\s+(?:the\s+date|today'?s\s+date|the\s+date\s+today|today)|what\s+(?:day|date)\s+is\s+(?:it|today)(?:\s+today)?|what\s+is\s+the\s+day\s+today|tell\s+me\s+the\s+date|today'?s\s+date)(?:,?\s+(?:jarvis|sir|please))?$/;
  function instant(raw) { try { return answer(raw); } catch (e) { return null; } }
  function answer(raw) {
    var t = String(raw || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '');
    if (!t || t.length > 80) return null;
    var now = new Date(), m;
    if ((m = TIME.exec(t))) {
      if (!m[1]) return { say: 'It\'s ' + fmtTime(now) + ', sir.', show: fmtTime(now) + ', ' + fmtDay(now) + '.' };
      var place = m[1].trim(), tz = zone(place);
      if (!tz) return null;
      var there = fmtTime(now, tz), off = dayOff(now, tz), name = (/^the\s+/.test(place) ? 'the ' : '') + title(place.replace(/^the\s+/, ''));
      return { say: 'It\'s ' + there + off + ' in ' + name + ', sir.', show: name.replace(/^the /, 'The ') + ': ' + there + ', ' + fmtDay(now, tz) + '. Here: ' + fmtTime(now) + '.' };
    }
    if (DATE.test(t)) return { say: 'It\'s ' + fmtDay(now) + ', sir.', show: fmtDay(now) + ', ' + now.getFullYear() + '. ' + fmtTime(now) + '.' };
    return null;
  }
  Kin.clock = { instant: instant, zone: zone };
})();
