/* away.js — Away mode for Jarvis (Kin.Away).
   While the owner is away, Jarvis keeps the routine going and decides how loudly to tell them about each thing:
     rung 0  log       kept quietly in the log
     rung 1  summary   held for the morning summary
     rung 2  push      a notification now
     rung 3  call      Jarvis phones the owner (only if they turned "Jarvis may call me" on)
   Every action has an authority level: auto (just do it), draft (prepare it, never send it), ok (needs an OK card).
   Anything that sends, posts, buys, books, calls, pays or deletes is locked at "ok" and can never be lowered.
   Nothing here touches the network. The host passes in `notify` (push) and `callOwner` (a phone call) when wiring it in.
   Works in the browser (window.Kin.Away) and in Node (module.exports) for the unit tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Kin = root.Kin || {}; root.Kin.Away = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RUNGS = ['log', 'summary', 'push', 'call'];
  var RUNG_TEXT = { log: 'Logged quietly', summary: 'Held for your morning summary', push: 'Sent you a notification', call: 'Called you' };
  var LEVELS = ['auto', 'draft', 'ok'];
  // kinds that act on the world: always need an OK card, whatever the settings say
  var LOCKED = ['send', 'post', 'buy', 'book', 'call', 'pay', 'delete'];
  var CONTACT = ['send', 'post', 'call', 'book'];
  var KINDS = { read: 'auto', draft: 'auto', send: 'ok', post: 'ok', buy: 'ok', book: 'ok', call: 'ok', pay: 'ok', delete: 'ok' };
  var DEFAULTS = {
    on: false,
    quiet: { start: '22:00', end: '07:00' },
    dailyCap: 2,            // dollars Jarvis may spend per day on its own work while away (model calls, searches)
    callMe: [],             // people or words that mean "call me now" (empty until the owner fills it in)
    never: [],              // people Jarvis must never contact
    allowCallMe: false,     // the owner's standing OK for Jarvis to phone them for rung-3 things
    maxCallsPerDay: 2,
    callCooldownMin: 60,
    pushPerHour: 3,
    authority: { read: 'auto', draft: 'auto' }
  };
  var STORE_KEY = 'kin.away';
  var MAX_LOG = 500;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function mins(hhmm) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); if (!m) return null; var h = +m[1], mi = +m[2]; return h < 24 && mi < 60 ? h * 60 + mi : null; }
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function cleanList(a) { var out = []; (Array.isArray(a) ? a : []).forEach(function (x) { x = String(x || '').trim().slice(0, 120); if (x && out.map(norm).indexOf(norm(x)) < 0) out.push(x); }); return out.slice(0, 100); }

  function memStore() { var m = {}; return { get: function (k) { return m[k] == null ? null : m[k]; }, set: function (k, v) { m[k] = v; return true; } }; }
  function browserStore() {
    return {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    };
  }

  function create(opt) {
    opt = opt || {};
    var now = opt.now || function () { return new Date(); };
    var store = opt.store || (typeof localStorage !== 'undefined' ? browserStore() : memStore());
    var notify = opt.notify || function () { return Promise.resolve(true); };
    var callOwner = opt.callOwner || null; // function(event) -> Promise<{answered:boolean}>
    var listeners = [];
    var seq = 0;

    var st = load();
    function load() {
      var raw = store.get(STORE_KEY), s = null;
      try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
      var base = { settings: clone(DEFAULTS), log: [], cards: [], spend: {}, calls: [], pushes: [] };
      if (!s || typeof s !== 'object') return base;
      base.settings = sanitize(Object.assign(clone(DEFAULTS), s.settings || {}));
      ['log', 'cards', 'calls', 'pushes'].forEach(function (k) { if (Array.isArray(s[k])) base[k] = s[k]; });
      if (s.spend && typeof s.spend === 'object') base.spend = s.spend;
      return base;
    }
    function save() {
      st.log = st.log.slice(-MAX_LOG); st.calls = st.calls.slice(-100); st.pushes = st.pushes.slice(-100);
      store.set(STORE_KEY, JSON.stringify({ settings: st.settings, log: st.log, cards: st.cards.filter(function (c) { return c.status === 'pending'; }).concat(st.cards.filter(function (c) { return c.status !== 'pending'; }).slice(-100)), spend: st.spend, calls: st.calls, pushes: st.pushes }));
      listeners.forEach(function (f) { try { f(api); } catch (e) { /* a broken view must not stop the engine */ } });
    }
    function sanitize(s) {
      var out = clone(DEFAULTS);
      out.on = !!s.on;
      out.quiet = { start: mins(s.quiet && s.quiet.start) != null ? s.quiet.start : DEFAULTS.quiet.start, end: mins(s.quiet && s.quiet.end) != null ? s.quiet.end : DEFAULTS.quiet.end };
      var cap = Number(s.dailyCap); out.dailyCap = isFinite(cap) ? Math.max(0, Math.min(50, cap)) : DEFAULTS.dailyCap;
      out.callMe = cleanList(s.callMe); out.never = cleanList(s.never);
      out.allowCallMe = !!s.allowCallMe;
      out.maxCallsPerDay = Math.max(0, Math.min(10, Math.floor(Number(s.maxCallsPerDay)) || 0));
      if (s.maxCallsPerDay == null) out.maxCallsPerDay = DEFAULTS.maxCallsPerDay;
      out.callCooldownMin = Math.max(10, Math.min(24 * 60, Number(s.callCooldownMin) || DEFAULTS.callCooldownMin));
      out.pushPerHour = Math.max(0, Math.min(20, s.pushPerHour == null ? DEFAULTS.pushPerHour : Math.floor(Number(s.pushPerHour)) || 0));
      out.authority = { read: 'auto', draft: 'auto' };
      var a = s.authority || {};
      if (LEVELS.indexOf(a.read) >= 0) out.authority.read = a.read;
      if (a.draft === 'auto' || a.draft === 'ok') out.authority.draft = a.draft;
      return out;
    }

    function inQuiet(d) {
      var a = mins(st.settings.quiet.start), b = mins(st.settings.quiet.end); if (a == null || b == null || a === b) return false;
      var t = d.getHours() * 60 + d.getMinutes();
      return a < b ? (t >= a && t < b) : (t >= a || t < b);
    }
    function match(list, who) {
      who = norm(who); if (!who) return null;
      for (var i = 0; i < list.length; i++) { var x = norm(list[i]); if (x && (who === x || who.indexOf(x) >= 0)) return list[i]; }
      return null;
    }
    function onNever(who) { return !!match(st.settings.never, who); }
    function levelFor(kind) { if (LOCKED.indexOf(kind) >= 0 || !KINDS[kind]) return 'ok'; return st.settings.authority[kind] || KINDS[kind]; }

    // ---- spending ----
    function spentToday() { return st.spend[dayKey(now())] || 0; }
    function leftToday() { return Math.max(0, st.settings.dailyCap - spentToday()); }
    function reserve(cost) {
      cost = Math.max(0, Number(cost) || 0); if (!cost) return true;
      if (spentToday() + cost > st.settings.dailyCap + 1e-9) return false;
      var k = dayKey(now()), total = spentToday() + cost; st.spend = {}; st.spend[k] = total; // keep only today
      return true;
    }
    function refund(cost, kept) { var k = dayKey(now()); st.spend[k] = Math.max(0, (st.spend[k] || 0) - Math.max(0, cost - (kept || 0))); }

    // ---- events: how loudly to tell the owner ----
    function score(ev) {
      var tags = (ev.tags || []).map(norm), r = 0, why = [];
      if (typeof ev.severity === 'number') { r = Math.max(0, Math.min(3, Math.floor(ev.severity))); why.push('Severity ' + r + ' from the source'); }
      else if (tags.some(function (t) { return ['emergency', 'safety', 'security', 'fire', 'smoke', 'leak', 'crash'].indexOf(t) >= 0; })) { r = 3; why.push('Safety or emergency'); }
      else if (tags.some(function (t) { return ['payment-failed', 'deadline-today', 'legal', 'outage', 'urgent'].indexOf(t) >= 0; })) { r = 2; why.push('Time-sensitive'); }
      else if (tags.some(function (t) { return ['reply-needed', 'decision', 'question'].indexOf(t) >= 0; })) { r = 1; why.push('Needs you, not urgent'); }
      else why.push('Routine');
      return { rung: r, why: why, tags: tags };
    }

    function ingest(ev) {
      ev = ev || {};
      var d = now(), s = score(ev), rung = s.rung, why = s.why.slice();
      var from = String(ev.from || '').slice(0, 120);
      var rec = { id: 'e' + d.getTime().toString(36) + (seq++), at: d.toISOString(), source: String(ev.source || 'system').slice(0, 30), from: from, title: String(ev.title || 'Something happened').slice(0, 140), detail: String(ev.detail || '').slice(0, 600), rung: 0, rungName: 'log', why: why, never: false };
      if (from && onNever(from)) { rung = 0; rec.never = true; why.push('On your never-contact list'); }
      else if (from && match(st.settings.callMe, from)) { if (rung < 3) why.push('On your call-me-now list'); rung = 3; }
      else if (match(st.settings.callMe, rec.title)) { if (rung < 3) why.push('Matches your call-me-now list'); rung = 3; }
      if (!st.settings.on && rung > 1) { rung = 1; why.push('Away mode is off, so this waits for you'); }
      if (rung === 2 && inQuiet(d) && s.tags.indexOf('urgent') < 0) { rung = 1; why.push('Quiet hours'); }
      if (rung === 2) {
        var hourAgo = d.getTime() - 3600e3, recent = st.pushes.filter(function (t) { return t > hourAgo; }).length;
        if (recent >= st.settings.pushPerHour) { rung = 1; why.push('Already sent ' + recent + ' notifications this hour'); }
      }
      var callBlocked = null;
      if (rung === 3) {
        if (!st.settings.allowCallMe) callBlocked = 'Calls are off in Away settings';
        else if (!callOwner) callBlocked = 'Calling is not connected yet';
        else {
          var today = dayKey(d), callsToday = st.calls.filter(function (c) { return c.day === today; });
          var last = callsToday.length ? new Date(callsToday[callsToday.length - 1].at).getTime() : 0;
          if (callsToday.length >= st.settings.maxCallsPerDay) callBlocked = 'Already called you ' + callsToday.length + ' times today';
          else if (last && d.getTime() - last < st.settings.callCooldownMin * 60e3) callBlocked = 'Called you less than ' + st.settings.callCooldownMin + ' minutes ago';
        }
        if (callBlocked) { rung = 2; why.push(callBlocked + ', so you get a notification instead'); }
      }
      rec.rung = rung; rec.rungName = RUNGS[rung]; rec.outcome = RUNG_TEXT[RUNGS[rung]];
      st.log.push(rec);
      var done = Promise.resolve(rec);
      if (rung === 2) { st.pushes.push(d.getTime()); done = Promise.resolve(notify({ title: rec.title, body: rec.detail || rec.why.join('. ') })).then(function () { return rec; }, function () { rec.outcome = 'Notification failed, held for your summary'; rec.rung = 1; rec.rungName = 'summary'; save(); return rec; }); }
      if (rung === 3) {
        var call = { at: d.toISOString(), day: dayKey(d), event: rec.id, answered: null };
        st.calls.push(call);
        done = Promise.resolve().then(function () { return callOwner(rec); }).then(function (r) {
          call.answered = !!(r && r.answered);
          if (!call.answered) { rec.outcome = 'Called you, no answer. Sent a notification and kept it for your summary'; st.pushes.push(now().getTime()); return Promise.resolve(notify({ title: 'Missed call from Jarvis: ' + rec.title, body: rec.detail })).catch(function () {}).then(function () { save(); return rec; }); }
          rec.outcome = 'Called you and you answered'; save(); return rec;
        }, function () { call.answered = false; rec.outcome = 'The call did not go through. Sent a notification instead'; st.pushes.push(now().getTime()); return Promise.resolve(notify({ title: rec.title, body: rec.detail })).catch(function () {}).then(function () { save(); return rec; }); });
      }
      save();
      return done;
    }

    // ---- actions: what Jarvis may do on its own ----
    function propose(a) {
      a = a || {};
      var d = now(), kind = KINDS[a.kind] ? a.kind : 'unknown', level = levelFor(kind);
      var card = { id: 'c' + d.getTime().toString(36) + (seq++), at: d.toISOString(), kind: kind, title: String(a.title || 'Do something').slice(0, 140), detail: String(a.detail || '').slice(0, 600), to: String(a.to || '').slice(0, 120), cost: Math.max(0, Number(a.cost) || 0), status: 'pending', level: level, note: '' };
      var run = typeof a.run === 'function' ? a.run : null;
      if (card.to && CONTACT.indexOf(kind) >= 0 && onNever(card.to)) { card.status = 'blocked'; card.note = card.to + ' is on your never-contact list, so Jarvis will not do this.'; st.cards.push(card); save(); return Promise.resolve(card); }
      // nothing to run, or the owner set this kind to "draft": prepare it and show it, never do it
      if (level === 'draft' || !run) { card.status = 'drafted'; card.note = 'Prepared, not sent. It is in your summary.'; st.cards.push(card); save(); return Promise.resolve(card); }
      if (level === 'auto') return execute(card, run);
      runners[card.id] = run;
      st.cards.push(card); save();
      return Promise.resolve(card);
    }
    var runners = {};
    function execute(card, run) {
      if (!reserve(card.cost)) { card.status = card.level === 'auto' ? 'held' : 'pending'; card.note = 'This needs ' + money(card.cost) + ' and only ' + money(leftToday()) + ' is left of today\'s ' + money(st.settings.dailyCap) + ' limit.'; if (st.cards.indexOf(card) < 0) st.cards.push(card); save(); return Promise.resolve(card); }
      card.status = 'running'; if (st.cards.indexOf(card) < 0) st.cards.push(card); save();
      return Promise.resolve().then(function () { return run ? run() : null; }).then(function (r) {
        card.status = 'done'; card.note = r && r.note ? String(r.note).slice(0, 300) : 'Done.';
        if (r && typeof r.spent === 'number') refund(card.cost, r.spent);
        delete runners[card.id]; save(); return card;
      }, function (e) { card.status = 'failed'; card.note = 'It did not work: ' + String(e && e.message || e).slice(0, 200); refund(card.cost, 0); delete runners[card.id]; save(); return card; });
    }
    // approve needs a real person: `how` is 'tap' (a click on the card) or 'voice-confirmed' (they said yes to the read-back)
    function approve(id, how) {
      var card = find(id);
      if (!card) return Promise.reject(new Error('No such card'));
      if (card.status !== 'pending') return Promise.reject(new Error('This card is ' + card.status));
      if (how !== 'tap' && how !== 'voice-confirmed') return Promise.reject(new Error('An OK has to come from you'));
      if (card.to && CONTACT.indexOf(card.kind) >= 0 && onNever(card.to)) { card.status = 'blocked'; card.note = card.to + ' is on your never-contact list.'; save(); return Promise.resolve(card); }
      card.approvedBy = how; card.approvedAt = now().toISOString();
      return execute(card, runners[card.id] || null);
    }
    function decline(id) { var c = find(id); if (c && c.status === 'pending') { c.status = 'declined'; c.note = 'Stopped. Nothing was done.'; delete runners[id]; save(); } return c; }
    function find(id) { for (var i = 0; i < st.cards.length; i++) if (st.cards[i].id === id) return st.cards[i]; return null; }

    // ---- the morning summary ----
    function summary(sinceIso) {
      var since = sinceIso ? new Date(sinceIso).getTime() : now().getTime() - 24 * 3600e3;
      var inWin = function (x) { return new Date(x.at).getTime() >= since; };
      var ev = st.log.filter(inWin), cards = st.cards.filter(inWin);
      var s = {
        handled: cards.filter(function (c) { return c.status === 'done'; }),
        drafted: cards.filter(function (c) { return c.status === 'drafted'; }),
        waiting: st.cards.filter(function (c) { return c.status === 'pending'; }),
        blocked: cards.filter(function (c) { return c.status === 'blocked' || c.status === 'held' || c.status === 'failed'; }),
        held: ev.filter(function (e) { return e.rung === 1; }),
        pushed: ev.filter(function (e) { return e.rung === 2; }),
        called: ev.filter(function (e) { return e.rung === 3; }),
        quiet: ev.filter(function (e) { return e.rung === 0; }).length,
        spent: spentToday(), cap: st.settings.dailyCap
      };
      var p = [];
      p.push('Sir, here is what happened while you were away.');
      if (s.handled.length) p.push('I handled ' + s.handled.length + ': ' + s.handled.slice(0, 3).map(function (c) { return c.title; }).join('; ') + (s.handled.length > 3 ? '; and more' : '') + '.');
      if (s.held.length) p.push(s.held.length + (s.held.length === 1 ? ' thing needs' : ' things need') + ' you, none urgent: ' + s.held.slice(0, 3).map(function (e) { return e.title; }).join('; ') + '.');
      if (s.waiting.length) p.push(s.waiting.length + (s.waiting.length === 1 ? ' card is' : ' cards are') + ' waiting for your OK.');
      if (s.drafted.length) p.push(s.drafted.length + ' draft' + (s.drafted.length === 1 ? ' is' : 's are') + ' ready for you to look over.');
      if (s.pushed.length) p.push('I sent you ' + s.pushed.length + ' notification' + (s.pushed.length === 1 ? '' : 's') + ': ' + s.pushed.slice(0, 2).map(function (e) { return e.title; }).join('; ') + '.');
      if (s.called.length) p.push('I called you ' + s.called.length + (s.called.length === 1 ? ' time.' : ' times.'));
      if (!s.handled.length && !s.held.length && !s.waiting.length && !s.called.length && !s.pushed.length && !s.drafted.length) p.push('Nothing needs you.');
      if (s.quiet) p.push(s.quiet + ' routine item' + (s.quiet === 1 ? ' was' : 's were') + ' logged quietly.');
      p.push('Spent ' + money(s.spent) + ' of ' + money(s.cap) + '.');
      s.text = p.join(' ');
      return s;
    }

    var api = {
      get settings() { return clone(st.settings); },
      setSettings: function (patch) {
        patch = patch || {};
        var a = patch.authority || {};
        for (var k in a) if (LOCKED.indexOf(k) >= 0 && a[k] !== 'ok') throw new Error('"' + k + '" always needs your OK and cannot be changed');
        st.settings = sanitize(Object.assign(clone(st.settings), patch, { authority: Object.assign({}, st.settings.authority, a), quiet: Object.assign({}, st.settings.quiet, patch.quiet || {}) }));
        save(); return api.settings;
      },
      levelFor: levelFor, inQuiet: function () { return inQuiet(now()); },
      ingest: ingest, propose: propose, approve: approve, decline: decline, card: find,
      get cards() { return st.cards.slice(); }, get log() { return st.log.slice(); },
      spentToday: spentToday, leftToday: leftToday, summary: summary,
      onChange: function (f) { listeners.push(f); return function () { listeners = listeners.filter(function (x) { return x !== f; }); }; },
      setCallOwner: function (f) { callOwner = typeof f === 'function' ? f : null; }
    };
    return api;
  }

  /* ---------------- views (browser only) ---------------- */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function pill(label, note, cls, onClick) { var b = h('button', 'pill ' + cls); b.type = 'button'; b.appendChild(h('span', 'pl', label)); if (note) b.appendChild(h('span', 'pn', note)); b.addEventListener('click', onClick); return b; }
  var KIND_TEXT = { send: 'Send', post: 'Post', buy: 'Buy', book: 'Book', call: 'Call', pay: 'Pay', delete: 'Delete', read: 'Read', draft: 'Draft', unknown: 'Action' };

  // The OK card for one action. Approve and Stop are pills; the price sits big, like the existing Jarvis cards.
  function renderCard(el, away, id) {
    var c = away.card(id); el.textContent = ''; if (!c) return;
    var box = h('section', 'ac-card' + (c.status === 'pending' ? '' : ' ac-done')); box.setAttribute('aria-label', 'Needs your OK');
    var head = h('div', 'chead');
    head.appendChild(h('span', 'chip', c.status === 'pending' ? 'Needs your OK' : c.status));
    head.appendChild(h('span', 'chip ghost', KIND_TEXT[c.kind] || c.kind));
    if (c.to) head.appendChild(h('span', 'chip ghost', 'To ' + c.to));
    box.appendChild(head);
    box.appendChild(h('h3', 'asktitle', c.title));
    if (c.cost) { var pr = h('div', 'cprice'); pr.appendChild(h('b', '', money(c.cost))); pr.appendChild(h('span', '', 'from today\'s ' + money(away.settings.dailyCap) + ' away limit, ' + money(away.leftToday()) + ' left')); box.appendChild(pr); }
    if (c.detail) box.appendChild(h('p', 'cline', c.detail));
    if (c.note) box.appendChild(h('p', 'cline ac-note', c.note));
    if (c.status === 'pending') {
      var btns = h('div', 'cbtns');
      btns.appendChild(pill(KIND_TEXT[c.kind] === 'Action' ? 'Go ahead' : KIND_TEXT[c.kind] + ' it', 'Only this one, only now', 'go', function () { away.approve(c.id, 'tap').then(function () { renderCard(el, away, id); }, function () { renderCard(el, away, id); }); }));
      btns.appendChild(pill('Stop', 'Nothing is done', 'stop', function () { away.decline(c.id); renderCard(el, away, id); }));
      box.appendChild(btns);
    }
    el.appendChild(box);
  }

  function renderSettings(el, away) {
    var s = away.settings; el.textContent = '';
    var wrap = h('section', 'ac-panel'); wrap.setAttribute('aria-label', 'Away mode settings');
    var top = h('div', 'ac-top');
    var tl = h('div'); tl.appendChild(h('p', 'ac-eyebrow', 'Away mode')); tl.appendChild(h('h2', 'ac-h', s.on ? 'Jarvis is minding things' : 'Away mode is off'));
    top.appendChild(tl);
    var sw = h('button', 'ac-switch' + (s.on ? ' on' : '')); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', String(s.on)); sw.setAttribute('aria-label', 'Away mode'); sw.appendChild(h('i'));
    sw.addEventListener('click', function () { away.setSettings({ on: !away.settings.on }); renderSettings(el, away); });
    top.appendChild(sw); wrap.appendChild(top);

    // the ladder
    var lad = h('ol', 'ac-ladder');
    [['Log', 'Routine things, kept quietly'], ['Summary', 'Needs you, not urgent. Waits for the morning'], ['Notify', 'Time-sensitive. A notification now, never in quiet hours'], ['Call', s.allowCallMe ? 'Big things only. Up to ' + s.maxCallsPerDay + ' calls a day' : 'Off. Turn on "Jarvis may call me" below']].forEach(function (r, i) {
      var li = h('li', 'ac-rung r' + i + (i === 3 && !s.allowCallMe ? ' off' : '')); li.appendChild(h('span', 'ac-rn', String(i))); var t = h('div'); t.appendChild(h('b', '', r[0])); t.appendChild(h('span', '', r[1])); li.appendChild(t); lad.appendChild(li);
    });
    wrap.appendChild(lad);

    var grid = h('div', 'ac-grid');
    // quiet hours
    var q = h('div', 'ac-tile'); q.appendChild(h('p', 'ac-lab', 'Quiet hours'));
    var qr = h('div', 'ac-row');
    ['start', 'end'].forEach(function (k, i) { var inp = h('input', 'ac-time'); inp.type = 'time'; inp.value = s.quiet[k]; inp.setAttribute('aria-label', 'Quiet hours ' + (i ? 'end' : 'start')); inp.addEventListener('change', function () { var p = { quiet: {} }; p.quiet[k] = inp.value; away.setSettings(p); }); qr.appendChild(inp); if (!i) qr.appendChild(h('span', 'ac-to', 'to')); });
    q.appendChild(qr); grid.appendChild(q);
    // spend cap
    var cp = h('div', 'ac-tile'); cp.appendChild(h('p', 'ac-lab', 'Daily spend limit'));
    var cr = h('div', 'ac-row'); cr.appendChild(h('span', 'ac-cur', '$')); var ci = h('input', 'ac-num'); ci.type = 'number'; ci.min = '0'; ci.max = '50'; ci.step = '0.5'; ci.value = String(s.dailyCap); ci.setAttribute('aria-label', 'Daily spend limit in dollars');
    ci.addEventListener('change', function () { away.setSettings({ dailyCap: Number(ci.value) }); renderSettings(el, away); });
    cr.appendChild(ci); cr.appendChild(h('span', 'ac-sub', money(away.spentToday()) + ' spent today')); cp.appendChild(cr); grid.appendChild(cp);
    wrap.appendChild(grid);

    // call me toggle
    var cm = h('div', 'ac-tile ac-wide'); var cmr = h('div', 'ac-row ac-between');
    var cmt = h('div'); cmt.appendChild(h('p', 'ac-lab', 'Jarvis may call me')); cmt.appendChild(h('p', 'ac-sub', 'For rung 3 only. Turning this on is your standing OK for these calls to you, and no one else.'));
    var cms = h('button', 'ac-switch sm' + (s.allowCallMe ? ' on' : '')); cms.type = 'button'; cms.setAttribute('role', 'switch'); cms.setAttribute('aria-checked', String(s.allowCallMe)); cms.setAttribute('aria-label', 'Jarvis may call me'); cms.appendChild(h('i'));
    cms.addEventListener('click', function () { away.setSettings({ allowCallMe: !away.settings.allowCallMe }); renderSettings(el, away); });
    cmr.appendChild(cmt); cmr.appendChild(cms); cm.appendChild(cmr); wrap.appendChild(cm);

    // lists
    [['callMe', 'Call me now if…', 'A person, or words like "flood"', 'Nobody yet. Add the people and words that should always reach you.'], ['never', 'Never contact', 'A person or company', 'Nobody yet. Jarvis will never message or call anyone on this list.']].forEach(function (L) {
      var t = h('div', 'ac-tile ac-wide'); t.appendChild(h('p', 'ac-lab', L[1]));
      var chips = h('div', 'ac-chips');
      if (!s[L[0]].length) chips.appendChild(h('p', 'ac-sub ac-empty', L[3]));
      s[L[0]].forEach(function (x) { var c = h('span', 'ac-tag'); c.appendChild(h('span', '', x)); var del = h('button', 'ac-x'); del.type = 'button'; del.setAttribute('aria-label', 'Remove ' + x); del.textContent = '×'; del.addEventListener('click', function () { var p = {}; p[L[0]] = away.settings[L[0]].filter(function (y) { return y !== x; }); away.setSettings(p); renderSettings(el, away); }); c.appendChild(del); chips.appendChild(c); });
      t.appendChild(chips);
      var f = h('form', 'ac-add'); var inp = h('input', 'ac-in'); inp.placeholder = L[2]; inp.setAttribute('aria-label', L[1]); inp.maxLength = 120; var b = h('button', 'ac-addb', 'Add'); b.type = 'submit';
      f.addEventListener('submit', function (e) { e.preventDefault(); if (!inp.value.trim()) return; var p = {}; p[L[0]] = away.settings[L[0]].concat([inp.value]); away.setSettings(p); renderSettings(el, away); });
      f.appendChild(inp); f.appendChild(b); t.appendChild(f); wrap.appendChild(t);
    });

    // authority
    var au = h('div', 'ac-tile ac-wide'); au.appendChild(h('p', 'ac-lab', 'What Jarvis may do alone'));
    var tbl = h('div', 'ac-auth');
    Object.keys(KINDS).forEach(function (k) {
      var row = h('div', 'ac-arow'); row.appendChild(h('span', 'ac-ak', KIND_TEXT[k]));
      var lv = away.levelFor(k);
      if (LOCKED.indexOf(k) >= 0) { var lk = h('span', 'ac-lock', 'Always asks you'); row.appendChild(lk); }
      else {
        var seg = h('div', 'ac-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', KIND_TEXT[k]);
        (k === 'read' ? ['auto', 'draft', 'ok'] : ['auto', 'ok']).forEach(function (L) {
          var b = h('button', 'ac-sb' + (lv === L ? ' on' : ''), L === 'auto' ? 'Alone' : L === 'draft' ? 'Draft' : 'Ask'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(lv === L));
          b.addEventListener('click', function () { var p = { authority: {} }; p.authority[k] = L; away.setSettings(p); renderSettings(el, away); }); seg.appendChild(b);
        });
        row.appendChild(seg);
      }
      tbl.appendChild(row);
    });
    au.appendChild(tbl); wrap.appendChild(au);
    el.appendChild(wrap);
  }

  function renderSummary(el, away, since) {
    var s = away.summary(since); el.textContent = '';
    var wrap = h('section', 'ac-panel'); wrap.setAttribute('aria-label', 'While you were away');
    wrap.appendChild(h('p', 'ac-eyebrow', 'While you were away'));
    wrap.appendChild(h('h2', 'ac-h', s.waiting.length ? s.waiting.length + ' need' + (s.waiting.length === 1 ? 's' : '') + ' your OK' : 'All handled'));
    wrap.appendChild(h('p', 'ac-lede', s.text));
    var stats = h('div', 'ac-stats');
    [['Handled', s.handled.length], ['Waiting', s.waiting.length], ['Held', s.held.length], ['Calls', s.called.length]].forEach(function (x) { var t = h('div', 'ac-stat'); t.appendChild(h('span', 'ac-lab', x[0])); t.appendChild(h('b', '', String(x[1]))); stats.appendChild(t); });
    wrap.appendChild(stats);
    var feed = h('ol', 'ac-feed');
    away.log.slice(-12).reverse().forEach(function (e) {
      var li = h('li', 'ac-ev r' + e.rung); var dot = h('span', 'ac-dot'); li.appendChild(dot);
      var t = h('div', 'ac-evt'); var top = h('div', 'ac-evtop'); top.appendChild(h('b', '', e.title)); top.appendChild(h('span', 'ac-when', new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))); t.appendChild(top);
      t.appendChild(h('span', 'ac-out', e.outcome + (e.why.length ? ' · ' + e.why[e.why.length - 1] : ''))); li.appendChild(t); feed.appendChild(li);
    });
    wrap.appendChild(feed);
    el.appendChild(wrap);
  }

  return { create: create, RUNGS: RUNGS, KINDS: KINDS, LOCKED: LOCKED, DEFAULTS: DEFAULTS, renderCard: renderCard, renderSettings: renderSettings, renderSummary: renderSummary, memStore: memStore };
});
