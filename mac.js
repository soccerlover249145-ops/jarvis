/* mac.js: Kin's side of the Jarvis Mac app (window.jarvisDesk, version 1).
   Inside the Mac app the page can open sites, apps on the owner's list and files in shared folders, start a Mail draft,
   and hand a job to take control. In any normal browser window.jarvisDesk does not exist and nothing here calls anything.

   Rules (from the Mac app's contract):
   - only from something the owner asked for: a model tool call inside the owner's own turn, or a tap; never on load;
   - the Mac asks the owner first in its own dialog, which this page cannot draw or click;
   - a "no" is final: nothing is asked again in that turn, nothing retries by itself;
   - Mail drafts are never sent; take control still asks before passwords, sending, buying, booking, posting or deleting;
   - never on a shared or plain-http address (Kin.shared).

   Public surface (window.Kin.mac):
     available()            -> true inside the Mac app on Jarvis's own address
     tools(ctx)             -> the Claude tools (open_url, open_app, open_file, run_task), or [] outside the app
     draft(ctx, d)          -> email_draft inside the app: a Mail draft, falling back to the Gmail card if the Mac cannot
     busy() / stop()        -> a take-control task is running / stop it at once
     onDone(fn)             -> fn({ title, body }) when a task ends
     needsMac(text)         -> true for "open the Notes app", "show my Downloads folder", "do X on my computer"
     card(info) / need()    -> the small result card, and the "needs the Mac app" reply's install steps */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};

  function D() { var d = window.jarvisDesk; return d && typeof d === 'object' && d.version >= 1 ? d : null; }
  function available() { return !!D() && !Kin.shared; }

  var running = false, doneFns = [], hooked = false;
  function hook() {
    var d = D(); if (hooked || !d || typeof d.onTaskDone !== 'function') return; hooked = true;
    try { d.onTaskDone(function (x) { running = false; x = x || {}; var o = { title: String(x.title || 'The task ended').slice(0, 120), body: String(x.body || '').slice(0, 600) }; doneFns.forEach(function (f) { try { f(o); } catch (e) {} }); }); } catch (e) {}
  }

  /* ------------------------------------------------------------ checks before anything goes to the Mac */
  function urlOk(u) {
    u = String(u || '').trim(); if (!u || u.length > 2000) return null;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { var x = new URL(u); if (!/^https?:$/.test(x.protocol) || x.username || x.password || !/\./.test(x.hostname)) return null; return x.href; } catch (e) { return null; }
  }
  function appOk(n) { n = String(n || '').trim(); return /^[\p{L}\p{N}][\p{L}\p{N} .&'+()\-]{0,79}$/u.test(n) ? n : null; }
  function pathOk(p) { p = String(p || '').trim(); return p && p.length <= 1000 && !/[\u0000-\u001f]/.test(p) ? p : null; }
  function taskOk(t) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length >= 3 && t.length <= 2000 ? t : null; }

  /* one call to the Mac, shown as a card; a "no" in this turn stops every later call in the same turn */
  var LABEL = { openUrl: 'Open a site', openApp: 'Open an app', openFile: 'Open a file', revealFile: 'Show a file in Finder', newEmailDraft: 'Start a Mail draft', runTask: 'Use your computer' };
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
  function call(ctx, method, arg, what, host) {
    var d = D();
    if (!d || Kin.shared) return Promise.resolve('Not done: this only works inside the Jarvis Mac app. Say so in one line.');
    ctx.mac = ctx.mac || { n: 0, task: 0, no: false };
    if (ctx.mac.no) return Promise.resolve('Not asked: the founder already said no to a computer action in this message. Do not try again; say what you would have done in one line.');
    if (method === 'runTask' && ++ctx.mac.task > 1) return Promise.resolve('Not asked: one take-control task per message. Say what is left.');
    if (++ctx.mac.n > 5) return Promise.resolve('Not asked: five computer actions is the limit for one message. Stop here and say what is left.');
    if (typeof d[method] !== 'function') return Promise.resolve('Not done: this Mac app does not offer that yet.');
    var info = { kind: method, label: LABEL[method] || 'Computer action', what: String(what).slice(0, 300), host: host || '', state: 'asking' };
    var c = card(info); if (ctx.onMac) ctx.onMac(c.el);
    var beat = setInterval(function () { if (ctx.onBeat) ctx.onBeat(); }, 4000);
    var pr; try { pr = Promise.resolve(d[method](arg)); } catch (e) { pr = Promise.reject(e); }
    return pr.then(function (r) {
      clearInterval(beat); r = r && typeof r === 'object' ? r : { ok: false, why: 'The Mac gave no answer.' };
      if (r.ok) {
        if (method === 'runTask') { running = true; hook(); }
        c.set(method === 'runTask' ? 'running' : 'done', method === 'newEmailDraft' ? 'Draft is open in Mail. It is not sent.' : method === 'runTask' ? 'Jarvis is using your computer. Esc or moving the mouse stops it.' : 'Done.');
        if (method === 'newEmailDraft') return 'The draft is open in the Mail app. It is NOT sent: the founder presses Send. Say exactly that in one short line, and never say it was sent.';
        if (method === 'runTask') return 'The task has started on the founder\'s computer with a visible Stop bar. Say in one line that it is under way and how to stop it (Esc, or move the mouse). Do not claim it is finished.';
        return 'Done on the founder\'s Mac. Confirm in a few words.';
      }
      var why = String(r.why || 'The Mac did not do it.').slice(0, 300);
      if (r.declined) { ctx.mac.no = true; c.set('no', 'You said no. Nothing was done.'); return 'The founder said no in the Mac\'s dialog. Nothing was done. Accept it in a few words and do not try again.'; }
      c.set('refused', why); return 'The Mac refused: ' + why + ' Tell the founder plainly; do not try again in this message.';
    }, function (e) {
      clearInterval(beat); var why = 'The Mac app did not answer (' + String((e && e.message) || e).slice(0, 120) + ').';
      c.set('refused', why); return 'Not done: ' + why + ' Say so plainly; do not retry.';
    });
  }

  /* ------------------------------------------------------------ the Claude tools, only inside the Mac app */
  var str = function (v) { return typeof v === 'string' && v.trim().length > 0; };
  /* the computer tools are offered only when the founder's own words in this message ask for something on the computer:
     a web page or a tool result saying "open this" is not the founder */
  var ASKED = /^\s*(?:(?:hey|ok|okay)\s+)?(?:jarvis[,!.:]?\s+)?(?:(?:please|can you|could you|would you|go and|go)\s+)*(?:open|launch|start up|quit|close|show me|reveal|pull up|bring up|go to|visit)\b|\b(?:on|in) my (?:computer|mac|laptop|desktop|browser)\b|\bin finder\b|\btake control\b|\buse my (?:computer|mac|laptop)\b/i;
  function asked(text) { return ASKED.test(String(text || '')); }
  function tools(ctx) {
    if (!available()) return [];
    if (!asked(ctx && ctx.question)) return [];
    hook();
    return [
      { def: { name: 'open_url', description: 'Open a web address in the founder\'s default browser on their Mac. The Mac asks the founder first.', eager_input_streaming: true,
          input_schema: { type: 'object', properties: { url: { type: 'string', description: 'An http or https address.' } }, required: ['url'] } },
        ok: function (i) { return str(i.url); }, status: 'Asking your Mac',
        run: function (i) { var u = urlOk(i.url); if (!u) return 'Not opened: that is not an http or https address. Ask for the right one.'; return call(ctx, 'openUrl', u, u, hostOf(u)); } },
      { def: { name: 'open_app', description: 'Open an app on the founder\'s Mac by its name (e.g. "Notes", "Calendar"). Only apps on the founder\'s list open; the Mac says how to add one otherwise. The Mac asks first.', eager_input_streaming: true,
          input_schema: { type: 'object', properties: { name: { type: 'string', description: 'The app\'s name as it appears in Applications.' } }, required: ['name'] } },
        ok: function (i) { return str(i.name); }, status: 'Asking your Mac',
        run: function (i) { var n = appOk(i.name); if (!n) return 'Not opened: that is not an app name.'; return call(ctx, 'openApp', n, n); } },
      { def: { name: 'open_file', description: 'Open a file, or show it in Finder, inside a folder the founder shared with the Mac app. A path relative to a shared folder or absolute. Files that could run code are only shown in Finder. The Mac asks first.', eager_input_streaming: true,
          input_schema: { type: 'object', properties: { path: { type: 'string' }, reveal: { type: 'boolean', description: 'true to only show it in Finder.' } }, required: ['path'] } },
        ok: function (i) { return str(i.path) && (i.reveal === undefined || typeof i.reveal === 'boolean'); }, status: 'Asking your Mac',
        run: function (i) { var p = pathOk(i.path); if (!p) return 'Not opened: that is not a usable path.'; return call(ctx, i.reveal ? 'revealFile' : 'openFile', p, p); } },
      { def: { name: 'run_task', description: 'Hand a job to take control: Jarvis uses the founder\'s screen, mouse and keyboard on their Mac to do it, with a visible Stop bar. Use only for "do it on my computer" jobs that the other tools cannot do. The Mac always asks first, and inside the task it still asks before passwords, sending, buying, booking, posting, deleting or installing. One per message.', eager_input_streaming: true,
          input_schema: { type: 'object', properties: { task: { type: 'string', description: 'The job in plain words, with what done looks like and anything not to do (e.g. "do not submit").' } }, required: ['task'] } },
        ok: function (i) { return str(i.task); }, status: 'Asking your Mac',
        run: function (i) { var t = taskOk(i.task); if (!t) return 'Not started: describe the task in a sentence (at most 2,000 characters).'; return call(ctx, 'runTask', t, t); } }
    ];
  }
  /* email_draft inside the Mac app: a draft in Mail; if the Mac cannot (not a "no"), the Gmail card instead */
  function draft(ctx, d) {
    if (!available()) return null;
    var to = String(d.to || '').trim();
    return call(ctx, 'newEmailDraft', { to: to, cc: String(d.cc || '').trim(), subject: d.subject, body: d.body }, (to ? 'To ' + to + ': ' : '') + d.subject).then(function (r) {
      if (/^The Mac refused|^Not done/.test(r) && ctx.onEmail) { ctx.emails.push(d); ctx.onEmail(d); return r + ' The email is also shown as a card the founder can open in Gmail.'; }
      if (/^The draft is open/.test(r)) ctx.emails.push(d);
      return r;
    });
  }

  /* the founder's own words "open example.com" inside the Mac app: the default browser, after the Mac asks */
  function openOwn(url, onNode) { var u = urlOk(url); if (!u) return Promise.resolve('Not opened.'); return call({ onMac: onNode }, 'openUrl', u, u, hostOf(u)); }

  function busy() { return running && available(); }
  function stop() { var d = D(); if (!running || !d || typeof d.stop !== 'function') return Promise.resolve({ ok: false }); running = false; try { return Promise.resolve(d.stop()); } catch (e) { return Promise.resolve({ ok: false }); } }
  function onDone(fn) { if (typeof fn === 'function') doneFns.push(fn); }

  /* ------------------------------------------------------------ in a normal browser: say what needs the Mac app */
  var APPS = 'notes|finder|mail|calendar|messages|spotify|slack|xcode|terminal|photos|music|reminders|pages|numbers|keynote|figma|discord|facetime|zoom|vs ?code|visual studio code|bambu studio|system settings|system preferences|preview|textedit|app store|photo booth|garageband|imovie|final cut( pro)?|logic( pro)?';
  var NEED = [
    new RegExp('^(?:(?:hey|ok|okay)\\s+)?(?:jarvis[,!.]?\\s+)?(?:please\\s+|can you\\s+|could you\\s+)?(?:open|launch|start|quit|close)\\s+(?:up\\s+)?(?:the\\s+|my\\s+)?(?:' + APPS + ')(?:\\s+app)?\\s*[.!?]*$', 'i'),
    /^(?:(?:hey|ok|okay)\s+)?(?:jarvis[,!.]?\s+)?(?:please\s+|can you\s+|could you\s+)?(?:open|launch|start)\s+(?:up\s+)?(?:the\s+|my\s+)?[\w .&'+-]{1,40}\s+app\s*[.!?]*$/i,
    /^(?:(?:hey|ok|okay)\s+)?(?:jarvis[,!.]?\s+)?(?:please\s+|can you\s+|could you\s+)?(?:open|show|reveal)\s+(?:me\s+)?(?:the\s+|my\s+)?(?:[\w .'-]{1,40}\s+)?(?:file|folder|downloads|documents folder|desktop folder)\b/i,
    /\bin finder\b/i,
    /^(?:(?:hey|ok|okay)\s+)?(?:jarvis[,!.]?\s+)?(?:please\s+|can you\s+|could you\s+|go\s+)?(?:do|fill|click|type|use|set|change|organi[sz]e|move|rename|clean|sort|close|quit|turn|run|take control)\b.*\bon my (?:computer|mac|laptop|desktop)\b/i
  ];
  function needsMac(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    /* "open my reminders" means Jarvis's own reminders (the Calendar panel), not the Reminders app */
    if (/^(?:(?:hey|ok|okay)\s+)?(?:jarvis[,!.]?\s+)?(?:(?:please|can you|could you|would you)\s+)*(?:open|show)\s+(?:me\s+)?my\s+reminders\s*[.!?]*$/i.test(t)) return false;
    return !!t && t.length <= 300 && NEED.some(function (r) { return r.test(t); });
  }
  var NEED_TEXT = 'That needs the Jarvis Mac app on your computer, sir. In a browser I can open websites, but not apps, files or your screen.';
  var STEPS = ['Install Apple\'s command line tools (xcode-select --install) and Node.js 20 or newer.',
    'Clone the desktop-app branch of your jarvis repository and run: bash install-mac.sh (the guide is LOCAL-SETUP.md in that branch).',
    'Open Jarvis from Applications (right-click, Open, the first time).',
    'In its Settings, allow Microphone, Speech, Screen Recording and Accessibility, and add your apps and folders.'];

  /* ------------------------------------------------------------ the small result card */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var STATE = { asking: 'Your Mac is asking you', done: 'Done', running: 'Running', no: 'You said no', refused: 'Not done' };
  function card(info) {
    var el = h('div', 'maccard is-' + info.state), top = h('div', 'mc-top');
    var chip = h('span', 'mc-chip', STATE[info.state] || ''), lab = h('span', 'mc-lab', info.label);
    top.appendChild(chip); top.appendChild(lab); el.appendChild(top);
    /* for a web address the site's name is what matters: shown large, the full address under it */
    if (info.host) el.appendChild(h('p', 'mc-host', info.host));
    el.appendChild(h('p', 'mc-what', info.what));
    var note = h('p', 'mc-note', info.state === 'asking' ? 'Answer the dialog on your Mac. Nothing happens until you do.' : ''); el.appendChild(note);
    el.setAttribute('role', 'status');
    return { el: el, set: function (st, text) { el.className = 'maccard is-' + st; chip.textContent = STATE[st] || ''; note.textContent = text || ''; } };
  }
  /* the reply in a normal browser: a line, plus a pill that shows the install steps */
  function need() {
    var wrap = h('div', 'macneed'), b = h('button', 'pill sm macsteps'); b.type = 'button'; b.appendChild(h('span', 'pl', 'How to install the Mac app'));
    var ol = h('ol', 'macstepslist'); ol.hidden = true; STEPS.forEach(function (s) { ol.appendChild(h('li', null, s)); });
    b.addEventListener('click', function () { ol.hidden = !ol.hidden; b.setAttribute('aria-expanded', String(!ol.hidden)); });
    b.setAttribute('aria-expanded', 'false'); wrap.appendChild(b); wrap.appendChild(ol); return wrap;
  }

  var NOTE = 'THE MAC APP\nYou are running inside the Jarvis Mac app on the founder\'s computer. Besides everything else, you can open_url, open_app (apps on the founder\'s list), open_file (inside folders the founder shared) and run_task (take control of the screen for a multi-step job); email_draft opens a draft in the Mail app. Use them whenever the founder asks you to open something or do something on their computer, and never in any other case. The Mac asks the founder before each action in its own dialog; if they say no, accept it and do not try again. Prefer the specific tools; use run_task only when nothing else fits, at most once per message. A Mail draft is never sent by you. You still never send, buy, post, book or delete: take control stops and asks the founder before any of those.';
  function note() { return available() ? NOTE : ''; }

  /* ------------------------------------------------------------ keys from the Mac's Keychain (window.jarvisDesk.keys)
     On load, a key this page lacks is filled in from the Mac; a key the owner saves here is also handed to the Mac.
     The values are never logged, shown or put in the page: they go straight into the same setKey the Settings use. */
  function K() { var d = D(); return d && !Kin.shared && d.keys && typeof d.keys === 'object' ? d.keys : null; }
  function pick(o, names) { if (!o) return ''; if (typeof o === 'string') return o; for (var i = 0; i < names.length; i++) { var v = o[names[i]]; if (typeof v === 'string' && v) return v; if (v && typeof v.value === 'string') return v.value; } return typeof o.value === 'string' ? o.value : ''; }
  var CLAUDE = ['claude', 'anthropic'], ELEVEN = ['elevenlabs', 'tts', 'voice'];
  var fromMac = {};
  function prefill(after) {
    var k = K(); if (!k || typeof k.get !== 'function') return Promise.resolve(false);
    var needC = Kin.brain && !Kin.brain.hasKey(), needE = Kin.voice && Kin.voice.tts && !Kin.voice.tts.hasKey();
    if (!needC && !needE) return Promise.resolve(false);
    var pr; try { pr = Promise.resolve(k.get()); } catch (e) { pr = Promise.resolve(null); }
    return pr.then(function (r) {
      if (!r || r.ok === false) return false;
      var o = r.keys && typeof r.keys === 'object' ? r.keys : r, c = pick(o, CLAUDE).trim(), e = pick(o, ELEVEN).trim(), changed = false, jobs = [];
      /* these are the Mac's stand-ins, not the keys: the app swaps in the real key as each request leaves the Mac */
      if (needC && c && Kin.brain.setKey(c).ok) { fromMac.claude = true; changed = true; }
      if (needE && e) jobs.push(Kin.voice.tts.setKey(e).then(function () { fromMac.elevenlabs = true; changed = true; }, function () {}));
      return Promise.all(jobs).then(function () { if (changed && typeof after === 'function') after(); return changed; });
    }, function () { return false; });
  }
  /* a key the owner pasted here goes to the Mac's Keychain; the page then keeps only the Mac's stand-in */
  function saveKey(kind, value, after) {
    var k = K(); if (!k || typeof k.saveFromPage !== 'function' || !value) return Promise.resolve({ ok: false, local: true });
    var pr; try { pr = Promise.resolve(k.saveFromPage(kind, String(value).trim())); } catch (e) { pr = Promise.resolve({ ok: false }); }
    return pr.then(function (r) {
      r = r || {};
      if (r.ok && typeof r.placeholder === 'string' && r.placeholder) {
        if (kind === 'claude' && Kin.brain.setKey(r.placeholder).ok) fromMac.claude = true;
        if (kind === 'elevenlabs') { fromMac.elevenlabs = true; Kin.voice.tts.setKey(r.placeholder).catch(function () {}); }
      } else if (r.ok && r.unchanged) fromMac[kind] = true;
      if (typeof after === 'function') after(r);
      return { ok: !!r.ok, why: r.ok ? '' : String(r.why || '').slice(0, 200) };
    }, function () { return { ok: false }; });
  }
  function keptOnMac(kind) { return !!fromMac[kind] && !!K(); }

  Kin.mac = { asked: asked, available: available, tools: tools, draft: draft, busy: busy, stop: stop, onDone: onDone, needsMac: needsMac, NEED_TEXT: NEED_TEXT, need: need, card: card, note: note, STEPS: STEPS, prefill: prefill, saveKey: saveKey, keptOnMac: keptOnMac, openOwn: openOwn };
})();
