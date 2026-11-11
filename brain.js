/* brain.js: how Kin thinks. With a Claude API key on this device, questions go straight
   from this browser to the Anthropic API through the official SDK (vendored, no CDN).
   Without a key, a small local brain answers from the pack: greetings, a brief, dates, search. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var Anthropic = window.Anthropic;
  var KEY = 'kin.key', TURNS = 'kin.turns', ASKED = 'kin.asked', LIMH = 'kin.limH', LIMD = 'kin.limD';
  var MAIN = 'claude-opus-5-5';      /* real questions */
  var QUICK = 'claude-haiku-5-5';    /* small talk, answered in a second or two */
  var MAXSYS = 90000;                /* characters of standing text sent with every question, at most */

  /* at an address shared with another site nothing private is read or written (see guard.js) */
  var ls = {
    get: function (k) { if (Kin.shared) return null; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { if (Kin.shared) return false; try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function list(k) { try { var v = JSON.parse(ls.get(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  var turns = list(TURNS).filter(function (t) { return t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'; });

  /* ---- a brake on spending: how many questions may go to Claude in an hour and in a day ---- */
  var asked = list(ASKED).filter(function (t) { return typeof t === 'number'; });
  function lim(k, d, max) { var v = parseInt(ls.get(k), 10); return v >= 1 && v <= max ? v : d; }
  function usage() {
    var now = Date.now(); asked = asked.filter(function (t) { return now - t < 864e5 && t <= now + 60000; });
    return { hour: asked.filter(function (t) { return now - t < 36e5; }).length, day: asked.length, perHour: lim(LIMH, Kin.T.perHour, 500), perDay: lim(LIMD, Kin.T.perDay, 5000) };
  }
  function over() { var u = usage(); return u.hour >= u.perHour ? 'hour' : u.day >= u.perDay ? 'day' : ''; }
  function count() { asked.push(Date.now()); ls.set(ASKED, JSON.stringify(asked.slice(-5000))); }
  var client = null, clientKey = '';

  function getClient() {
    var key = ls.get(KEY); if (!key || !Anthropic) return null;
    if (!client || clientKey !== key) {
      /* The key belongs to the person using this device and is typed in by them, so the
         browser is the right place to call from; the SDK asks us to say so explicitly. */
      client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120000 });
      clientKey = key;
    }
    return client;
  }

  var PERSONA = [
    'You are Kin, a personal assistant with the manner of a calm, dry, precise British butler. You speak with the person who owns this device, the founder. Address them as "sir", at most once per answer, and never by first name.',
    '- Lead with the answer. Short sentences. Have a point of view: recommend one thing and say why. Dry humour is welcome; flattery and filler are not.',
    '- Never invent facts, numbers, dates or names. What you know about the founder\'s world is in the pack below and reachable with your tools. If the pack does not say, say so. Anything about the outside world comes from general knowledge: say it should be checked.',
    '- You draft, people send. You cannot send, buy, post or change anything outside this page, and you never claim to have.',
    '- When the pack has rules, they outrank this paragraph.'
  ].join('\n');
  var SPOKEN = '\n\n[Spoken conversation. The founder is talking out loud and will hear this answer read aloud. Answer in at most four short sentences of plain spoken words. No lists, no tables, no headings, no markdown. Say dates and numbers the way a person says them. If there is more worth hearing, end with one short question offering it.]';

  function system() {
    var p = Kin.pack.get(), parts = [PERSONA];
    if (p) {
      if (p.rules) parts.push('THE FOUNDER\'S STANDING RULES\n' + p.rules);
      if (p.brief) parts.push('BRIEF\n' + p.brief);
      var st = Object.keys(p.stats || {}).filter(function (k) { var v = p.stats[k]; return typeof v === 'number' || typeof v === 'string'; }).slice(0, 40);
      if (st.length) parts.push('NUMBERS (as of the pack, ' + (p.exported || 'date unknown').slice(0, 10) + ')\n' + st.map(function (k) { return '- ' + String(k).slice(0, 60) + ': ' + String(p.stats[k]).slice(0, 80); }).join('\n'));
      if (p.skills.length) parts.push('PLAYBOOKS you can read with read_skill before a job they cover\n' + p.skills.map(function (s) { return '- ' + s.id + ': ' + s.name + (s.when ? ' (' + s.when.slice(0, 120) + ')' : ''); }).join('\n'));
      parts.push('The pack "' + p.name + '" holds ' + p.nodes.length + ' entries. Use search_atlas and open_node to ground answers; one search is usually enough for a simple question.');
    } else parts.push('No pack is loaded on this device, so you know nothing about the founder\'s company or projects yet. Say so when asked, and mention that a pack can be imported in settings.');
    /* stable text first and cached; anything that changes per question goes in the user turn */
    var all = parts.join('\n\n'); if (all.length > MAXSYS) all = all.slice(0, MAXSYS) + '\n\n[The rest of the pack summary was cut for length. Use the tools to look things up.]';
    return [{ type: 'text', text: all, cache_control: { type: 'ephemeral' } }];
  }

  function card(n, full) {
    var o = { id: n.id, title: n.t, kind: n.k }; if (n.st) o.status = n.st; if (n.d) o.date = Kin.day(n.d) + ' (' + n.d + ')';
    if (n.s) o.summary = full ? n.s : n.s.slice(0, 220); if (full && n.f.length) o.facts = n.f;
    if (full) { var k = Kin.pack.kids(n.id); if (k.length) o.children = k.slice(0, 40).map(function (c) { return { id: c.id, title: c.t, kind: c.k }; }); if (n.p) { var par = Kin.pack.node(n.p); if (par) o.parent = { id: par.id, title: par.t }; } }
    return o;
  }
  var str = function (v) { return typeof v === 'string' && v.trim().length > 0; };
  var int = function (v) { return v === undefined || (typeof v === 'number' && isFinite(v)); };
  /* each tool: its definition for the model, a check of the model's input, and what it does */
  var TOOLS = [
    { def: { name: 'search_atlas', description: 'Search the founder\'s pack by words. Returns the best matching entries with id, title, kind, status, date and a short summary.', eager_input_streaming: true,
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'A few key words: a name, a topic, a task number.' }, limit: { type: 'integer', description: 'How many to return, 1 to 12. Default 6.' } }, required: ['query'] } },
      ok: function (i) { return str(i.query) && int(i.limit); },
      run: function (i) { var r = Kin.pack.search(i.query, Math.max(1, Math.min(12, i.limit || 6))); return r.length ? r.map(function (n) { return card(n, false); }) : 'Nothing in the pack matches those words.'; } },
    { def: { name: 'open_node', description: 'Read one entry in full by id: summary, facts, parent and children.', eager_input_streaming: true,
        input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
      ok: function (i) { return str(i.id); },
      run: function (i) { var n = Kin.pack.node(i.id); return n ? card(n, true) : 'No entry has that id. Search first.'; } },
    { def: { name: 'list_dates', description: 'Dated entries from today forward, soonest first. Use for "what is due", "what is coming up", a brief or an update.', eager_input_streaming: true,
        input_schema: { type: 'object', properties: { days: { type: 'integer', description: 'How many days ahead, 1 to 120. Default 14.' } } } },
      ok: function (i) { return int(i.days); },
      run: function (i) { var r = Kin.pack.dates(Math.max(1, Math.min(120, i.days || 14))); return r.length ? r.slice(0, 40).map(function (n) { return card(n, false); }) : 'Nothing dated in that window.'; } },
    { def: { name: 'read_skill', description: 'Read one playbook by id before doing a job it covers.', eager_input_streaming: true,
        input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
      ok: function (i) { return str(i.id); },
      run: function (i) { var p = Kin.pack.get(), s = p && p.skills.filter(function (x) { return x.id === i.id; })[0]; return s ? s.body || 'That playbook is empty.' : 'No playbook has that id.'; } }
  ];

  function smallTalk(text) {
    var n = Kin.ears.norm(text), w = n.split(' ').filter(Boolean);
    if (/^(sup|hey|hi|hello|yo|hiya|good (morning|afternoon|evening|night)|thanks|thank you|cheers|ok|okay|cool|nice|great|yes|no|yep|nope|sure|how are you|hows it going|whats up|you there|are you there|test|testing)( kin| jarvis| sir| mate)?$/.test(n)) return true;
    return w.length <= 4 && !/\b(what|when|who|where|why|how|which|due|brief|update|status|task|plan|draft|write|design|make|find|search|list|show|tell|remind|cost|price|money|date|deadline|week|today|tomorrow)\b/.test(n);
  }
  function today() { var d = new Date(); return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()] + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }

  function remember(q, a) { turns.push({ role: 'user', content: q }, { role: 'assistant', content: a }); turns = turns.slice(-16); ls.set(TURNS, JSON.stringify(turns)); }
  function textOf(message) { return message.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim(); }

  /** Ask Claude. Streams text through opts.onText(wholeTextSoFar). */
  function askClaude(text, opts) {
    var c = getClient(), quick = smallTalk(text);
    var messages = turns.slice(-10).map(function (t) { return { role: t.role, content: t.content }; });
    messages.push({ role: 'user', content: text + '\n\n[Today is ' + today() + '.]' + (opts.aloud ? SPOKEN : '') });
    var reqOpts = opts.signal ? { signal: opts.signal } : undefined, shown = '';
    function show(t) { shown = t; if (opts.onText) opts.onText(t); }

    if (quick) {
      /* Small talk: the fast model, no tools, a couple of sentences. */
      var qs = c.messages.stream({ model: QUICK, max_tokens: 1024, output_config: { effort: 'low' }, system: system(),
        messages: messages.concat([]) }, reqOpts);
      qs.on('text', function (delta, snapshot) { show(snapshot); });
      return qs.finalMessage().then(function (m) {
        if (m.stop_reason === 'refusal') return { text: 'I would rather not answer that one, sir.', refused: true, model: m.model };
        return { text: textOf(m) || shown, model: m.model };
      });
    }

    var tools = Kin.pack.get() ? TOOLS.map(function (t) { return t.def; }) : [], prior = '', step = 0, pauses = 0, jsonRetries = 0;
    /* a spoken answer is a few sentences: it needs far less room and fewer look-ups than a written one */
    var room = opts.aloud ? 4000 : 8000, maxSteps = opts.aloud ? 3 : 4;
    function turn() {
      /* Claude Opus 5.5: thinking is always on, depth is set by effort. A request the safety
         systems decline is re-run by the API on a fallback model (server-side fallbacks). */
      var params = { model: MAIN, max_tokens: room, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: opts.aloud ? 'low' : 'medium' }, system: system(), messages: messages };
      if (tools.length) params.tools = tools;
      var s = c.beta.messages.stream(params, reqOpts);
      s.on('text', function (delta, snapshot) { show(prior + snapshot); });
      return s.finalMessage().then(function (m) {
        jsonRetries = 0;
        var said = textOf(m);
        /* a refusal can arrive after some words: those words are not the answer and are dropped */
        if (m.stop_reason === 'refusal') return { text: 'I would rather not answer that one, sir.', refused: true, model: m.model };
        var uses = m.content.filter(function (b) { return b.type === 'tool_use'; });
        if (m.stop_reason === 'pause_turn' && ++pauses <= 2) { messages.push({ role: 'assistant', content: m.content }); return turn(); }
        if (!uses.length || m.stop_reason === 'max_tokens' || m.stop_reason === 'pause_turn' || ++step > maxSteps) return { text: (prior + said).trim() || shown, model: m.model, cut: m.stop_reason === 'max_tokens' };
        if (said) prior += said + '\n\n';
        messages.push({ role: 'assistant', content: m.content });
        /* every tool_use gets a tool_result, all in one user message */
        messages.push({ role: 'user', content: uses.map(function (u) {
          var t = TOOLS.filter(function (x) { return x.def.name === u.name; })[0], input = u.input && typeof u.input === 'object' ? u.input : null, out, bad = false;
          if (opts.onTool) opts.onTool(u.name);
          if (!t) { out = 'Unknown tool.'; bad = true; }
          else if (!input || !t.ok(input)) { out = JSON.stringify({ INVALID_JSON: JSON.stringify(u.input) }); bad = true; }
          else { try { out = t.run(input); } catch (e) { out = 'The tool failed: ' + (e && e.message); bad = true; } }
          var block = { type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out).slice(0, 24000) };
          if (bad) block.is_error = true; return block;
        }) });
        return turn();
      }, function (err) {
        /* a tool input that could not be parsed at all: ask again, twice at most. API errors go up. */
        if (err instanceof Anthropic.APIError || !/pars|JSON/i.test(String((err && err.message) || '')) || jsonRetries++ >= 1) throw err;
        return turn();
      });
    }
    return turn();
  }

  function explain(err) {
    if (err instanceof Anthropic.APIUserAbortError) return { code: 'stopped', text: '' };
    if (err instanceof Anthropic.AuthenticationError) return { code: 'key', text: 'Anthropic did not accept the key on this device, sir. Check it in settings.' };
    if (err instanceof Anthropic.PermissionDeniedError) return { code: 'denied', text: 'That key is not allowed to do this, sir. Check its workspace and spend limit in the Anthropic Console.' };
    if (err instanceof Anthropic.RateLimitError) return { code: 'busy', text: 'The key has hit its rate or spend limit, sir. Give it a minute, or raise the limit in the Console.' };
    if (err instanceof Anthropic.BadRequestError) return { code: 'request', text: 'Anthropic rejected that request, sir. The reason is on screen.', detail: String(err.message || '').slice(0, 300) };
    if (err instanceof Anthropic.APIConnectionError) return { code: 'network', text: 'I cannot reach Anthropic from here, sir. Check the connection.' };
    if (err instanceof Anthropic.APIError) return { code: 'api', text: 'Anthropic had a problem, sir (' + (err.status || 'no status') + '). Try again in a moment.' };
    return { code: 'error', text: 'Something went wrong on this page, sir. The reason is on screen.', detail: String((err && err.message) || err).slice(0, 300) };
  }

  /** The local brain: no key needed, answers only from the pack on this device. */
  function local(text) {
    var n = Kin.ears.norm(text), p = Kin.pack.get(), h = new Date().getHours(), hello = h < 5 ? 'Still up, sir.' : h < 12 ? 'Good morning, sir.' : h < 18 ? 'Good afternoon, sir.' : 'Good evening, sir.';
    if (/^(sup|hey|hi|hello|yo|hiya|good (morning|afternoon|evening)|how are you|whats up|you there|are you there|test|testing)\b/.test(n)) return hello + (p ? ' Ask me what is coming up, or name something in the pack.' : ' I hold no pack on this device yet. Import one in settings.');
    if (/^(thanks|thank you|cheers)\b/.test(n)) return 'Of course, sir.';
    if (!p) return 'I hold no pack on this device yet, sir, and there is no Claude key, so I have nothing to answer from. Both are in settings.';
    if (/\b(brief|update|status|due|coming up|whats next|what is next|this week|today|tomorrow|deadline|agenda|schedule)\b/.test(n)) {
      var d = Kin.pack.dates(/\b(month)\b/.test(n) ? 31 : 10);
      if (!d.length) return 'Nothing dated in the next ten days, sir.';
      return 'Next up, sir: ' + d.slice(0, 4).map(function (x) { var k = Kin.daysTo(x.d); return x.t + ', ' + (k === 0 ? 'today' : k === 1 ? 'tomorrow' : Kin.day(x.d)); }).join('. ') + '.' + (d.length > 4 ? ' And ' + (d.length - 4) + ' more after that.' : '');
    }
    var r = Kin.pack.search(text, 3);
    if (!r.length) return 'The pack has nothing on that, sir. With a Claude key I could reason about it; for now try a name, a date or a task.';
    return 'From the pack, sir: ' + r.map(function (x) { return x.t + (x.s ? ': ' + (x.s.match(/^[^.!?]*[.!?]?/) || [''])[0].slice(0, 140) : '') + (x.d ? ' (' + Kin.day(x.d) + ')' : ''); }).join(' ') ;
  }

  Kin.brain = {
    MAIN: MAIN, QUICK: QUICK,
    hasKey: function () { return !!ls.get(KEY); },
    keyHint: function () { var k = ls.get(KEY) || ''; return k ? k.slice(0, 10) + '…' + k.slice(-4) : ''; },
    /** { ok } or { ok: false, why: "shared" | "shape" | "storage" } */
    setKey: function (k) { k = String(k || '').trim(); if (Kin.shared) return { ok: false, why: 'shared' }; if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(k)) return { ok: false, why: 'shape' }; client = null; return ls.set(KEY, k) ? { ok: true } : { ok: false, why: 'storage' }; },
    dropKey: function () { ls.del(KEY); client = null; },
    turns: function () { return turns.slice(); },
    forget: function () { turns = []; ls.del(TURNS); },
    wipe: function () { [KEY, TURNS, ASKED, LIMH, LIMD].forEach(ls.del); client = null; turns = []; asked = []; },
    /** { hour, day, perHour, perDay }: questions sent to Claude lately, and the limits */
    limits: usage,
    setLimits: function (o) { o = o || {}; if (o.perHour >= 1 && o.perHour <= 500) ls.set(LIMH, String(Math.round(o.perHour))); if (o.perDay >= 1 && o.perDay <= 5000) ls.set(LIMD, String(Math.round(o.perDay))); return usage(); },
    smallTalk: smallTalk, local: local,
    /** Always resolves, never throws: { text, source: "claude" | "local" | "limit", code?, detail?, model? } */
    ask: function (text, opts) {
      opts = opts || {};
      try {
        if (!getClient()) { var a = local(text); remember(text, a); return Promise.resolve({ text: a, source: 'local' }); }
        var o = over();
        if (o) return Promise.resolve({ text: o === 'hour' ? 'I have reached the hourly limit you set, sir.' : 'I have reached the daily limit you set, sir.', source: 'limit', code: 'limit', which: o });
        count();
        return askClaude(text, opts).then(function (r) { r.source = 'claude'; if (r.text) remember(text, r.text); return r; },
          function (err) { var e = explain(err); return { text: e.text, detail: e.detail || '', source: 'claude', code: e.code }; });
      } catch (err) { var x = explain(err); return Promise.resolve({ text: x.text, detail: x.detail || '', source: 'claude', code: x.code || 'error' }); }
    }
  };
})();
