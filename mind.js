/* mind.js: what Kin keeps and does on this device without asking Claude.
   - memory: facts and preferences the founder asked Kin to remember, and lessons from thumbs and corrections
   - made:   documents, plans, tables and designs Kin made, with download and copy
   - log:    the logbook (mods, builds, batches, workouts, notes) and its instant phrases
   - timers, protocols (morning brief, shutdown, focus): instant, no model call
   - spend:  an estimate of what each answer cost, and a daily web search count
   Everything is stored in this browser only (IndexedDB and localStorage). At an address shared with another
   site (see guard.js) nothing is read or written. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};

  /* ---------------------------------------------------------------- storage */
  var data = { memory: [], made: [], log: [] }, loaded = false, saveT = {};
  function kv() { return Kin.pack && Kin.pack.kv; }
  function save(name) {
    if (Kin.shared || !kv()) return;
    clearTimeout(saveT[name]);
    saveT[name] = setTimeout(function () { kv().set('mind.' + name, data[name]).catch(function () {}); }, 150);
  }
  function load() {
    if (Kin.shared || !kv()) { loaded = true; return Promise.resolve(); }
    return Promise.all(['memory', 'made', 'log'].map(function (n) {
      return kv().get('mind.' + n).then(function (v) { data[n] = Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; }).catch(function () { data[n] = []; });
    })).then(function () { loaded = true; });
  }
  var ls = {
    get: function (k, d) { if (Kin.shared) return d; try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { if (Kin.shared) return; try { localStorage.setItem(k, v); } catch (e) {} }
  };
  /* the old model choice for hard jobs is gone (Opus 5.5 does every deep job); drop its leftover setting */
  try { if (!Kin.shared) localStorage.removeItem('kin.deep'); } catch (e) {}
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function words(s) { return Kin.pack ? Kin.pack.words(s) : String(s || '').toLowerCase().split(/\W+/).filter(Boolean); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  /* ---------------------------------------------------------------- memory and lessons */
  var MEM_MAX = 200, LESSON_MAX = 80;
  /** Things that must never be kept: keys and passwords, and what the founder's own rules keep out of everything
      Kin makes (age, school, family money). Returns a reason, or '' when the text may be kept. */
  function refuse(text) {
    var t = String(text || '');
    var AGE_W = '(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
    if (/sk-ant-|\bsk_[A-Za-z0-9]{16,}|\b[a-z]{2,6}_[A-Za-z0-9_]{10,}\b|\beyJ[A-Za-z0-9_-]{10,}|\b(api[ _-]?key|password|passcode|pin( code)?|secret key|client secret|(access|api|auth|bearer|refresh|session) token|my token|token is|alarm code|door code|security code|cvv|sort code|account number|routing number)\b/i.test(t)) return 'Keys, codes and passwords are never kept in memory.';
    if (/\b(?:\d[ -]?){13,19}\b/.test(t) || /\b(card|visa|mastercard|amex)\b[^.]{0,30}\d{4}/i.test(t)) return 'Card numbers are never kept in memory.';
    if (/\b(code|pin|combination|passcode)\b[^.]{0,20}\b\d{4,8}\b/i.test(t)) return 'Keys, codes and passwords are never kept in memory.';
    if (new RegExp('\\b(\\d{1,2}\\s*(years?|yrs?)\\s*old|i\'?m \\d{1,2}\\b|i am \\d{1,2}\\b|(i\'?m|i am|turning|turned) ' + AGE_W + '\\b|' + AGE_W + ' years? old|my age|how old i am|my birthday|born (in|on) |grade \\d{1,2}|(year|grade) (seven|eight|nine|ten|eleven|twelve)\\b|(high|middle|elementary|primary|secondary|grammar|prep) school|my school|i go to [A-Z]?[a-z]+ (high|academy|college|prep)|\\b(high|academy)\\b[^.]{0,20}\\b(student|pupil|class|grade))', 'i').test(t)) return 'Your age and school are never kept, by your own rules.';
    if (/\b(family|parents?|mum|mom|dad|father|mother|grandma|grandpa|uncle|aunt)\b[^.]{0,60}(\$|£|€|\d|\b(thousand|million|hundred|grand|pounds|dollars|euros|money|loan|lent|invested|gave)\b)|(\$|£|€)\s?\d[^.]{0,60}\b(family|parents?|mum|mom|dad|father|mother)\b/i.test(t)) return 'Family money is never kept, by your own rules.';
    return '';
  }
  function remember(text, kind, extra) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text) return { ok: false, why: 'Nothing to remember.' };
    var why = refuse(text); if (why) return { ok: false, why: why };
    kind = /^(fact|preference|lesson|correction|good|bad)$/.test(kind) ? kind : 'fact';
    var n = Kin.ears ? Kin.ears.norm(text) : text.toLowerCase();
    var same = data.memory.filter(function (m) { return (Kin.ears ? Kin.ears.norm(m.text) : m.text.toLowerCase()) === n; })[0];
    if (same) { same.at = Date.now(); same.kind = kind; save('memory'); return { ok: true, id: same.id, again: true }; }
    var m = { id: uid('m'), text: text, kind: kind, at: Date.now(), uses: 0 };
    if (extra && extra.q) m.q = String(extra.q).slice(0, 300);
    data.memory.push(m);
    prune(); save('memory');
    return { ok: true, id: m.id };
  }
  function isLesson(m) { return /^(lesson|correction|good|bad)$/.test(m.kind); }
  /** keep the list small: oldest and least used go first, separately for lessons and for facts */
  function prune() {
    function cut(filter, max) {
      var list = data.memory.filter(filter); if (list.length <= max) return;
      list.sort(function (a, b) { return (a.uses - b.uses) || (a.at - b.at); });
      var drop = {}; list.slice(0, list.length - max).forEach(function (m) { drop[m.id] = 1; });
      data.memory = data.memory.filter(function (m) { return !drop[m.id]; });
    }
    cut(isLesson, LESSON_MAX); cut(function (m) { return !isLesson(m); }, MEM_MAX);
  }
  function forget(id) { var n = data.memory.length; data.memory = data.memory.filter(function (m) { return m.id !== id; }); if (data.memory.length !== n) save('memory'); return data.memory.length !== n; }
  function forgetAll() { data.memory = []; save('memory'); }
  /** the memories and lessons that matter for this question, ranked by shared words, kind and age, within a size cap */
  function recall(question, maxChars) {
    var q = words(question), now = Date.now();
    function score(m) {
      var w = words(m.text + ' ' + (m.q || '')), hit = 0;
      q.forEach(function (x) { if (x.length > 2 && w.indexOf(x) >= 0) hit++; });
      var age = (now - m.at) / 864e5, base = m.kind === 'preference' ? 2 : m.kind === 'correction' ? 2.5 : m.kind === 'bad' ? 1.5 : 1;
      return hit * 2 + base + Math.max(0, 1 - age / 60) + Math.min(m.uses, 5) * 0.1;
    }
    var facts = data.memory.filter(function (m) { return !isLesson(m); }).map(function (m) { return { m: m, s: score(m) }; }),
      lessons = data.memory.filter(isLesson).map(function (m) { return { m: m, s: score(m) }; });
    facts.sort(function (a, b) { return b.s - a.s; }); lessons.sort(function (a, b) { return b.s - a.s; });
    var out = [], used = 0, cap = maxChars || 3500;
    function take(list, n, fmt) { list.slice(0, n).forEach(function (x) { var line = fmt(x.m); if (used + line.length > cap) return; used += line.length; out.push(line); x.m.uses++; }); }
    var f = [], l = [];
    take(facts, 14, function (m) { var s = '- ' + m.text; f.push(s); return s; });
    take(lessons, 6, function (m) { var s = '- ' + (m.kind === 'correction' ? 'Corrected: ' : m.kind === 'bad' ? 'Marked not right: ' : m.kind === 'good' ? 'Marked good: ' : '') + m.text; l.push(s); return s; });
    if (out.length) save('memory');
    var txt = '';
    if (f.length) txt += 'What the founder asked you to remember (stored on this device):\n' + f.join('\n');
    if (l.length) txt += (txt ? '\n\n' : '') + 'Lessons from earlier answers (follow them):\n' + l.join('\n');
    return txt;
  }
  /** a thumbs up or down on an answer */
  function rate(q, a, good) {
    var text = (good ? 'This kind of answer worked: ' : 'Avoid answering like this: ') + 'asked "' + String(q || '').slice(0, 140) + '", answered "' + String(a || '').replace(/\s+/g, ' ').slice(0, 220) + '"';
    return remember(text, good ? 'good' : 'bad', { q: q });
  }
  var CORRECTION = /^(no[,.!]|nope\b|wrong\b|that'?s (wrong|not right|not it|incorrect)|not quite\b|incorrect\b|actually[,]? |you got that wrong|that isn'?t right)/i;
  /** the founder correcting the last answer: kept as a lesson tied to the question it was about */
  function noteCorrection(text, prevQ, prevA) {
    var t0 = String(text || '').trim();
    if (!prevQ || !CORRECTION.test(t0)) return null;
    /* "Actually, what time is it in Tokyo?" is a new question, not a correction */
    var after = t0.replace(CORRECTION, '').trim();
    if (/\?\s*$/.test(t0) || /^(what|when|who|where|why|how|which|can|could|would|will|is|are|do|does|did|should|tell|show|give|find)\b/i.test(after) || after.split(/\s+/).length < 3) return null;
    return remember('When asked "' + String(prevQ).slice(0, 140) + '", the founder corrected the answer: "' + String(text).slice(0, 260) + '"', 'correction', { q: prevQ });
  }

  /* ---------------------------------------------------------------- made things */
  var MADE_MAX = 60;
  function addMade(item) {
    var old = item.id && data.made.filter(function (m) { return m.id === item.id; })[0];
    if (old) { Object.keys(item).forEach(function (k) { old[k] = item[k]; }); old.at = Date.now(); old.round = (old.round || 1) + (item.content ? 1 : 0); save('made'); return old; }
    var m = { id: item.id || uid('d'), kind: item.kind, title: item.title, note: item.note || '', content: item.content, at: Date.now(), round: 1, score: null };
    /* a design from the studio also keeps its brief, the art director's notes and the other concepts */
    ['src', 'brief', 'concept', 'notes', 'why', 'caps', 'others', 'pictures', 'credits', 'usd', 'issues', 'spec'].forEach(function (k) { if (item[k] !== undefined) m[k] = item[k]; });
    data.made.unshift(m); if (data.made.length > MADE_MAX) data.made.length = MADE_MAX; save('made'); return m;
  }
  function getMade(id) { return data.made.filter(function (m) { return m.id === id; })[0] || null; }
  function dropMade(id) { data.made = data.made.filter(function (m) { return m.id !== id; }); save('made'); }

  /** Clean an SVG before it is shown, stored or downloaded: no scripts, no event handlers, no outside links,
      no embedded web content. It is only ever shown inside an <img>, which runs nothing anyway. */
  function cleanSvg(src) {
    var txt = String(src || '').trim();
    var a = txt.indexOf('<svg'), b = txt.lastIndexOf('</svg>');
    if (a < 0 || b < a) return { ok: false, why: 'There is no <svg> element in it.' };
    txt = txt.slice(a, b + 6);
    var doc; try { doc = new DOMParser().parseFromString(txt, 'image/svg+xml'); } catch (e) { return { ok: false, why: 'The SVG could not be read.' }; }
    var err = doc.getElementsByTagName('parsererror')[0];
    if (err) return { ok: false, why: 'The SVG does not parse: ' + String(err.textContent || '').replace(/\s+/g, ' ').slice(0, 160) };
    var root = doc.documentElement; if (!root || root.nodeName.toLowerCase() !== 'svg') return { ok: false, why: 'The root element is not <svg>.' };
    Array.prototype.slice.call(root.querySelectorAll('script, style, foreignObject, iframe, object, embed, audio, video, animate, set, animateMotion, animateTransform, animateColor')).forEach(function (n) { n.parentNode.removeChild(n); });
    /* the same elements under any namespace prefix (an XHTML <h:script>, say) */
    Array.prototype.slice.call(root.getElementsByTagName('*')).filter(function (n) { return /^(script|style|iframe|object|embed|foreignobject)$/i.test(n.localName); }).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    /* a link inside a picture goes nowhere useful: keep what it wraps, drop the link */
    Array.prototype.slice.call(root.querySelectorAll('a')).forEach(function (a) { while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a); a.parentNode.removeChild(a); });
    Array.prototype.slice.call(root.querySelectorAll('*')).concat([root]).forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (at) {
        var name = at.name.toLowerCase(), local = String(at.localName || name).toLowerCase(), v = String(at.value || '').trim();
        if (/^on/.test(local)) n.removeAttribute(at.name);
        /* a link under any prefix (xlink:, x:, …) may only point inside the picture or carry a picture as data */
        else if ((local === 'href' || local === 'src') && !/^#|^data:image\/(png|jpe?g|gif|webp);/i.test(v)) n.removeAttribute(at.name);
        /* url(...) anywhere (fill, filter, mask, style) may only point inside the picture */
        else if (/url\(\s*['"]?(?!#)/i.test(v)) n.removeAttribute(at.name);
      });
    });
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var out = new XMLSerializer().serializeToString(root);
    var vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number), w = parseFloat(root.getAttribute('width')) || vb[2] || 1200, h = parseFloat(root.getAttribute('height')) || vb[3] || 1200;
    return { ok: true, svg: out, w: w, h: h };
  }
  /* ---- the fonts this page carries, embedded into a design so it looks the same in the preview, the art
     director's picture and the downloaded file. Outside fonts cannot be loaded here. */
  var FONTS = [['Jost', 'fonts/jost.woff2', '300 500'], ['IBM Plex Mono', 'fonts/plexmono-400.woff2', '400'], ['IBM Plex Mono', 'fonts/plexmono-500.woff2', '500']], fontP = null;
  function b64(buf) { var s = '', u = new Uint8Array(buf); for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function fonts() {
    if (!fontP) fontP = Promise.all(FONTS.map(function (f) { return fetch(f[1]).then(function (r) { if (!r.ok) throw new Error('font'); return r.arrayBuffer(); }).then(function (b) { return { family: f[0], weight: f[2], b64: b64(b) }; }).catch(function () { return null; }); }))
      .then(function (l) { return l.filter(Boolean); });
    return fontP;
  }
  /** the SVG with @font-face rules for the families it uses, as data, so nothing is fetched when it is drawn */
  function withFonts(svg) {
    var uses = FONTS.filter(function (f, k) { return FONTS.map(function (x) { return x[0]; }).indexOf(f[0]) === k && svg.indexOf(f[0]) >= 0; });
    if (!uses.length) return Promise.resolve(svg);
    return fonts().then(function (fl) {
      var css = fl.filter(function (f) { return svg.indexOf(f.family) >= 0; }).map(function (f) { return '@font-face{font-family:"' + f.family + '";src:url(data:font/woff2;base64,' + f.b64 + ') format("woff2");font-weight:' + f.weight + ';}'; }).join('');
      if (!css) return svg;
      var a = svg.indexOf('<svg'), b = svg.indexOf('>', a); if (a < 0 || b < 0) return svg;
      return svg.slice(0, b + 1) + '<defs><style type="text/css">' + css + '</style></defs>' + svg.slice(b + 1);
    });
  }
  /** Words the founder's own rules ban, read from the pack's rules ("never say "x"", "Banned words: a, b"). */
  function banned() {
    var p = Kin.pack && Kin.pack.get(), out = [], seen = {}; if (!p || !p.rules) return out;
    var add = function (w) { w = String(w || '').trim().toLowerCase(); if (w.length >= 2 && w.length <= 40 && !seen[w]) { seen[w] = 1; out.push(w); } };
    p.rules.replace(/\b(?:never|don'?t|do not)\s+(?:say|use|write|call\s+(?:it|us|them|the drink)?|mention|describe\s+(?:it|us)?\s*as)?\s*[\u201c"]([^"\u201d\n]{2,40})[\u201d"]/gi, function (m, w) { add(w); return m; });
    p.rules.replace(/\b(?:banned|forbidden)(?: words?| phrases?)?\s*[:\-]\s*([^\n]+)/gi, function (m, l) { l.split(/[,;]/).forEach(function (w) { add(w.replace(/[\u201c\u201d"'.]/g, '')); }); return m; });
    return out.slice(0, 40);
  }
  /** what the text breaks: long dashes, and the banned words */
  function wordProblems(text) {
    var t = String(text || ''), out = [];
    var dash = (t.match(/[\u2013\u2014]/g) || []).length; if (dash) out.push('Uses ' + dash + ' long dash' + (dash === 1 ? '' : 'es') + '; the rules say none. Use a comma, a colon or a full stop.');
    banned().forEach(function (w) { var re = new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])', 'i'); if (re.test(t)) out.push('Uses "' + w + '", which the rules ban.'); });
    return out;
  }
  /** Measure a design the way a checker would: draw it hidden in this page with the real fonts, then look for
      text running off the canvas, text on text, text crowding an edge, text too small to read, and banned words. */
  function measure(svg, w, h) {
    return new Promise(function (res) {
      var host = null;
      function done(v) { try { if (host) host.remove(); } catch (e) {} res(v); }
      try {
        var doc = new DOMParser().parseFromString(svg, 'image/svg+xml'), root = document.importNode(doc.documentElement, true);
        Array.prototype.slice.call(root.querySelectorAll('style')).forEach(function (n) { n.remove(); });
        Array.prototype.slice.call(root.querySelectorAll('[style]')).concat([root]).forEach(function (n) { n.removeAttribute('style'); });
        root.setAttribute('width', w); root.setAttribute('height', h);
        host = document.createElement('div'); host.setAttribute('aria-hidden', 'true');
        host.style.position = 'fixed'; host.style.left = '-30000px'; host.style.top = '0'; host.style.width = w + 'px'; host.style.height = h + 'px'; host.style.visibility = 'hidden'; host.style.pointerEvents = 'none';
        host.appendChild(root); document.body.appendChild(host);
        var loads = []; if (document.fonts && document.fonts.load) ['300 40px Jost', '400 40px Jost', '500 40px Jost', '400 40px "IBM Plex Mono"', '500 40px "IBM Plex Mono"'].forEach(function (f) { loads.push(document.fonts.load(f).catch(function () {})); });
        var t0 = setTimeout(function () { done({ hard: [], soft: [], failed: true }); }, 5000);
        Promise.all(loads).then(function () { return document.fonts && document.fonts.ready; }).then(function () {
          clearTimeout(t0);
          var rr = root.getBoundingClientRect(), vb = root.viewBox && root.viewBox.baseVal, W = vb && vb.width || w, H = vb && vb.height || h, kx = W / (rr.width || 1), ky = H / (rr.height || 1), short = Math.min(W, H);
          /* a text box from the browser is the whole line box (ascent to descent), far taller than the letters.
             Tight display type would read as overlapping, so each box is cut to where the ink sits: cap height above the baseline, a short descender below */
          var texts = Array.prototype.slice.call(root.querySelectorAll('text')).map(function (t) {
            var b = t.getBoundingClientRect(), fs = parseFloat(getComputedStyle(t).fontSize) || 0, x = (b.left - rr.left) * kx, y = (b.top - rr.top) * ky, bw = b.width * kx, bh = b.height * ky;
            if (fs > 0) { var line = Math.min(bh, 1.45 * fs), top = Math.max(0, 0.75 * line - 0.74 * fs), bot = Math.max(0, 0.25 * line - 0.18 * fs); y += top; bh = Math.max(1, bh - top - bot); }
            return { txt: (t.textContent || '').replace(/\s+/g, ' ').trim(), x: x, y: y, w: bw, h: bh, fs: fs || bh, bleed: !!(t.closest && t.closest('[data-bleed="true"]')), decor: !!(t.closest && t.closest('[data-layer="decor"]')) };
          }).filter(function (t) { return t.txt && t.w > 0 && t.h > 0; });
          var hard = [], soft = [], q = function (t) { return '"' + (t.txt.length > 40 ? t.txt.slice(0, 38) + '…' : t.txt) + '"'; }, edge = 0.04 * short;
          texts.forEach(function (t) {
            if (t.x < -0.01 * W || t.y < -0.01 * H || t.x + t.w > 1.01 * W || t.y + t.h > 1.01 * H) hard.push(q(t) + ' runs off the canvas.');
            else if (!t.bleed && (t.x < edge || t.y < edge || W - (t.x + t.w) < edge || H - (t.y + t.h) < edge)) soft.push(q(t) + ' sits within 4% of an edge; give it more margin.');
            if (t.fs < 0.016 * short) soft.push(q(t) + ' is very small (' + Math.round(t.fs) + ' units on a ' + Math.round(short) + ' canvas); it may not read.');
          });
          for (var i = 0; i < texts.length; i++) for (var j = i + 1; j < texts.length; j++) {
            var a = texts[i], b = texts[j], ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (!(ix > 0 && iy > 0 && ix * iy > 0.2 * Math.min(a.w * a.h, b.w * b.h))) continue;
            /* layered type on purpose (a ghost word behind a headline, marked decor, or three times the size) is a judgement for the art director, not a fault */
            if (a.decor || b.decor || a.bleed || b.bleed || Math.max(a.fs, b.fs) >= 3 * Math.min(a.fs, b.fs)) soft.push(q(a) + ' and ' + q(b) + ' are layered; make sure the front one reads clearly.');
            else hard.push(q(a) + ' and ' + q(b) + ' print over each other.');
          }
          wordProblems(texts.map(function (t) { return t.txt; }).join(' \n ')).forEach(function (x) { hard.push(x); });
          done({ hard: hard.slice(0, 8), soft: soft.slice(0, 6), texts: texts.length });
        }, function () { clearTimeout(t0); done({ hard: [], soft: [], failed: true }); });
      } catch (e) { done({ hard: [], soft: [], failed: true }); }
    });
  }
  function svgUrl(svg) { return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); }
  /** Draw an SVG to a PNG (base64, no prefix), at most `max` pixels on the long side. Resolves null when the browser will not. */
  function svgToPng(svg, w, h, max) {
    return new Promise(function (res) {
      withFonts(svg).then(function (full) { draw(full); }, function () { draw(svg); });
      function draw(svg) {
      var url = svgUrl(svg), img = new Image(), done = false;
      function fin(v) { if (done) return; done = true; try { URL.revokeObjectURL(url); } catch (e) {} res(v); }
      var t = setTimeout(function () { fin(null); }, 6000);
      img.onload = function () {
        try {
          var k = Math.min(1, (max || 1200) / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
          var c = document.createElement('canvas'); c.width = cw; c.height = ch; var g = c.getContext('2d');
          g.fillStyle = '#ffffff'; g.fillRect(0, 0, cw, ch); g.drawImage(img, 0, 0, cw, ch);
          var data = c.toDataURL('image/png'); clearTimeout(t); fin(/^data:image\/png;base64,/.test(data) ? data.split(',')[1] : null);
        } catch (e) { clearTimeout(t); fin(null); }
      };
      img.onerror = function () { clearTimeout(t); fin(null); };
      img.src = url;
      }
    });
  }
  function download(name, text, type) {
    try {
      var url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })), a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000); return true;
    } catch (e) { return false; }
  }
  function fileName(m) { var base = String(m.title || 'kin').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'kin'; return base + (m.kind === 'design' || m.kind === 'chart' ? '.svg' : '.md'); }

  /* ---------------------------------------------------------------- a small, safe Markdown renderer.
     Builds DOM nodes with textContent only, so nothing in the text can become markup. */
  function inline(el, text) {
    var re = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g, last = 0, m;
    text = String(text);
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var n;
      if (m[2]) { n = document.createElement('strong'); n.textContent = m[2]; }
      else if (m[3] || m[4]) { n = document.createElement('em'); n.textContent = m[3] || m[4]; }
      else if (m[5]) { n = document.createElement('code'); n.textContent = m[5]; }
      else { n = document.createElement('a'); n.textContent = m[6]; n.href = m[7]; n.target = '_blank'; n.rel = 'noopener noreferrer'; }
      el.appendChild(n); last = re.lastIndex;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }
  function md(text, into) {
    var root = into || document.createElement('div'); root.textContent = '';
    var lines = String(text || '').replace(/\r/g, '').split('\n'), i = 0;
    function para(buf) { if (!buf.length) return; var p = document.createElement('p'); inline(p, buf.join(' ')); root.appendChild(p); }
    var buf = [];
    while (i < lines.length) {
      var l = lines[i];
      if (/^```/.test(l)) { para(buf); buf = []; var code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; var pre = document.createElement('pre'); pre.textContent = code.join('\n'); root.appendChild(pre); continue; }
      var h = /^(#{1,4})\s+(.*)$/.exec(l);
      if (h) { para(buf); buf = []; var hn = document.createElement(h[1].length <= 2 ? 'h3' : 'h4'); inline(hn, h[2]); root.appendChild(hn); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        para(buf); buf = []; var tbl = document.createElement('table'), cells = function (s) { return s.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
        var tr = document.createElement('tr'); cells(l).forEach(function (c) { var th = document.createElement('th'); inline(th, c); tr.appendChild(th); }); var th0 = document.createElement('thead'); th0.appendChild(tr); tbl.appendChild(th0);
        var tb = document.createElement('tbody'); i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { var r = document.createElement('tr'); cells(lines[i]).forEach(function (c) { var td = document.createElement('td'); inline(td, c); r.appendChild(td); }); tb.appendChild(r); i++; }
        tbl.appendChild(tb); var wrap = document.createElement('div'); wrap.className = 'tbl'; wrap.appendChild(tbl); root.appendChild(wrap); continue;
      }
      var li = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(l);
      if (li) {
        para(buf); buf = []; var ol = /\d/.test(li[1]), list = document.createElement(ol ? 'ol' : 'ul');
        while (i < lines.length) { var x = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(lines[i]); if (!x) break; var item = document.createElement('li'); inline(item, x[2]); list.appendChild(item); i++; }
        root.appendChild(list); continue;
      }
      if (/^>\s?/.test(l)) { para(buf); buf = []; var q = document.createElement('blockquote'); inline(q, l.replace(/^>\s?/, '')); root.appendChild(q); i++; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { para(buf); buf = []; root.appendChild(document.createElement('hr')); i++; continue; }
      if (!l.trim()) { para(buf); buf = []; i++; continue; }
      buf.push(l.trim()); i++;
    }
    para(buf);
    return root;
  }

  /* ---------------------------------------------------------------- numbers said as words */
  var NUM1 = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var NUM10 = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  function isNum(w) { return w in NUM1 || w in NUM10 || w === 'hundred' || w === 'thousand'; }
  /** "one thirty five" is 135 and "four oh five" is 405, as people say weights */
  function runValue(ws) {
    var ch = [], i = 0, w, v;
    while (i < ws.length) { w = ws[i];
      if (w === 'hundred' || w === 'thousand' || w === 'oh') ch.push(w);
      else if (w in NUM10) { v = NUM10[w]; if (i + 1 < ws.length && ws[i + 1] in NUM1 && NUM1[ws[i + 1]] > 0 && NUM1[ws[i + 1]] < 10) { v += NUM1[ws[i + 1]]; i++; } ch.push(v); }
      else if (w in NUM1) ch.push(NUM1[w]);
      i++; }
    if (ch.indexOf('hundred') >= 0 || ch.indexOf('thousand') >= 0) { var total = 0, cur = 0; ch.forEach(function (c) { if (c === 'hundred') cur = (cur || 1) * 100; else if (c === 'thousand') { total += (cur || 1) * 1000; cur = 0; } else if (c !== 'oh') cur += c; }); return total + cur; }
    if (ch.length === 1) return ch[0] === 'oh' ? 0 : ch[0];
    if (ch.length === 2 && typeof ch[0] === 'number' && typeof ch[1] === 'number' && ch[0] >= 1 && ch[1] >= 10) return ch[0] * 100 + ch[1];
    if (ch.length === 3 && ch[1] === 'oh' && typeof ch[0] === 'number' && ch[0] <= 9 && typeof ch[2] === 'number' && ch[2] <= 9) return ch[0] * 100 + ch[2];
    return +ch.map(function (c) { return c === 'oh' ? 0 : c; }).join('');
  }
  function numify(text) {
    var tk = String(text || '').split(/(\s+|[,;!?]|\.(?=\s|$))/), out = [], i = 0;
    var word = function (k) { return (tk[k] || '').toLowerCase(); }, next = function (k) { k++; while (k < tk.length && /^\s*$/.test(tk[k])) k++; return k; };
    while (i < tk.length) {
      var w = word(i);
      if (isNum(w) && w !== 'oh') {
        var run = [w], j = i, k = next(j);
        while (k < tk.length && isNum(word(k))) { run.push(word(k)); j = k; k = next(k); }
        out.push(String(runValue(run))); i = j + 1;
      } else { out.push(tk[i]); i++; }
    }
    return out.join('');
  }

  /* ---------------------------------------------------------------- the logbook: instant, no model */
  var LOG_MAX = 1000;
  function kindOf(t) {
    if (/\b(torque|torqued|bolt|axle|controller|battery|motor|sprocket|chain|brake|tyre|tire|fork|shock|swap(ped)?|install(ed)?|upgrade|mod(ded)?)\b/i.test(t)) return 'mod';
    if (/\b(batch|brew|syrup|ph|brix|ferment|bottled|canned|recipe|flavou?r)\b/i.test(t)) return 'batch';
    if (/\b(print(ed)?|solder(ed)?|wired|wiring|cad|prototype|build|built|assembl(e|ed|y))\b/i.test(t)) return 'build';
    return 'note';
  }
  function addLog(kind, text, extra) {
    var e = { id: uid('l'), kind: kind, text: String(text).slice(0, 400), at: Date.now() };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    data.log.unshift(e); if (data.log.length > LOG_MAX) data.log.length = LOG_MAX; save('log'); return e;
  }
  function dropLog(id) { data.log = data.log.filter(function (e) { return e.id !== id; }); save('log'); }
  var EXERCISE = 'bench(?: press)?|squats?|deadlifts?|overhead press|ohp|press|rows?|pull ?ups?|chin ?ups?|dips?|curls?|lunges?|rdls?|hip thrusts?|leg press|incline(?: bench)?|push ?ups?|lat pull ?downs?|cleans?|snatch(?:es)?';
  var SET_RE = new RegExp('^(?:log |logged )?(' + EXERCISE + ')[ ,:]+(\\d+(?:\\.\\d+)?)\\s*(?:lbs?|pounds|kg|kilos)?\\s*(?:for|x|by|times)\\s*(\\d+)(?:\\s*(?:reps?))?[.!]?$', 'i');
  function instantLog(raw) {
    var t = numify(String(raw || '').trim()).replace(/\s+/g, ' ');
    var s = SET_RE.exec(t);
    if (s) { var e = addLog('workout', s[1].toLowerCase() + ' ' + s[2] + ' for ' + s[3], { exercise: s[1].toLowerCase(), weight: +s[2], reps: +s[3] }); return { say: 'Done, sir.', show: 'Logged a set: ' + e.text + '.', clip: 'done' }; }
    var m = /^(?:kin[, ]+|jarvis[, ]+)?(?:please )?(?:log(?: that)?|note(?: that)?|add to (?:the |my )?log(?:book)?)[:, ]+(.{3,})$/i.exec(t);
    if (m && !/^(in|into|onto)\b/i.test(m[1])) { var txt = m[1].replace(/[.!]+$/, ''), k = kindOf(txt); addLog(k, txt); return { say: 'Done, sir.', show: 'Logged (' + k + '): ' + txt + '.', clip: 'done' }; }
    if (/^(?:what(?:'s| is) in (?:the |my )?log(?:book)?|show (?:me )?(?:the |my )?log(?:book)?|read (?:me )?(?:the |my )?log(?:book)?)[?.!]*$/i.test(t)) {
      if (!data.log.length) return { say: 'The logbook is empty, sir.', show: 'The logbook is empty, sir.' };
      var last = data.log.slice(0, 5).map(function (e) { return e.text; });
      return { say: 'The last ' + last.length + ' entries, sir: ' + last.join('. ') + '.', show: 'Last entries:\n' + data.log.slice(0, 5).map(function (e) { return '- ' + new Date(e.at).toLocaleDateString() + ' (' + e.kind + '): ' + e.text; }).join('\n'), open: 'log' };
    }
    return null;
  }

  /* ---------------------------------------------------------------- timers: instant, no model */
  /* timers: several at once, each with a name ("Pasta", "Eggs", "Rest", "Timer 2"); the soonest shows in the status line.
     They are kept in this browser (kin.timers), so a reload or a sleeping laptop does not lose them, and other tabs
     follow them (one tab says each one); at an address shared with other pages they live in memory only */
  var timers = [], timerSubs = [], tiv = 0, tto = 0, ttoEnd = 0, MAX_TIMERS = 8, TKEY = 'kin.timers', trestored = false, tseq = 0, doneIds = {};
  function tid() { return 't' + (++tseq) + Date.now().toString(36); }
  function onTimer(f) { timerSubs.push(f); if (!trestored) { trestored = true; tload(true); } }
  function leftOf(x) { return Math.max(0, Math.ceil((x.end - Date.now()) / 1000)); }
  function bySoon(a, b) { return a.end - b.end; }
  function soonest() { return timers.slice().sort(bySoon)[0] || null; }
  function sameName(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  function tstate() { var s = soonest(); return s ? { left: leftOf(s), label: s.label, more: timers.length - 1 } : null; }
  function temit(st) { timerSubs.forEach(function (f) { try { f(st); } catch (e) {} }); }
  function tick() { temit(tstate()); }
  function tsave() { if (Kin.shared) return; try { if (timers.length) localStorage.setItem(TKEY, JSON.stringify(timers.map(function (x) { return { end: x.end, label: x.label, total: x.total }; }))); else localStorage.removeItem(TKEY); } catch (e) {} }
  /* what this browser keeps: read on the first listener (after a reload) and whenever another tab changes it. A timer
     that is no longer there is let go here too, and one that went off is marked so its card says Done */
  function tload(first) {
    if (Kin.shared) return;
    var a = null, now = Date.now(); try { a = JSON.parse(localStorage.getItem(TKEY) || 'null'); } catch (e) {}
    if (!Array.isArray(a)) { if (first) return; a = []; }
    var next = [];
    a.slice(0, MAX_TIMERS).forEach(function (x) {
      var end = x ? +x.end : NaN, label = x && typeof x.label === 'string' ? x.label.replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24) : '';
      /* nothing longer than four hours; one that went off more than half an hour ago is let go; one name once */
      if (!label || !isFinite(end) || end > now + 4 * 3600000 + 60000 || end < now - 30 * 60000 || next.some(function (y) { return sameName(y.label, label); })) return;
      var total = x && +x.total > 0 && +x.total <= 4 * 3600 ? +x.total : Math.max(1, Math.min(4 * 3600, Math.ceil((end - now) / 1000)));
      var had = timers.filter(function (y) { return sameName(y.label, label) && y.end === end; })[0];
      if (had) { had.total = total; next.push(had); } else next.push({ id: tid(), end: end, label: label, total: total });
    });
    if (!first) timers.forEach(function (y) { if (next.indexOf(y) < 0 && y.end <= now + 1000) doneIds[y.id] = y.end; });
    timers = next; if (first) tsave();
    if (timers.length) loop(); else if (tiv) { clearInterval(tiv); tiv = 0; }
    tick(); tarm();
  }
  try { window.addEventListener('storage', function (e) { if (e.key === TKEY && trestored) tload(false); }); } catch (e) {}
  /* "Timer", "Rest" and "Timer 2" stand alone; any other name is "the pasta timer" */
  function plainLabel(l) { return /^(?:timer|rest)(?: \d)?$/i.test(l); }
  function phrase(l) { return plainLabel(l) ? l : 'the ' + l.toLowerCase() + ' timer'; }
  /* in a list "the rest timer" reads better than "Rest"; "cancel timer 1" names the plain one when there are more */
  function listName(l) { return /^rest$/i.test(l) ? 'the rest timer' : phrase(l); }
  function sayCancel(l) { return 'cancel ' + (/^rest$/i.test(l) ? 'the rest timer' : /^timer$/i.test(l) ? 'timer 1' : plainLabel(l) ? l.toLowerCase() : phrase(l)); }
  function stillRunning() { var a = timers.slice().sort(bySoon).map(function (x) { return listName(x.label); }); return a.length ? ' ' + cap1(andList(a)) + (a.length > 1 ? ' are' : ' is') + ' still running.' : ''; }
  function andList(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function cap1(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  /* "Timer is up", "The pasta timer is up", "The pasta timer and the eggs timer are up", "The pasta timer went off 12
     minutes ago" (or 3 hours ago, after a laptop slept with the page open) */
  function upWords(list, now) {
    var subj = cap1(andList(list.map(function (x) { return phrase(x.label); })));
    if (!now) return subj + (list.length > 1 ? ' are up' : ' is up');
    var mins = Math.round((now - list[0].end) / 60000), hrs = Math.round(mins / 60);
    return subj + ' went off ' + (list.length > 1 ? 'while you were away' : mins <= 1 ? 'a minute ago' : mins < 60 ? mins + ' minutes ago' : hrs <= 1 ? 'an hour ago' : hrs + ' hours ago');
  }
  /* one tab says each one: the first to reach it marks it in kin.timers.rung (under a lock where the browser has them) */
  function ring(ev, done) {
    if (Kin.shared) { temit(ev); return; }
    var sig = done.map(function (x) { return x.label.toLowerCase() + '@' + x.end; }).sort().join('|'), RK = TKEY + '.rung';
    var go = function () {
      var r = [], now = Date.now(); try { r = JSON.parse(localStorage.getItem(RK) || '[]'); } catch (e) {}
      if (!Array.isArray(r)) r = [];
      r = r.filter(function (x) { return x && typeof x.sig === 'string' && now - x.at < 10 * 60000; });
      if (r.some(function (x) { return x.sig === sig; })) return;
      r.push({ sig: sig, at: now }); try { localStorage.setItem(RK, JSON.stringify(r.slice(-20))); } catch (e) {}
      temit(ev);
    };
    try { if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') { navigator.locks.request(RK, go).catch(go); return; } } catch (e) {}
    go();
  }
  function tcheck() {
    var now = Date.now(), done = timers.filter(function (x) { return now >= x.end; });
    if (done.length) {
      timers = timers.filter(function (x) { return now < x.end; }); tsave();
      Object.keys(doneIds).forEach(function (k) { if (now - doneIds[k] > 3600000) delete doneIds[k]; }); done.forEach(function (x) { doneIds[x.id] = x.end; });
      /* a hidden tab can run a minute behind; only a timer that went off well before now (a closed page, a sleeping laptop) is "late" */
      var late = done.filter(function (x) { return now - x.end > 120000; }).sort(bySoon), fresh = done.filter(function (x) { return now - x.end <= 120000; });
      var words = [fresh.length ? upWords(fresh) : '', late.length ? upWords(late, now) : ''].filter(Boolean).join('. ');
      ring({ done: true, label: done[0].label, labels: done.map(function (x) { return x.label; }), ids: done.map(function (x) { return x.id; }), words: words, late: !fresh.length, more: timers.length }, done);
    }
    if (!timers.length && tiv) { clearInterval(tiv); tiv = 0; }
    tick(); tarm();
  }
  function loop() { if (!tiv) tiv = setInterval(tcheck, 250); }
  /* a one-off wake at the soonest end as well: a background tab runs the 250 ms loop only about once a minute */
  function tarm() { var s = soonest(), e = s ? s.end : 0; if (e === ttoEnd) return; clearTimeout(tto); tto = 0; ttoEnd = e; if (s) tto = setTimeout(function () { ttoEnd = 0; tcheck(); }, Math.max(0, e - Date.now()) + 30); }
  /* finds a timer by name: exactly, then without a plural "s", then by a word of its name when only one has it */
  function findTimer(name) {
    var n = String(name || '').toLowerCase().trim(), sing = function (w) { return w.replace(/(?:es|s)$/, ''); };
    if (!n) return null;
    var hit = timers.filter(function (x) { return x.label.toLowerCase() === n; })[0] || timers.filter(function (x) { return sing(x.label.toLowerCase()) === sing(n); })[0];
    if (hit) return hit;
    var words = timers.filter(function (x) { return (' ' + x.label.toLowerCase() + ' ').indexOf(' ' + n + ' ') >= 0 || (' ' + sing(x.label.toLowerCase()) + ' ').indexOf(' ' + sing(n) + ' ') >= 0; });
    return words.length === 1 ? words[0] : null;
  }
  /** starts a timer; one of the same name starts again. Returns { id, again }, or null when eight already run */
  function startTimer(sec, label) {
    label = label || 'Timer'; sec = Math.max(1, Math.min(4 * 3600, Math.round(sec)));
    var had = timers.length; timers = timers.filter(function (x) { return !sameName(x.label, label); });
    var again = timers.length < had;
    if (timers.length >= MAX_TIMERS) { tick(); return null; }
    var x = { id: tid(), end: Date.now() + sec * 1000, label: label, total: sec };
    timers.push(x); tsave(); loop(); tick(); tarm(); return { id: x.id, again: again };
  }
  /** the card under a timer's answer (app.js): a minute more (never past four hours), cancel, or the same again */
  function timerAdd(id, sec) {
    var x = timers.filter(function (y) { return y.id === id; })[0]; if (!x) return false;
    var add = Math.max(0, Math.min(sec, 4 * 3600 - leftOf(x))); x.end += add * 1000; x.total = Math.min(4 * 3600, x.total + add); tsave(); tick(); tarm(); return add > 0;
  }
  function timerCancel(id) { var n = timers.length; timers = timers.filter(function (y) { return y.id !== id; }); if (timers.length === n) return false; tchanged(); return true; }
  /** stops one timer by its name, or all of them */
  function stopTimer(quiet, label) {
    if (label) timers = timers.filter(function (x) { return !sameName(x.label, label); }); else timers = [];
    tchanged();
  }
  /* after a timer stops: kept, the loop ends with the last one, and the status line hears */
  function tchanged() { tsave(); if (!timers.length && tiv) { clearInterval(tiv); tiv = 0; } tick(); tarm(); }
  function fmt(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60, ss = s + (s === 1 ? ' second' : ' seconds');
    if (h) return h + (h === 1 ? ' hour' : ' hours') + (m ? ' ' + m + (m === 1 ? ' minute' : ' minutes') : '') + (s ? ' ' + ss : '');
    return m ? m + (m === 1 ? ' minute' : ' minutes') + (s ? ' ' + ss : '') : ss;
  }
  function clockText(sec) { var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2); }
  function timerList() { return timers.slice().sort(bySoon).map(function (x) { return x.label + ' ' + clockText(leftOf(x)); }); }
  /* words that are not a timer's name ("is there a timer", "a good timer") */
  var NOT_NAME = /\b(?:is|are|was|were|be|there|what|whats|how|why|when|where|which|who|can|could|would|should|will|do|does|did|i|you|we|it|its|this|that|these|those|a|an|the|for|of|to|in|on|at|with|and|or|not|no|please|set|start|make|put|need|want|get|give|me|my|just|some|good|best|any|timer|timers|alarm|countdown|stopwatch|reminder|clock|minute|minutes|second|seconds|hour|hours)\b/;
  /* "another", "a second", "a new" timer is one more unnamed timer */
  var MORE_WORDS = /^(?:new|another|other|second|extra|one more|quick|short)\b ?/;
  /* a timer's name, from "set a pasta timer", "a timer for the eggs": up to three plain words */
  function timerName(w) {
    w = String(w || '').trim().replace(/^(?:the|my|a|an)\s+/, '');
    while (MORE_WORDS.test(w)) w = w.replace(MORE_WORDS, '');
    if (!w || w.length > 24 || /\d/.test(w) || w.split(' ').length > 3 || NOT_NAME.test(w)) return '';
    return cap1(w);
  }
  /* words that point at a timer without naming it: "that timer", "the running timer", "stop the timer for me" */
  var POINT = /^(?:that|this|it|the other|other|running|current|active|last|latest|one|me|for me)$/;
  /* the timer a request means: by name ("pasta", "rest", "timer 2", "the second timer"), or the only one */
  function whichTimer(w) {
    w = String(w || '').trim().replace(/^(?:the|my)\s+/, '').replace(/\s+timer$/, '');
    var m = /^(?:timer )?(\d)$/.exec(w) || /^(second|third|fourth|fifth)$/.exec(w);
    if (m) { var n = +m[1] || { second: 2, third: 3, fourth: 4, fifth: 5 }[m[1]]; return { name: n === 1 ? 'Timer' : 'Timer ' + n, hit: findTimer(n === 1 ? 'Timer' : 'Timer ' + n) }; }
    if (w === 'first') return { name: 'Timer', hit: findTimer('Timer') || timers.slice().sort(bySoon)[0] || null };
    if (!w || POINT.test(w)) return { name: '', hit: timers.length === 1 ? timers[0] : null };
    if (w === 'timer') return { name: '', hit: timers.length === 1 ? timers[0] : findTimer('Timer') };
    if (w === 'rest') return { name: 'Rest', hit: findTimer('Rest') };
    var nm = timerName(w);
    if (!nm) return { name: '', hit: timers.length === 1 ? timers[0] : null };
    return { name: nm, hit: findTimer(nm) };
  }
  function noSuch(name) { return { say: 'There is no ' + phrase(name).replace(/^the /, '') + ' running, sir.', show: 'No ' + phrase(name).replace(/^the /, '') + '. Running: ' + timerList().join(', ') + '.' }; }
  var T_VERB = '(?:cancel|stop|clear|kill|end|delete|remove|turn off|switch off)', T_NAME = '([a-z][a-z ]{0,23}?(?: \\d)?)';
  var T_ALL = new RegExp('^' + T_VERB + ' (?:(?:all|both)(?: (?:of )?(?:the|my))? timers|every timer|(?:the |my )?timers)$');
  var T_ONE = new RegExp('^' + T_VERB + '(?: the| my)?(?: ' + T_NAME + ')? timer(?: (\\d))?(?: for (?:the |my )?' + T_NAME + ')?$');
  /* "cancel the eggs": only when a running timer has that name */
  var T_BARE = new RegExp('^' + T_VERB + ' (?:the |my )?([a-z][a-z ]{0,23})$');
  var T_LEFT = new RegExp('^(?:how (?:long|much time)(?: is| do i have| have i got)? left|time left|how long on the timer|how long is left|how much longer|how much time|what(?:\'?s| is) left)(?: (?:on|for) (?:the |my )?' + T_NAME + '(?: timer)?)?$');
  var T_UNTIL = new RegExp('^how (?:long|much longer) (?:until|till|before) (?:the |my )?' + T_NAME + '(?: timer)? (?:is |are |goes |go |will be |will |comes |gets? )?(?:done|ready|up|finished|off|out)$');
  var T_IT = /^how (?:long|much longer) (?:until|till|before) (?:it'?s|it is|it will be|it'?ll be|it goes off) ?(?:done|ready|up|finished|off)?$/;
  var T_LIST = /^(?:(?:what|which) timers (?:are (?:running|going|set|on)|do i have(?: running| going| set)?|have i got)|(?:list|show)(?: me)?(?: all)?(?: of)? (?:my |the )?timers|(?:are there |do i have |have i got )?any timers(?: running| going| set| on)?|(?:my )?timers)$/;
  var T_UNIT = '(seconds?|secs?|s|minutes?|mins?|m)';
  var T_SET1 = new RegExp('^(?:(?:set|start|put on|make)(?: me)? )?(?:a |an |the |my |another |one more )?(?:' + T_NAME + ' )?(rest timer|timer|rest)(?: (?:called|named) ' + T_NAME + ')?(?: for (?:the |my )?' + T_NAME + ')?(?: for)? (\\d+(?:\\.\\d+)?) ?' + T_UNIT + '(?: for (?:the |my )?' + T_NAME + ')?(?: (?:called|named) ' + T_NAME + ')?$');
  var T_SET2 = new RegExp('^(?:(?:set|start|put on|make)(?: me)? )?(?:a |an |another |one more )?(\\d+(?:\\.\\d+)?)[ -]?(seconds?|secs?|minutes?|mins?)(?: (rest))?(?: ' + T_NAME + ')?( timer)?(?: for (?:the |my )?' + T_NAME + ')?(?: (?:called|named) ' + T_NAME + ')?$');
  function instantTimer(raw) {
    var t = numify(String(raw || '').trim().toLowerCase()).replace(/[.!?]+$/, '').replace(/^(?:(?:hey|ok|okay) )?(?:jarvis|kin)[,!.]? /, '').replace(/^(?:(?:please|can you|could you|would you) )+/, '').replace(/,? please$/, '').replace(/,\s+/g, ' ').replace(/\s+/g, ' ')
      .replace(/\b1st\b/g, 'first').replace(/\b2nd\b/g, 'second').replace(/\b3rd\b/g, 'third').replace(/\b4th\b/g, 'fourth').replace(/\b5th\b/g, 'fifth')
      /* "an hour", "half an hour", "an hour and a half", "1 hour 30 minutes" become minutes the patterns below read */
      .replace(/\b(?:an|one|1) hour and a half\b/, '90 minutes').replace(/\bhalf an hour\b/, '30 minutes').replace(/\b(?:an|one) hour\b/, '1 hour')
      .replace(/(\d+(?:\.\d+)?) ?(?:hours?|hrs?|h)(?:,? and)? (\d+) ?(?:minutes?|mins?|m)\b/, function (x, h, mi) { return (Math.round(+h * 60) + +mi) + ' minutes'; })
      .replace(/(\d+(?:\.\d+)?) ?(?:hours?|hrs?)\b/, function (x, h) { return Math.round(+h * 60) + ' minutes'; })
      .replace(/\bfor a minute$/, 'for 1 minute');
    var m, w, none = { say: 'There is no timer running, sir.', show: 'No timer running.' };
    /* cancel all of them */
    if (T_ALL.test(t)) { if (!timers.length) return none; var nAll = timers.length, only = timers[0].label; stopTimer(); return { say: nAll === 1 ? cap1(phrase(only)) + ' is cancelled, sir.' : 'All ' + nAll + ' timers cancelled, sir.', show: nAll === 1 ? 'Cancelled: ' + only + '.' : 'Cancelled all ' + nAll + ' timers.' }; }
    /* cancel one: by name, the one meant, or the only one */
    if ((m = T_ONE.exec(t))) {
      if (!timers.length) return none;
      w = whichTimer(m[2] ? 'timer ' + m[2] : m[1] || m[3] || '');
      if (w.hit) { stopTimer(true, w.hit.label); return { say: cap1(phrase(w.hit.label)) + ' is cancelled, sir.' + stillRunning(), show: 'Cancelled: ' + w.hit.label + '.' + (timers.length ? ' Still running: ' + timerList().join(', ') + '.' : '') }; }
      if (w.name) return noSuch(w.name);
      return { say: 'You have ' + timers.length + ' timers, sir: ' + andList(timers.slice().sort(bySoon).map(function (x) { return listName(x.label); })) + '. Which one?', show: 'Running: ' + timerList().join(', ') + '. Say "' + sayCancel(soonest().label) + '" or "cancel all timers".' };
    }
    if ((m = T_BARE.exec(t)) && timers.length) {
      var bn = timerName(m[1]), bh = bn ? findTimer(bn) : null;
      if (bh) { stopTimer(true, bh.label); return { say: cap1(phrase(bh.label)) + ' is cancelled, sir.' + stillRunning(), show: 'Cancelled: ' + bh.label + '.' + (timers.length ? ' Still running: ' + timerList().join(', ') + '.' : '') }; }
    }
    /* how long is left: on one by name, the only one, or all of them */
    if ((m = T_LEFT.exec(t) || T_UNTIL.exec(t)) || T_LIST.test(t) || T_IT.test(t)) {
      /* "how long left on the lease", "how much longer for the delivery", "how long until the turkey is done": questions for
         Claude unless they say "timer" or name a timer that is running */
      var said = /\btimers?\b/.test(t), bare = /^(?:how (?:long|much time)(?: is)? left|time left|how long is left)$/.test(t);
      if (!timers.length) return said || bare ? none : null;
      w = m ? whichTimer(m[1] || '') : { name: '', hit: T_IT.test(t) && timers.length === 1 ? timers[0] : null };
      if (w.name && !w.hit) return said ? noSuch(w.name) : null;
      if (w.hit) { var l = leftOf(w.hit), on = timers.length > 1 || !plainLabel(w.hit.label) ? ' on ' + phrase(w.hit.label) : ''; return { say: fmt(l) + ' left' + on + ', sir.', show: w.hit.label + ': ' + fmt(l) + ' left.', timers: [w.hit.id] }; }
      var srt = timers.slice().sort(bySoon);
      return { say: (srt.length === 1 ? 'One timer, sir: ' : srt.length + ' timers, sir: ') + srt.map(function (x) { return x.label.toLowerCase() + ', ' + fmt(leftOf(x)); }).join('; ') + '.', show: 'Running: ' + timerList().join(', ') + '.', timers: srt.map(function (x) { return x.id; }) };
    }
    /* set: "set a timer for 10 minutes", "set a pasta timer for 10 minutes", "10 minute timer for the eggs", "rest 90 seconds",
       "another timer for 5 minutes", "a timer for the rice for 10 minutes", "a timer for 10 minutes called rice" */
    var name = '', n, unit, rest = false, worded = true;
    if ((m = T_SET1.exec(t))) { name = m[1] || m[3] || m[4] || m[7] || m[8] || ''; rest = /rest/.test(m[2]); n = +m[5]; unit = m[6]; }
    else if ((m = T_SET2.exec(t))) {
      n = +m[1]; unit = m[2]; rest = !!m[3]; worded = !!m[5] || rest;
      /* "a 5 minute timer for the eggs": the name pattern can take the word timer itself */
      var nm4 = m[4] || ''; if (/(?:^| )timer$/.test(nm4)) { worded = true; nm4 = nm4.replace(/ ?timer$/, ''); }
      name = nm4 || m[6] || m[7] || '';
    }
    /* "time the eggs for 4 minutes", "time it for 5 minutes" */
    else if ((m = /^time (?:the |my |a )?([a-z][a-z ]{0,23}?) for (\d+(?:\.\d+)?) ?(seconds?|secs?|minutes?|mins?)$/.exec(t))) { name = /^(?:it|this|that)$/.test(m[1]) ? '' : m[1]; n = +m[2]; unit = m[3]; }
    else return null;
    if (/^rest$/.test(name.trim())) { rest = true; name = ''; }
    var sec = Math.round(/^m/.test(unit) ? n * 60 : n);
    if (!(sec >= 1)) return null;
    if (sec > 4 * 3600) return !worded ? null : { say: 'Timers go up to four hours, sir. For longer, ask me to remind you.', show: 'Timers go up to 4 hours. For longer, say "remind me in 5 hours to ...".' };
    var label = timerName(name), more = /\b(?:another|one more|extra|new)\b|\bsecond timer\b|\bother timer\b/.test(t);
    if (name && !label && !MORE_WORDS.test(name.trim().replace(/^(?:the|my|a|an) /, ''))) return null;
    if (label && !worded) return null;   /* "10 minutes for the eggs" without the word timer is left to Claude */
    if (!label) label = rest ? 'Rest' : 'Timer';
    /* "another timer" while one runs is Timer 2, Timer 3 ... */
    if (label === 'Timer' && more && findTimer('Timer')) { for (var k = 2; k < 10 && findTimer('Timer ' + k); k++); label = 'Timer ' + k; }
    var st = startTimer(sec, label);
    if (!st) return { say: 'You have eight timers running, sir. Cancel one first.', show: 'Eight timers are running: ' + timerList().join(', ') + '. Cancel one first.' };
    var nameT = plainLabel(label) ? label : label + ' timer', others = timers.filter(function (x) { return x.label !== label; });
    var also = others.length ? ' Also running: ' + others.slice().sort(bySoon).map(function (x) { return x.label + ' ' + clockText(leftOf(x)); }).join(', ') + '.' : '';
    if (st.again && label !== 'Rest') return { say: nameT + ' restarted, ' + fmt(sec) + ', sir.', show: nameT + ' restarted: ' + fmt(sec) + '.' + also, timers: [st.id] };
    return { say: nameT + ', ' + fmt(sec) + '. Starting now, sir.', show: nameT + ': ' + fmt(sec) + '.' + also, timers: [st.id] };
  }

  /* ---------------------------------------------------------------- protocols: named routines, instant, from what is on this device */
  function dated(days) { return Kin.pack && Kin.pack.get() ? Kin.pack.dates(days) : []; }
  function when(n) { var k = Kin.daysTo(n.d); return k === 0 ? 'today' : k === 1 ? 'tomorrow' : Kin.day(n.d); }
  var PROTOCOLS = {
    morning: { name: 'Morning brief', run: function () {
      var d = dated(7), h = new Date().getHours(), hi = h < 12 ? 'Good morning, sir.' : h < 18 ? 'Good afternoon, sir.' : 'Good evening, sir.';
      /* today's reminders by time only, and what is left on the to-do list (both kept on this device) */
      var hm = function (t) { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
      var rt = Kin.remind ? Kin.remind.today() : [], td = Kin.lists && Kin.lists.get ? Kin.lists.get('to-do') : null, left = td ? td.items.filter(function (x) { return !x.done; }).length : 0;
      var extra = (rt.length ? ' ' + (rt.length === 1 ? 'One reminder today, at ' + hm(rt[0].at) : rt.length + ' reminders today, the first at ' + hm(rt[0].at)) + '.' : '') + (left ? ' ' + (left === 1 ? 'One thing is' : left + ' things are') + ' on your to-do list.' : '');
      hi += extra;
      if (!Kin.pack.get()) return { say: hi + ' I hold no pack on this device yet, so I have nothing dated to brief you on.', show: hi + ' No pack on this device yet. In the Atlas: Kin\'s settings > Your data > Export everything. Then here: Settings > Import Kin pack.' };
      var lines = d.slice(0, 4).map(function (n) { return n.t + ', ' + when(n); });
      var sets = data.log.filter(function (e) { return Date.now() - e.at < 864e5; }).length;
      var say = hi + ' ' + (d.length ? d.length + (d.length === 1 ? ' thing is' : ' things are') + ' dated in the next seven days. First: ' + lines.join('. ') + '.' : 'Nothing is dated in the next seven days.') + (sets ? ' You logged ' + sets + (sets === 1 ? ' entry' : ' entries') + ' in the last day.' : '');
      return { say: say, show: say };
    } },
    shutdown: { name: 'Shutdown', run: function () {
      var day = data.log.filter(function (e) { return new Date(e.at).toDateString() === new Date().toDateString(); }), tom = dated(1).filter(function (n) { return Kin.daysTo(n.d) === 1; });
      var say = (day.length ? 'Today you logged ' + day.length + (day.length === 1 ? ' entry' : ' entries') + ': ' + day.slice(0, 3).map(function (e) { return e.text; }).join('. ') + '.' : 'Nothing was logged today.') + ' ' + (tom.length ? 'First thing tomorrow: ' + tom[0].t + '.' : 'Nothing is dated for tomorrow.') + ' Rest well, sir.';
      return { say: say, show: say, sleep: true };
    } },
    focus: { name: 'Focus', run: function () {
      var d = dated(30), one = d[0];
      var say = one ? 'The one thing, sir: ' + one.t + ', ' + when(one) + '. I will keep quiet until you call.' : 'Nothing dated is pressing, sir. Pick the hardest thing and start. I will keep quiet until you call.';
      return { say: say, show: say, sleep: true };
    } }
  };
  function instantProtocol(raw) {
    var t = String(raw || '').toLowerCase().replace(/[.!?]+$/, '').trim();
    var m = /^(?:run |start |do )?(?:the |my )?(morning(?: brief| protocol| briefing)?|shutdown(?: protocol)?|shut down(?: protocol)?|focus(?: mode| protocol)?)(?: protocol)?(?: please)?$/.exec(t);
    if (!m) return null;
    var key = /^morning/.test(m[1]) ? 'morning' : /^shut/.test(m[1]) ? 'shutdown' : 'focus';
    var r = PROTOCOLS[key].run(); r.protocol = PROTOCOLS[key].name; return r;
  }
  function instantHelp(raw) {
    if (!/^(help|what can (you|i) (do|say)|what do you do|commands)[?.! ]*$/i.test(String(raw || '').trim())) return null;
    var show = 'Things you can say:\n- "hey Jarvis", "go to sleep", "stop"\n- "What is due this week?", "brief me", "what is the latest on ..."\n- "Design a poster for ...", "Write a plan for ...", "Make a table of ..."\n- "bench, 135 for 8", "log that I changed the brake pads", "rest 90 seconds", "set a timer for an hour", "set a pasta timer for 10 minutes", "how long left on the pasta"\n- "flip a coin", "roll two dice", "pick a number between 1 and 10", "start a stopwatch", "how many days until Christmas"\n- "what time is it in Tokyo", "what\'s the date", "is it going to rain", "weather tomorrow"\n- "what\'s 15% of 240", "20% tip on 85", "convert 5 miles to km"\n- "run the morning protocol", "shutdown", "focus"\n- "remind me at 3pm to call Sam", "remind me every weekday at 8 to stretch", "remind me on the 1st of every month to pay rent", "what are my reminders"\n- "add eggs and milk to my shopping list", "what\'s on my to-do list", "tick off eggs"\n- "ask Grok Bot ..." (when the Grok Bot bridge is on in settings)\n- "remember that ...", and the thumbs under each answer teach me what works.';
    return { say: 'It is on screen now, sir.', show: show };
  }
  /** Phrases Kin handles on this device at once, without Claude. Returns { say, show, clip?, sleep?, open? } or null. */
  function instant(text) {
    /* the answer to "When should I remind you?" comes first: "10 minutes" then is the reminder's time, not a timer */
    if (Kin.remind && Kin.remind.waiting()) { var rw = Kin.remind.instant(text); if (rw) return rw; }
    /* a list phrase before the logbook: "note down call Sam on my to-do list" goes on the list */
    var li = null; if (Kin.lists) { try { li = Kin.lists.instant(text); } catch (e) { li = null; } }
    return instantTimer(text) || (Kin.clock ? Kin.clock.instant(text) : null) || (Kin.quick ? Kin.quick.instant(text) : null) || (Kin.calc ? Kin.calc.instant(text) : null) || (Kin.weatherNow ? Kin.weatherNow.instant(text) : null) || li || instantLog(text) || instantProtocol(text) || instantHelp(text) || (Kin.remind ? Kin.remind.instant(text) : null);
  }

  /* ---------------------------------------------------------------- spend: an estimate from the token counts */
  /* dollars per million tokens: input, output, cache read, cache write (5-minute writes cost 1.25 times input) */
  var PRICES = {
    'claude-opus-5-5': [4, 20, 0.2, 5], 'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
    'claude-opus-4-8': [5, 25, 0.5, 6.25], 'claude-opus-5': [5, 25, 0.5, 6.25], 'claude-sonnet-5-5': [2, 10, 0.1, 2.5]
  };
  var SEARCH_USD = 0.01;
  function price(model) { var k = Object.keys(PRICES).filter(function (p) { return String(model || '').indexOf(p) === 0; }).sort(function (a, b) { return b.length - a.length; })[0]; return PRICES[k] || PRICES['claude-opus-5-5']; }
  function tokens(p, u) { return (u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]; }
  /** a request stopped part way (a stop, the watchdog, an error): what it probably cost, from the input counted at its start and the output that arrived */
  function partialCost(model, start, chars) { var u = Object.assign({}, start || {}); u.output_tokens = Math.max(u.output_tokens || 0, Math.ceil((chars || 0) / 3.5)); delete u.iterations; return costOf(model, u); }
  function costOf(model, u) {
    if (!u) return 0;
    /* with server-side fallbacks the top-level usage covers only the attempt that answered; usage.iterations holds every attempt, each at its own model's price */
    var c = Array.isArray(u.iterations) && u.iterations.length ? u.iterations.reduce(function (sum, it) { return sum + (it ? tokens(price(it.model || model), it) : 0); }, 0) : tokens(price(model), u);
    var ws = u.server_tool_use && u.server_tool_use.web_search_requests || 0;
    return c / 1e6 + ws * SEARCH_USD;
  }
  function day(key) { var v; try { v = JSON.parse(ls.get(key, '') || '{}'); } catch (e) { v = {}; } if (!v || v.day !== today()) v = { day: today(), n: 0, usd: 0 }; return v; }
  function addSpend(usd) { var v = day('kin.spend'); v.usd = Math.round((v.usd + (usd || 0)) * 1e5) / 1e5; v.n++; ls.set('kin.spend', JSON.stringify(v)); return v; }
  function spendToday() { return day('kin.spend'); }
  function webCap() { var v = parseInt(ls.get('kin.webcap', ''), 10); return v >= 0 && v <= 500 ? v : 30; }
  function setWebCap(n) { n = Math.round(+n); if (n >= 0 && n <= 500) ls.set('kin.webcap', String(n)); return webCap(); }
  function webToday() { return day('kin.web').n; }
  function addWeb(n) { if (!n) return; var v = day('kin.web'); v.n += n; ls.set('kin.web', JSON.stringify(v)); }
  function webLeft() { return Math.max(0, webCap() - webToday()); }

  /* ---------------------------------------------------------------- moving to another device
     Items from another device's export (see move.js) are merged in, never trusted as they come:
     memories are checked against the same never-keep rules as remember(), designs are cleaned again,
     and the same caps apply. Returns how many of each were added. */
  var MADE_KINDS = /^(document|plan|table|design|chart)$/, MADE_EXTRA = ['src', 'brief', 'concept', 'notes', 'why', 'caps', 'others', 'pictures', 'credits', 'usd', 'issues', 'spec', 'round', 'score'];
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function sid(v, p) { var t = str(v, 60); return /^[A-Za-z0-9_.:-]{1,60}$/.test(t) ? t : uid(p); }
  function mergeIn(inc) {
    var out = { memory: 0, made: 0, log: 0, refused: 0 };
    if (Kin.shared || !inc || typeof inc !== 'object') return out;
    var norm = function (t) { return Kin.ears ? Kin.ears.norm(t) : String(t).toLowerCase(); };
    if (Array.isArray(inc.memory)) {
      var seen = {}; data.memory.forEach(function (m) { seen[norm(m.text)] = 1; });
      inc.memory.slice(0, 1000).forEach(function (m) {
        if (!m || typeof m !== 'object') return;
        var text = str(m.text, 500).replace(/\s+/g, ' ').trim(); if (!text) return;
        if (refuse(text)) { out.refused++; return; }
        var n = norm(text); if (seen[n]) return; seen[n] = 1;
        var x = { id: sid(m.id, 'm'), text: text, kind: /^(fact|preference|lesson|correction|good|bad)$/.test(m.kind) ? m.kind : 'fact', at: num(m.at, Date.now()), uses: Math.max(0, num(m.uses, 0)) };
        if (m.q) x.q = str(m.q, 300);
        data.memory.push(x); out.memory++;
      });
      prune(); save('memory');
    }
    if (Array.isArray(inc.made)) {
      var have = {}; data.made.forEach(function (m) { have[m.id] = m; });
      inc.made.slice(0, 200).forEach(function (m) {
        if (!m || typeof m !== 'object' || !MADE_KINDS.test(m.kind)) return;
        var content = str(m.content, 2000000);
        if (m.kind === 'design' || m.kind === 'chart') { var c = cleanSvg(content); if (!c.ok) { out.refused++; return; } content = c.svg; }
        var id = sid(m.id, 'd'), old = have[id];
        if (old && num(old.at, 0) >= num(m.at, 0)) return;
        var x = { id: id, kind: m.kind, title: str(m.title, 200) || 'Untitled', note: str(m.note, 2000), content: content, at: num(m.at, Date.now()), round: 1, score: null };
        MADE_EXTRA.forEach(function (k) { if (m[k] !== undefined) { try { x[k] = JSON.parse(JSON.stringify(m[k])); } catch (e) {} } });
        if (old) data.made = data.made.filter(function (y) { return y.id !== id; });
        data.made.push(x); have[id] = x; out.made++;
      });
      data.made.sort(function (a, b) { return num(b.at, 0) - num(a.at, 0); });
      if (data.made.length > MADE_MAX) data.made.length = MADE_MAX;
      save('made');
    }
    if (Array.isArray(inc.log)) {
      var ids = {}; data.log.forEach(function (e) { ids[e.id] = 1; });
      inc.log.slice(0, LOG_MAX).forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        var text = str(e.text, 400); if (!text) return;
        var id = sid(e.id, 'l'); if (ids[id]) return; ids[id] = 1;
        var x = {}; Object.keys(e).slice(0, 20).forEach(function (k) { var v = e[k]; if (typeof v === 'string') x[k.slice(0, 30)] = v.slice(0, 400); else if (typeof v === 'number' && isFinite(v)) x[k.slice(0, 30)] = v; });
        x.id = id; x.text = text; x.kind = str(e.kind, 30) || 'note'; x.at = num(e.at, Date.now());
        data.log.push(x); out.log++;
      });
      data.log.sort(function (a, b) { return num(b.at, 0) - num(a.at, 0); });
      if (data.log.length > LOG_MAX) data.log.length = LOG_MAX;
      save('log');
    }
    return out;
  }
  /** flush pending saves now (an import reloads the page right after) */
  function flush() {
    var k = kv(); if (Kin.shared || !k) return Promise.resolve();
    Object.keys(saveT).forEach(function (n) { clearTimeout(saveT[n]); });
    return Promise.all(['memory', 'made', 'log'].map(function (n) { return k.set('mind.' + n, data[n]).catch(function () {}); }));
  }

  Kin.mind = {
    load: load, loaded: function () { return loaded; },
    memory: function () { return data.memory.slice(); }, remember: remember, forget: forget, forgetAll: forgetAll, recall: recall, rate: rate, noteCorrection: noteCorrection, refuse: refuse,
    made: function () { return data.made.slice(); }, addMade: addMade, getMade: getMade, dropMade: dropMade, cleanSvg: cleanSvg, svgUrl: svgUrl, svgToPng: svgToPng, download: download, fileName: fileName,
    withFonts: withFonts, measure: measure, wordProblems: wordProblems, banned: banned,
    log: function () { return data.log.slice(); }, addLog: addLog, dropLog: dropLog,
    instant: instant, numify: numify, onTimer: onTimer, timer: function () { var s = soonest(); return s ? { left: leftOf(s), label: s.label } : null; }, timers: function () { return timers.slice().sort(bySoon).map(function (x) { return { id: x.id, label: x.label, left: leftOf(x), end: x.end, total: x.total }; }); }, timerAdd: timerAdd, timerCancel: timerCancel, timerDone: function (id) { return !!doneIds[id]; }, timerStart: function (sec, label) { var st = startTimer(sec, label); return st ? st.id : ''; }, stopTimer: stopTimer, fmt: fmt,
    md: md,
    costOf: costOf, partialCost: partialCost, addSpend: addSpend, spendToday: spendToday, webCap: webCap, setWebCap: setWebCap, webToday: webToday, addWeb: addWeb, webLeft: webLeft,
    mergeIn: mergeIn, flush: flush,
    wipe: function () { data = { memory: [], made: [], log: [] }; stopTimer(true); var k = kv(); if (k) ['memory', 'made', 'log'].forEach(function (n) { k.del('mind.' + n).catch(function () {}); }); }
  };
})();
