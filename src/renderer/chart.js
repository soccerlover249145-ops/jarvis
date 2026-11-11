/* chart.js: Kin's own charts. The model hands over DATA (never drawing); this file draws it the same way every time:
   a clear title and one-line takeaway, generous margins, hairline grids, direct labels instead of legends where they fit,
   callouts for the high, the low and the latest value, units, a source line, and a pill tooltip on hover or tap.
   No chart library: a small SVG writer. Text from the model or a data source is escaped (in SVG) or set with textContent (in HTML).
   Also here: today's weather from Open-Meteo for the place the founder set once in settings (only coordinates are sent).

   Colours follow the dataviz method: categorical slots in a fixed order, stepped for this dark surface and validated with
   the dataviz validator (scripts/validate_palette.js, --mode dark --surface #141416); text never wears a series colour. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};

  /* ---------------------------------------------------------------- the look */
  var C = {
    surface: '#141416', ink: '#F0EFEC', ink2: '#C3C2B7', muted: '#9A988F', grid: '#2A2A2C', base: '#46464A',
    series: ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#9085E9'], /* dark steps of the reference palette, fixed order */
    font: 'Jost, system-ui, -apple-system, "Segoe UI", sans-serif', mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace'
  };
  var KINDS = ['line', 'area', 'bar', 'stacked_bar', 'range', 'scatter', 'donut'];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function fmt(v, unit) {
    if (v == null) return '–';
    var a = Math.abs(v), s = a >= 1e6 ? r1(v / 1e6) + 'M' : a >= 1e4 ? r1(v / 1e3) + 'K' : a >= 100 ? Math.round(v).toLocaleString('en') : String(r1(v));
    return unit ? (/^[°%]/.test(unit) ? s + unit : /^[$£€]$/.test(unit) ? unit + s : s + ' ' + unit) : s;
  }
  /* round axis steps: 1, 2, 2.5 or 5 times a power of ten */
  function ticks(lo, hi, n) {
    if (lo === hi) { lo -= 1; hi += 1; }
    var raw = (hi - lo) / Math.max(2, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p, st = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
    var a = Math.floor(lo / st) * st, b = Math.ceil(hi / st) * st, out = [];
    for (var v = a; v <= b + st / 2; v += st) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  /* an x value as a short label: an ISO hour becomes "3 PM", an ISO day "Wed 12" */
  function isoish(v) { return typeof v === 'string' && /^\d{4}-\d\d-\d\d(T\d\d:\d\d)?/.test(v); }
  function xLabel(v, all) {
    if (!isoish(v)) return String(v);
    var d = new Date(v.length === 10 ? v + 'T12:00' : v), hourly = /T/.test(v) && all.length > 2 && all.every(function (x) { return String(x).slice(0, 10) === String(all[0]).slice(0, 10); });
    if (isNaN(d)) return String(v);
    return hourly ? d.toLocaleTimeString('en-US', { hour: 'numeric' }) : d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
  }
  /* roughly how wide a line of text is, to wrap titles and keep labels inside the picture */
  function textW(s, size) { return String(s).length * size * 0.54; }
  function wrap(s, size, max, lines) {
    var words = String(s).split(/\s+/), out = [''];
    words.forEach(function (w) { var cur = out[out.length - 1]; if (cur && textW(cur + ' ' + w, size) > max) out.push(w); else out[out.length - 1] = cur ? cur + ' ' + w : w; });
    if (out.length > lines) { out = out.slice(0, lines); out[lines - 1] = out[lines - 1].replace(/\s*\S*$/, '') + '…'; }
    return out;
  }

  /* ---------------------------------------------------------------- the data the model sends, checked */
  /** { ok, spec } or { ok: false, why }. Numbers must be numbers; nothing is invented here, only trimmed and checked. */
  function check(i) {
    if (!i || typeof i !== 'object') return { ok: false, why: 'No chart data.' };
    var kind = KINDS.indexOf(i.kind) >= 0 ? i.kind : 'line';
    var xs = Array.isArray(i.x && i.x.values) ? i.x.values.slice(0, 400).map(function (v) { return typeof v === 'number' ? v : String(v).slice(0, 40); }) : [];
    var ser = (Array.isArray(i.series) ? i.series : []).slice(0, 6).map(function (s, k) {
      var vals = (Array.isArray(s.values) ? s.values : []).slice(0, 400).map(num), lo = Array.isArray(s.low) ? s.low.slice(0, 400).map(num) : null, hi = Array.isArray(s.high) ? s.high.slice(0, 400).map(num) : null;
      return { name: String(s.name || 'Series ' + (k + 1)).slice(0, 40), unit: String(s.unit || '').slice(0, 12), values: vals, low: lo, high: hi, panel: s.panel === 1 ? 1 : 0, kind: KINDS.indexOf(s.kind) >= 0 ? s.kind : kind };
    }).filter(function (s) { return s.values.some(function (v) { return v != null; }) || (s.low && s.high); });
    if (!ser.length) return { ok: false, why: 'The chart has no numbers. Send real values from the data you found; never make numbers up.' };
    if (!String(i.source || '').trim()) return { ok: false, why: 'Name the source of the numbers in source (a site, a dataset, or "your pack").' };
    if (kind !== 'donut' && xs.length < 2) return { ok: false, why: 'x.values needs at least two points.' };
    if (kind !== 'donut' && ser.some(function (s) { return s.values.length && s.values.length !== xs.length; })) return { ok: false, why: 'Every series needs one value per x value (' + xs.length + '). Use null for a gap.' };
    return { ok: true, spec: { title: String(i.title || 'Chart').slice(0, 90), takeaway: String(i.takeaway || '').slice(0, 160), kind: kind, x: { values: xs, label: String((i.x && i.x.label) || '').slice(0, 40) },
      series: ser, annotations: (Array.isArray(i.annotations) ? i.annotations : []).slice(0, 4).map(function (a) { return { x: a.x, text: String(a.text || '').slice(0, 40) }; }), source: String(i.source).slice(0, 160), now: i.now || null } };
  }

  /* ---------------------------------------------------------------- drawing */
  /** an SVG string for a checked spec, w pixels wide (height follows). opts: { w, interactive } */
  function svg(spec, opts) {
    opts = opts || {};
    var W = Math.max(320, Math.min(1400, Math.round(opts.w || 760))), small = W < 520, pad = small ? 18 : 28;
    var tS = small ? 21 : 26, kS = small ? 14 : 16, aS = small ? 11.5 : 12.5, lS = small ? 12.5 : 13.5;
    var out = [], y = pad + tS;
    var tl = wrap(spec.title, tS, W - pad * 2, small ? 3 : 2), kl = spec.takeaway ? wrap(spec.takeaway, kS, W - pad * 2, 2) : [];
    tl.forEach(function (l, k) { out.push('<text x="' + pad + '" y="' + (y + k * tS * 1.15) + '" font-size="' + tS + '" font-weight="500" fill="' + C.ink + '">' + esc(l) + '</text>'); });
    y += (tl.length - 1) * tS * 1.15 + kS * 1.6;
    kl.forEach(function (l, k) { out.push('<text x="' + pad + '" y="' + (y + k * kS * 1.35) + '" font-size="' + kS + '" fill="' + C.ink2 + '">' + esc(l) + '</text>'); });
    y += (kl.length ? (kl.length - 1) * kS * 1.35 : -kS) + (small ? 34 : 44);
    var hit = { panels: [], xs: spec.x.values, W: W };

    if (spec.kind === 'donut') { y = donut(spec, out, W, y, pad, lS, hit); }
    else {
      var panels = [0, 1].map(function (p) { return spec.series.filter(function (s) { return s.panel === p; }); }).filter(function (l) { return l.length; });
      var xs = spec.x.values, n = xs.length, isBarX = spec.series.some(function (s) { return /bar/.test(s.kind); });
      var endLabels = spec.series.filter(function (s) { return /^(line|area)$/.test(s.kind); }).length > 1;
      var yW = small ? 40 : 52, rW = endLabels ? (small ? 62 : 80) : (small ? 12 : 20), x0 = pad + yW, x1 = W - pad - rW;
      var band = (x1 - x0) / (isBarX ? n : Math.max(1, n - 1));
      function X(k) { return isBarX ? x0 + band * (k + 0.5) : x0 + band * k; }
      hit.X = X; hit.x0 = x0; hit.x1 = x1; hit.band = band;
      panels.forEach(function (list, pi) {
        var h = pi === 0 ? (small ? 210 : 260) : (small ? 110 : 130), stacked = list.some(function (s) { return s.kind === 'stacked_bar'; });
        var lo = Infinity, hi = -Infinity;
        list.forEach(function (s) { (s.values || []).concat(s.low || [], s.high || []).forEach(function (v) { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
        if (stacked) { hi = 0; xs.forEach(function (_, k) { var t = 0; list.forEach(function (s) { t += Math.max(0, s.values[k] || 0); }); hi = Math.max(hi, t); }); lo = 0; }
        var unit = list[0].unit, pct = unit === '%';
        if (list.some(function (s) { return /bar/.test(s.kind); }) || pct) lo = Math.min(0, lo);
        if (pct && hi <= 100) hi = Math.max(hi, pi === 0 ? hi : 100);
        var tk = ticks(lo, hi, pi === 0 ? 4 : 2), t0 = tk[0], t1 = tk[tk.length - 1];
        if (pi > 0) { out.push('<text x="' + pad + '" y="' + (y + 2) + '" font-size="' + lS + '" font-weight="500" fill="' + C.ink + '">' + esc(list.map(function (s) { return s.name; }).join(', ') + (unit ? ' (' + unit + ')' : '')) + '</text>'); y += lS + 12; }
        var top = y + (pi === 0 ? 34 : 0), bot = top + h; /* the main panel keeps a band above the data for the high and "now" */
        function Y(v) { return bot - (v - t0) / (t1 - t0 || 1) * h; }
        /* grid and the axis on the left: hairlines, the unit on the top tick */
        tk.forEach(function (v, k) { var yy = r1(Y(v)); out.push('<line x1="' + x0 + '" x2="' + x1 + '" y1="' + yy + '" y2="' + yy + '" stroke="' + (v === 0 && t0 < 0 ? C.base : C.grid) + '" stroke-width="1"/>');
          out.push('<text x="' + (x0 - 10) + '" y="' + (yy + 4) + '" font-size="' + aS + '" text-anchor="end" fill="' + C.muted + '" font-family=\'' + C.mono + '\'>' + esc(fmt(v, k === tk.length - 1 ? unit : '')) + '</text>'); });
        out.push('<line x1="' + x0 + '" x2="' + x1 + '" y1="' + r1(bot) + '" y2="' + r1(bot) + '" stroke="' + C.base + '" stroke-width="1"/>');
        var slot = function (s) { return spec.series.indexOf(s); };
        /* bars: at most 24 px, 4 px rounded data end, square at the baseline, a 2 px gap between neighbours */
        var bars = list.filter(function (s) { return s.kind === 'bar' || s.kind === 'stacked_bar'; }), bw = Math.max(2, Math.min(24, band - 2) / (stacked ? 1 : Math.max(1, bars.length)));
        var acc = xs.map(function () { return 0; });
        bars.forEach(function (s, bi) {
          s.values.forEach(function (v, k) {
            if (v == null) return; var base = stacked ? acc[k] : 0, a = Y(base), b = Y(base + v); if (stacked) acc[k] += Math.max(0, v);
            var bx = X(k) - (stacked ? bw / 2 : (bars.length * bw) / 2 - bi * bw), top2 = Math.min(a, b), hh = Math.abs(a - b) - (stacked && base > 0 ? 2 : 0), rr = Math.min(4, hh, bw / 2);
            if (hh <= 0.5) return;
            out.push('<path d="' + barPath(bx + 1, top2, bw - 2, hh, rr) + '" fill="' + C.series[slot(s)] + '"/>');
          });
        });
        /* range bands, areas and lines: 2 px lines, a 10 % wash under areas and bands */
        list.forEach(function (s) {
          var col = C.series[slot(s)];
          if (s.kind === 'range' && s.low && s.high) {
            var up = [], dn = [];
            xs.forEach(function (_, k) { if (s.low[k] != null && s.high[k] != null) { up.push(r1(X(k)) + ',' + r1(Y(s.high[k]))); dn.unshift(r1(X(k)) + ',' + r1(Y(s.low[k]))); } });
            if (up.length > 1) out.push('<polygon points="' + up.concat(dn).join(' ') + '" fill="' + col + '" fill-opacity=".18"/>');
          }
          if (s.kind === 'bar' || s.kind === 'stacked_bar') return;
          var pts = segs(s.values, X, Y);
          if (s.kind === 'area') pts.forEach(function (seg) { if (seg.length > 1) out.push('<path d="M' + seg[0][0] + ',' + r1(bot) + ' L' + seg.map(function (p) { return p.join(','); }).join(' L') + ' L' + seg[seg.length - 1][0] + ',' + r1(bot) + ' Z" fill="' + col + '" fill-opacity=".12"/>'); });
          if (s.kind === 'scatter') { s.values.forEach(function (v, k) { if (v != null) out.push('<circle cx="' + r1(X(k)) + '" cy="' + r1(Y(v)) + '" r="5" fill="' + col + '" stroke="' + C.surface + '" stroke-width="2"/>'); }); return; }
          pts.forEach(function (seg) { if (seg.length > 1) out.push('<path d="M' + seg.map(function (p) { return p.join(','); }).join(' L') + '" fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'); });
        });
        /* callouts on the first line of the main panel: the high, the low, and the latest value; then direct labels at the right */
        var lines = list.filter(function (s) { return /^(line|area)$/.test(s.kind); });
        var placed = [];
        /* a pill label: the first of the candidate places (x, y of its centre line, anchor) that collides with nothing placed yet */
        function label(cands, text, col, strong) {
          var tw = textW(text, lS) + 16, pick = null;
          cands.some(function (c) {
            var bx = c[2] === 'end' ? c[0] - tw : c[2] === 'middle' ? c[0] - tw / 2 : c[0]; bx = Math.max(pad, Math.min(W - pad - tw, bx));
            var by = Math.max(top - 32, Math.min(bot - 2, c[1] - 12));
            var free = !placed.some(function (p) { return by < p[1] + 26 && by + 24 > p[1] - 2 && bx < p[0] + p[2] + 4 && bx + tw + 4 > p[0]; });
            if (free || !pick) pick = [bx, by]; return free;
          });
          var bx2 = pick[0], by2 = pick[1]; placed.push([bx2, by2, tw]);
          out.push('<rect x="' + r1(bx2) + '" y="' + r1(by2) + '" width="' + r1(tw) + '" height="24" rx="12" fill="' + (strong ? '#232326' : C.surface) + '" stroke="' + C.grid + '" stroke-width="1"/>');
          out.push('<circle cx="' + r1(bx2 + 10) + '" cy="' + r1(by2 + 12) + '" r="3.5" fill="' + col + '"/>');
          out.push('<text x="' + r1(bx2 + 18) + '" y="' + r1(by2 + 16.5) + '" font-size="' + lS + '" font-weight="' + (strong ? 500 : 400) + '" fill="' + C.ink + '">' + esc(text.replace(/^\s+/, '')) + '</text>');
        }
        /* "now", when the x axis is today's hours: drawn first so the labels keep clear of it */
        if (spec.now && pi === 0) { var nk = xs.indexOf(spec.now); if (nk >= 0) { var nx = r1(X(nk)); out.push('<line x1="' + nx + '" x2="' + nx + '" y1="' + r1(top - 18) + '" y2="' + r1(bot) + '" stroke="' + C.ink2 + '" stroke-width="1" opacity=".5"/>'); out.push('<text x="' + nx + '" y="' + r1(top - 22) + '" font-size="' + aS + '" text-anchor="middle" fill="' + C.ink2 + '" font-family=\'' + C.mono + '\'>NOW</text>'); placed.push([nx - 20, top - 36, 40]); } }
        lines.forEach(function (s, li) {
          var col = C.series[slot(s)], vals = s.values, mi = -1, ma = -1, last = -1;
          vals.forEach(function (v, k) { if (v == null) return; if (ma < 0 || v > vals[ma]) ma = k; if (mi < 0 || v < vals[mi]) mi = k; last = k; });
          if (li === 0 && pi === 0 && ma >= 0 && mi !== ma) {
            [[ma, 'High ' + fmt(vals[ma], s.unit), -1], [mi, 'Low ' + fmt(vals[mi], s.unit), 1]].forEach(function (c) {
              var cx = X(c[0]), cy = Y(vals[c[0]]);
              out.push('<circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="5" fill="' + col + '" stroke="' + C.surface + '" stroke-width="2"/>');
              var side = [[cx + 12, cy, 'start'], [cx - 12, cy, 'end']]; if (cx > (x0 + x1) / 2) side.reverse();
              label(c[2] < 0 ? [[cx, cy - 30, 'middle']].concat(side) : side.concat([[cx, cy + 30, 'middle']]), c[1], col, true);
            });
          }
          if (last >= 0) {
            var lx = X(last), ly = Y(vals[last]);
            out.push('<circle cx="' + r1(lx) + '" cy="' + r1(ly) + '" r="4.5" fill="' + col + '" stroke="' + C.surface + '" stroke-width="2"/>');
            if (lines.length > 1 || pi > 0) label([[lx + 8, ly, 'start'], [lx + 8, ly - 26, 'start'], [lx + 8, ly + 26, 'start']], s.name + ' ' + fmt(vals[last], s.unit), col, false);
          }
        });
        /* a single bar series in a lower panel: its peak, labelled */
        if (pi > 0 && bars.length === 1) { var bs = bars[0], pk = -1; bs.values.forEach(function (v, k) { if (v != null && (pk < 0 || v > bs.values[pk])) pk = k; });
          if (pk >= 0 && bs.values[pk] > 0) label([[X(pk) + (X(pk) > (x0 + x1) / 2 ? -bw : bw), Y(bs.values[pk]) - 6, X(pk) > (x0 + x1) / 2 ? 'end' : 'start'], [X(pk), Y(bs.values[pk]) - 20, 'middle']], 'Peak ' + fmt(bs.values[pk], bs.unit), C.series[slot(bs)], false); }
        hit.panels.push({ list: list, top: top, bot: bot, Y: Y });
        y = bot + (pi === panels.length - 1 ? 8 : 26);
      });
      /* the x axis: a label about every 64 px */
      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((x1 - x0) / (small ? 58 : 70)))));
      xs.forEach(function (v, k) { if (k % every) return; out.push('<text x="' + r1(X(k)) + '" y="' + r1(y + 12) + '" font-size="' + aS + '" text-anchor="middle" fill="' + C.muted + '" font-family=\'' + C.mono + '\'>' + esc(xLabel(v, xs)) + '</text>'); });
      y += 22;
      if (spec.x.label) { out.push('<text x="' + r1((x0 + x1) / 2) + '" y="' + r1(y + 8) + '" font-size="' + aS + '" text-anchor="middle" fill="' + C.muted + '">' + esc(spec.x.label) + '</text>'); y += 18; }
      /* a legend only when there is more than one series and the labels did not name them all */
      var multi = spec.series.length > 1 && panels.length === 1;
      if (multi) { var lx2 = pad; y += 10; spec.series.forEach(function (s, k) { var t = s.name, tw = textW(t, lS) + 30; if (lx2 + tw > W - pad) { lx2 = pad; y += 22; } out.push((/bar|area|range/.test(s.kind) ? '<rect x="' + lx2 + '" y="' + (y - 9) + '" width="12" height="12" rx="3" fill="' + C.series[k] + '"/>' : '<line x1="' + lx2 + '" x2="' + (lx2 + 14) + '" y1="' + (y - 3) + '" y2="' + (y - 3) + '" stroke="' + C.series[k] + '" stroke-width="2.5" stroke-linecap="round"/>') + '<text x="' + (lx2 + 20) + '" y="' + (y + 1) + '" font-size="' + lS + '" fill="' + C.ink2 + '">' + esc(t) + '</text>'); lx2 += tw + 12; }); y += 10; }
    }
    y += small ? 18 : 22;
    wrap('Source: ' + spec.source, aS, W - pad * 2, 2).forEach(function (l, k) { out.push('<text x="' + pad + '" y="' + r1(y + k * aS * 1.4) + '" font-size="' + aS + '" fill="' + C.muted + '">' + esc(l) + '</text>'); });
    y += aS * 1.4 + pad - 6;
    var H = Math.round(y);
    hit.H = H;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" font-family=\'' + C.font + '\' role="img" aria-label="' + esc(spec.title + (spec.takeaway ? '. ' + spec.takeaway : '')) + '">' +
      '<rect width="' + W + '" height="' + H + '" rx="' + (opts.square ? 0 : 24) + '" fill="' + C.surface + '"/>' + out.join('') + '</svg>';
    return opts.withHit ? { svg: s, hit: hit } : s;
  }
  function barPath(x, y, w, h, r) {
    /* rounded at the data end (the top), square at the baseline */
    return 'M' + r1(x) + ',' + r1(y + h) + ' V' + r1(y + r) + ' Q' + r1(x) + ',' + r1(y) + ' ' + r1(x + r) + ',' + r1(y) + ' H' + r1(x + w - r) + ' Q' + r1(x + w) + ',' + r1(y) + ' ' + r1(x + w) + ',' + r1(y + r) + ' V' + r1(y + h) + ' Z';
  }
  function segs(vals, X, Y) { var out = [[]]; vals.forEach(function (v, k) { if (v == null) { if (out[out.length - 1].length) out.push([]); return; } out[out.length - 1].push([r1(X(k)), r1(Y(v))]); }); return out; }
  function donut(spec, out, W, y, pad, lS, hit) {
    var s = spec.series[0], parts = s.values.map(function (v, k) { return { v: Math.max(0, v || 0), name: String(spec.x.values[k] != null ? spec.x.values[k] : 'Part ' + (k + 1)) }; }).filter(function (p) { return p.v > 0; }).slice(0, 6);
    var tot = parts.reduce(function (a, p) { return a + p.v; }, 0) || 1, R = Math.min(120, (W - pad * 2) / 4), cx = pad + R, cy = y + R, a0 = -Math.PI / 2;
    parts.forEach(function (p, k) {
      var a1 = a0 + p.v / tot * Math.PI * 2, gap = 0.012, b0 = a0 + gap, b1 = a1 - gap, ri = R * 0.62, large = b1 - b0 > Math.PI ? 1 : 0;
      out.push('<path d="M' + r1(cx + R * Math.cos(b0)) + ',' + r1(cy + R * Math.sin(b0)) + ' A' + R + ',' + R + ' 0 ' + large + ' 1 ' + r1(cx + R * Math.cos(b1)) + ',' + r1(cy + R * Math.sin(b1)) + ' L' + r1(cx + ri * Math.cos(b1)) + ',' + r1(cy + ri * Math.sin(b1)) + ' A' + ri + ',' + ri + ' 0 ' + large + ' 0 ' + r1(cx + ri * Math.cos(b0)) + ',' + r1(cy + ri * Math.sin(b0)) + ' Z" fill="' + C.series[k] + '"/>');
      a0 = a1;
      var ly = y + 14 + k * 30, lx = cx + R + 28;
      out.push('<rect x="' + lx + '" y="' + (ly - 10) + '" width="12" height="12" rx="3" fill="' + C.series[k] + '"/><text x="' + (lx + 20) + '" y="' + ly + '" font-size="' + lS + '" fill="' + C.ink + '">' + esc(p.name) + '  <tspan fill="' + C.ink2 + '">' + esc(fmt(p.v, s.unit)) + ' · ' + Math.round(p.v / tot * 100) + '%</tspan></text>');
    });
    out.push('<text x="' + cx + '" y="' + (cy + 8) + '" font-size="24" font-weight="500" text-anchor="middle" fill="' + C.ink + '">' + esc(fmt(tot, s.unit)) + '</text>');
    hit.donut = true;
    return y + R * 2 + 8;
  }

  /* ---------------------------------------------------------------- on the page: the chart, a pill tooltip, and the numbers as a table */
  function mount(el, spec) {
    el.textContent = '';
    var box = document.createElement('div'); box.className = 'chartbox'; el.appendChild(box);
    var w = Math.max(320, Math.min(900, el.clientWidth || 640)), r = svg(spec, { w: w, withHit: true });
    box.innerHTML = r.svg; /* built from escaped text only (esc above) */
    var sv = box.firstChild; sv.removeAttribute('width'); sv.removeAttribute('height'); sv.style.width = '100%'; sv.style.height = 'auto'; sv.style.display = 'block';
    var hit = r.hit;
    if (!hit.donut && hit.panels.length) {
      var NS = 'http://www.w3.org/2000/svg', cross = document.createElementNS(NS, 'line'), tip = document.createElement('div');
      cross.setAttribute('stroke', C.ink2); cross.setAttribute('stroke-width', '1'); cross.setAttribute('opacity', '0'); sv.appendChild(cross);
      tip.className = 'charttip'; tip.hidden = true; box.appendChild(tip);
      var show = function (ev) {
        var rc = sv.getBoundingClientRect(), sx = (ev.clientX - rc.left) * hit.W / rc.width, n = hit.xs.length, k;
        if (sx < hit.x0 - 20 || sx > hit.x1 + 20) { hide(); return; }
        k = Math.round(hit.band ? (sx - hit.X(0)) / hit.band : 0); k = Math.max(0, Math.min(n - 1, k));
        var cx = hit.X(k); cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('y1', hit.panels[0].top); cross.setAttribute('y2', hit.panels[hit.panels.length - 1].bot); cross.setAttribute('opacity', '.6');
        tip.textContent = ''; var hd = document.createElement('b'); hd.textContent = xLabel(hit.xs[k], hit.xs); tip.appendChild(hd);
        spec.series.map(function (s, si) { return [s, si]; }).sort(function (a, b) { return a[0].panel - b[0].panel; }).forEach(function (pair) {
          var s = pair[0], si = pair[1], v = s.values[k]; if (v == null && !(s.low && s.high)) return;
          var row = document.createElement('span'), key = document.createElement('i'), val = document.createElement('strong'), nm = document.createElement('em');
          key.style.background = C.series[si]; val.textContent = s.kind === 'range' && s.low ? fmt(s.low[k], s.unit) + '–' + fmt(s.high[k], s.unit) : fmt(v, s.unit); nm.textContent = s.name;
          row.appendChild(key); row.appendChild(val); row.appendChild(nm); tip.appendChild(row);
        });
        tip.hidden = false;
        var px = cx / hit.W * rc.width, bw = box.clientWidth, tw = tip.offsetWidth;
        tip.style.left = Math.max(4, Math.min(bw - tw - 4, px - tw / 2)) + 'px'; tip.style.top = Math.max(0, hit.panels[0].top / hit.H * rc.height - tip.offsetHeight - 6) + 'px';
      };
      var hide = function () { tip.hidden = true; cross.setAttribute('opacity', '0'); };
      sv.addEventListener('pointermove', show); sv.addEventListener('pointerdown', show); sv.addEventListener('pointerleave', hide);
    }
    /* every value reachable without hovering */
    var det = document.createElement('details'); det.className = 'charttable'; var sm = document.createElement('summary'); sm.textContent = 'Show the numbers'; det.appendChild(sm);
    var tb = document.createElement('table'), tr = document.createElement('tr'), th0 = document.createElement('th'); th0.textContent = spec.x.label || ''; tr.appendChild(th0);
    spec.series.forEach(function (s) { var th = document.createElement('th'); th.textContent = s.name + (s.unit ? ' (' + s.unit + ')' : ''); tr.appendChild(th); }); tb.appendChild(tr);
    (spec.kind === 'donut' ? spec.x.values : hit.xs).forEach(function (xv, k) { var r2 = document.createElement('tr'), td = document.createElement('td'); td.textContent = spec.kind === 'donut' ? String(xv) : xLabel(xv, hit.xs); r2.appendChild(td);
      spec.series.forEach(function (s) { var c = document.createElement('td'); c.textContent = s.kind === 'range' && s.low ? fmt(s.low[k], '') + '–' + fmt(s.high[k], '') : fmt(s.values[k], ''); r2.appendChild(c); }); tb.appendChild(r2); });
    det.appendChild(tb); el.appendChild(det);
    return sv;
  }
  /** the numbers as tab-separated text, for Copy when an image cannot go on the clipboard */
  function tsv(spec) {
    var rows = [[spec.x.label || ''].concat(spec.series.map(function (s) { return s.name + (s.unit ? ' (' + s.unit + ')' : ''); }))];
    spec.x.values.forEach(function (x, k) { rows.push([String(x)].concat(spec.series.map(function (s) { return s.values[k] == null ? '' : String(s.values[k]); }))); });
    return rows.map(function (r) { return r.join('\t'); }).join('\n') + '\nSource: ' + spec.source;
  }

  /* ---------------------------------------------------------------- the weather, from Open-Meteo (free, no key; CORS open) */
  var PLACE = 'kin.place', GEO = 'https://geocoding-api.open-meteo.com/v1/search', FC = 'https://api.open-meteo.com/v1/forecast';
  var ls = {
    get: function (k) { if (Kin.shared) return null; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { if (Kin.shared) return false; try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function place() { try { var p = JSON.parse(ls.get(PLACE) || 'null'); return p && isFinite(p.lat) && isFinite(p.lon) ? p : null; } catch (e) { return null; } }
  function setPlace(p) { if (!p || !isFinite(p.lat) || !isFinite(p.lon)) return false; return ls.set(PLACE, JSON.stringify({ name: String(p.name || '').slice(0, 80), region: String(p.region || '').slice(0, 80), country: String(p.country || '').slice(0, 60), lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4, tz: String(p.tz || '').slice(0, 60) })); }
  function getJSON(url, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms || 12000);
    return fetch(url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctl.signal }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('Open-Meteo answered ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }
  /** look a town up once, in settings: the town name goes to Open-Meteo's geocoder, nothing else */
  function findPlace(name) {
    name = String(name || '').trim().slice(0, 80); if (name.length < 2) return Promise.resolve([]);
    return getJSON(GEO + '?name=' + encodeURIComponent(name) + '&count=5&language=en&format=json').then(function (j) {
      return (j && Array.isArray(j.results) ? j.results : []).slice(0, 5).map(function (r) { return { name: r.name, region: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude, tz: r.timezone || '' }; }).filter(function (r) { return isFinite(r.lat) && isFinite(r.lon); });
    });
  }
  /** today, hour by hour, for the saved place: only its coordinates are sent */
  function weatherToday() {
    var p = place(); if (!p) return Promise.resolve({ ok: false, why: 'No place is set. The founder sets their town once in Settings, under Weather.' });
    var url = FC + '?latitude=' + p.lat + '&longitude=' + p.lon + '&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&current=temperature_2m&timezone=auto&forecast_days=1';
    return getJSON(url).then(function (j) {
      var h = j && j.hourly, d = j && j.daily; if (!h || !Array.isArray(h.time)) return { ok: false, why: 'Open-Meteo sent no hourly forecast.' };
      var cur = j.current && j.current.time ? String(j.current.time).slice(0, 13) + ':00' : null;
      return { ok: true, place: [p.name, p.region, p.country].filter(Boolean).join(', '), timezone: j.timezone || p.tz, units: { temperature: (j.hourly_units && j.hourly_units.temperature_2m) || '°C', precipitation_probability: '%' },
        hourly: { time: h.time.slice(0, 24), temperature: (h.temperature_2m || []).slice(0, 24), precipitation_probability: (h.precipitation_probability || []).slice(0, 24) },
        high: d && d.temperature_2m_max ? d.temperature_2m_max[0] : null, low: d && d.temperature_2m_min ? d.temperature_2m_min[0] : null, rain_chance_max: d && d.precipitation_probability_max ? d.precipitation_probability_max[0] : null,
        now: cur, current_temperature: j.current ? j.current.temperature_2m : null, source: 'Open-Meteo forecast (open-meteo.com) for ' + p.name };
    }, function (e) { return { ok: false, why: 'Open-Meteo could not be reached (' + String(e && e.message || e).slice(0, 80) + ').' }; });
  }

  Kin.chart = { check: check, svg: svg, mount: mount, tsv: tsv, colors: C, KINDS: KINDS,
    place: place, setPlace: setPlace, dropPlace: function () { ls.del(PLACE); }, findPlace: findPlace, weatherToday: weatherToday };
})();
