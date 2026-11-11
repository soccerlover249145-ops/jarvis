/* calls.js — Jarvis makes phone calls (Kin.Calls).
   The real line will be an ElevenLabs Agent speaking over a Twilio number. Until the owner has a number, everything
   runs on a fake line (FakeLine) that plays a scripted restaurant, so the whole flow can be seen and tested.
   Rules this module enforces, whatever line is plugged in:
     - No call to anyone else happens without an approval card the owner tapped (or confirmed by voice after a read-back).
     - Every call opens by saying Jarvis is an AI assistant calling for someone.
     - Calls are never recorded. There is no setting to turn recording on.
     - Each call has a hard time limit; there is a cap on calls and on dollars per day.
     - Jarvis may only agree to what the card said (party size, a time window, no deposit or card details).
       Anything else is "I'll check and call back", and the owner gets a card about it.
   Nothing here touches the network. Works in the browser (window.Kin.Calls) and in Node for the unit tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Kin = root.Kin || {}; root.Kin.Calls = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    reservationName: '',   // the name the table is booked under; empty until the owner sets it
    ownerNumber: '',       // the owner's phone, for away-mode calls; empty until set
    maxCallSec: 240,       // hard stop for one call
    maxCallsPerDay: 3,     // calls to other people per day
    maxDollarsPerDay: 1.5, // calling spend per day
    ratePerMin: 0.15,      // rough cost of agent voice plus phone line, dollars per minute (check against real bills)
    windowMin: 30          // how far from the asked-for time Jarvis may agree
  };
  var STORE_KEY = 'kin.calls';
  var NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 0, couple: 2 };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function clock(mins) { var h = Math.floor(mins / 60) % 24, m = mins % 60, ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12; return hh + ':' + String(m).padStart(2, '0') + ' ' + ap; }
  function memStore() { var m = {}; return { get: function (k) { return m[k] == null ? null : m[k]; }, set: function (k, v) { m[k] = v; return true; } }; }
  function browserStore() { return { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } } }; }
  function title(s) { return s.replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); }); }

  /* "Book a table for three at Harbor Table at 7:30 tomorrow" -> { party: 3, place: 'Harbor Table', minutes: 450, day: 'tomorrow' } */
  function parseBooking(text) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ') + ' ';
    var out = { party: null, place: '', minutes: null, day: 'today', missing: [] };
    var pm = /\bfor (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a couple)\b(?! ?(?:am|pm|o'?clock|:))/.exec(t) || /\b(?:party|table) of (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.exec(t);
    if (pm) { var w = pm[1].replace('a couple', 'couple'); out.party = /^\d+$/.test(w) ? +w : NUMS[w] || null; }
    if (/\btomorrow\b/.test(t)) out.day = 'tomorrow';
    var tm = /\b(?:at|for|around|by) (\d{1,2})(?::(\d{2}))? ?(am|pm|o'?clock)?\b/g, m, best = null;
    while ((m = tm.exec(t))) { if (m[3] || m[2] || +m[1] >= 5) { if (!m[3] && !m[2] && pm && m.index === pm.index) continue; best = m; } }
    if (best) { var hh = +best[1], mm = best[2] ? +best[2] : 0, ap = best[3]; if (ap === 'am') hh = hh % 12; else if (ap === 'pm' || hh < 12 && hh >= 1 && hh <= 11) hh = hh % 12 + 12; if (hh < 24 && mm < 60) out.minutes = hh * 60 + mm; }
    else if (/\btonight\b/.test(t)) out.minutes = null;
    var pl = /\b(?:at|in) ((?:the )?[a-z0-9'&][a-z0-9'& -]*?)(?= (?:at|for|around|by|on|tonight|tomorrow|today|this|next)\b| $)/g, p;
    while ((p = pl.exec(t))) { if (!/^\d/.test(p[1])) { out.place = title(p[1].trim()); break; } }
    if (!out.party) out.missing.push('party');
    if (!out.place) out.missing.push('place');
    if (out.minutes == null) out.missing.push('time');
    return out;
  }

  /* Is something the other side offered inside what the owner approved? */
  function withinScope(offer, plan) {
    var why = [];
    if (offer.party != null && offer.party !== plan.party) why.push('a table for ' + offer.party + ' instead of ' + plan.party);
    if (offer.minutes != null && Math.abs(offer.minutes - plan.minutes) > plan.windowMin) why.push(clock(offer.minutes) + ', outside ' + clock(plan.minutes - plan.windowMin) + ' to ' + clock(plan.minutes + plan.windowMin));
    if (offer.deposit) why.push('a deposit');
    if (offer.card) why.push('card details');
    if (offer.other) why.push(String(offer.other).slice(0, 80));
    return { ok: !why.length, why: why };
  }

  /* The words the agent is given. A real ElevenLabs Agent gets first_message and the prompt; the fake line plays them. */
  function disclosure(plan) {
    return plan.kind === 'owner'
      ? 'Hi, this is Jarvis, your AI assistant. I am calling because something needs you.'
      : 'Hi, this is Jarvis, an AI assistant calling on behalf of ' + (plan.forName || 'a customer') + '. This call is not recorded.';
  }
  function agentConfig(plan) {
    var first = disclosure(plan) + (plan.kind === 'booking' ? ' I would like to book a table for ' + plan.party + ' ' + (plan.day === 'tomorrow' ? 'tomorrow' : 'today') + ' at ' + clock(plan.minutes) + ', please.' : ' ' + plan.reason);
    var rules = plan.kind === 'booking' ? [
      'You are Jarvis, an AI assistant. You already said you are an AI. If asked again, say so plainly.',
      'Your only job: book a table for exactly ' + plan.party + ' under the name ' + (plan.forName || '(ask the owner)') + '.',
      'You may accept any time from ' + clock(plan.minutes - plan.windowMin) + ' to ' + clock(plan.minutes + plan.windowMin) + ' ' + plan.day + '.',
      'Never give card details, agree to a deposit or fee, change the party size, or agree to anything else. If asked, say you will check and call back.',
      'Do not share any personal information beyond the name for the booking.',
      'When done, repeat back the time, party size and name, thank them, and end the call.'
    ] : ['You are Jarvis, an AI assistant calling the owner. Explain the reason in one or two sentences and ask what they want done. Do not take any action on the call.'];
    return { first_message: first, prompt: rules.join('\n'), max_duration_seconds: plan.maxSec, record: false };
  }

  /* The agent's side of the fake call, using the same rules the prompt gives the real agent. */
  function agentTurn(plan, offer) {
    var sc = withinScope(offer, plan);
    if (!sc.ok) return { text: 'I am not able to agree to ' + sc.why.join(' or ') + ' without checking. I will check and call you back. Thank you!', end: true, result: { outcome: 'needs-you', offer: offer, why: sc.why } };
    if (offer.minutes != null) return { text: 'That works. So that is a table for ' + plan.party + ' at ' + clock(offer.minutes) + ', under ' + (plan.forName || 'the name I gave') + '. Thank you very much!', end: true, result: { outcome: 'booked', minutes: offer.minutes, party: plan.party, name: plan.forName } };
    return { text: 'Thank you. Could you tell me what time you can do?', end: false };
  }

  /* A scripted restaurant. script: accept | counter-ok | counter-far | deposit | noanswer | rambling */
  function FakeLine(script, opt) {
    opt = opt || {};
    var tick = opt.tickMs == null ? 600 : opt.tickMs;
    return {
      name: 'Practice line (' + script + ')',
      fake: true,
      dial: function (req) {
        // req: { to, config, plan, onTurn(turn), signal: { aborted } , hangup registration }
        if (req.config.record !== false) return Promise.reject(new Error('Recording must be off'));
        var turns = [], sec = 0, ended = false, timer = null, resolveFn;
        var done = new Promise(function (r) { resolveFn = r; });
        function say(who, text, s) { sec += s || 4; var t = { who: who, text: text, at: sec }; turns.push(t); if (req.onTurn) req.onTurn(t); }
        function end(result) { if (ended) return; ended = true; clearTimeout(timer); resolveFn({ turns: turns, seconds: sec, result: result }); }
        req.hangup = function (why) { end({ outcome: why || 'hung-up' }); };
        var steps = [];
        if (script === 'noanswer') { steps.push(function () { sec = 30; end({ outcome: 'no-answer' }); }); }
        else {
          steps.push(function () { say('them', 'Good evening, ' + (req.plan.place || 'restaurant') + ', how can I help?', 3); });
          steps.push(function () {
            var first = req.config.first_message;
            if (!/\bAI assistant\b/.test(first)) { end({ outcome: 'refused', why: 'no disclosure' }); return; }
            say('jarvis', first, 7);
          });
          var offer;
          if (script === 'accept') offer = { text: 'Sure, we have that. See you then.', minutes: req.plan.minutes };
          else if (script === 'counter-ok') offer = { text: 'We are full then, but I could do ' + clock(req.plan.minutes + 15) + '.', minutes: req.plan.minutes + 15 };
          else if (script === 'counter-far') offer = { text: 'The earliest I have is ' + clock(req.plan.minutes + 90) + '.', minutes: req.plan.minutes + 90 };
          else if (script === 'deposit') offer = { text: 'We can do that, I just need a card for a twenty dollar deposit per person.', minutes: req.plan.minutes, deposit: true, card: true };
          else if (script === 'rambling') offer = null;
          if (offer) {
            steps.push(function () { say('them', offer.text, 5); });
            steps.push(function () { var a = agentTurn(req.plan, offer); say('jarvis', a.text, 6); if (a.end) steps.push(function () { say('them', 'Thank you, bye!', 2); end(a.result); }); });
          } else {
            for (var i = 0; i < 200; i++) steps.push(function () { say('them', 'Let me just check the book for you, one moment, it is a busy night…', 25); });
          }
        }
        function next() {
          if (ended) return;
          if (sec >= req.config.max_duration_seconds) { say('jarvis', 'I am sorry, I have to go. I will call back. Goodbye.', 0); end({ outcome: 'cut-off' }); return; }
          var f = steps.shift(); if (!f) { end({ outcome: 'ended' }); return; }
          f(); if (!ended) timer = setTimeout(next, tick);
        }
        timer = setTimeout(next, tick);
        return done;
      }
    };
  }

  /* The real line, not connected yet. It waits on: a Twilio number (after the ID check), the ElevenLabs agent id and
     its phone-number id. See INTEGRATION.md. It never sends anything until those are set and a card was approved. */
  function ElevenLabsTwilioLine(cfg) {
    cfg = cfg || {};
    return {
      name: 'ElevenLabs + Twilio', fake: false,
      ready: !!(cfg.agentId && cfg.phoneNumberId && cfg.send),
      dial: function () { return Promise.reject(new Error('Calling is not connected yet. It waits on the phone number and the ElevenLabs agent.')); }
    };
  }

  function create(opt) {
    opt = opt || {};
    var now = opt.now || function () { return new Date(); };
    var store = opt.store || (typeof localStorage !== 'undefined' ? browserStore() : memStore());
    var line = opt.line || FakeLine('accept');
    var lookup = opt.lookup || function () { return null; };       // place -> phone number, from search or contacts
    var isNever = opt.isNever || function () { return false; };     // hooked to Away's never-contact list
    var listeners = [], seq = 0, live = {};
    var st = (function () { var s = null; try { s = JSON.parse(store.get(STORE_KEY) || 'null'); } catch (e) {} s = s && typeof s === 'object' ? s : {}; return { settings: Object.assign(clone(DEFAULTS), s.settings || {}), plans: Array.isArray(s.plans) ? s.plans : [], log: Array.isArray(s.log) ? s.log : [] }; })();
    function save() { st.log = st.log.slice(-200); st.plans = st.plans.slice(-50); store.set(STORE_KEY, JSON.stringify(st)); listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
    function today() { var k = dayKey(now()); return st.log.filter(function (c) { return c.day === k && c.kind !== 'owner'; }); }
    function spentToday() { var k = dayKey(now()); return st.log.filter(function (c) { return c.day === k; }).reduce(function (a, c) { return a + (c.cost || 0); }, 0); }
    function find(id) { for (var i = 0; i < st.plans.length; i++) if (st.plans[i].id === id) return st.plans[i]; return null; }
    function estimate(sec) { return Math.round(sec / 60 * st.settings.ratePerMin * 100) / 100; }

    function checks(plan) {
      var p = [];
      if (!plan.number) p.push('I could not find a phone number for ' + (plan.place || 'them') + '.');
      if (isNever(plan.place) || isNever(plan.number)) p.push((plan.place || plan.number) + ' is on your never-contact list.');
      if (plan.kind === 'booking' && !plan.forName) p.push('Set the name to book under in Calls settings.');
      if (today().length >= st.settings.maxCallsPerDay) p.push('That would be more than ' + st.settings.maxCallsPerDay + ' calls today.');
      if (spentToday() + plan.estimate > st.settings.maxDollarsPerDay + 1e-9) p.push('That could pass today\'s ' + money(st.settings.maxDollarsPerDay) + ' calling limit.');
      return p;
    }

    function planBooking(text) {
      var b = parseBooking(text), d = now();
      var plan = { id: 'p' + d.getTime().toString(36) + (seq++), kind: 'booking', at: d.toISOString(), ask: String(text || '').slice(0, 200), party: b.party, place: b.place, minutes: b.minutes, day: b.day, missing: b.missing.slice(), number: b.place ? lookup(b.place) || '' : '', forName: st.settings.reservationName, windowMin: st.settings.windowMin, maxSec: st.settings.maxCallSec, status: 'card' };
      plan.estimate = estimate(plan.maxSec);
      plan.problems = plan.missing.length ? [] : checks(plan);
      if (plan.missing.length) plan.status = 'needs-info';
      else if (plan.problems.length) plan.status = 'blocked';
      if (!plan.missing.length) { var cfg = agentConfig(plan); plan.opening = cfg.first_message; }
      st.plans.push(plan); save();
      return plan;
    }

    /* Dial only from an approved card. `how` must be 'tap' or 'voice-confirmed'. */
    function approve(id, how, onTurn) {
      var plan = find(id);
      if (!plan) return Promise.reject(new Error('No such call card'));
      if (plan.status !== 'card') return Promise.reject(new Error('This call is ' + plan.status));
      if (how !== 'tap' && how !== 'voice-confirmed') return Promise.reject(new Error('A call needs your OK'));
      var again = checks(plan); if (again.length) { plan.status = 'blocked'; plan.problems = again; save(); return Promise.resolve(plan); }
      return dial(plan, how, onTurn);
    }
    function dial(plan, how, onTurn) {
      var d = now(), cfg = agentConfig(plan);
      cfg.record = false; // not configurable
      plan.status = 'calling'; plan.approvedBy = how; plan.turns = []; save();
      var req = { to: plan.number, config: cfg, plan: plan, onTurn: function (t) { plan.turns.push(t); if (onTurn) onTurn(t, plan); } };
      live[plan.id] = req;
      // our own clock too, in case a line ignores max_duration_seconds
      var guard = setTimeout(function () { if (req.hangup) req.hangup('cut-off'); }, (cfg.max_duration_seconds + 15) * 1000);
      return Promise.resolve().then(function () { return line.dial(req); }).then(function (r) {
        clearTimeout(guard); delete live[plan.id];
        var res = r.result || { outcome: 'ended' };
        // double-check what the agent says it agreed to against the card, whatever the line reports
        if (res.outcome === 'booked') { var sc = withinScope({ minutes: res.minutes, party: res.party }, plan); if (!sc.ok) res = { outcome: 'needs-you', why: sc.why }; }
        plan.status = 'done'; plan.result = res; plan.seconds = r.seconds || 0; plan.cost = estimate(plan.seconds); plan.turns = r.turns || plan.turns;
        st.log.push({ id: plan.id, kind: plan.kind, day: dayKey(d), at: d.toISOString(), seconds: plan.seconds, cost: plan.cost, outcome: res.outcome });
        save(); return plan;
      }, function (e) {
        clearTimeout(guard); delete live[plan.id];
        plan.status = 'done'; plan.result = { outcome: 'failed', why: [String(e && e.message || e).slice(0, 200)] }; plan.seconds = 0; plan.cost = 0; save(); return plan;
      });
    }
    function hangup(id) { var r = live[id]; if (r && r.hangup) r.hangup('hung-up'); }
    function decline(id) { var p = find(id); if (p && (p.status === 'card' || p.status === 'needs-info' || p.status === 'blocked')) { p.status = 'stopped'; save(); } return p; }

    /* Away mode calls the owner. Away's "Jarvis may call me" switch is the standing OK, passed in as standingOk. */
    function callOwner(ev, standing) {
      if (!standing || standing.standingOk !== true) return Promise.reject(new Error('Calls to you need "Jarvis may call me" turned on'));
      if (!st.settings.ownerNumber) return Promise.reject(new Error('Your number is not set'));
      var d = now(), plan = { id: 'o' + d.getTime().toString(36) + (seq++), kind: 'owner', at: d.toISOString(), place: 'You', number: st.settings.ownerNumber, reason: String(ev && ev.title || 'Something needs you.').slice(0, 200), maxSec: Math.min(120, st.settings.maxCallSec), status: 'calling' };
      plan.estimate = estimate(plan.maxSec);
      st.plans.push(plan);
      return dial(plan, 'standing', null).then(function (p) { return { answered: p.result && p.result.outcome !== 'no-answer' && p.result.outcome !== 'failed', plan: p }; });
    }

    return {
      get settings() { return clone(st.settings); },
      setSettings: function (patch) { patch = Object.assign({}, patch || {}); delete patch.record; var s = Object.assign(st.settings, patch); s.maxCallSec = Math.max(30, Math.min(600, Number(s.maxCallSec) || DEFAULTS.maxCallSec)); s.maxCallsPerDay = Math.max(0, Math.min(10, Math.floor(Number(s.maxCallsPerDay)) || 0)); s.maxDollarsPerDay = Math.max(0, Math.min(20, Number(s.maxDollarsPerDay) || 0)); s.windowMin = Math.max(0, Math.min(90, Number(s.windowMin) || 0)); s.reservationName = String(s.reservationName || '').slice(0, 60); s.ownerNumber = String(s.ownerNumber || '').replace(/[^\d+]/g, '').slice(0, 16); save(); return clone(s); },
      planBooking: planBooking, approve: approve, decline: decline, hangup: hangup, callOwner: callOwner, plan: find,
      setLine: function (l) { line = l; }, get line() { return line; },
      callsToday: function () { return today().length; }, spentToday: spentToday,
      onChange: function (f) { listeners.push(f); }
    };
  }

  /* ---------------- views (browser only) ---------------- */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function pill(label, note, cls, onClick) { var b = h('button', 'pill ' + cls); b.type = 'button'; b.appendChild(h('span', 'pl', label)); if (note) b.appendChild(h('span', 'pn', note)); b.addEventListener('click', onClick); return b; }
  function fmtNum(n) { var m = /^\+?1?(\d{3})(\d{3})(\d{4})$/.exec(n || ''); return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : n; }
  function mmss(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

  function renderPlan(el, calls, id, hooks) {
    hooks = hooks || {};
    var p = calls.plan(id); el.textContent = ''; if (!p) return;
    var box = h('section', 'ac-card'); box.setAttribute('aria-label', 'Call card');
    var head = h('div', 'chead');
    head.appendChild(h('span', 'chip', p.status === 'card' ? 'Needs your OK' : p.status === 'needs-info' ? 'Needs a detail' : p.status === 'blocked' ? 'Can\'t call yet' : p.status));
    head.appendChild(h('span', 'chip ghost', 'Phone call'));
    if (calls.line.fake) head.appendChild(h('span', 'chip ghost ac-fake', 'Practice line'));
    box.appendChild(head);
    box.appendChild(h('h3', 'asktitle', 'Call ' + (p.place || 'the restaurant') + '?'));
    if (calls.line.fake) box.appendChild(h('p', 'cline ac-practice', 'Practice line: no real call is made. Real calls wait on setup (a phone number and the ElevenLabs agent).'));
    if (p.status === 'needs-info') {
      var miss = { party: 'how many people', place: 'which restaurant', time: 'what time' };
      box.appendChild(h('p', 'cline', 'Tell me ' + p.missing.map(function (m) { return miss[m]; }).join(' and ') + ', sir, and I will set it up.'));
    } else {
      var facts = h('div', 'ac-facts');
      [['Table for', String(p.party)], ['Time', clock(p.minutes) + (p.day === 'tomorrow' ? ' tomorrow' : ' today')], ['May accept', clock(p.minutes - p.windowMin) + ' – ' + clock(p.minutes + p.windowMin)], ['Number', fmtNum(p.number) || 'Not found']].forEach(function (f) { var t = h('div', 'ac-fact'); t.appendChild(h('span', 'ac-lab', f[0])); t.appendChild(h('b', f[0] === 'Number' ? 'ac-nowrap' : '', f[1])); facts.appendChild(t); });
      box.appendChild(facts);
      if (p.opening) { var q = h('blockquote', 'ac-quote'); q.appendChild(h('span', 'ac-lab', 'Jarvis opens with')); q.appendChild(h('p', '', '“' + p.opening + '”')); box.appendChild(q); }
      var rules = h('ul', 'ac-rules');
      ['Says it is an AI assistant first', 'Not recorded', 'Hangs up by ' + mmss(p.maxSec), 'No card details, deposits or other changes'].forEach(function (r) { rules.appendChild(h('li', '', r)); });
      box.appendChild(rules);
      var pr = h('div', 'cprice'); pr.appendChild(h('b', '', 'up to ' + money(p.estimate))); pr.appendChild(h('span', '', calls.callsToday() + ' of ' + calls.settings.maxCallsPerDay + ' calls used today')); box.appendChild(pr);
      (p.problems || []).forEach(function (x) { box.appendChild(h('p', 'cline ac-note', x)); });
    }
    if (p.status === 'card' || p.status === 'needs-info' || p.status === 'blocked') {
      var btns = h('div', 'cbtns');
      if (p.status === 'card') btns.appendChild(pill('Call now', 'Only this call, only now', 'go', function () { if (hooks.onApprove) hooks.onApprove(p); }));
      btns.appendChild(pill('Stop', 'No call is made', 'stop', function () { calls.decline(p.id); renderPlan(el, calls, id, hooks); }));
      box.appendChild(btns);
    } else if (p.status === 'stopped') box.appendChild(h('p', 'cresult', 'Stopped. No call was made.'));
    el.appendChild(box);
  }

  function renderLive(el, calls, id, hooks) {
    var p = calls.plan(id); el.textContent = ''; if (!p) return;
    var box = h('section', 'ac-card ac-live'); box.setAttribute('aria-label', 'Call in progress');
    var head = h('div', 'chead'); head.appendChild(h('span', 'chip live', 'On the call')); head.appendChild(h('span', 'chip ghost', 'Not recorded')); if (calls.line.fake) head.appendChild(h('span', 'chip ghost ac-fake', 'Practice line')); box.appendChild(head);
    var row = h('div', 'ac-liverow'); row.appendChild(h('h3', 'asktitle', p.place)); var last = p.turns && p.turns.length ? p.turns[p.turns.length - 1].at : 0; row.appendChild(h('b', 'ac-timer', mmss(last) + ' / ' + mmss(p.maxSec))); box.appendChild(row);
    var bar = h('div', 'ac-bar'); var fill = h('i'); fill.style.width = Math.min(100, last / p.maxSec * 100) + '%'; bar.appendChild(fill); box.appendChild(bar);
    var tl = h('ol', 'ac-turns'); tl.setAttribute('aria-live', 'polite');
    (p.turns || []).slice(-6).forEach(function (t) { var li = h('li', 'ac-turn ' + t.who); li.appendChild(h('span', 'ac-lab', t.who === 'jarvis' ? 'Jarvis' : p.place)); li.appendChild(h('p', '', t.text)); tl.appendChild(li); });
    box.appendChild(tl);
    var btns = h('div', 'cbtns'); btns.appendChild(pill('Hang up', 'Ends the call now', 'stop', function () { calls.hangup(p.id); if (hooks && hooks.onHangup) hooks.onHangup(p); })); box.appendChild(btns);
    el.appendChild(box);
  }

  var OUT = {
    booked: ['Booked', 'ok'], 'needs-you': ['Needs you', 'warn'], 'no-answer': ['No answer', 'warn'], 'cut-off': ['Cut off at the time limit', 'warn'],
    'hung-up': ['You hung up', 'warn'], failed: ['Did not go through', 'bad'], refused: ['Stopped: no AI greeting', 'bad'], ended: ['Ended', 'warn']
  };
  function renderTranscript(el, calls, id, hooks) {
    hooks = hooks || {};
    var p = calls.plan(id); el.textContent = ''; if (!p || !p.result) return;
    var r = p.result, o = OUT[r.outcome] || [r.outcome, 'warn'];
    var box = h('section', 'ac-card ac-after ' + o[1]); box.setAttribute('aria-label', 'Call transcript');
    var head = h('div', 'chead'); head.appendChild(h('span', 'chip ' + o[1], o[0])); head.appendChild(h('span', 'chip ghost', mmss(p.seconds || 0) + ' · ' + money(p.cost || 0))); head.appendChild(h('span', 'chip ghost', 'Not recorded')); if (calls.line.fake) head.appendChild(h('span', 'chip ghost ac-fake', 'Practice line')); box.appendChild(head);
    var line;
    if (r.outcome === 'booked') line = 'Table for ' + r.party + ' at ' + clock(r.minutes) + (p.day === 'tomorrow' ? ' tomorrow' : ' today') + ', under ' + (r.name || 'your name') + '.';
    else if (r.outcome === 'needs-you') line = 'They offered ' + (r.why || []).join(' and ') + '. I did not agree to anything.';
    else if (r.outcome === 'no-answer') line = 'Nobody picked up. I can try again later.';
    else if (r.outcome === 'cut-off') line = 'The call hit the ' + mmss(p.maxSec) + ' limit, so I said goodbye. Nothing was booked.';
    else line = (r.why && r.why.join('. ')) || 'Nothing was booked.';
    box.appendChild(h('h3', 'asktitle', p.place));
    box.appendChild(h('p', 'ac-lede', line));
    if (calls.line.fake) box.appendChild(h('p', 'cline ac-practice', 'Practice line: no real call was made, and nothing was booked.'));
    if (p.turns && p.turns.length) {
      var det = h('details', 'ac-tx'); det.appendChild(h('summary', '', 'Transcript, ' + p.turns.length + ' lines'));
      var ol = h('ol', 'ac-turns'); p.turns.forEach(function (t) { var li = h('li', 'ac-turn ' + t.who); li.appendChild(h('span', 'ac-lab', (t.who === 'jarvis' ? 'Jarvis' : p.place) + ' · ' + mmss(t.at))); li.appendChild(h('p', '', t.text)); ol.appendChild(li); });
      det.appendChild(ol); box.appendChild(det);
    }
    var btns = h('div', 'cbtns');
    if (r.outcome === 'booked' && hooks.onCalendar) btns.appendChild(pill('Add to calendar', 'Shows you the event first', 'go', function () { hooks.onCalendar(p); }));
    if (r.outcome !== 'booked' && hooks.onRetry) btns.appendChild(pill('Try another time', 'Makes a new call card', 'alt', function () { hooks.onRetry(p); }));
    btns.appendChild(pill('Done', '', 'stop', function () { if (hooks.onDone) hooks.onDone(p); }));
    box.appendChild(btns);
    el.appendChild(box);
  }

  return { create: create, parseBooking: parseBooking, withinScope: withinScope, agentConfig: agentConfig, agentTurn: agentTurn, disclosure: disclosure, FakeLine: FakeLine, ElevenLabsTwilioLine: ElevenLabsTwilioLine, DEFAULTS: DEFAULTS, clock: clock, memStore: memStore, renderPlan: renderPlan, renderLive: renderLive, renderTranscript: renderTranscript };
});
