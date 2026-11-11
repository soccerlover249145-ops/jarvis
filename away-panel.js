/* away-panel.js: Away mode and practice calls inside Jarvis (Kin.awayPanel).
   Glue only: the rules live in away.js (Kin.Away) and calls.js (Kin.Calls).
   - Calls run on the practice line only (Kin.Calls.FakeLine). The real line (Kin.Calls.ElevenLabsTwilioLine) is a stub
     that refuses to dial; it waits on a phone number and the ElevenLabs agent.
   - Nothing sends, posts, buys, books, calls or deletes without a tap on its own card.
   - "Jarvis may call me" is off by default, and both contact lists start empty.
   - On a shared address the panel does not open and nothing is stored (the engines would only keep things in memory).
   - The engines stay private to this file: no other code can approve a card or change the line. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  if (!Kin.Away || !Kin.Calls) return;

  var away = null, calls = null;
  /* The practice line never dials anyone. Its number is a made-up 555-01xx number, shown on the card as practice. */
  var PRACTICE_NUMBER = '+15555550123';
  function setup() {
    if (away) return;
    /* on a shared address nothing is written to this browser's storage */
    var mem = !!Kin.shared;
    calls = Kin.Calls.create({ store: mem ? Kin.Calls.memStore() : undefined,
      line: Kin.Calls.FakeLine('accept', { tickMs: 650 }),
      lookup: function () { return PRACTICE_NUMBER; },
      isNever: function (x) { var n = away ? away.settings.never : []; x = String(x || '').toLowerCase().trim(); return !!x && n.some(function (y) { y = String(y || '').toLowerCase().trim(); return y && (x === y || new RegExp('(^|[^a-z0-9])' + y.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(x)); }); }
    });
    away = Kin.Away.create({ store: mem ? Kin.Away.memStore() : undefined,
      notify: function (n) { try { if (Kin.desk && Kin.desk.notify) Kin.desk.notify.done(n.title, n.body); } catch (e) {} return Promise.resolve(true); },
      callOwner: function (ev) { return calls.callOwner(ev, { standingOk: away.settings.allowCallMe === true }); }
    });
  }

  /* ---- what the founder said ---- */
  var LEAD = /^(?:(?:hey|ok|okay)\s+)?(?:jarvis|kin)[,!.]?\s+/;
  function clean(t) { return String(t || '').trim().toLowerCase().replace(/[’']/g, "'").replace(LEAD, '').replace(/^(?:please|sir)[, ]+/, '').replace(/[,]?\s*(?:please|sir)[.!?]*$/, '').replace(/\s+/g, ' '); }
  var RE = {
    /* "I'm heading out" is a hint, not a command: Jarvis asks first */
    hint: /^(?:i'?m|i am) (?:heading|going|stepping) out(?: (?:now|for (?:the|a) (?:day|night|evening|afternoon|bit|while|weekend)))?[.!]*$/,
    on: /^(?:turn|switch|put) (?:on )?away mode(?: on)?[.!]*$|^(?:turn|switch) on away mode[.!]*$|^(?:start|enable) away mode[.!]*$|^away mode on[.!]*$/,
    off: /^(?:turn|switch) (?:off )?away mode off[.!]*$|^(?:turn|switch) off away mode[.!]*$|^(?:stop|end|disable) away mode[.!]*$|^away mode off[.!]*$/,
    back: /^i'?m (?:back|home)(?: now)?[.!]*$/,
    summary: /^what (?:happened|did i miss|did you (?:do|handle)) while i was (?:away|out|gone)[?.!]*$|^(?:show |give me )?(?:my |the )?away (?:mode )?summary[?.!]*$/,
    settings: /^(?:open |show )?(?:my |the )?away mode(?: settings)?[?.!]*$|^(?:open |show )?(?:my |the )?away settings[?.!]*$/,
    /* a table needs a party size right after "for", or a place after "at"; a reservation needs a meal or "restaurant", or a party, a place and a clock time */
    book: /^(?:can you |could you )?(?:book|reserve) (?:me |us )?(?:a )?table (?:for (?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a couple)\b|at [a-z])|^(?:can you |could you )?(?:make|book|get) (?:me |us )?a (?:dinner|lunch|brunch|breakfast|restaurant) reservation\b|^(?:can you |could you )?(?:make|book|get) (?:me |us )?a reservation for (?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (?:people )?at [a-z][a-z0-9' &-]*? (?:at|around) \d/,
    notbook: /\b(?:hotel|motel|flight|airbnb|rental car|car rental|appointment|booth|conference|trade show|spreadsheet|schema|database|meeting)\b|\b(?:a|hotel|guest|meeting|conference) room\b/
  };
  function isOn() { if (away) return away.settings.on; if (Kin.shared) return false; try { var v = JSON.parse(localStorage.getItem('kin.away') || 'null'); return !!(v && v.settings && v.settings.on); } catch (e) { return false; } }
  function intent(text) {
    var t = clean(text); if (!t || t.length > 160) return null;
    if (RE.off.test(t)) return { k: 'off' };
    /* "I'm back" only means something while away mode is on; otherwise it is ordinary chat */
    if (RE.back.test(t)) return isOn() ? { k: 'off' } : null;
    if (RE.on.test(t)) return { k: 'on' };
    if (RE.hint.test(t)) return isOn() ? null : { k: 'ask-on' };
    if (RE.summary.test(t)) return { k: 'summary' };
    if (RE.settings.test(t)) return { k: 'settings' };
    if (RE.book.test(t) && !RE.notbook.test(t)) return { k: 'book', text: t };
    return null;
  }

  /* ---- the panel ---- */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var cur = null;
  function close() {
    if (!cur) return; var c = cur; cur = null;
    /* closing the panel ends any call that is still going */
    if (calls && calls.live()) calls.hangupAll();
    document.removeEventListener('keydown', c.key);
    c.el.classList.add('wl-hide'); setTimeout(function () { c.el.remove(); }, 320);
  }
  function svgClose() {
    var ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    ['M6 6l12 12', 'M18 6L6 18'].forEach(function (d) { var p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.appendChild(p); }); return s;
  }

  function open(tab, opts) {
    opts = opts || {}; setup();
    if (cur) close();
    var el = h('div', 'wl acx'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Away mode and calls');
    var panel = h('div', 'wl-panel'); panel.tabIndex = -1; el.appendChild(panel);
    var head = h('div', 'wl-head'), ht = h('div');
    var title = h('h2', 'wl-title', 'Away mode & calls'); ht.appendChild(title);
    head.appendChild(ht);
    var x = h('button', 'wl-pill wl-icon'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.appendChild(svgClose()); x.addEventListener('click', close); head.appendChild(x);
    panel.appendChild(head);
    var inner = h('div', 'ac'); panel.appendChild(inner);
    var tabs = h('div', 'ac-tabs'); tabs.setAttribute('role', 'tablist'); inner.appendChild(tabs);
    var body = h('div', 'ac-body'); inner.appendChild(body);
    var c = cur = { el: el, tab: tab || 'settings', plan: opts.plan || null, holder: null };
    c.key = function (e) { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', c.key);

    var TABS = [['settings', 'Away mode'], ['summary', 'Summary'], ['calls', 'Calls']];
    function show(k) {
      c.tab = k; tabs.textContent = '';
      TABS.forEach(function (t) { var b = h('button', 'ac-tab', t[1]); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(t[0] === k)); b.addEventListener('click', function () { show(t[0]); }); tabs.appendChild(b); });
      body.textContent = '';
      if (k === 'settings') { var s = h('div'); body.appendChild(s); Kin.Away.renderSettings(s, away); }
      else if (k === 'summary') { var m = h('div'); body.appendChild(m); Kin.Away.renderSummary(m, away); }
      else calltab();
    }
    function nameTile() {
      var t = h('div', 'ac-panel ac-name'); t.appendChild(h('p', 'ac-lab', 'Name to book under'));
      t.appendChild(h('p', 'ac-sub', 'Say "book a table for three at a place at 7". Jarvis shows a card first; nothing is dialed until you tap Call now. Calls say they are from an AI, are never recorded, and stop at four minutes.'));
      var f = h('form', 'ac-add'); var inp = h('input', 'ac-in'); inp.maxLength = 60; inp.placeholder = 'Name to book under'; inp.setAttribute('aria-label', 'Name to book under'); inp.value = calls.settings.reservationName; inp.autocomplete = 'off';
      var b = h('button', 'ac-addb', 'Save'); b.type = 'submit';
      f.addEventListener('submit', function (e) { e.preventDefault(); calls.setSettings({ reservationName: inp.value.trim() }); if (c.plan) { var p = calls.plan(c.plan); if (p && p.status === 'blocked') { c.plan = calls.planBooking(p.ask).id; } } calltab(); });
      f.appendChild(inp); f.appendChild(b); t.appendChild(f);
      return t;
    }
    function calltab() {
      body.textContent = '';
      var holder = c.holder = h('div'); body.appendChild(holder);
      if (c.plan) drawPlan();
      body.appendChild(nameTile());
    }
    /* always draws into the Calls tab that is on screen now, or nowhere */
    function drawPlan() {
      var p = calls.plan(c.plan), holder = c.holder; if (!p || !holder || cur !== c || c.tab !== 'calls') return;
      if (p.status === 'calling') { Kin.Calls.renderLive(holder, calls, p.id); return; }
      if (p.status === 'done') {
        Kin.Calls.renderTranscript(holder, calls, p.id, {
          onRetry: function () { if (opts.onSay) opts.onSay('Tell me the new time, sir.'); },
          onDone: function () { c.plan = null; calltab(); }
        });
        return;
      }
      Kin.Calls.renderPlan(holder, calls, p.id, { onApprove: function () {
        /* the tap on Call now is the OK for this one call only */
        calls.approve(p.id, 'tap', function () { drawPlan(); }).then(function (done) {
          if (cur !== c) return;
          drawPlan();
          if (done && done.result && opts.onSay) opts.onSay(done.result.outcome === 'booked' ? 'Practice call done, sir. On a real line that would be booked. No real call was made.' : 'Practice call done, sir. It needs you. No real call was made.');
        });
        drawPlan();
      } });
    }
    show(c.tab);
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('wl-show'); if (Kin.focusPanel) Kin.focusPanel(panel); else panel.focus({ preventScroll: true }); });
    return { close: close, element: el };
  }

  /* ---- what each request does; the reply is spoken by the host through onSay ---- */
  function handle(it, opts) {
    opts = opts || {}; setup();
    var say = opts.onSay || function () {};
    if (it.k === 'ask-on') return 'Turn on away mode, sir?';
    if (it.k === 'on') {
      away.setSettings({ on: true });
      open('settings', opts);
      return 'Away mode is on, sir. Routine things are logged, the rest waits for your summary, and only time-sensitive things become notifications.' + (away.settings.allowCallMe ? ' I may call you for big things.' : ' Calls to you are off.');
    }
    if (it.k === 'off') {
      away.setSettings({ on: false });
      open('summary', opts);
      return 'Away mode is off, sir. ' + away.summary().text;
    }
    if (it.k === 'summary') { open('summary', opts); return away.summary().text; }
    if (it.k === 'settings') { open('settings', opts); return 'Here is away mode, sir.'; }
    if (it.k === 'book') {
      var p = calls.planBooking(it.text);
      open('calls', Object.assign({}, opts, { plan: p.id }));
      if (p.status === 'needs-info') { var miss = { party: 'how many people', place: 'which restaurant', time: 'what time' }; return 'Tell me ' + p.missing.map(function (m) { return miss[m]; }).join(' and ') + ', sir.'; }
      if (p.status === 'blocked') return (p.problems && p.problems[0]) || 'I cannot set up that call yet, sir.';
      return 'The call card is ready, sir. This is the practice line, so no real call is made. Tap Call now to run it.';
    }
    say(''); return '';
  }

  if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', function () { if (calls && calls.live()) calls.hangupAll(); });
  /* read-only views for the rest of the page: nothing here can approve a card, dial, or change the line */
  Kin.awayPanel = { intent: intent, handle: handle, open: function (tab, opts) { return open(tab, opts); }, close: close,
    view: function () { setup(); return {
      away: { get settings() { return away.settings; }, summary: function (x) { return away.summary(x); }, get log() { return away.log; }, get cards() { return away.cards; }, ingest: function (ev) { return away.ingest(ev); }, propose: function (a) { return away.propose(a); } },
      calls: { get settings() { return calls.settings; }, plan: function (id) { var p = calls.plan(id); return p ? JSON.parse(JSON.stringify(p)) : null; }, callsToday: function () { return calls.callsToday(); }, spentToday: function () { return calls.spentToday(); }, live: function () { return calls.live(); } }
    }; } };
})();
