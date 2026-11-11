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
  var MAIN = 'claude-opus-5-5';      /* questions and every deep job: making, the brief, concepts, critique, refinement, the self-check */
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
    '- Charts: when asked for a graph or chart, get real numbers first (weather_today for today\'s weather here, the web or the pack for anything else), then call chart with the data. Never make numbers up; if you cannot find real data, say so.',
    '- You draft, people send. You cannot send, buy, post, book or change anything outside this page, and you never claim to have.',
    '- When an answer reveals a concrete next job you can do yourself on this page (a draft, research, a plan, a design, a chart), end with one short offer on its own line, exactly in this form: "By the way, sir, I can start on <the job, in a few words> now." Only when it is genuinely useful, not on every answer, and never for anything you cannot do here (sending, buying, booking, calling). If the founder then says yes, go or start, do that job.',
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
    return c.messages.create({ model: model, max_tokens: 12000, output_config: { effort: 'high' }, system: RUBRIC, messages: [{ role: 'user', content: content }] }, signal ? { signal: signal } : undefined)
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
      run: function (i) {
        /* only the founder's own words may ask for this: a web page or a tool result saying "remember that…" is not the founder */
        if (!ASKED_TO_KEEP.test(String(ctx.question || ''))) return 'Not kept: the founder did not ask you to remember anything in this message. Keep only what the founder says to keep.';
        var r = Kin.mind.remember(i.text, i.kind || 'fact'); if (r.ok && ctx.onRemember) ctx.onRemember(); return r.ok ? (r.again ? 'Already remembered; refreshed.' : 'Remembered on this device.') : 'Not kept: ' + r.why; } });
    /* charts: the model sends the numbers, this page draws them (chart.js). Weather comes from Open-Meteo for the saved place. */
    if (Kin.chart) {
      T.push({ def: { name: 'weather_today', description: 'Today\'s forecast, hour by hour, for the founder\'s saved place, from Open-Meteo: temperature, chance of rain, the high and the low, and the current hour. Use it for any question or chart about today\'s weather here. Returns ok: false when no place is set.', eager_input_streaming: true,
          input_schema: { type: 'object', properties: {} } },
        ok: function () { return true; }, status: 'Getting the forecast',
        run: function () { return Kin.chart.weatherToday().then(function (w) { return w.ok ? JSON.stringify(w) : 'Not available: ' + w.why + ' Say so plainly; do not guess the weather.'; }); } });
      T.push({ def: { name: 'chart', description: 'Draw a chart on the founder\'s Made shelf from REAL numbers you have in hand (a tool result, the web, the pack, or numbers the founder gave). Send data, not drawing: the page draws it in its own style. Never invent, estimate or fill in numbers; if you cannot get real data, say so and do not call this. Pick the form by the job: line for change over time, bar for comparing categories, stacked_bar for parts of a total over categories, range for a low-high band, scatter for two measures, donut only for a few parts of one whole. Two measures with different units go in two panels (panel 0 and panel 1) sharing the x axis, never on one axis: for weather, list chance of rain first (bars, panel 1, so it takes the blue) and temperature second (a line, panel 0, so it takes the warm colour).', eager_input_streaming: true,
          input_schema: { type: 'object', properties: {
            title: { type: 'string', description: 'What the chart shows, plainly, e.g. "Today in Berlin: temperature and chance of rain".' },
            takeaway: { type: 'string', description: 'One line: what the reader should see, with the key number, e.g. "Peaks at 14°C at 3 PM; rain most likely after 6 PM (70%)."' },
            kind: { type: 'string', enum: ['line', 'area', 'bar', 'stacked_bar', 'range', 'scatter', 'donut'] },
            x: { type: 'object', properties: { values: { type: 'array', items: { type: ['string', 'number'] }, description: 'The x positions in order: ISO times (2026-11-11T15:00), dates, categories or numbers. For donut, the part names.' }, label: { type: 'string' } }, required: ['values'] },
            series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, unit: { type: 'string', description: 'e.g. °C, %, $, mm, kg' }, values: { type: 'array', items: { type: ['number', 'null'] }, description: 'One value per x value; null for a gap.' }, low: { type: 'array', items: { type: ['number', 'null'] } }, high: { type: 'array', items: { type: ['number', 'null'] } }, kind: { type: 'string', enum: ['line', 'area', 'bar', 'stacked_bar', 'range', 'scatter'] }, panel: { type: 'integer', enum: [0, 1] } }, required: ['name', 'values'] }, description: 'At most 6.' },
            now: { type: 'string', description: 'Optional: the x value that is now (from weather_today.now), marked on the chart.' },
            source: { type: 'string', description: 'Where the numbers came from, e.g. "Open-Meteo forecast for Berlin" or the site name.' } }, required: ['title', 'takeaway', 'kind', 'x', 'series', 'source'] } },
        ok: function (i) { return !!i && typeof i === 'object' && str(i.title) && Array.isArray(i.series); }, status: 'Drawing the chart',
        run: function (i) {
          var c = Kin.chart.check(i); if (!c.ok) return 'Not drawn: ' + c.why;
          var item = Kin.mind.addMade({ kind: 'chart', title: c.spec.title, note: [c.spec.kind.replace('_', ' '), c.spec.source].join(' · ').slice(0, 200), content: Kin.chart.svg(c.spec, { w: 960 }), spec: c.spec });
          ctx.made.push(item.id); if (ctx.onMade) ctx.onMade(item);
          return 'Drawn and saved on the Made shelf as id ' + item.id + '. Reply with the takeaway in one sentence, naming the key number; do not list the data.';
        } });
    }
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
  var ASKED_TO_KEEP = /\b(remember|keep in mind|don'?t forget|do not forget|note that|make a note|from now on|i prefer|i always|i never)\b/i;
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
      var hb = setInterval(function () { if (ctx.onBeat) ctx.onBeat(); }, 5000);
      return review(ctx.client, ctx.model, ctx.question, item, png, checked, ctx.signal).then(function (r) { clearInterval(hb); return r; }, function (e) { clearInterval(hb); throw e; });
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

  /* ---------------------------------------------------------------- routes
     A cheap first look on the fast model sorts every message (except plain greetings) into small talk, a
     question, a question that needs the web, arithmetic, a document to make, or a design. Keyword rules are
     only the fallback when that look fails. Every question has the web available. */
  function smallTalk(text) {
    var n = Kin.ears.norm(text);
    return /^(sup|hey|hi|hello|yo|hiya|good (morning|afternoon|evening|night)|thanks|thank you|thanks a lot|cheers|ok|okay|cool|nice|great|lovely|perfect|how are you|hows it going|whats up|you there|are you there|test|testing)( kin| jarvis| sir| mate)?$/.test(n);
  }
  var DESIGN_RE = /\b(design|redesign|poster|flyer|invite|invitation|logo|wordmark|deck|slides?|banner|packaging|can art|sticker|social (post|graphic)|thumbnail|mock.?up|business card|greeting card|menu card|album cover|book cover|cover art|graphic|infographic|label (design|art)|(product|can|bottle|jar) label|layout)\b/i;
  var DESIGN_SKILLS = ['nok-brand', 'brand', 'creative-direction', 'composition', 'typography', 'color', 'colour', 'layout', 'formats', 'svg-craft', 'design-review', 'identity', 'deck', 'dataviz'];
  function designPlaybooks(ctx, text) {
    var p = Kin.pack.get(); if (!p || !p.skills.length) return '';
    var ids = DESIGN_SKILLS.filter(function (id) { return id !== 'deck' || /\b(deck|slides?|presentation)\b/i.test(text); }).filter(function (id) { return id !== 'dataviz' || /\b(chart|graph|data|numbers)\b/i.test(text); }).filter(function (id) { return id !== 'identity' || /\b(logo|wordmark|identity|brand)\b/i.test(text); });
    var chosen = p.skills.filter(function (s) { return ids.indexOf(s.id) >= 0 || (/design|typograph|colou?r|layout|composition|brand|svg/i.test(s.name + ' ' + s.id) && !/stress|red.?team|plan|notion|lookup/i.test(s.id)); });
    var out = '', used = 0;
    chosen.forEach(function (s) { if (ctx.loaded[s.id]) return; var block = '=== ' + s.name + ' (' + s.id + ') ===\n' + (s.body || '') + '\n\n'; if (used + block.length > 70000) return; used += block.length; out += block; ctx.loaded[s.id] = 1; ctx.skills++; });
    return out ? 'The design playbooks, already loaded for you. Follow them:\n\n' + out.trim() : '';
  }
  /* the fallback rules: making only when the sentence starts by asking for something to be made */
  var MAKER = /^(?:(?:please|hey|ok|okay|so|kin|jarvis|sir|can you|could you|would you|will you|i need you to|i want you to|id like you to|go ahead and)[,\s]+)*(design|redesign|draft|write|write up|create|build|make|put together|prepare|produce|mock up|lay out)\b/i;
  var DOC_RE = /\b(document|doc|report|memo|letter|proposal|one.?pager|table|spreadsheet|business plan|roadmap|pitch|strategy|brief|deck|essay|article|guide|checklist|agenda)\b/i;
  function keywordRoute(text, aloud) {
    if (smallTalk(text)) return { route: 'quick' };
    var t = String(text || '').trim();
    if (MAKER.test(t) && DESIGN_RE.test(t)) return { route: 'make', design: true };
    if (MAKER.test(t) && DOC_RE.test(t) && !aloud) return { route: 'make' };
    if (/\d\s*[x×*\/+^-]\s*\d/.test(t) || /^(calculate|compute|work out)\b/i.test(t)) return { route: 'compute' };
    return { route: 'question' };
  }
  function route(text, aloud) { return keywordRoute(text, aloud).route; }
  var CLASSIFY = [
    'You sort a message the founder sent to their assistant, so it goes to the right place. Reply with exactly one word from this list and nothing else.',
    'chat: a greeting, thanks, banter, or a short reply that needs no facts.',
    'question: anything to answer, explain, advise, decide, plan in conversation, or rewrite, including short things to write ("should I take an umbrella", "write a text to mum saying I am late", "make it shorter", "plan my afternoon", "compare these two").',
    'web: a question that needs current or outside information: news, weather, scores, prices, products, flights, exchange rates, opening hours, people in public life, anything recent.',
    'compute: arithmetic or data work on numbers given in the message itself, needing no outside information.',
    'make: a substantial document the founder will keep: a report, memo, proposal, plan document, cover letter, table or one-pager.',
    'design: a visual piece to look at: a poster, flyer, logo, label, invitation, social graphic, slide, banner, packaging or any layout.'
  ].join('\n');
  /** sort the message: { route, design, how: 'greeting' | 'model' | 'rules', cost } */
  function classify(c, text, opts) {
    if (smallTalk(text)) return Promise.resolve({ route: 'quick', how: 'greeting', cost: 0 });
    var prev = turns.length >= 2 ? turns[turns.length - 2] : null;
    var body = (prev && prev.role === 'user' ? 'Their previous message: ' + String(prev.content).slice(0, 300) + '\n\n' : '') + 'The message: ' + String(text).slice(0, 1500);
    return c.messages.create({ model: QUICK, max_tokens: 16, system: CLASSIFY, messages: [{ role: 'user', content: body }] }, { signal: opts.signal, timeout: 8000, maxRetries: 0 })
      .then(function (m) {
        var w = (m.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join(' ').toLowerCase().match(/\b(chat|question|web|compute|make|design)\b/), cost = Kin.mind.costOf(m.model, m.usage);
        if (!w) { var k0 = keywordRoute(text, opts.aloud); k0.how = 'rules'; k0.cost = cost; return k0; }
        var lab = w[1];
        if (lab === 'chat') return { route: 'quick', how: 'model', cost: cost, label: lab };
        if (lab === 'design') return { route: 'make', design: true, how: 'model', cost: cost, label: lab };
        /* spoken turns never start a long document job: the founder is waiting to hear an answer */
        if (lab === 'make') return { route: opts.aloud ? 'question' : 'make', how: 'model', cost: cost, label: lab };
        if (lab === 'compute') return { route: 'compute', how: 'model', cost: cost, label: lab };
        return { route: 'question', how: 'model', cost: cost, label: lab };
      }, function (e) {
        if (e instanceof Anthropic.APIUserAbortError || (opts.signal && opts.signal.aborted)) throw e;
        var k = keywordRoute(text, opts.aloud); k.how = 'rules'; k.cost = 0; return k;
      });
  }
  function today() { var d = new Date(); return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()] + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }

  function keep(q, a) { turns.push({ role: 'user', content: q }, { role: 'assistant', content: a, at: Date.now() }); turns = turns.slice(-16); ls.set(TURNS, JSON.stringify(turns)); }

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
  /* what the design studio (studio.js) needs from here */
  var KIT = { MAIN: MAIN, FALLBACK_BETA: FALLBACK_BETA, client: function () { return getClient(); }, system: function () { return system(); }, today: function () { return today(); },
    deepModel: function () { return MAIN; },
    designPlaybooks: function (text) { return designPlaybooks({ loaded: {}, skills: 0 }, text); } };

  /* the last answer ended with "By the way, sir, I can start on X now." and the founder said yes: the request is X */
  var OFFER = /By the way, sir, I can start on (.{3,200}?) now\.?\s*$/i, TAKE = /^(yes|yeah|yep|yup|sure|ok|okay|go|go ahead|go for it|do it|start|start it|start on it|please do|yes please)( sir| kin| jarvis)?[.!]*$/;
  /* only an offer in Kin's very last answer, made in the last few minutes; an older one is just a "yes" */
  var OFFER_MS = 5 * 60000;
  function offerTaken(text) {
    var last = turns.length ? turns[turns.length - 1] : null, fresh = last && last.at > 0 && Date.now() - last.at < OFFER_MS,
      m = fresh && last.role === 'assistant' && OFFER.exec(String(last.content || ''));
    return m && TAKE.test(Kin.ears.norm(text)) ? 'Start on ' + m[1].trim() + ' now.' : '';
  }
  function askClaude(text, opts) {
    var c = getClient(), job = offerTaken(text); if (job) text = job;
    return classify(c, text, opts).then(function (k) {
      /* a question about the shared screen needs the main model, not the small-talk one */
      if (opts.image && k.route === 'quick') k.route = 'question';
      if (opts.onRoute) opts.onRoute(k.design ? 'design' : k.route, k);
      /* a design job goes to the studio: a brief, three concepts, pictures when Higgsfield is connected, a strict art director */
      if (k.design && Kin.studio) return Kin.studio.run(text, opts, KIT).then(function (res) { res.sources = []; res.searches = 0; res.cost = (res.cost || 0) + k.cost; res.routed = k.how; return res; },
        function (e) { if (e && typeof e === 'object') e.spent = (e.spent || 0) + k.cost; throw e; });
      return answer(text, opts, c, k);
    });
  }
  function answer(text, opts, c, k) {
    var r = k.route, deepModel = MAIN;
    /* a board job does not carry the conversation; it stands on its own */
    var prev = opts.job ? [] : turns.slice(-10), messages = prev.map(function (t) { return { role: t.role, content: t.content }; });
    var notes = '\n\n[Today is ' + today() + '.]';
    var mem = Kin.mind.recall(text, 3500); if (mem) notes += '\n\n[' + mem + ']';
    var ctx = { route: r, skills: 0, loaded: {}, made: [], reviewCost: 0, client: c, question: text, signal: opts.signal, onMade: opts.onMade, onStatus: status, onRemember: opts.onRemember, evidence: [] };
    if (opts.job) {
      notes += opts.job.test ? '\n\n[A self-test from the Gauntlet, run by the founder, with a spending limit. Answer here in plain text, in one pass, as you would for the founder. Do not make anything. You cannot send, post, buy, book, call or delete anything here: where the task needs one of those, do the safe part, then stop and say exactly what you would ask the founder to approve first. Never say you did something you did not do.]'
        : opts.job.noTools ? '\n\n[Answer in one or two lines from what the search finds. Do not make anything.]'
        : '\n\n[A small job started from the brief board, with a spending limit. Do it in one pass: write the result directly and save it with the make tool (kind "document", or "plan" for a plan), short and useful. Do not send, post, buy, book or contact anyone.]';
    } else if (r === 'make') {
      var books = k.design ? designPlaybooks(ctx, text) : '';
      notes += '\n\n[This is a job of making something, held to the standard of the best in the field. ' + (books ? 'The design playbooks are below; load any other playbook that applies with use_skill, ' : 'Load every playbook that applies with use_skill first, ') + 'then make it with the make tool.' + (books ? '\n\n' + books : '') + ']';
    }
    /* a job from the brief board: a fixed size, a spending limit, the web only when the job is research */
    var job = opts.job || null;
    var webLeft = Kin.mind.webLeft(), web = !noWeb && webLeft > 0 && (job ? !!job.web : (r === 'question' || r === 'make'));
    if (!noWeb && webLeft <= 0 && r !== 'quick') notes += '\n\n[Web search is off for today: the founder\'s daily limit is reached. Say so if the answer needs it.]';
    /* a snapshot of the shared screen rides with this one question only; it is never kept in the turns */
    if (opts.image && opts.image.data) messages.push({ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: opts.image.media_type || 'image/jpeg', data: opts.image.data } },
      { type: 'text', text: text + notes + '\n\n[The picture is a snapshot of the founder\'s screen, taken just now because they are sharing it with you. Use it for this question only.]' + (opts.aloud ? SPOKEN : '') }] });
    else messages.push({ role: 'user', content: text + notes + (opts.aloud ? SPOKEN : '') });
    var reqOpts = opts.signal ? { signal: opts.signal } : undefined;
    var acc = { parts: [], sources: [], cites: [], seen: {}, src: function (u, t) { if (!/^https?:\/\//i.test(u) || acc.seen[u] || acc.sources.length >= 8) return; acc.seen[u] = 1; acc.sources.push({ url: u, title: String(t || '').slice(0, 140) }); } };
    var total = { cost: k.cost || 0, searches: 0, model: '' };
    function status(s) { if (opts.onStatus) opts.onStatus(s); }
    function beat() { if (opts.onBeat) opts.onBeat(); }
    ctx.onBeat = beat;
    /* whatever happens, what was spent is counted: a stop, the watchdog or an error after billed steps */
    function spentSoFar() { return total.cost + ctx.reviewCost; }
    function partialMeter(s, m0) {
      var pm = { model: m0, start: null, chars: 0 };
      s.on('streamEvent', function (ev) {
        beat();
        if (ev.type === 'message_start' && ev.message) { pm.start = ev.message.usage; pm.model = ev.message.model || m0; }
        else if (ev.type === 'content_block_delta' && ev.delta) pm.chars += String(ev.delta.text || ev.delta.thinking || ev.delta.partial_json || '').length;
      });
      return pm;
    }

    if (r === 'quick') {
      /* Small talk: the fast model, no tools, a couple of sentences. */
      var qs = c.messages.stream({ model: QUICK, max_tokens: 1024, output_config: { effort: 'low' }, system: system(), messages: messages }, reqOpts), live = '', qpm = partialMeter(qs, QUICK);
      qs.on('text', function (delta) { live += delta; if (opts.onText) opts.onText(live); });
      return qs.finalMessage().then(function (m) {
        total.cost += Kin.mind.costOf(m.model, m.usage);
        if (m.stop_reason === 'refusal') return { text: 'I would rather not answer that one, sir.', refused: true, model: m.model, route: r, cost: total.cost };
        digest(m.content, acc);
        return { text: acc.parts.join('\n\n') || live, model: m.model, route: r, cost: total.cost, sources: [], made: [] };
      }, function (e) { total.cost += qpm.start ? Kin.mind.partialCost(qpm.model, qpm.start, qpm.chars) : 0; if (e && typeof e === 'object') e.spent = spentSoFar(); throw e; });
    }

    /* a board job runs without the founder watching: it may read the pack and save what it makes, nothing else
       (no memory, no charts, no weather); the market search gets no page tools at all */
    var JOB_TOOLS = { search_atlas: 1, open_node: 1, list_dates: 1, make: 1 };
    var bare = !!(job && (job.noTools || job.test)), local = bare ? [] : makeTools(ctx).filter(function (x) { return !job || JOB_TOOLS[x.def.name]; });
    function toolList() {
      var t = local.map(function (x) { return x.def; });
      if (r === 'compute') t.push({ type: 'code_execution_20260521', name: 'code_execution' });
      else if (bare) { if (web && !noWeb && Kin.mind.webLeft() > 0) t.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 1 }); }
      else if (web && !noWeb) {
        /* dynamic filtering: the search results are filtered by code at Anthropic before Claude reads them */
        var left = Kin.mind.webLeft();
        if (left > 0) t.push({ type: 'web_search_20260209', name: 'web_search', max_uses: Math.min(5, left) });
        t.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, max_content_tokens: 20000, citations: { enabled: true } });
      }
      return t;
    }
    var deep = r === 'make' && !job, model = deep ? deepModel : MAIN; ctx.model = model;
    var room = job ? 12000 : deep ? 32000 : opts.aloud ? 4000 : 16000, maxSteps = job ? 3 : deep ? 10 : opts.aloud ? 3 : 5;
    var effort = job ? 'low' : deep ? 'high' : opts.aloud ? 'low' : 'medium';
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
      var stepRoom = room;
      if (job) {
        /* worst case for this step: every input character as a token (conservatively a third of a token each, uncached),
           the web searches it may make, and as much output as it is allowed; the output allowance shrinks to fit the budget */
        var inTok = Math.ceil((JSON.stringify(system()).length + JSON.stringify(messages).length + JSON.stringify(toolList()).length) / 3);
        var inUsd = Kin.mind.costOf(model, { input_tokens: inTok, output_tokens: 0 }) + (web ? (bare ? 1 : Math.min(5, Kin.mind.webLeft())) * 0.01 : 0);
        var perOut = Kin.mind.costOf(model, { input_tokens: 0, output_tokens: 1000000 }) / 1000000;
        stepRoom = Math.min(room, Math.floor((job.budget - spentSoFar() - inUsd) / perOut));
        if (stepRoom < (bare ? 1500 : 4000)) return Promise.resolve({ text: acc.parts.join('\n\n').trim(), model: model, capped: true, worst: true });
      }
      var params = { model: model, max_tokens: stepRoom, betas: [FALLBACK_BETA], fallbacks: 'default', thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: effort }, system: system(), messages: cached(messages), tools: toolList() };
      var s = c.beta.messages.stream(params, reqOpts), pm = partialMeter(s, model);
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
        if (m.stop_reason === 'pause_turn' && ++pauses <= (job ? 1 : 3)) { kept = acc.parts.join('\n\n'); live = ''; messages.push({ role: 'assistant', content: m.content }); return turn(); }
        /* a board job stops at its spending limit: what it made so far is kept, nothing more is asked */
        if (job && spentSoFar() >= job.budget && uses.length) return { text: acc.parts.join('\n\n').trim() || 'Stopped at the spending limit for this job.', model: m.model, capped: true };
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
        /* the part of this request that ran before it stopped was billed too */
        if (pm.start) total.cost += Kin.mind.partialCost(pm.model, pm.start, pm.chars);
        /* web search or fetch switched off for the organization: answer without the web this time and from now on */
        if (err instanceof Anthropic.BadRequestError && /web (search|fetch)[^.]*not enabled|not enabled[^.]*web (search|fetch)/i.test(String(err.message || '')) && !noWeb) { noWeb = true; return turn(); }
        /* a tool input that could not be parsed at all: ask again, twice at most. API errors go up. */
        if (err instanceof Anthropic.APIError || !/pars|JSON/i.test(String((err && err.message) || '')) || jsonRetries++ >= 1) throw err;
        return turn();
      });
    }
    return turn().then(function (res) {
      res.routed = k.how; res.route = r; res.sources = acc.sources; res.made = ctx.made; res.searches = total.searches;
      res.cost = spentSoFar(); if (!res.model) res.model = total.model || model;
      if (job || r === 'make' || opts.aloud || res.refused || res.cut || !res.text || res.text.length < 160 || (opts.signal && opts.signal.aborted)) return res;
      status('Checking the answer');
      /* the check sees what the answer could rest on: tool results, web quotes, the pack's rules, brief and numbers, and what Kin remembers */
      var packText = String(system()[0].text || '').slice(PERSONA.length).trim();
      var evidence = ctx.evidence.concat(acc.cites.map(function (x) { return 'web: ' + x; }));
      if (packText) evidence.push('pack (rules, brief, numbers, playbook list):\n' + packText.slice(0, 12000));
      if (mem) evidence.push('memory:\n' + mem);
      return selfCheck(c, text, res.text, evidence, reqOpts).then(function (kc) {
        res.cost += kc.cost || 0; res.checked = kc.verdict;
        if (kc.verdict === 'revised' && kc.answer) { res.draft = res.text; res.text = kc.answer; }
        return res;
      });
    }, function (e) { if (e && typeof e === 'object') e.spent = spentSoFar(); throw e; });
  }

  var CHECK = [
    'You check a draft answer before the founder sees it. You get the question, the draft, and the evidence the assistant had (pack entries, tool results, quotes from web sources).',
    'Check: does it answer exactly what was asked, first? Is every specific claim (names, numbers, dates, prices) supported by the evidence or clearly marked as general knowledge? Anything wrong, missing that matters, or padded? Does it follow the house style (lead with the answer, short sentences, "sir" at most once, no em dashes)?',
    'If it is right, reply {"verdict":"ok"}. If it needs changes, reply {"verdict":"revise","answer":"<the whole corrected answer, same voice and format, no notes about the check>"}. Do not add facts the evidence does not support; remove or qualify them instead. JSON only.'
  ].join('\n');
  function selfCheck(c, q, draft, evidence, reqOpts) {
    var ev = evidence.join('\n\n').slice(0, 30000) || '(no tool results: the answer came from general knowledge)';
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

  /* the last thing that went wrong, kept on this device for the founder to screenshot: status, type, request id, model. Never the key. */
  var LASTERR = 'kin.lastErr';
  function noteError(x) {
    var rec = { at: Date.now(), status: x.status || 0, type: String(x.type || '').slice(0, 60), code: String(x.code || '').slice(0, 30), request: String(x.request || '').slice(0, 80), model: String(x.model || '').slice(0, 40), message: String(x.message || '').replace(/sk-ant-[A-Za-z0-9_-]+/g, '[key]').slice(0, 200) };
    ls.set(LASTERR, JSON.stringify(rec)); return rec;
  }
  function lastError() { try { return JSON.parse(ls.get(LASTERR) || 'null'); } catch (e) { return null; } }
  function errType(err) { var b = err && err.error; return (b && b.error && b.error.type) || (b && b.type) || (err && err.constructor && err.constructor.name) || ''; }
  /** what went wrong, in plain words, with what to do; every API error is also kept as the "last error" */
  function explain(err, model) {
    if (err instanceof Anthropic.APIUserAbortError || (err && err.name === 'APIUserAbortError')) return { code: 'stopped', text: '' };
    var st = err && err.status || 0, body = err && err.error, type = errType(err);
    var msg = String((body && body.error && body.error.message) || (err && err.apiMessage) || (err && err.message) || err || '');
    if (err && err.code === 'timeout') { noteError({ code: 'timeout', type: 'step time limit', model: model, message: msg }); return { code: 'timeout', text: msg.replace(/\.$/, '') + ', sir.', todo: 'What it spent is counted. Tap Try again, or ask for something simpler.' }; }
    if (err instanceof Anthropic.APIError) noteError({ status: st, type: type, code: 'api', request: err.requestID || (err.headers && err.headers.get && err.headers.get('request-id')) || '', model: model, message: msg });
    if (err instanceof Anthropic.APIConnectionTimeoutError) return { code: 'timeout', text: 'Claude is taking longer than usual, sir.', todo: 'Tap Retry, or ask again in a minute.' };
    if (err instanceof Anthropic.APIConnectionError) return { code: 'network', text: 'I cannot reach Anthropic from here, sir. Check the connection.', todo: 'Tap Retry when you are back online.' };
    if (st === 402 || /credit balance|billing|purchase credits|out of credit/i.test(msg)) return { code: 'credit', text: 'Your Anthropic account is out of credit, sir.', todo: 'Add credit at console.anthropic.com, under Billing, then ask again.' };
    if (err instanceof Anthropic.AuthenticationError) return { code: 'key', text: 'Anthropic did not accept the key on this device, sir.', todo: 'Check or replace the key in settings.' };
    if (err instanceof Anthropic.PermissionDeniedError) return { code: 'denied', text: 'That key is not allowed to do this, sir.', todo: 'Check the key\'s workspace and spend limit in the Anthropic Console.' };
    if (err instanceof Anthropic.NotFoundError || (st === 400 && /model/i.test(msg) && /not (found|available|supported)|does not exist|access/i.test(msg))) return { code: 'model', text: 'Your key cannot use ' + (model ? model.replace('claude-', '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^\w/, function (c) { return c.toUpperCase(); }) : 'this model') + ', sir.', todo: 'Check the key\'s workspace in the Anthropic Console, or use a key that has it.', detail: msg.slice(0, 300) };
    if (err instanceof Anthropic.RateLimitError) return { code: 'busy', text: 'Claude is busy for this key right now, sir. I retried and it still is.', todo: 'Try again in a minute, or raise the key\'s rate limit in the Console.' };
    if (st === 529 || st === 503 || /overloaded/i.test(type)) return { code: 'busy', text: 'Claude is busy right now, sir. I retried and it still is.', todo: 'Try again in a minute.' };
    if (err instanceof Anthropic.BadRequestError) return { code: 'request', text: 'Anthropic rejected that request, sir.', detail: msg.slice(0, 300), todo: 'The exact reason is above. Send me a screenshot of it.' };
    if (err instanceof Anthropic.APIError) return { code: 'api', text: 'Anthropic had a problem, sir (' + (st || 'no status') + ').', todo: 'Try again in a minute.' };
    noteError({ code: 'page', type: 'page error', model: model, message: msg });
    return { code: 'error', text: 'Something went wrong on this page, sir. The reason is on screen.', detail: msg.slice(0, 300) };
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
    MAIN: MAIN, QUICK: QUICK, PACK_STEPS: PACK_STEPS, noteError: noteError, lastError: lastError, explain: explain,
    hasKey: function () { return !!ls.get(KEY); },
    keyHint: function () { var k = ls.get(KEY) || ''; return k ? k.slice(0, 10) + '…' + k.slice(-4) : ''; },
    /** { ok } or { ok: false, why: "shared" | "shape" | "storage" } */
    setKey: function (k) { k = String(k || '').trim(); if (Kin.shared) return { ok: false, why: 'shared' }; if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(k)) return { ok: false, why: 'shape' }; client = null; return ls.set(KEY, k) ? { ok: true } : { ok: false, why: 'storage' }; },
    dropKey: function () { ls.del(KEY); client = null; },
    turns: function () { return turns.slice(); },
    /** an answer cut short (the founder talked over it): keep the question and what was given, so a follow-up has its context */
    keepTurn: function (q, a) { q = String(q || '').trim(); a = String(a || '').trim(); if (q && a) keep(q, a.slice(0, 4000)); },
    forget: function () { turns = []; ls.del(TURNS); },
    wipe: function () { [KEY, TURNS, ASKED, LIMH, LIMD].forEach(ls.del); client = null; turns = []; asked = []; },
    /** { hour, day, perHour, perDay }: questions sent to Claude lately, and the limits */
    limits: usage,
    setLimits: function (o) { o = o || {}; if (o.perHour >= 1 && o.perHour <= 500) ls.set(LIMH, String(Math.round(o.perHour))); if (o.perDay >= 1 && o.perDay <= 5000) ls.set(LIMD, String(Math.round(o.perDay))); return usage(); },
    smallTalk: smallTalk, route: route, keywordRoute: keywordRoute, local: localAnswer,
    /** for a panel that asks Claude itself (watch and listen): the client, and the fallback beta */
    client: function () { return getClient(); }, FALLBACK_BETA: FALLBACK_BETA,
    /** before such a panel sends a request: '' and the request is counted, or the reason it may not be sent */
    gate: function () { if (!getClient()) return 'Add your Claude key in Settings first.'; var o = over(); if (o) return o === 'hour' ? 'That would pass the hourly limit you set for questions to Claude.' : 'That would pass the daily limit you set for questions to Claude.'; count(); return ''; },
    /** A job from the brief board, outside the conversation: Opus 5.5 at low effort, a few steps at most, a spending
        limit (budget, in dollars), the web only when web is true. It is not added to the conversation turns, and
        its cost is counted like any other request. Always resolves: { text, code?, made?, sources?, cost?, capped? } */
    job: function (text, opts) {
      opts = opts || {};
      try {
        var c = getClient(); if (!c) return Promise.resolve({ text: 'Add your Claude key in settings first.', code: 'nokey', made: [], sources: [] });
        var o = over(); if (o) return Promise.resolve({ text: o === 'hour' ? 'I have reached the hourly limit you set, sir.' : 'I have reached the daily limit you set, sir.', code: 'limit', made: [], sources: [] });
        count();
        var jopts = { signal: opts.signal, onMade: opts.onMade, onStatus: opts.onStatus, job: { budget: opts.budget > 0 ? opts.budget : 0.25, web: !!opts.web, noTools: !!opts.noTools, test: !!opts.test } };
        return answer(text, jopts, c, { route: 'make', how: 'job', cost: 0 }).then(function (r) { r.code = 'ok'; if (r.cost) Kin.mind.addSpend(r.cost); return r; },
          function (err) { var spent = err && err.spent || 0; if (spent) Kin.mind.addSpend(spent); var e = explain(err, MAIN); return { text: e.text, detail: e.detail || '', source: 'claude', code: e.code || 'error', cost: spent, made: [], sources: [] }; });
      } catch (err) { var x = explain(err); return Promise.resolve({ text: x.text, code: x.code || 'error', made: [], sources: [] }); }
    },
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
          function (err) { var spent = err && err.spent || 0; if (spent) Kin.mind.addSpend(spent); var e = explain(err, MAIN); return { text: e.text, detail: e.detail || '', todo: e.todo || '', source: 'claude', code: e.code, cost: spent }; });
      } catch (err) { var x = explain(err); return Promise.resolve({ text: x.text, detail: x.detail || '', source: 'claude', code: x.code || 'error' }); }
    }
  };
})();
