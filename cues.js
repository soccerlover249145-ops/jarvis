/* cues.js: spoken cues. Short orders Jarvis answers at once on this device, each with a spoken acknowledgement:
     "set it all up"            -> "Setting everything up, sir." and a set-up walk, one thing at a time
     "run a systems check"      -> "Running a systems check, sir." and what is on and what is not
     "can you hear me"          -> "Loud and clear, sir." (or the plain reason it cannot)
     "what's left to set up"    -> the short list
     "open settings", "open the voice settings", "close that"
     "say that again"           -> the last thing Jarvis said
     "thank you", "stop listening", "start listening", "speak slower", "speak faster", "normal speed"
   During a set-up walk: "next", "skip", "go back", "that's done", "stop setup".
   Nothing here leaves the device or changes a setting by itself. The walk opens the right place and says what to do;
   the founder does each thing (pastes a key, types a town, taps Allow). The one thing it may start is listening, and
   only when the founder asked to be set up.
   Public surface (window.Kin.cues):
     instant(text) -> { say, show, card } | null     for the instant chain in mind.js
     rows()        -> the checks, each { key, title, ok, must, state, note }
     card(c, box)  -> draws the set-up card
     wire(kit)     -> app.js hands over { say(line, small), steps() } so the walk can speak when a step is done
     walking()     -> true while a set-up walk is on */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var $ = function (id) { return document.getElementById(id); };
  var kit = { say: function () {} };

  /* ------------------------------------------------------------ what is ready and what is not */
  function st() { return Kin.state || {}; }
  function inMac() { return !!(Kin.mac && Kin.mac.available && Kin.mac.available()); }
  function hearRow() {
    var E = Kin.ears || {}, s = st(), on = s.micState === 'listening' && !(E.desktop && !E.exact && E.heard && !E.heard());
    var how = E.desktop ? 'Through the Mac app’s own listener' : 'Through this browser';
    var note = on ? how : !E.supported ? 'This browser cannot listen. Type, or use the keyboard’s mic'
      : s.micState === 'blocked' ? ((E.why && E.why(s.micWhy, true)) || { short: 'The microphone is blocked for this site.' }).short
      : s.micState === 'starting' ? 'Starting' : s.micState === 'listening' ? 'The Mac app has not passed on anything yet. Say something, or update the Mac app' : 'Off. Tap the mic and I listen';
    return { key: 'hear', title: 'Hearing', ok: on, must: false, state: on ? 'on' : s.micState === 'blocked' ? 'blocked' : 'off', note: note,
      line: !E.supported ? 'I cannot listen in this browser, sir. Type to me, or use the keyboard’s microphone.' : s.micState === 'blocked' ? note + ' The steps are in Settings, sir.' : 'I am not listening, sir. Tap the microphone and I will.',
      fix: E.supported && s.micState !== 'blocked' && s.micState !== 'listening' ? 'Turn on' : 'How',
      go: function () { if (E.supported && s.micState !== 'blocked' && s.micState !== 'listening') { if (!E.wanted()) { var m = $('mic'); if (m) m.click(); } } else settings('voice', ''); } };
  }
  function rows() {
    var out = [hearRow()], s = st(), V = Kin.voice, B = Kin.brain, mac = inMac();
    var keyed = !!(V && V.tts && V.tts.hasKey());
    out.push({ key: 'speak', title: 'Speaking', ok: !!s.unlocked, must: false, state: s.unlocked ? 'on' : 'off',
      note: s.unlocked ? (keyed ? 'In your chosen voice' : 'In the built-in voice') : 'One tap anywhere lets me speak',
      line: 'Tap anywhere once, sir, and I can speak.', fix: '', go: function () {} });
    var hasC = !!(B && B.hasKey());
    out.push({ key: 'claude', title: 'Claude key', ok: hasC, must: true, state: hasC ? 'on' : 'off',
      note: hasC ? (mac && Kin.mac.keptOnMac && Kin.mac.keptOnMac('claude') ? 'Kept in your Mac’s Keychain' : 'Saved on this device') : 'Without it I answer only from your pack',
      line: 'Your Claude key, sir. Paste it in the box I have opened and tap Save. ' + (mac ? 'It is kept in your Mac’s Keychain.' : 'It stays on this device and goes only to Anthropic.'),
      fix: 'Paste it', go: function () { settings('brain', 'apiKey'); } });
    out.push({ key: 'voice', title: 'Voice key', ok: keyed, must: false, state: keyed ? 'on' : 'off',
      note: keyed ? 'Your chosen voice speaks' : 'Optional. Gives me my own voice',
      line: 'A voice key gives me my own voice, sir. Paste it in the box I have opened, or say skip.', fix: 'Paste it', go: function () { settings('voice', 'ttsKey'); } });
    if (!Kin.shared) {
      if (Kin.chart && Kin.chart.place) { var pl = Kin.chart.place();
        out.push({ key: 'town', title: 'Your town', ok: !!pl, must: false, state: pl ? 'on' : 'off', note: pl ? 'Weather for ' + String(pl.name || 'your town').slice(0, 40) : 'For the weather and “will it rain”',
          line: 'Your town, sir, for the weather. Type it in the box I have opened and tap Find it. Or say skip.', fix: 'Set it', go: function () { settings('brief', 'wxTown'); } }); }
      if (Kin.email && Kin.email.canRead) { var g = !!Kin.email.canRead();
        out.push({ key: 'google', title: 'Google', ok: g, must: false, state: g ? 'on' : 'off', note: g ? 'Inbox, calendar and Send are on' : 'Optional. Inbox, calendar and Send',
          line: 'Google, sir, for your inbox and calendar. Paste your Google Client ID in the box I have opened, or say skip.', fix: 'Connect', go: function () { settings('email', 'mailCid'); } }); }
      var N = Kin.desk && Kin.desk.notify;
      if (N && N.supported && N.supported() && N.permission() !== 'denied') { var np = N.permission() === 'granted';
        out.push({ key: 'notify', title: 'Notifications', ok: np, must: false, state: np ? 'on' : 'off', note: np ? 'Reminders and finished jobs can reach you' : 'So a reminder can reach you in the background',
          line: 'Notifications, sir, so a reminder can reach you while I am in the background. Tap the switch I have opened, then Allow. Or say skip.', fix: 'Turn on', go: function () { settings('away', 'notifyOn'); } }); }
      if (Kin.pack && Kin.pack.get) { var pk = Kin.pack.get();
        out.push({ key: 'pack', title: 'Your Kin pack', ok: !!pk, must: false, state: pk ? 'on' : 'off', note: pk ? String(pk.name || 'Imported').slice(0, 40) : 'Optional. Your company’s facts, from the Atlas',
          line: 'Your Kin pack, sir: your company’s facts, exported from the Atlas. Choose the file in the box I have opened, or say skip.', fix: 'Import', go: function () { settings('brain', 'packFile'); } }); }
    }
    /* inside the Mac app: an older copy of the app cannot say why it is not hearing */
    if (Kin.ears && Kin.ears.desktop && Kin.ears.exact === false) {
      out.push({ key: 'macnew', title: 'Newest Mac app', ok: false, must: false, state: 'off', note: 'So I can say exactly why when I cannot hear you',
        line: 'One more, sir: installing the newest Mac app lets me tell you exactly why when I cannot hear you. The steps are on screen. Or say skip.', fix: 'Steps',
        go: function () { if (kit.steps) kit.steps(); } });
    }
    return out;
  }
  /* opens Settings at a section, with the field that matters focused */
  function settings(sg, focus) {
    try {
      if (typeof Kin.go === 'function') Kin.go('settings', true);
      setTimeout(function () {
        var b = document.querySelector('#snav [data-sg="' + String(sg).replace(/[^a-z]/g, '') + '"]'); if (b) b.click();
        /* the box the step needs, focused; tried again briefly on a slow device where the panel was still settling */
        if (focus) { var tries = 0; setTimeout(function put() { var f = $(focus); if (!f || typeof f.focus !== 'function') return; if (document.activeElement !== f) { try { f.focus(); } catch (e) {} } if (document.activeElement !== f && ++tries < 4) setTimeout(put, 150); }, 60); }
      }, 40);
    } catch (e) {}
  }
  function closeTop() {
    var sh = $('sheet'), sf = $('shelf'), th = $('thread');
    if (sh && !sh.hidden) { sh.hidden = true; return 'Settings'; }
    if (sf && !sf.hidden) { sf.hidden = true; return 'the panel'; }
    if (th && !th.hidden && th.children.length) { th.hidden = true; return 'the conversation'; }
    return '';
  }

  /* ------------------------------------------------------------ words */
  function list(a) { return a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function num(n) { return ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][n] || String(n); }
  function low(t) { return t.charAt(0).toLowerCase() + t.slice(1); }
  var NAMED = { hear: 'hearing', speak: 'speaking', claude: 'your Claude key', voice: 'a voice key', town: 'your town', google: 'Google', notify: 'notifications', pack: 'your Kin pack', macnew: 'the newest Mac app' };
  function named(r) { return Object.prototype.hasOwnProperty.call(NAMED, r.key) ? NAMED[r.key] : low(r.title); }

  /* ------------------------------------------------------------ the set-up walk: one thing at a time */
  var walk = { on: false, keys: [], i: 0, skipped: {}, at: 0, poll: 0, auto: [], away: false };
  /* the walk stays on (its card and buttons work) for 15 minutes; its spoken words count for 3 minutes after the last
     step, and not at all once the founder has started talking about something else */
  var WALK_IDLE = 15 * 60000, WALK_WORDS = 3 * 60000;
  function byKey(k) { return rows().filter(function (r) { return r.key === k; })[0] || null; }
  function cur() { return walk.on && walk.i < walk.keys.length ? byKey(walk.keys[walk.i]) : null; }
  function endWalk() { walk.on = false; clearInterval(walk.poll); walk.poll = 0; }
  function left() { return rows().filter(function (r) { return !r.ok && r.key !== 'speak'; }); }
  /* move to the next thing that is still open (dir -1: the one before); returns it, or null when the walk is over */
  function step(dir) {
    walk.at = Date.now();
    for (var n = 0; n < walk.keys.length + 1; n++) {
      walk.i += dir < 0 ? -1 : 1;
      if (walk.i < 0) { walk.i = 0; break; }
      if (walk.i >= walk.keys.length) return null;
      var r = byKey(walk.keys[walk.i]); if (r && !r.ok && (dir < 0 || !walk.skipped[r.key])) return r;
    }
    return cur();
  }
  function openStep(r) { if (!r) return; try { r.go(); } catch (e) {} }
  function closing() {
    var l = left(), must = l.filter(function (r) { return r.must; });
    endWalk();
    if (!l.length) return 'That is everything, sir. All systems are go.';
    if (must.length) return 'Set-up is paused, sir. I still need ' + list(must.map(named)) + ' before I can answer properly. Say “continue setup” when you are ready.';
    return 'That is the set-up for now, sir. Still open: ' + list(l.map(named)) + '. Say “continue setup” any time.';
  }
  /* while a walk is on: when the thing in hand gets done, say so and move on by itself */
  function watchWalk() {
    clearInterval(walk.poll);
    walk.poll = setInterval(function () {
      if (!walk.on) { clearInterval(walk.poll); walk.poll = 0; return; }
      if (Date.now() - walk.at > WALK_IDLE) { endWalk(); repaint(); return; }
      var r = cur(); repaint();
      if (!r || !r.ok) return;
      var s = st(); if (s.busy || s.talking) return;
      var nx = step(1), line;
      walk.away = false;
      if (nx) { openStep(nx); line = 'Got it, sir. Next: ' + nx.line; } else { closeTop(); line = 'Got it, sir. ' + closing(); }
      repaint(); try { kit.say(line, 'Setting up'); } catch (e) {}
    }, 1200);
  }
  function startWalk() {
    var auto = [], E = Kin.ears, s = st();
    /* the things that need nobody: listening (the founder asked to be set up), and the Mac's saved keys */
    if (E && E.supported && !E.wanted() && s.micState !== 'blocked' && !Kin.shared) { try { E.start(); auto.push('listening'); } catch (e) {} }
    if (inMac() && Kin.mac.prefill) { try { Kin.mac.prefill(function () { repaint(); }); } catch (e) {} }
    var all = rows(), todo = all.filter(function (r) { return !r.ok && r.key !== 'speak' && !(r.key === 'hear' && auto.length); });
    todo.sort(function (a, b) { return (b.must ? 1 : 0) - (a.must ? 1 : 0); });
    walk.keys = todo.map(function (r) { return r.key; }); walk.i = 0; walk.skipped = {}; walk.at = Date.now(); walk.auto = auto; walk.away = false; walk.on = todo.length > 0;
    var ready = all.filter(function (r) { return r.ok; }), first = cur();
    var say = 'Setting everything up, sir. ';
    if (!todo.length) { endWalk(); return { say: say + 'It is all in place already: ' + list(ready.map(function (r) { return low(r.title); })) + '. All systems are go.', done: true }; }
    say += ready.length ? num(ready.length) + ' of ' + all.length + (ready.length === 1 ? ' is' : ' are') + ' ready' + (auto.length ? ', and I have turned on listening' : '') + '. ' : auto.length ? 'I have turned on listening. ' : '';
    say += num(todo.length) + (todo.length === 1 ? ' thing is' : ' things are') + ' left. First: ' + first.line + (todo.length > 1 ? ' Say “next” to move on.' : '');
    openStep(first); watchWalk();
    return { say: say };
  }

  /* ------------------------------------------------------------ the card: every check, the one in hand lit */
  var cards = [];
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svg(tag, at) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(at || {}).forEach(function (k) { e.setAttribute(k, at[k]); }); return e; }
  function paintCard(d) {
    var all = rows(), ready = all.filter(function (r) { return r.ok; }).length, c = cur(), R = 24, C = 2 * Math.PI * R, mode = d.dataset.mode;
    /* redrawn only when something on it changed, so a keyboard user's place (focus on Next) is kept */
    var sig = mode + '|' + walk.on + '|' + (c ? c.key : '') + '|' + all.map(function (r) { return r.key + r.ok + r.state + r.note + (walk.skipped[r.key] ? 's' : ''); }).join(',');
    if (d._sig === sig) return; d._sig = sig;
    var fa = document.activeElement, keep = fa && d.contains(fa) ? (fa.getAttribute('aria-label') || fa.textContent) : null;
    d.textContent = '';
    d.setAttribute('aria-label', (mode === 'check' ? 'Systems check' : 'Set-up') + ': ' + ready + ' of ' + all.length + ' ready');
    var ring = svg('svg', { viewBox: '0 0 60 60', 'class': 'su-ring', 'aria-hidden': 'true' });
    ring.appendChild(svg('circle', { cx: 30, cy: 30, r: R, 'class': 'trk' }));
    var arc = svg('circle', { cx: 30, cy: 30, r: R, 'class': 'arc' + (ready === all.length ? ' full' : ''), transform: 'rotate(-90 30 30)' });
    arc.setAttribute('stroke-dasharray', C.toFixed(1)); arc.setAttribute('stroke-dashoffset', (C * (1 - ready / Math.max(1, all.length))).toFixed(1)); ring.appendChild(arc);
    var tx = svg('text', { x: 30, y: 35, 'text-anchor': 'middle', 'class': 'num' }); tx.textContent = ready + '/' + all.length; ring.appendChild(tx);
    var head = el('div', 'su-head'), ht = el('div', 'su-ht');
    ht.appendChild(el('b', '', mode === 'check' ? 'Systems check' : walk.on ? 'Setting up' : 'Set-up'));
    ht.appendChild(el('div', 'su-big', ready === all.length ? 'All systems go' : ready + ' of ' + all.length + ' ready'));
    ht.appendChild(el('small', '', ready === all.length ? 'Everything is in place.' : walk.on && c ? 'In hand: ' + c.title : 'Tap one to finish it, or say “set it all up”.'));
    head.appendChild(ring); head.appendChild(ht); d.appendChild(head);
    var ul = el('ul', 'su-list');
    all.forEach(function (r) {
      var isCur = !!(walk.on && c && c.key === r.key), skipped = walk.on && !r.ok && !!walk.skipped[r.key];
      var li = el('li', 'su-row' + (r.ok ? ' ok' : r.state === 'blocked' ? ' bad' : '') + (isCur ? ' cur' : '') + (skipped ? ' skip' : '') + (r.must && !r.ok ? ' must' : '') + (!r.ok && r.fix ? ' hasfix' : ''));
      var dot = el('span', 'su-dot'); dot.setAttribute('aria-hidden', 'true'); dot.textContent = r.ok ? '✓' : isCur ? '→' : r.state === 'blocked' ? '!' : '';
      var mid = el('span', 'su-mid'); mid.appendChild(el('b', '', r.title)); mid.appendChild(el('small', '', skipped ? 'Skipped for now' : r.note));
      li.appendChild(dot); li.appendChild(mid);
      var chip = el('span', 'su-chip', r.ok ? 'Ready' : r.state === 'blocked' ? 'Blocked' : r.must ? 'Needed' : 'Not yet'); li.appendChild(chip);
      if (!r.ok && r.fix) {
        var b = el('button', 'su-fix', r.fix); b.type = 'button'; b.setAttribute('aria-label', r.fix + ': ' + r.title);
        b.addEventListener('click', function () { walk.at = Date.now(); walk.away = false; if (walk.on) { var ix = walk.keys.indexOf(r.key); if (ix >= 0) walk.i = ix; } try { r.go(); } catch (e) {} repaint(); });
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
    d.appendChild(ul);
    if (walk.on) {
      var foot = el('div', 'su-foot'), mk = function (label, words) { var b = el('button', 'su-btn', label); b.type = 'button'; b.addEventListener('click', function () { walk.away = false; var r = inWalk(words, true); if (r) { try { kit.say(r.say, 'Setting up'); } catch (e) {} } repaint(); }); return b; };
      foot.appendChild(mk('Next', 'next')); foot.appendChild(mk('Skip', 'skip')); foot.appendChild(mk('Stop', 'stop setup'));
      foot.appendChild(el('small', '', 'Or say “next”, “skip” or “stop setup”.'));
      d.appendChild(foot);
    }
    if (keep) { var bs = d.querySelectorAll('button'); for (var i = 0; i < bs.length; i++) { if ((bs[i].getAttribute('aria-label') || bs[i].textContent) === keep) { try { bs[i].focus(); } catch (e) {} break; } } }
  }
  /* ------------------------------------------------------------ the showcase card: what Jarvis can do, each a tap away */
  function hasClaude() { return !!(Kin.brain && Kin.brain.hasKey && Kin.brain.hasKey()); }
  function showGroups() {
    var g = [
      { t: 'Instant', s: 'On this device, no waiting', items: ['What time is it in Tokyo?', 'Set a timer for 10 minutes', 'What’s 18% of 240?', 'Remind me to stretch in an hour'] },
      { t: 'Thinks with Claude', s: hasClaude() ? 'Research, writing and design' : 'Needs your Claude key', claude: true,
        items: ['What’s the latest in AI this week?', 'Design a poster for a coffee shop', Kin.venture ? 'Give me three business ideas' : 'Plan my week', 'Draft a thank-you email'] },
      { t: 'Voice', s: 'Just say it', items: ['Speak a little slower', 'Run a systems check', 'Set it all up', 'Say that again'] }
    ];
    if (inMac()) g[0].items[3] = 'Open Calendar';
    return g;
  }
  function askNow(q) {
    var inp = $('ask'), bar = $('bar'); if (!inp || !bar) return;
    inp.value = q;
    if (bar.requestSubmit) bar.requestSubmit(); else bar.dispatchEvent(new Event('submit', { cancelable: true }));
  }
  function paintShow(d) {
    d.textContent = ''; d.setAttribute('aria-label', 'What Jarvis can do');
    var head = el('div', 'sc-head'); head.appendChild(el('b', '', 'At your service'));
    head.appendChild(el('div', 'sc-big', 'What I can do'));
    head.appendChild(el('small', '', 'Tap one, or simply say it.')); d.appendChild(head);
    showGroups().forEach(function (gr) {
      var sec = el('section', 'sc-grp' + (gr.claude && !hasClaude() ? ' off' : ''));
      var h = el('div', 'sc-gh'); h.appendChild(el('span', 'sc-gt', gr.t)); h.appendChild(el('span', 'sc-gs', gr.s)); sec.appendChild(h);
      var row = el('div', 'sc-chips');
      gr.items.forEach(function (q) {
        var b = el('button', 'sc-chip', q); b.type = 'button';
        b.addEventListener('click', function () {
          if (gr.claude && !hasClaude()) { settings('brain', 'apiKey'); return; }
          askNow(q);
        });
        row.appendChild(b);
      });
      sec.appendChild(row); d.appendChild(sec);
    });
  }
  function repaint() { cards = cards.filter(function (d) { return d.isConnected; }); cards.forEach(function (d) { try { paintCard(d); } catch (e) {} }); }
  function card(c, box) {
    if (c && c.mode === 'show') { var sd = el('div', 'tmcard ancard setupcard showcard'); sd.setAttribute('role', 'group'); box.appendChild(sd); paintShow(sd); return; }
    var d = el('div', 'tmcard ancard setupcard'); d.setAttribute('role', 'group'); d.dataset.mode = c && c.mode === 'check' ? 'check' : 'setup';
    box.appendChild(d); cards.push(d); paintCard(d);
    /* keep it true while it is on screen: a key pasted in Settings ticks its row here */
    if (!card.t) card.t = setInterval(function () { cards = cards.filter(function (x) { return x.isConnected; }); if (!cards.length) { clearInterval(card.t); card.t = 0; return; } if (document.visibilityState !== 'hidden') repaint(); }, 2500);
  }

  /* ------------------------------------------------------------ the phrases (the whole sentence must be one of these) */
  var LEAD = /^(?:(?:hey|ok|okay|hi|hello) )?(?:(?:jarvis|kin) )?(?:(?:please|now|right|alright|all right|so) )*(?:(?:can|could|would|will|shall) (?:you|we) (?:please )?)?(?:(?:lets|let us|go ahead and|i want you to|i need you to|just) )*/;
  var TAIL = /(?: (?:please|sir|jarvis|kin|now|for me|right now|thanks|thank you))+$/;
  function clean(raw) {
    var t = String(raw || ''); if (!t || t.length > 90) return '';
    t = t.toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return t.replace(LEAD, '').replace(TAIL, '').trim();
  }
  var SETUP = /^(?:set (?:it|everything|you|yourself|jarvis) all up|set (?:everything|yourself|jarvis) up|get (?:everything|yourself|jarvis|you) (?:all )?set up|get you set up|(?:help me )?set you up|(?:i want|i would like|id like) to set you up|set up (?:everything|jarvis|yourself|it all|all of it)|(?:run|start|begin|do|open|launch) (?:the |my |a |your )?(?:initial |first )?set ?up(?: wizard| walk ?through)?|(?:run|walk|take|talk) me through (?:the |your )?(?:set ?up|setting up)|(?:continue|resume|finish|complete|carry on with|go on with) (?:the |my )?(?:set ?up|setting up)|finish setting (?:it|this|everything|things|me) (?:all )?up|guide me through (?:the )?(?:set ?up|setting up)|(?:help me )?(?:get|finish getting) (?:set up|all set up)|get everything ready|set ?up)$/;
  /* "set everything up" right after Jarvis offered something ("Shall I draft the plan?") means that offer: Claude takes
     it. "Set it all up" is the founder's own name for the set-up walk, so it always means the walk. */
  var AMBIG = /^(?:set everything all up|set everything up|set up (?:everything|it all|all of it)|get everything (?:ready|set up|all set up))$/;
  function offered() {
    var th = $('thread'), all = th && th.querySelectorAll ? th.querySelectorAll('.msg.kin') : [], last = all.length ? all[all.length - 1] : null;
    var t = last ? String(last.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return !!t && /\?$/.test(t) && !/set it all up|set-up|setup/i.test(t);
  }
  var CHECK = /^(?:(?:run|do|start|perform|give me|show me) (?:a |an |the |me a )?(?:full |quick )?(?:systems? check|systems? status|diagnostics?|diagnostic check|self ?test|self ?check)|(?:systems?|diagnostic|self) (?:check|test)|systems? status|diagnostics|how are your systems|are (?:all )?(?:your )?systems (?:go|online|up|ok|okay|working)|(?:is everything|are you)(?: all| fully)? (?:set up|working|online)(?: properly| correctly)?|check (?:your|all|all your) systems|(?:run |do )?(?:a )?(?:quick )?(?:status|health) check|check yourself|do a (?:quick )?check of (?:all )?your systems|all systems go|is everything (?:ok|okay|alright|all right) with you)$/;
  var HEAR = /^(?:(?:can|do|did) you hear me(?: ok| okay| alright)?|hear me(?: ok| okay| alright)?|are you (?:hearing|listening to) me|are you listening|(?:do|can) you read me|(?:are )?you there|is (?:the|my|this|your) (?:mic|microphone) (?:working|on)|is this thing on|(?:mic|microphone|sound|audio) (?:check|test)|testing(?: test(?:ing)?)*(?: (?:one|1) (?:two|2)(?: (?:three|3))?)?|test(?: test(?:ing)?)+|test (?:one|1) (?:two|2)(?: (?:three|3))?|(?:one|1) (?:two|2)(?: (?:one|1) (?:two|2))*|check (?:one|1) (?:two|2)(?: (?:three|3))?|do you copy|(?:can|do) you hear me (?:clearly|at all))$/;
  var LEFT = /^(?:(?:whats|what is)(?: still| else)? (?:left to set up|left in (?:the )?set ?up|missing from (?:the )?set ?up|not set up(?: yet)?|left to do in (?:the )?set ?up)|what (?:else |still )?needs (?:setting up|to be set up)|what (?:else )?do (?:you|i) (?:still )?need to set up|anything (?:else )?left to set up)$/;
  var SECT = { start: 'start', voice: 'voice', listening: 'voice', microphone: 'voice', mic: 'voice', brain: 'brain', claude: 'brain', key: 'brain', keys: 'brain', pictures: 'pictures', picture: 'pictures', email: 'email', mail: 'email', google: 'email', brief: 'brief', weather: 'brief', away: 'away', notifications: 'away', notification: 'away', 'grok bot': 'grok', grok: 'grok', sync: 'sync', privacy: 'privacy' };
  var SNAME = { start: 'Start', voice: 'Voice', brain: 'Brain', pictures: 'Pictures', email: 'Email', brief: 'Brief', away: 'Away', grok: 'Grok Bot', sync: 'Sync', privacy: 'Privacy' };
  var OPENSET = /^(?:(?:open|show|show me|bring up|pull up|go to|take me to)(?: the| my| your)? )?(?:jarvis )?(?:(start|voice|listening|microphone|mic|brain|claude|keys?|pictures?|e?mail|google|brief|weather|away|notifications?|grok(?: bot)?|sync|privacy) )?(?:settings|preferences)$/;
  var CLOSE = /^(?:(?:close|hide|dismiss|shut)(?: (?:that|it|this|the panel|the window|the settings|settings|the shelf|the conversation|everything|all of that))|close)$/;
  var AGAIN = /^(?:(?:say|repeat) (?:that|it)(?: again| once more| one more time)?|what did you(?: just)? say|what was that|come again|sorry what|i did not catch that|i didnt catch that|i missed that|pardon(?: me)?|repeat yourself|repeat (?:the last thing you said|what you (?:just )?said)|say again)$/;
  /* the showcase: "show me what you can do" gets a short spoken tour and a card of things to try, each one tap */
  var SHOW = /^(?:show me what you can do|show me what youve got|show me what you have got|what can you do(?: for me)?|what are you capable of|what are you able to do|show off|show me your (?:skills|powers|abilities|tricks)|impress me|(?:give me |run |do )?(?:a |the )?(?:quick )?(?:demo|tour|showcase)|show me around|what do you do)$/;
  var THANKS = /^(?:thanks|thank you|thank you very much|thanks a lot|thanks a million|many thanks|cheers|much appreciated|i appreciate it|appreciate it|nice work|good job|great job|well done|nicely done|good work|great work|thank you so much|thanks so much|thanks a bunch|thank you kindly|brilliant thanks|great thanks|perfect thanks)$/;
  var MUTE = /^(?:stop listening(?: to me)?|turn off (?:the )?(?:mic|microphone|listening)|turn (?:the )?(?:mic|microphone|listening) off|(?:mic|microphone) off|mute (?:the )?(?:mic|microphone)|mute yourself|mute|turn off your (?:mic|microphone)|stop listening for (?:now|a (?:bit|while)))$/;
  var UNMUTE = /^(?:start listening(?: to me)?(?: again)?|turn your (?:mic|microphone) (?:back )?on|turn on (?:the )?(?:mic|microphone|listening)|turn (?:the )?(?:mic|microphone|listening) on|(?:mic|microphone) on|unmute(?: (?:the )?(?:mic|microphone)| yourself)?)$/;
  var SLOWER = /^(?:(?:speak|talk|go) (?:a (?:bit|little) )?(?:slower|more slowly)|slow down(?: a (?:bit|little))?|slow it down|(?:speak|talk) slowly|slower|not so fast|(?:youre|you are) (?:talking|speaking|going) too fast)$/;
  var FASTER = /^(?:(?:speak|talk|go) (?:a (?:bit|little) )?(?:faster|quicker|more quickly)|speed it up|(?:speak|talk) quickly|faster|(?:youre|you are) (?:talking|speaking|going) too slow(?:ly)?)$/;
  var NORMAL = /^(?:(?:speak|talk) (?:at )?(?:your )?(?:normal|regular|usual) (?:speed|pace)|(?:normal|regular|usual) (?:speed|pace)|(?:speak|talk) normally)$/;
  /* how fast Jarvis speaks, kept on this device (not at a shared address) */
  function pace(d) {
    var V = Kin.voice; if (!V || typeof V.set !== 'function') return null;
    var r = 1; try { r = +(window.localStorage.getItem('kin.rate') || 1) || 1; } catch (e) {}
    var to = d === 0 ? 1 : Math.max(0.8, Math.min(1.2, Math.round((r + d) * 100) / 100));
    V.set({ rate: to }); if (!Kin.shared) { try { window.localStorage.setItem('kin.rate', String(to)); } catch (e) {} }
    return { from: r, to: to };
  }

  /* only while a walk is on */
  var W_NEXT = /^(?:next|next one|next step|next thing|ok next|okay next)$/;
  var W_SKIP = /^(?:skip|skip it|skip that|skip this|skip this one|skip that one|skip for now)$/;
  var W_BACK = /^(?:go back|previous step|the one before|back one)$/;
  var W_DONE = /^(?:done|thats done|that is done|its done|it is done|i did it|ive done it|i have done it|ive done that|its saved|it is saved|i pasted it|ive pasted it)$/;
  var W_STOP = /^(?:(?:stop|cancel|end|pause|quit|exit|leave)(?: the| this)? set ?up|enough set ?up(?: for now)?|well finish (?:the )?set ?up later|finish (?:the )?set ?up later)$/;

  function inWalk(t, fromButton) {
    if (!walk.on) return null;
    if (Date.now() - walk.at > WALK_IDLE) { endWalk(); return null; }
    if (!fromButton && (walk.away || Date.now() - walk.at > WALK_WORDS)) return null;
    var r = cur(), nx;
    if (W_STOP.test(t)) { closeTop(); endWalk(); var l = left(); return { say: l.length ? 'Set-up paused, sir. ' + num(l.length) + (l.length === 1 ? ' thing is' : ' things are') + ' still open. Say “continue setup” to pick it up.' : 'Set-up is finished, sir. All systems are go.' }; }
    if (W_DONE.test(t)) {
      if (r && !r.ok) { walk.at = Date.now(); return { say: 'I do not see it yet, sir. ' + (r.key === 'claude' || r.key === 'voice' || r.key === 'google' ? 'Paste it in the box and tap Save. ' : r.key === 'town' ? 'Type the town and tap Find it. ' : '') + 'Or say skip.' }; }
      nx = step(1); if (nx) { openStep(nx); return { say: 'Got it, sir. Next: ' + nx.line }; }
      closeTop(); return { say: 'Got it, sir. ' + closing() };
    }
    if (W_NEXT.test(t) || W_SKIP.test(t)) {
      var skip = W_SKIP.test(t) || (r && !r.ok); if (r && !r.ok) walk.skipped[r.key] = true;
      nx = step(1); if (nx) { openStep(nx); return { say: (skip && r && !r.ok ? 'Skipping ' + named(r) + ' for now, sir. ' : '') + 'Next: ' + nx.line }; }
      closeTop(); return { say: (skip && r && !r.ok ? 'Skipping ' + named(r) + ', sir. ' : '') + closing() };
    }
    if (W_BACK.test(t)) { var was = walk.i; nx = step(-1); if (nx && nx.ok) { walk.i = was; nx = null; } if (nx) { delete walk.skipped[nx.key]; openStep(nx); return { say: 'Back to ' + named(nx) + ', sir. ' + nx.line }; } return { say: 'That is the first one, sir.' }; }
    return null;
  }

  /* "say that again": the last thing Jarvis said aloud, gathered line by line as it speaks */
  var lastSaid = '', saying = '', fresh = true;
  try {
    if (Kin.voice && typeof Kin.voice.on === 'function') Kin.voice.on(function (e) {
      if (!e) return;
      if (e.type === 'line') { if (fresh) { saying = ''; fresh = false; } if (saying.length < 700) saying += (saying ? ' ' : '') + String(e.text || ''); return; }
      if (e.type === 'state' && e.state === 'idle') { if (saying) lastSaid = saying.slice(0, 700); fresh = true; }
    });
  } catch (e) {}
  function reply(say, cardMode, show) { var r = { say: say, show: show || say }; if (cardMode) r.card = { kind: 'setup', mode: cardMode }; return r; }
  function instant(raw) {
    try {
      var t = clean(raw); if (!t) return null;
      /* a step of the walk updates the card already on screen; only starting a walk or a check adds one */
      var w = inWalk(t); if (w) { repaint(); return reply(w.say, cards.some(function (d) { return d.isConnected; }) ? '' : 'setup'); }
      if (SETUP.test(t) && !(AMBIG.test(t) && offered())) { var s = startWalk(); return reply(s.say, 'setup'); }
      if (CHECK.test(t)) {
        var all = rows(), off = all.filter(function (r) { return !r.ok; }), on = all.length - off.length;
        var say = 'Running a systems check, sir. ' + (off.length ? num(on) + ' of ' + all.length + (on === 1 ? ' is' : ' are') + ' on. Not yet: ' + list(off.map(named)) + '.' + (off.some(function (r) { return r.must; }) ? ' I need the Claude key first.' : '') + ' Say “set it all up” and I will walk you through.' : 'All ' + all.length + ' are on. All systems are go.');
        return reply(say, 'check');
      }
      if (HEAR.test(t)) {
        var h = hearRow(), sp = st().unlocked;
        var hi = /you there$/.test(t) ? 'Right here, sir.' : 'Loud and clear, sir.';
        if (h.ok) return reply(hi + (sp ? '' : ' Tap anywhere once and I can answer aloud.'), '', hi + ' ' + h.note + '.' + (sp ? '' : ' Tap anywhere once and I can answer aloud.'));
        return reply('I can read what you type, sir, but I am not hearing you. ' + h.line, 'check');
      }
      if (LEFT.test(t)) {
        var l = left();
        if (!l.length) return reply('Nothing, sir. Everything is set up.', 'check');
        return reply(num(l.length) + (l.length === 1 ? ' thing is' : ' things are') + ' left, sir: ' + list(l.map(named)) + '. Say “set it all up” and I will walk you through.', 'check');
      }
      var m = OPENSET.exec(t);
      if (m) {
        var k = m[1] || '', sg = !k ? 'start' : /^e?mail$/.test(k) ? 'email' : /^grok/.test(k) ? 'grok' : (Object.prototype.hasOwnProperty.call(SECT, k) ? SECT[k] : 'start');
        settings(sg, ''); return reply(sg !== 'start' ? 'Opening the ' + SNAME[sg] + ' settings, sir.' : 'Opening settings, sir.');
      }
      if (CLOSE.test(t)) { var what = closeTop(); return reply(what ? 'Closed, sir.' : 'Nothing is open, sir.'); }
      if (AGAIN.test(t)) { return lastSaid ? reply(lastSaid) : reply('I have not said anything yet, sir.'); }
      /* "what can you do now" / "these days" asks what is new: that has its own answer */
      if (SHOW.test(t) && !/\b(?:now|these days|lately|new)\b/i.test(String(raw))) {
        var mac = inMac(), cl = hasClaude();
        var tour = 'With pleasure, sir. Right here, I keep time in any city, run your timers, reminders and lists, and do the maths before you finish asking. ' +
          (cl ? 'With Claude behind me, I search the web, write your emails, design posters and whole websites, and pressure-test a business idea until it holds. '
              : 'Give me your Claude key and I will also search the web, write your emails, design posters and websites, and pressure-test your business ideas. ') +
          (mac ? 'On this Mac I can open your apps, read your calendar and, when you say so, take the controls. ' : '') +
          'And you can talk over me whenever you like. Pick one below, or simply ask.';
        return reply(tour, 'show', 'Here is what I can do, sir. Tap one, or simply say it.');
      }
      if (THANKS.test(t)) { var tl = ['Of course, sir.', 'Any time, sir.', 'My pleasure, sir.', 'Always, sir.']; return reply(tl[Math.floor(Math.random() * tl.length)]); }
      var E = Kin.ears;
      if (MUTE.test(t)) {
        if (!E || !E.supported) return reply('I am not listening on this device, sir.');
        if (E.wanted()) { try { E.stop(); } catch (e) {} return reply('Listening is off, sir. Tap the mic when you want me.'); }
        return reply('I am not listening, sir.');
      }
      if (UNMUTE.test(t)) {
        if (!E || !E.supported) return reply('This browser cannot listen, sir. Type to me, or use the keyboard’s microphone.');
        if ((Kin.state || {}).micState === 'blocked') return reply(hearRow().line);
        if (E.wanted() && (Kin.state || {}).micState === 'listening') return reply('I am listening, sir.');
        try { E.start(); } catch (e) {} return reply('Listening, sir.');
      }
      if (SLOWER.test(t) || FASTER.test(t) || NORMAL.test(t)) {
        var d = NORMAL.test(t) ? 0 : SLOWER.test(t) ? -0.1 : 0.1, pc = pace(d);
        if (!pc) return null;
        if (d && pc.to === pc.from) return reply(d < 0 ? 'That is as slow as I go, sir.' : 'That is as fast as I go, sir.');
        return reply(d === 0 ? 'Back to my usual pace, sir.' : d < 0 ? 'A little slower, sir.' : 'A little faster, sir.');
      }
      /* something else entirely: the walk's spoken words stop counting until the walk is picked up again */
      if (walk.on) walk.away = true;
      return null;
    } catch (e) { return null; }
  }

  Kin.cues = {
    instant: instant, rows: rows, card: card, walking: function () { return walk.on; }, stop: function () { endWalk(); repaint(); },
    wire: function (k) { if (k && typeof k === 'object') { if (typeof k.say === 'function') kit.say = k.say; if (typeof k.steps === 'function') kit.steps = k.steps; } },
    _re: { SHOW: SHOW, SETUP: SETUP, CHECK: CHECK, HEAR: HEAR, LEFT: LEFT, OPENSET: OPENSET, CLOSE: CLOSE, AGAIN: AGAIN, THANKS: THANKS, MUTE: MUTE, UNMUTE: UNMUTE, SLOWER: SLOWER, FASTER: FASTER, NORMAL: NORMAL }, _clean: clean
  };
})();
