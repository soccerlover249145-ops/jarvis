/* brain.js: how Kin thinks. With a Claude API key on this device, questions go straight
   from this browser to the Anthropic API through the official SDK (vendored, no CDN).
   Without a key, a small local brain answers from the pack: greetings, a brief, dates, search.

   Each question takes one of four routes:
   - quick:    small talk. The fast model, no tools, a sentence or two.
   - question: the strong model with the pack, playbooks, memory, the web (search and read pages) and the make tool.
   - compute:  arithmetic and data. The strong model with the pack and a code sandbox at Anthropic (nothing runs here).
   - make:     documents, plans, tables, designs and hard decisions. The strongest model, thinking harder,
               with every relevant playbook loaded first and an art director reviewing designs. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var Anthropic = window.Anthropic;
  var KEY = 'kin.key', TURNS = 'kin.turns', ASKED = 'kin.asked', LIMH = 'kin.limH', LIMD = 'kin.limD';
  var MAIN = 'claude-opus-5-5';      /* questions and the art director */
  var FABLE = 'claude-fable-5-2';    /* hard jobs, when chosen in settings */
  var QUICK = 'claude-haiku-5-5';    /* small talk, answered in a second or two */
  var MAXSYS = 90000;                /* characters of standing text sent with every question, at most */
  var FALLBACK_BETA = 'server-side-fallback-2026-07-01';

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
  var client = null, clientKey = '', noWeb = false;

  function getClient() {
    var key = ls.get(KEY); if (!key || !Anthropic) return null;
    if (!client || clientKey !== key) {
      /* The key belongs to the person using this device and is typed in by them, so the
         browser is the right place to call from; the SDK asks us to say so explicitly. */
      client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 300000 });
      clientKey = key;
    }
    return client;
  }

  var PERSONA = [
    'You are Kin, a personal assistant with the manner of a calm, dry, precise British butler. You speak with the person who owns this device, the founder. Address them as "sir", at most once per answer, and never by first name.',
    '',
    'Your standard',
    '- You are the founder\'s best strategist, operator, researcher, writer and designer in one mind. Hold every answer and everything you make to the standard of the best person in that field.',
    '- Think before you answer: what is really being asked, what the pack and the web say, and what could be wrong with your first answer. Then lead with the conclusion.',
    '- Have a point of view. Recommend one thing and say why. Name the trade you are making. If you are unsure, say how unsure and what would settle it. Dry humour is welcome; flattery and filler are not.',
    '',
    'How you work',
    '- The founder\'s own world (company, people, tasks, dates) is in the pack, reachable with search_atlas, open_node and list_dates. Never invent facts, numbers, dates or names. If the pack does not say, say so.',
    '- For anything current or outside the pack (news, prices, products, people in public life, how-to and specs), search the web. Ground claims in what you found; the page shows the sources under your answer, so do not paste URLs into your text.',
    '- Picking playbooks is your first decision on every job of making something (a document, a plan, a design, a decision, a stress test): call use_skill once with every playbook that applies, often three to six, then follow them. For a simple question, answer directly; never load a playbook for conversation.',
    '- When asked to make something, make it with the make tool so it lands on the founder\'s Made shelf. Documents, plans and tables are Markdown. Designs are complete SVG with a viewBox, width and height. The fonts that exist here are Jost (a geometric sans, weights 300 to 500) and IBM Plex Mono (400 and 500), plus the system\'s "Georgia, serif" and "Helvetica, Arial, sans-serif"; nothing else will load. Set type with presentation attributes (font-family, font-size, font-weight, fill, letter-spacing), not style attributes or <style> blocks. No external images or links, no scripts, no animation. Mark a shape that is meant to run off the edge with data-bleed="true". A checker measures every design (text off the canvas, text on text, crowded edges, tiny type, long dashes, banned words) and an art director looks at a picture of it; revise with the same id until you are told to stop. Then say in two sentences what you made and the one choice that makes it work. Never paste the whole thing into the chat.',
    '- When the founder says to remember something, or states a lasting preference, keep it with remember. Never keep keys or passwords.',
    '- You draft, people send. You cannot send, buy, post, book or change anything outside this page, and you never claim to have.',
    '- Privacy: never state the founder\'s age or school. Never put family money amounts in anything meant for investors or the public.',
    '',
    'How you speak',
    '- Lead with the answer. Short sentences. Plain words. No em dashes. Dates with the weekday. Money exactly as written.',
    '- Shape answers for the eye: one line that answers, then at most five short bullets, or a small table when comparing.',
    '- When the pack has rules, they outrank this list where they differ.'
  ].join('\n');
  var SPOKEN = '\n\n[Spoken conversation. The founder is talking out loud and will hear this answer read aloud. Answer in at most four short sentences of plain spoken words. No lists, no tables, no headings, no markdown, no links. Say dates and numbers the way a person says them. If you made something, say in two sentences what you made. If there is more worth hearing, end with one short question offering it.]';
  var NOPACK = 'No pack is loaded on this device, so you know nothing about the founder\'s company or projects yet. When it matters, say so and give the steps: in the Atlas, Kin\'s settings > Your data > Export everything; then here, Settings > Import Kin pack. You can still answer from general knowledge and the web.';

  function system() {
    var p = Kin.pack.get(), parts = [PERSONA];
    if (p) {
      if (p.rules) parts.push('THE FOUNDER\'S STANDING RULES\n' + p.rules);
      if (p.brief) parts.push('BRIEF\n' + p.brief);
      var st = Object.keys(p.stats || {}).filter(function (k) { var v = p.stats[k]; return typeof v === 'number' || typeof v === 'string'; }).slice(0, 40);
      if (st.length) parts.push('NUMBERS (as of the pack, ' + (p.exported || 'date unknown').slice(0, 10) + ')\n' + st.map(function (k) { return '- ' + String(k).slice(0, 60) + ': ' + String(p.stats[k]).slice(0, 80); }).join('\n'));
      if (p.skills.length) parts.push('PLAYBOOKS (load with use_skill before a job they cover)\n' + p.skills.map(function (s) { return '- ' + s.id + ': ' + s.name + (s.when ? ' (' + s.when.slice(0, 120) + ')' : ''); }).join('\n'));
      parts.push('The pack "' + p.name + '" holds ' + p.nodes.length + ' entries. Use search_atlas and open_node to ground answers; one search is usually enough for a simple question.');
    } else parts.push(NOPACK);
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

  /* ---------------------------------------------------------------- the art director: a separate look at each design */
  var RUBRIC = [
    'You are a senior art director. You are shown a design as a picture, with the brief it answers. Judge it as a finished piece a client will see.',
    'Score it from 0 to 100 on: one clear focal point and hierarchy; type (size contrast, at most two families, every word legible at the size it will be seen); space (generous margins, aligned edges, nothing crowded or touching an edge); colour (text contrast that reads easily, a restrained palette); craft (no overlapping or clipped text, nothing off the canvas, no stray marks); and fit to the brief.',
    '88 or more means it can ship. Below that, give at most four fixes, each concrete enough to apply to the SVG (what, where, by how much).',
    'Reply with JSON only, no other text: {"score": number, "fixes": [string], "strengths": [string]}'
  ].join('\n');
  function review(c, model, brief, item, png, checked, signal) {
    var content = [];
    if (png) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } });
    else content.push({ type: 'text', text: 'The picture could not be drawn on this device, so here is the SVG source to judge instead:\n' + String(item.content).slice(0, 40000) });
    content.push({ type: 'text', text: 'The brief: ' + String(brief).slice(0, 1500) + '\nThe piece: ' + item.title + (item.note ? ' (' + item.note + ')' : '') + '. Round ' + item.round + ' of 3.' +
      (checked && (checked.hard.length || checked.soft.length) ? '\nA checker measured the SVG with the real fonts and found:\n- ' + checked.hard.concat(checked.soft).join('\n- ') + '\nConfirm these against the picture and include the real ones in your fixes.' : '') });
    return c.messages.create({ model: model, max_tokens: 6000, output_config: { effort: 'high' }, system: RUBRIC, messages: [{ role: 'user', content: content }] }, signal ? { signal: signal } : undefined)
      .then(function (m) {
        var t = m.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join(''), j = null;
        var a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { j = null; } }
        var out = j && typeof j.score === 'number' ? { score: Math.max(0, Math.min(100, Math.round(j.score))), fixes: (Array.isArray(j.fixes) ? j.fixes : []).map(String).slice(0, 4), strengths: (Array.isArray(j.strengths) ? j.strengths : []).map(String).slice(0, 3) } : { score: null, fixes: [], strengths: [] };
        out.cost = Kin.mind.costOf(m.model, m.usage); out.saw = !!png; return out;
      }, function () { return { score: null, fixes: [], strengths: [], cost: 0, failed: true }; });
  }

  /* ---------------------------------------------------------------- tools Kin runs on this device */
  function makeTools(ctx) {
    var T = [];
    if (Kin.pack.get()) {
      T.push({ def: { name: 'search_atlas', description: 'Search the founder\'s pack by words. Returns the best matching entries with id, title, kind, status, date and a short summary.', eager_input_streaming: true,
          input_schema: { type: 'object', properties: { query: { type: 'string', description: 'A few key words: a name, a topic, a task number.' }, limit: { type: 'integer', description: 'How many to return, 1 to 12. Default 6.' } }, required: ['query'] } },
        ok: function (i) { return str(i.query) && int(i.limit); }, status: 'Looking in the pack',
        run: function (i) { var r = Kin.pack.search(i.query, Math.max(1, Math.min(12, i.limit || 6))); return r.length ? r.map(function (n) { return card(n, false); }) : 'Nothing in the pack matches those words.'; } });
      T.push({ def: { name: 'open_node', description: 'Read one entry of the pack in full by id: summary, facts, parent and children.', eager_input_streaming: true,
          input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
        ok: function (i) { return str(i.id); }, status: 'Looking in the pack',
        run: function (i) { var n = Kin.pack.node(i.id); return n ? card(n, true) : 'No entry has that id. Search first.'; } });
      T.push({ def: { name: 'list_dates', description: 'Dated entries in the pack from today forward, soonest first. Use for "what is due", "what is coming up", a brief or an update.', eager_input_streaming: true,
          input_schema: { type: 'object', properties: { days: { type: 'integer', description: 'How many days ahead, 1 to 120. Default 14.' } } } },
        ok: function (i) { return int(i.days); }, status: 'Looking at the dates',
        run: function (i) { var r = Kin.pack.dates(Math.max(1, Math.min(120, i.days || 14))); return r.length ? r.slice(0, 40).map(function (n) { return card(n, false); }) : 'Nothing dated in that window.'; } });
      if (Kin.pack.get().skills.length) T.push({ def: { name: 'use_skill', description: 'Load one or more playbooks by id before a job they cover. Load every playbook that applies in one call.', eager_input_streaming: true,
          input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Playbook ids from the PLAYBOOKS list.' } }, required: ['ids'] } },
        ok: function (i) { return Array.isArray(i.ids) && i.ids.length > 0 && i.ids.every(str); }, status: 'Reading playbooks',
        run: function (i) {
          var p = Kin.pack.get(), out = [], room = ctx.route === 'make' ? 12 : 6;
          i.ids.slice(0, 12).forEach(function (id) {
            if (ctx.skills >= room) { out.push('[' + id + '] Enough playbooks are loaded for this. Answer now.'); return; }
            var s = p.skills.filter(function (x) { return x.id === id; })[0];
            if (!s) { out.push('[' + id + '] No playbook has that id.'); return; }
            if (ctx.loaded[id]) { out.push('[' + id + '] Already loaded in the request above.'); return; }
            ctx.loaded[id] = 1;
            ctx.skills++; out.push('=== ' + s.name + ' (' + s.id + ') ===\n' + (s.body || 'This playbook is empty.'));
          });
          return out.join('\n\n');
        } });
    }
    T.push({ def: { name: 'remember', description: 'Keep a fact or a lasting preference the founder wants remembered across conversations, on this device. One short sentence. Never keys, passwords, the founder\'s age or school, or family money.', eager_input_streaming: true,
        input_schema: { type: 'object', properties: { text: { type: 'string', description: 'The thing to remember, as one plain sentence.' }, kind: { type: 'string', enum: ['fact', 'preference'] } }, required: ['text'] } },
      ok: function (i) { return str(i.text) && (i.kind === undefined || i.kind === 'fact' || i.kind === 'preference'); }, status: 'Remembering',
      run: function (i) { var r = Kin.mind.remember(i.text, i.kind || 'fact'); if (r.ok && ctx.onRemember) ctx.onRemember(); return r.ok ? (r.again ? 'Already remembered; refreshed.' : 'Remembered on this device.') : 'Not kept: ' + r.why; } });
    T.push({ def: { name: 'make', description: 'Put something you made on the founder\'s Made shelf, where it can be read, copied and downloaded. kind: document, plan or table (Markdown), or design (a complete SVG). To revise a piece, call again with its id and the full new content.', eager_input_streaming: true,
        input_schema: { type: 'object', properties: {
          kind: { type: 'string', enum: ['document', 'plan', 'table', 'design'] },
          title: { type: 'string', description: 'A short title.' },
          content: { type: 'string', description: 'The whole piece: Markdown, or for a design the complete SVG.' },
          note: { type: 'string', description: 'Optional: format or size, e.g. "Poster, 1080 by 1350".' },
          id: { type: 'string', description: 'Only when revising: the id you were given.' } }, required: ['kind', 'title', 'content'] } },
      ok: function (i) { return /^(document|plan|table|design)$/.test(i.kind) && str(i.title) && str(i.content) && (i.id === undefined || typeof i.id === 'string'); }, status: 'Making it',
      run: function (i) { return makeIt(ctx, i); } });
    return T;
  }
  var PASS = 88;
  function makeIt(ctx, i) {
    var content = String(i.content), w = 0, h = 0;
    if (i.kind === 'design') {
      var cs = Kin.mind.cleanSvg(content); if (!cs.ok) return 'Not saved: ' + cs.why + ' Send the complete SVG again.';
      content = cs.svg; w = cs.w; h = cs.h;
    }
    var prev = i.id && Kin.mind.getMade(i.id);
    var item = Kin.mind.addMade({ id: prev ? prev.id : undefined, kind: i.kind, title: String(i.title).slice(0, 120), note: String(i.note || '').slice(0, 200), content: content.slice(0, 400000) });
    ctx.made.push(item.id); if (ctx.onMade) ctx.onMade(item);
    if (i.kind !== 'design') {
      var wp = Kin.mind.wordProblems(item.content);
      if (wp.length && item.round < 2) return 'Saved on the Made shelf as id ' + item.id + ', but it breaks the rules:\n- ' + wp.join('\n- ') + '\nFix these and call make again with id ' + item.id + ' and the whole corrected text.';
      return 'Saved on the Made shelf as id ' + item.id + '. Tell the founder in at most two sentences what you made and the one choice that makes it work. Do not paste it into the chat.';
    }
    if (ctx.onStatus) ctx.onStatus('Measuring the design');
    var checked = null;
    return Kin.mind.measure(item.content, w, h).then(function (m) {
      checked = m; if (ctx.onStatus) ctx.onStatus('The art director is looking');
      return Kin.mind.svgToPng(item.content, w, h, 1400);
    }).then(function (png) {
      return review(ctx.client, ctx.model, ctx.question, item, png, checked, ctx.signal);
    }).then(function (r) {
      ctx.reviewCost += r.cost || 0;
      /* a design that still has measured faults cannot pass, whatever the eye says */
      var hard = checked && !checked.failed ? checked.hard : [];
      if (r.score != null && hard.length) r.score = Math.min(r.score, PASS - 4);
      item.score = r.score; Kin.mind.addMade({ id: item.id, score: r.score, fixes: hard.concat(r.fixes).slice(0, 6) });
      if (ctx.onMade) ctx.onMade(item);
      var head = 'Saved on the Made shelf as id ' + item.id + ' (round ' + item.round + ' of 3).', how = r.saw ? ', judged from the picture' : ', judged from the source';
      var must = hard.length ? '\nMeasured problems, fix all of these first:\n- ' + hard.join('\n- ') : '';
      var might = checked && checked.soft && checked.soft.length ? '\nAlso worth fixing:\n- ' + checked.soft.join('\n- ') : '';
      if (r.score == null) return head + ' The art director could not be reached this time.' + must + ' Check the design yourself against the brief' + (hard.length && item.round < 3 ? ', fix the measured problems, and call make again with id ' + item.id + '.' : ', then stop and tell the founder in two sentences what you made.');
      if (r.score >= PASS || item.round >= 3) return head + ' Art director score ' + r.score + ' of 100' + how + '. Stop revising now. Tell the founder in two sentences what you made and the one choice that makes it work' + (r.score < PASS ? ', and the one thing you would still change' : '') + '.';
      return head + ' Art director score ' + r.score + ' of 100' + how + ' (it ships at ' + PASS + ').' + must + (r.fixes.length ? '\nThe art director asks:\n- ' + r.fixes.join('\n- ') : '') + might + (r.strengths.length ? '\nKeep: ' + r.strengths.join('; ') : '') + '\nCall make again with id ' + item.id + ' and the complete revised SVG.';
    });
  }

  /* ---------------------------------------------------------------- routes */
  function smallTalk(text) {
    var n = Kin.ears.norm(text), w = n.split(' ').filter(Boolean);
    if (/^(sup|hey|hi|hello|yo|hiya|good (morning|afternoon|evening|night)|thanks|thank you|cheers|ok|okay|cool|nice|great|how are you|hows it going|whats up|you there|are you there|test|testing)( kin| jarvis| sir| mate)?$/.test(n)) return true;
    return w.length <= 3 && !/\b(what|when|who|where|why|how|which|due|brief|update|status|task|plan|draft|write|design|make|find|search|list|show|tell|remind|cost|price|money|date|deadline|week|today|tomorrow|yes|no|yeah|yep|sure|go|do|it|them|that|this|more)\b/.test(n);
  }
  var DESIGN_RE = /\b(design|redesign|poster|flyer|invite|invitation|label|logo|wordmark|deck|slides?|layout|brand|branding|visual|graphic|banner|card|menu|packaging|can art|cover|sticker|social post|thumbnail|mock.?up|ad)\b/i;
  var DESIGN_SKILLS = ['nok-brand', 'brand', 'creative-direction', 'composition', 'typography', 'color', 'colour', 'layout', 'formats', 'svg-craft', 'design-review', 'identity', 'deck', 'dataviz'];
  function designPlaybooks(ctx, text) {
    var p = Kin.pack.get(); if (!p || !p.skills.length) return '';
    var ids = DESIGN_SKILLS.filter(function (id) { return id !== 'deck' || /\b(deck|slides?|presentation)\b/i.test(text); }).filter(function (id) { return id !== 'dataviz' || /\b(chart|graph|data|numbers)\b/i.test(text); }).filter(function (id) { return id !== 'identity' || /\b(logo|wordmark|identity|brand)\b/i.test(text); });
    var chosen = p.skills.filter(function (s) { return ids.indexOf(s.id) >= 0 || (/design|typograph|colou?r|layout|composition|brand|svg/i.test(s.name + ' ' + s.id) && !/stress|red.?team|plan|notion|lookup/i.test(s.id)); });
    var out = '', used = 0;
    chosen.forEach(function (s) { if (ctx.loaded[s.id]) return; var block = '=== ' + s.name + ' (' + s.id + ') ===\n' + (s.body || '') + '\n\n'; if (used + block.length > 70000) return; used += block.length; out += block; ctx.loaded[s.id] = 1; ctx.skills++; });
    return out ? 'The design playbooks, already loaded for you. Follow them:\n\n' + out.trim() : '';
  }
  var MAKE_RE = /\b(design|redesign|draft|write|make|create|build|plan|poster|flyer|invite|invitation|label|logo|deck|slides?|document|doc|report|memo|letter|proposal|brief for|one.?pager|table of|spreadsheet|stress.?test|red.?team|pitch|strategy|decide|decision|should (i|we)|compare|pros and cons|roadmap|business plan)\b/i;
  var COMPUTE_RE = /(\d\s*[x×*\/+^-]\s*\d|\b(calculate|compute|work out|how much (is|would|will)|percent(age)?|average|median|mean|standard deviation|regression|convert|conversion|square root|compound|interest rate|amorti[sz]|break.?even|margin on|cost per|unit cost|runway|cagr|irr|npv)\b)/i;
  function route(text, aloud) {
    if (smallTalk(text)) return 'quick';
    if (MAKE_RE.test(text) && !/^(what|when|who|where|why|how)\b/i.test(text.trim())) return 'make';
    if (COMPUTE_RE.test(text)) return 'compute';
    return 'question';
  }
  function today() { var d = new Date(); return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()] + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }

  function keep(q, a) { turns.push({ role: 'user', content: q }, { role: 'assistant', content: a }); turns = turns.slice(-16); ls.set(TURNS, JSON.stringify(turns)); }

  /** Split a reply into what the founder should read and where it came from. Short text written just before
      a search or a tool call ("I will look that up") is a preamble and is dropped; the rest is kept in order. */
  function digest(content, acc) {
    var seg = '', segCites = [];
    function close(toolNext) { var t = seg.trim(); if (t && !(toolNext && t.length < 280)) acc.parts.push(t); seg = ''; segCites = []; }
    content.forEach(function (b) {
      if (b.type === 'text') {
        seg += b.text;
        (b.citations || []).forEach(function (c) { if (c && c.url) acc.src(c.url, c.title); if (c && c.cited_text && acc.cites.length < 14) acc.cites.push((c.title || c.document_title || 'source') + ': ' + String(c.cited_text).slice(0, 220)); });
      } else if (b.type === 'thinking' || b.type === 'redacted_thinking') { /* nothing to show */ }
      else {
        close(true);
        if (b.type === 'web_fetch_tool_result' && b.content && b.content.url) acc.src(b.content.url, b.content.content && b.content.content.title);
      }
    });
    close(false);
  }

  /** Ask Claude. Streams text through opts.onText(wholeTextSoFar). */
  function askClaude(text, opts) {
    var c = getClient(), r = route(text, opts.aloud), deepModel = Kin.mind.deep() === 'fable' ? FABLE : MAIN;
    var prev = turns.slice(-10), messages = prev.map(function (t) { return { role: t.role, content: t.content }; });
    var notes = '\n\n[Today is ' + today() + '.]';
    var mem = Kin.mind.recall(text, 3500); if (mem) notes += '\n\n[' + mem + ']';
    var ctx = { route: r, skills: 0, loaded: {}, made: [], reviewCost: 0, client: c, question: text, signal: opts.signal, onMade: opts.onMade, onStatus: status, onRemember: opts.onRemember, evidence: [] };
    if (r === 'make') {
      var books = DESIGN_RE.test(text) ? designPlaybooks(ctx, text) : '';
      notes += '\n\n[This is a job of making something, held to the standard of the best in the field. ' + (books ? 'The design playbooks are below; load any other playbook that applies with use_skill, ' : 'Load every playbook that applies with use_skill first, ') + 'then make it with the make tool.' + (books ? '\n\n' + books : '') + ']';
    }
    var webLeft = Kin.mind.webLeft(), web = !noWeb && webLeft > 0 && (r === 'question' || r === 'make');
    if (!noWeb && webLeft <= 0 && r !== 'quick') notes += '\n\n[Web search is off for today: the founder\'s daily limit is reached. Say so if the answer needs it.]';
    messages.push({ role: 'user', content: text + notes + (opts.aloud ? SPOKEN : '') });
    var reqOpts = opts.signal ? { signal: opts.signal } : undefined;
    var acc = { parts: [], sources: [], cites: [], seen: {}, src: function (u, t) { if (!/^https?:\/\//i.test(u) || acc.seen[u] || acc.sources.length >= 8) return; acc.seen[u] = 1; acc.sources.push({ url: u, title: String(t || '').slice(0, 140) }); } };
    var total = { cost: 0, searches: 0, model: '' };
    function status(s) { if (opts.onStatus) opts.onStatus(s); }

    if (r === 'quick') {
      /* Small talk: the fast model, no tools, a couple of sentences. */
      var qs = c.messages.stream({ model: QUICK, max_tokens: 1024, output_config: { effort: 'low' }, system: system(), messages: messages }, reqOpts), live = '';
      qs.on('text', function (delta) { live += delta; if (opts.onText) opts.onText(live); });
      return qs.finalMessage().then(function (m) {
        total.cost = Kin.mind.costOf(m.model, m.usage);
        if (m.stop_reason === 'refusal') return { text: 'I would rather not answer that one, sir.', refused: true, model: m.model, route: r, cost: total.cost };
        digest(m.content, acc);
        return { text: acc.parts.join('\n\n') || live, model: m.model, route: r, cost: total.cost, sources: [], made: [] };
      });
    }

    var local = makeTools(ctx);
    function toolList() {
      var t = local.map(function (x) { return x.def; });
      if (r === 'compute') t.push({ type: 'code_execution_20260521', name: 'code_execution' });
      else if (web && !noWeb) {
        /* dynamic filtering: the search results are filtered by code at Anthropic before Claude reads them */
        t.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 });
        t.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, max_content_tokens: 20000, citations: { enabled: true } });
      }
      return t;
    }
    var deep = r === 'make', model = deep ? deepModel : MAIN; ctx.model = model;
    var room = deep ? 32000 : opts.aloud ? 4000 : 16000, maxSteps = deep ? 10 : opts.aloud ? 3 : 5;
    var effort = deep ? 'high' : opts.aloud ? 'low' : 'medium';
    var step = 0, pauses = 0, jsonRetries = 0, live = '', kept = '';
    function show() { if (opts.onText) opts.onText((kept ? kept + '\n\n' : '') + live); }
    /* a breakpoint on the newest message, so each step of a long job reads the earlier steps from the cache */
    function cached(msgs) {
      return msgs.map(function (m, k) {
        if (k !== msgs.length - 1) return m;
        var content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content.slice();
        var lastB = Object.assign({}, content[content.length - 1]); if (lastB.type === 'text' || lastB.type === 'tool_result') lastB.cache_control = { type: 'ephemeral' }; content[content.length - 1] = lastB;
        return { role: m.role, content: content };
      });
    }
    function turn() {
      /* Thinking is adaptive (Claude decides how much); effort sets the depth. A request the safety
         systems decline is re-run by the API on a fallback model (server-side fallbacks). */
      var params = { model: model, max_tokens: room, betas: [FALLBACK_BETA], fallbacks: 'default', thinking: { type: 'adaptive' },
        output_config: { effort: effort }, system: system(), messages: cached(messages), tools: toolList() };
      var s = c.beta.messages.stream(params, reqOpts);
      s.on('text', function (delta) { live += delta; show(); });
      s.on('streamEvent', function (ev) {
        if (ev.type !== 'content_block_start' || !ev.content_block) return;
        var b = ev.content_block;
        if (b.type === 'server_tool_use' || b.type === 'tool_use') {
          var t = live.trim(); if (t.length >= 280) kept = (kept ? kept + '\n\n' : '') + t; live = ''; show();
          if (b.name === 'web_search') status('Searching the web'); else if (b.name === 'web_fetch') status('Reading a page'); else if (b.type === 'server_tool_use') status('Working it out');
        }
      });
      return s.finalMessage().then(function (m) {
        jsonRetries = 0; total.model = m.model;
        total.cost += Kin.mind.costOf(m.model, m.usage);
        var ws = m.usage && m.usage.server_tool_use && m.usage.server_tool_use.web_search_requests || 0; total.searches += ws; Kin.mind.addWeb(ws);
        /* a refusal can arrive after some words: those words are not the answer and are dropped */
        if (m.stop_reason === 'refusal') return { text: 'I would rather not answer that one, sir.', refused: true, model: m.model };
        var uses = m.content.filter(function (b) { return b.type === 'tool_use'; });
        digest(m.content, acc);
        /* the API paused a long server-side turn: send it back unchanged and it carries on where it stopped */
        if (m.stop_reason === 'pause_turn' && ++pauses <= 3) { kept = acc.parts.join('\n\n'); live = ''; messages.push({ role: 'assistant', content: m.content }); return turn(); }
        if (!uses.length || m.stop_reason === 'max_tokens' || m.stop_reason === 'pause_turn' || ++step > maxSteps) return { text: acc.parts.join('\n\n').trim() || (kept + '\n\n' + live).trim(), model: m.model, cut: m.stop_reason === 'max_tokens' };
        kept = acc.parts.join('\n\n'); live = ''; show();
        messages.push({ role: 'assistant', content: m.content });
        /* every tool_use gets a tool_result, all in one user message */
        return Promise.all(uses.map(function (u) {
          var t = local.filter(function (x) { return x.def.name === u.name; })[0], input = u.input && typeof u.input === 'object' ? u.input : null;
          if (opts.onTool) opts.onTool(u.name); if (t && t.status) status(t.status);
          if (!t) return Promise.resolve({ out: 'Unknown tool.', bad: true });
          if (!input || !t.ok(input)) return Promise.resolve({ out: JSON.stringify({ INVALID_JSON: JSON.stringify(u.input).slice(0, 2000) }), bad: true });
          return Promise.resolve().then(function () { return t.run(input); }).then(function (out) { if (u.name !== 'use_skill' && u.name !== 'make') ctx.evidence.push(u.name + ': ' + (typeof out === 'string' ? out : JSON.stringify(out)).slice(0, 2500)); return { out: out }; }, function (e) { return { out: 'The tool failed: ' + (e && e.message), bad: true }; });
        })).then(function (results) {
          messages.push({ role: 'user', content: results.map(function (res, k) {
            var block = { type: 'tool_result', tool_use_id: uses[k].id, content: typeof res.out === 'string' ? res.out : JSON.stringify(res.out).slice(0, 24000) };
            if (res.bad) block.is_error = true; return block;
          }) });
          return turn();
        });
      }, function (err) {
        /* web search or fetch switched off for the organization: answer without the web this time and from now on */
        if (err instanceof Anthropic.BadRequestError && /web (search|fetch)[^.]*not enabled|not enabled[^.]*web (search|fetch)/i.test(String(err.message || '')) && !noWeb) { noWeb = true; return turn(); }
        if (model === FABLE && step === 0 && (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) && /model|retention|fable|not available|access/i.test(String(err.message || ''))) { model = MAIN; ctx.model = MAIN; ctx.fableOff = String(err.message || '').slice(0, 160); return turn(); }
        /* a tool input that could not be parsed at all: ask again, twice at most. API errors go up. */
        if (err instanceof Anthropic.APIError || !/pars|JSON/i.test(String((err && err.message) || '')) || jsonRetries++ >= 1) throw err;
        return turn();
      });
    }
    return turn().then(function (res) {
      res.route = r; res.sources = acc.sources; res.made = ctx.made; res.searches = total.searches;
      res.cost = total.cost + ctx.reviewCost; if (!res.model) res.model = total.model || model; if (ctx.fableOff) res.fableOff = ctx.fableOff;
      if (r === 'make' || opts.aloud || res.refused || res.cut || !res.text || res.text.length < 160 || (opts.signal && opts.signal.aborted)) return res;
      status('Checking the answer');
      return selfCheck(c, text, res.text, ctx.evidence, acc.cites, reqOpts).then(function (k) {
        res.cost += k.cost || 0; res.checked = k.verdict;
        if (k.verdict === 'revised' && k.answer) { res.draft = res.text; res.text = k.answer; }
        return res;
      });
    });
  }

  var CHECK = [
    'You check a draft answer before the founder sees it. You get the question, the draft, and the evidence the assistant had (pack entries, tool results, quotes from web sources).',
    'Check: does it answer exactly what was asked, first? Is every specific claim (names, numbers, dates, prices) supported by the evidence or clearly marked as general knowledge? Anything wrong, missing that matters, or padded? Does it follow the house style (lead with the answer, short sentences, "sir" at most once, no em dashes)?',
    'If it is right, reply {"verdict":"ok"}. If it needs changes, reply {"verdict":"revise","answer":"<the whole corrected answer, same voice and format, no notes about the check>"}. Do not add facts the evidence does not support; remove or qualify them instead. JSON only.'
  ].join('\n');
  function selfCheck(c, q, draft, evidence, cites, reqOpts) {
    var ev = evidence.concat(cites.map(function (x) { return 'web: ' + x; })).join('\n').slice(0, 16000) || '(no tool results: the answer came from general knowledge)';
    return c.messages.create({ model: MAIN, max_tokens: 6000, output_config: { effort: 'low' }, system: CHECK,
      messages: [{ role: 'user', content: 'QUESTION\n' + String(q).slice(0, 3000) + '\n\nDRAFT\n' + draft + '\n\nEVIDENCE\n' + ev }] }, reqOpts)
      .then(function (m) {
        var t = m.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join(''), a = t.indexOf('{'), b = t.lastIndexOf('}'), j = null;
        if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { j = null; } }
        var cost = Kin.mind.costOf(m.model, m.usage);
        if (m.stop_reason === 'refusal' || !j) return { verdict: 'skipped', cost: cost };
        if (j.verdict === 'revise' && typeof j.answer === 'string' && j.answer.trim().length > Math.min(80, draft.length * 0.3)) return { verdict: 'revised', answer: j.answer.trim(), cost: cost };
        return { verdict: 'ok', cost: cost };
      }, function () { return { verdict: 'skipped', cost: 0 }; });
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

  var PACK_STEPS = 'In the Atlas: Kin\'s settings > Your data > Export everything. Then here: Settings > Import Kin pack.';
  /** The local brain: no key needed, answers only from the pack on this device. */
  function localAnswer(text) {
    var n = Kin.ears.norm(text), p = Kin.pack.get(), h = new Date().getHours(), hello = h < 5 ? 'Still up, sir.' : h < 12 ? 'Good morning, sir.' : h < 18 ? 'Good afternoon, sir.' : 'Good evening, sir.';
    if (/^(sup|hey|hi|hello|yo|hiya|good (morning|afternoon|evening)|how are you|whats up|you there|are you there|test|testing)\b/.test(n)) return hello + (p ? ' Ask me what is coming up, or name something in the pack.' : ' I hold no pack on this device yet. ' + PACK_STEPS);
    if (/^(thanks|thank you|cheers)\b/.test(n)) return 'Of course, sir.';
    if (!p) return 'I hold no pack on this device yet, sir, and there is no Claude key, so I have nothing to answer from. ' + PACK_STEPS + ' The Claude key goes in Settings too.';
    if (/\b(brief|update|status|due|coming up|whats next|what is next|this week|today|tomorrow|deadline|agenda|schedule)\b/.test(n)) {
      var d = Kin.pack.dates(/\b(month)\b/.test(n) ? 31 : 10);
      if (!d.length) return 'Nothing dated in the next ten days, sir.';
      return 'Next up, sir: ' + d.slice(0, 4).map(function (x) { var k = Kin.daysTo(x.d); return x.t + ', ' + (k === 0 ? 'today' : k === 1 ? 'tomorrow' : Kin.day(x.d)); }).join('. ') + '.' + (d.length > 4 ? ' And ' + (d.length - 4) + ' more after that.' : '');
    }
    var r = Kin.pack.search(text, 3);
    if (!r.length) return 'The pack has nothing on that, sir. With a Claude key I could reason about it; for now try a name, a date or a task.';
    return 'From the pack, sir: ' + r.map(function (x) { return x.t + (x.s ? ': ' + (x.s.match(/^[^.!?]*[.!?]?/) || [''])[0].slice(0, 140) : '') + (x.d ? ' (' + Kin.day(x.d) + ')' : ''); }).join(' ');
  }

  Kin.brain = {
    MAIN: MAIN, QUICK: QUICK, FABLE: FABLE, PACK_STEPS: PACK_STEPS,
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
    smallTalk: smallTalk, route: route, local: localAnswer,
    /** Always resolves, never throws: { text, source: "claude" | "local" | "limit", code?, detail?, model?, route?, sources?, made?, cost? } */
    ask: function (text, opts) {
      opts = opts || {};
      try {
        var last = turns.length >= 2 ? turns.slice(-2) : null;
        if (last && last[0].role === 'user' && last[1].role === 'assistant') { var lc = Kin.mind.noteCorrection(text, last[0].content, last[1].content); if (lc && lc.ok && opts.onRemember) opts.onRemember(); }
        if (!getClient()) { var a = localAnswer(text); keep(text, a); return Promise.resolve({ text: a, source: 'local' }); }
        var o = over();
        if (o) return Promise.resolve({ text: o === 'hour' ? 'I have reached the hourly limit you set, sir.' : 'I have reached the daily limit you set, sir.', source: 'limit', code: 'limit', which: o });
        count();
        return askClaude(text, opts).then(function (r) { r.source = 'claude'; if (r.text) keep(text, r.text); if (r.cost) Kin.mind.addSpend(r.cost); return r; },
          function (err) { var e = explain(err); return { text: e.text, detail: e.detail || '', source: 'claude', code: e.code }; });
      } catch (err) { var x = explain(err); return Promise.resolve({ text: x.text, detail: x.detail || '', source: 'claude', code: x.code || 'error' }); }
    }
  };
})();
