/* studio.js: how Kin designs. Every design job runs the same way, held to a professional bar:

   1. A creative brief: audience, message, one idea, references in words, the brand's constraints.
   2. Three concepts in parallel, each a different idea (not three colours of one idea).
   3. Pictures, when the founder's Higgsfield account is connected: Kin prices them first (a price
      check only), the founder approves once, then they are made and placed in the design.
   4. A strict art director judges all three from rendered pictures and picks the strongest.
      "Clean but generic" fails: no single idea, no image where one is plainly needed, default-looking
      type, empty space without purpose. A plain type-only piece is capped at 70 unless the brief asks
      for typographic minimalism. Measured faults (text on text, off the canvas) cap a piece below the bar.
   5. The winner is refined, up to three rounds in all, until it scores 90 or more.
   6. The Made shelf shows the winner, the brief, the art director's notes, and the two other concepts.

   Spending: before a job that is likely to cost more than $2 in Claude usage, Kin says so and asks once.
   Higgsfield credits are priced and approved separately, with a daily cap the founder sets. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var PASS = 90, TYPE_CAP = 70, FAULT_CAP = PASS - 4, ASK_OVER = 2;
  var MCP_BETA = 'mcp-client-2026-09-15';
  var ASPECTS = ['1:1', '3:4', '4:3', '4:5', '9:16', '16:9', '2:3', '3:2'];
  function noop() {}

  /* ---------------------------------------------------------------- what the job will cost, roughly, before it starts */
  function estimate(kit, deep, pictures) {
    var cost = Kin.mind.costOf;
    var usd = cost(deep, { input_tokens: 34000, output_tokens: 30000 }) +      /* brief and three concepts */
      cost(deep, { input_tokens: 7000, output_tokens: 3000 }) +                  /* the art director, three pictures */
      2 * cost(kit.MAIN, { input_tokens: 16000, output_tokens: 14000 }) +       /* up to two refinement rounds, on Opus */
      2 * cost(deep, { input_tokens: 4000, output_tokens: 2000 });              /* their reviews */
    if (pictures) usd += 2 * cost(kit.MAIN, { input_tokens: 9000, output_tokens: 2500 }); /* price check and making the pictures */
    return Math.round(usd * 100) / 100;
  }

  /* ---------------------------------------------------------------- the concepts request */
  var CONCEPTS_TOOL = { name: 'submit_concepts', description: 'Hand over the creative brief and exactly three design concepts. Call it once, with everything.', eager_input_streaming: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['title', 'brief', 'concepts'], properties: {
      title: { type: 'string', description: 'A short title for the piece, e.g. "Dec 3 tasting night invite".' },
      brief: { type: 'object', additionalProperties: false, required: ['audience', 'message', 'idea', 'references', 'constraints', 'format', 'minimal'], properties: {
        audience: { type: 'string' }, message: { type: 'string', description: 'The one thing a viewer must take away.' },
        idea: { type: 'string', description: 'The territory the three concepts explore.' },
        references: { type: 'string', description: 'References in words: movements, designers, objects, moods. No links.' },
        constraints: { type: 'string', description: 'From the founder\'s brand rules and the request: words, colours, size, must-haves.' },
        format: { type: 'string', description: 'Size and use, e.g. "Instagram post, 1080 by 1350".' },
        minimal: { type: 'boolean', description: 'True only if the brief itself asks for typographic minimalism.' } } },
      concepts: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['name', 'idea', 'svg', 'images'], properties: {
        name: { type: 'string', description: 'Two or three words.' }, idea: { type: 'string', description: 'The single idea in one sentence.' },
        svg: { type: 'string', description: 'The complete SVG with viewBox, width and height.' },
        images: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['id', 'prompt', 'aspect'], properties: {
          id: { type: 'string', description: 'img1, img2 and so on, unique across all three concepts.' },
          prompt: { type: 'string', description: 'A full image prompt: subject, composition, light, lens or medium, palette, mood. No text in the picture.' },
          aspect: { type: 'string', enum: ASPECTS } } } } } } } } } };
  var REVISE_TOOL = { name: 'revise_design', description: 'Hand over the complete revised SVG.', eager_input_streaming: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['svg', 'changed'], properties: { svg: { type: 'string' }, changed: { type: 'string', description: 'One sentence: what you changed.' } } } };

  function conceptRules(pictures) {
    return [
      'You are leading a design job at the level of the best studio in the world. Work in this order.',
      '1. Write the creative brief: audience, the one message, the territory, references in words, the constraints from the founder\'s rules and the request, the format.',
      '2. Make THREE concepts. Each one is a different idea, not a variation in colour or layout of the same idea. One may be bold, one restrained, one unexpected. Every concept needs a single strong idea a viewer gets in two seconds.',
      '3. Each concept is a complete, finished SVG at the real size, with a viewBox, width and height. Fonts that exist here: Jost (a geometric sans, weights 300 to 500) and IBM Plex Mono (400 and 500). Nothing else loads.',
      pictures
        ? '4. The founder\'s Higgsfield account is connected, so concepts may use real pictures. Where a picture is clearly the strongest idea (a product, a scene, a texture, a person), give it an id (img1, img2 …), a full image prompt with no text in the picture, and an aspect ratio, and place it in the SVG as <image href="hf:img1" x=".." y=".." width=".." height=".." preserveAspectRatio="xMidYMid slice"/>. At most two pictures per concept and four in all. Pictures cost the founder credits, so use them where they earn it.'
        : '4. No picture service is connected, so draw. Where a piece needs an image, illustrate it in the SVG itself: shapes, paths, gradients, patterns, a drawn object or scene. A piece that is only type on a flat colour fails review unless the brief asks for typographic minimalism. Leave "images" empty.',
      '5. Craft: clear hierarchy, generous margins (at least 6% of the short side), nothing touching an edge, no text on text, no text crossing an image unless it reads clearly, at most two type families, every word legible at the size it will be seen.',
      'Then call submit_concepts once with the title, the brief and the three concepts. Do not write anything else.'
    ].join('\n');
  }

  /* ---------------------------------------------------------------- the art director */
  var STRICT = [
    'You are a demanding senior art director at a top studio. You are shown design concepts as pictures, with the creative brief they answer. Judge each as a finished piece a client and the public will see.',
    'Score each from 0 to 100. Be strict: 70 is competent, 80 is good, 90 is excellent and could appear in a design annual.',
    'It FAILS (under 70) when it is "clean but generic": no single idea; no image or illustration where one is plainly needed; default-looking type set without a point of view; empty space that does nothing; it could be for any brand.',
    'Reward: one idea a viewer gets in two seconds; a striking focal image or drawn element; type with character and real size contrast; space used on purpose; colour with intent; finish (no overlaps, nothing clipped, nothing off the canvas).',
    'For each concept give: the score, at most three notes on what works or fails, and at most four fixes concrete enough to apply to the SVG (what, where, by how much). Then pick the winner by its potential after fixes, and say why in one sentence.',
    'Reply with JSON only: {"concepts":[{"score":number,"notes":[string],"fixes":[string]}],"winner":number (0-based),"why":string}'
  ].join('\n');

  /* ---------------------------------------------------------------- helpers */
  function textOf(m) { return (m.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join(''); }
  function jsonIn(t) { var a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; } }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /** put the pictures into an SVG: href="hf:img1" becomes the picture's data; an unknown id is left for the cleaner to drop */
  function compose(svg, pics) {
    var out = String(svg || '');
    Object.keys(pics).forEach(function (id) { out = out.replace(new RegExp('((?:xlink:)?href)\\s*=\\s*(["\'])hf:' + esc(id) + '\\2', 'g'), function (m, attr, q) { return attr + '=' + q + pics[id].data + q; }); });
    return out;
  }
  /** Is this a type-only piece: no picture and next to no drawn shape? */
  function typeOnly(svg) {
    var images = (svg.match(/<image\b[^>]*href\s*=\s*["']data:image/gi) || []).length; if (images) return false;
    var shapes = svg.match(/<(path|polygon|polyline|circle|ellipse|line)\b[^>]*>/gi) || [], ink = 0;
    shapes.forEach(function (s) { var d = /\bd\s*=\s*"([^"]*)"/.exec(s); ink += d ? d[1].length : 40; });
    var rects = (svg.match(/<rect\b/gi) || []).length;
    return shapes.length + Math.max(0, rects - 1) < 5 || ink < 500;
  }
  function deepSearch(o, key, val) { if (!o || typeof o !== 'object') return false; if (o[key] === val) return true; return Object.keys(o).some(function (k) { return deepSearch(o[k], key, val); }); }
  function walk(o, fn) { if (!o || typeof o !== 'object') return; fn(o); Object.keys(o).forEach(function (k) { walk(o[k], fn); }); }
  function resultText(b) { var c = b && b.content; if (typeof c === 'string') return c; if (!Array.isArray(c)) return ''; return c.map(function (x) { return x && x.type === 'text' ? x.text : ''; }).join('\n'); }
  var IMAGE_MODEL = 'gpt_image_2_6';   /* Higgsfield's default general image model */
  /** the picture URL in one job record, whatever the field is called; one of Higgsfield's hosts first */
  function urlIn(o) {
    var found = [];
    ['result_url', 'url', 'image_url', 'raw_url', 'min_url'].forEach(function (k) { if (typeof o[k] === 'string') found.push(o[k]); });
    ['results', 'urls', 'outputs', 'images', 'result'].forEach(function (k) { var v = o[k]; (Array.isArray(v) ? v : v ? [v] : []).forEach(function (x) { if (typeof x === 'string') found.push(x); else if (x && typeof x === 'object') ['url', 'result_url', 'raw_url'].forEach(function (k2) { if (typeof x[k2] === 'string') found.push(x[k2]); }); }); });
    found = found.filter(function (u) { return /^https:\/\//.test(u); });
    return found.filter(function (u) { return Kin.hf.okHost(u); })[0] || found[0] || '';
  }
  /** a credit price in a price-check result */
  function creditsIn(t) { var m = /"(?:credits_exact|credits|total_credits|cost|credit_cost)"\s*:\s*"?([\d.]+)/.exec(t) || /([\d.]+)\s*credits?\b/i.exec(t); return m ? parseFloat(m[1]) : NaN; }

  function run(text, opts, kit) {
    opts = opts || {};
    var c = kit.client(), deep = kit.deepModel(), status = opts.onStatus || noop, signal = opts.signal, reqOpts = signal ? { signal: signal } : undefined;
    var spent = 0, hfCredits = 0, notes = [], madeIds = [], fableOff = '';
    /* Fable not open to this key (some organisations): carry on with Opus for the rest of the job and say so */
    function fableGone(e, model) { return model === kit.FABLE && e && (e.status === 400 || e.status === 403 || e.status === 404) && /model|retention|fable|not available|access/i.test(String(e.message || '')); }
    var hfOn = !!(Kin.hf && Kin.hf.connected());
    if (kit.fableGone && kit.fableGone() && Kin.mind.deep() === 'fable') fableOff = kit.fableGone();
    function add(m) { spent += Kin.mind.costOf(m.model, m.usage); }
    function beat(s) { status(s); }
    /* every event of every stream keeps the page's watchdog fed; a stream that stops part way is still counted */
    function meter(st, model) {
      var pm = { model: model, start: null, chars: 0, counted: false };
      st.on('streamEvent', function (ev) {
        if (opts.onBeat) opts.onBeat();
        if (ev.type === 'message_start' && ev.message) { pm.start = ev.message.usage; pm.model = ev.message.model || model; }
        else if (ev.type === 'content_block_delta' && ev.delta) pm.chars += String(ev.delta.text || ev.delta.thinking || ev.delta.partial_json || '').length;
      });
      pm.lost = function () { if (!pm.counted && pm.start) { pm.counted = true; spent += Kin.mind.partialCost(pm.model, pm.start, pm.chars); } };
      return pm;
    }

    /* one streamed request with a single local tool the model must hand its work to */
    function toolCall(model, effort, system, user, tool, room, label) {
      var tries = 0;
      function once(msgs) {
        var s = c.beta.messages.stream({ model: model, max_tokens: room, betas: [kit.FALLBACK_BETA], fallbacks: 'default', thinking: { type: 'adaptive' }, output_config: { effort: effort },
          system: system, messages: msgs, tools: [tool] }, reqOpts), n = 0, pm = meter(s, model);
        s.on('streamEvent', function () { if (++n % 40 === 0) beat(label); });
        return s.finalMessage().then(function (m) {
          add(m);
          if (m.stop_reason === 'refusal') throw Object.assign(new Error('refused'), { refused: true });
          var u = (m.content || []).filter(function (b) { return b.type === 'tool_use' && b.name === tool.name; })[0];
          if (u && u.input && typeof u.input === 'object') return u.input;
          if (++tries > 1) throw new Error('The designer did not hand the work over.');
          return once(msgs.concat([{ role: 'assistant', content: m.content }, { role: 'user', content: [{ type: 'text', text: 'Call ' + tool.name + ' now with the complete work. Nothing else.' }] }]));
        }, function (e) {
          pm.lost();
          if (!fableGone(e, model)) throw e;
          fableOff = String(e.message || '').slice(0, 160); model = deep = kit.MAIN; if (kit.noteFableGone) kit.noteFableGone(fableOff); beat('Fable 5.2 is not open to this key; using Opus 5.5');
          return once(msgs);
        });
      }
      return once([{ role: 'user', content: user }]);
    }

    /* ---- the art director, from pictures ---- */
    function judge(brief, items) {
      var content = [];
      items.forEach(function (it, k) {
        content.push({ type: 'text', text: 'Concept ' + String.fromCharCode(65 + k) + ' (index ' + k + '): ' + it.name + '. Its idea: ' + it.idea });
        if (it.png) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: it.png } });
        else content.push({ type: 'text', text: 'The picture could not be drawn on this device; the SVG source:\n' + String(it.src).slice(0, 30000) });
        if (it.checked && (it.checked.hard.length || it.checked.soft.length)) content.push({ type: 'text', text: 'A checker measured this one with the real fonts and found:\n- ' + it.checked.hard.concat(it.checked.soft).join('\n- ') });
      });
      content.push({ type: 'text', text: 'The brief:\n' + JSON.stringify(brief).slice(0, 3000) });
      /* streamed, so a long look at three pictures keeps showing signs of life */
      var st = c.beta.messages.stream({ model: deep, max_tokens: 12000, betas: [kit.FALLBACK_BETA], fallbacks: 'default', thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, system: STRICT, messages: [{ role: 'user', content: content }] }, reqOpts), n = 0, jm = meter(st, deep);
      st.on('streamEvent', function () { if (++n % 40 === 0) beat('The art director is looking'); });
      return st.finalMessage()
        .then(function (m) {
          add(m); var j = jsonIn(textOf(m)) || {}, list = Array.isArray(j.concepts) ? j.concepts : [];
          items.forEach(function (it, k) {
            var r = list[k] || {}, s = typeof r.score === 'number' ? Math.max(0, Math.min(100, Math.round(r.score))) : null;
            it.raw = s; it.notes = (Array.isArray(r.notes) ? r.notes : []).map(String).slice(0, 3); it.fixes = (Array.isArray(r.fixes) ? r.fixes : []).map(String).slice(0, 4); it.caps = [];
            if (s != null && it.checked && !it.checked.failed && it.checked.hard.length && s > FAULT_CAP) { s = FAULT_CAP; it.caps.push('measured faults'); }
            if (s != null && it.typeOnly && !brief.minimal && s > TYPE_CAP) { s = TYPE_CAP; it.caps.push('type only'); }
            it.score = s;
          });
          return { winner: typeof j.winner === 'number' ? j.winner : 0, why: String(j.why || '').slice(0, 300) };
        }, function (e) { jm.lost(); if (e && e.name === 'APIUserAbortError') throw e; items.forEach(function (it) { it.score = null; it.notes = []; it.fixes = []; it.caps = []; }); notes.push('The art director could not be reached (' + String((e && e.message) || e).slice(0, 100) + ').'); return { winner: 0, why: '', failed: true }; });
    }

    /* ---- turn one SVG into something the art director can see: compose, clean, measure, draw ---- */
    function prepare(it, pics) {
      var composed = compose(it.src, pics), cs = Kin.mind.cleanSvg(composed);
      if (!cs.ok) { it.bad = cs.why; it.svg = ''; return Promise.resolve(it); }
      it.svg = cs.svg; it.w = cs.w; it.h = cs.h; it.typeOnly = typeOnly(cs.svg);
      return Kin.mind.measure(cs.svg, cs.w, cs.h).then(function (m) { it.checked = m; return Kin.mind.svgToPng(cs.svg, cs.w, cs.h, 1100); }).then(function (png) { it.png = png; return it; });
    }

    /* ---- pictures through Higgsfield, priced first, approved once, then made ---- */
    function mcpAsk(enable, prompt, room) {
      return Kin.hf.token().then(function (tok) {
        if (!tok) throw Object.assign(new Error('Higgsfield is not connected.'), { hf: 'auth' });
        var msgs = [{ role: 'user', content: prompt }], uses = [], results = [], pauses = 0;
        function step() {
          var s = c.beta.messages.stream({ model: kit.MAIN, max_tokens: room || 8000, betas: [MCP_BETA, kit.FALLBACK_BETA], fallbacks: 'default', output_config: { effort: 'low' },
            mcp_servers: [{ type: 'url', url: Kin.hf.MCP_URL, name: 'higgsfield', authorization_token: tok }],
            tools: [{ type: 'mcp_toolset', mcp_server_name: 'higgsfield', default_config: { enabled: false }, configs: enable }], messages: msgs }, reqOpts), n = 0, mm = meter(s, kit.MAIN);
          s.on('streamEvent', function () { if (++n % 30 === 0) beat('Talking to Higgsfield'); });
          return s.finalMessage().catch(function (e) { mm.lost(); throw e; }).then(function (m) {
            add(m);
            (m.content || []).forEach(function (b) { if (b.type === 'mcp_tool_use') uses.push(b); if (b.type === 'mcp_tool_result') results.push(b); });
            if (m.stop_reason === 'pause_turn' && ++pauses <= 4) { msgs.push({ role: 'assistant', content: m.content }); return step(); }
            return { uses: uses, results: results, text: textOf(m) };
          });
        }
        return step();
      }).then(function (r) {
        var authFail = r.results.filter(function (b) { return b.is_error && /401|403|unauthori[sz]ed|invalid[_ ]token|forbidden/i.test(resultText(b)); })[0];
        if (authFail) { Kin.hf.rejected(resultText(authFail).slice(0, 80)); throw Object.assign(new Error('Higgsfield turned the sign-in down.'), { hf: 'auth' }); }
        return r;
      }, function (e) {
        if (e && !e.hf && /mcp|authori[sz]|401|403|token/i.test(String(e.message || ''))) { Kin.hf.rejected(String(e.message || '').slice(0, 80)); throw Object.assign(new Error('Higgsfield turned the sign-in down.'), { hf: 'auth' }); }
        throw e;
      });
    }
    function pictures(plan) {
      if (!plan.length) return Promise.resolve({});
      var list = plan.map(function (p) { return '- ' + p.id + ': aspect ' + p.aspect + '; prompt: ' + p.prompt; }).join('\n');
      beat('Pricing the pictures');
      return mcpAsk({ generate_image: { enabled: true } },
        'PRICE CHECK ONLY. For each picture below call generate_image exactly once with params { model: "' + IMAGE_MODEL + '", prompt: the prompt exactly as written, aspect_ratio: the aspect given, get_cost: true, use_unlim: false }, so nothing is generated. Do not call anything else. Then reply with one line per picture: the id and its credit cost.\n' + list, 6000)
        .then(function (q) {
          var bad = q.uses.filter(function (u) { return u.name !== 'generate_image' || !deepSearch(u.input, 'get_cost', true); });
          if (bad.length) { notes.push('A price check asked Higgsfield to make a picture instead of pricing it, so I stopped there. Check your Higgsfield account for a charge.'); throw Object.assign(new Error('price check breach'), { hf: 'breach', credits: bad.length }); }
          var credits = 0, priced = 0;
          q.results.forEach(function (b) { var n = creditsIn(resultText(b)); if (!b.is_error && n >= 0) { credits += n; priced++; } });
          if (priced < plan.length) { notes.push('Higgsfield did not price every picture, so none were made.'); return null; }
          credits = Math.round(credits * 100) / 100;
          var used = Kin.hf.used(), cap = Kin.hf.cap();
          if (used + credits > cap) { notes.push('The pictures would cost about ' + credits + ' credits, which passes your daily Higgsfield limit (' + used + ' of ' + cap + ' used today). Raise it in settings to allow them.'); return null; }
          return (opts.confirm ? opts.confirm({ kind: 'credits', title: 'Make ' + plan.length + (plan.length === 1 ? ' picture' : ' pictures') + ' on Higgsfield?', lines: ['About ' + credits + ' Higgsfield credits, from your account.', 'Today so far: ' + used + ' of your ' + cap + '-credit daily limit.'], say: 'The pictures cost about ' + credits + ' Higgsfield credits, sir. Shall I make them?', yes: 'Make them', no: 'Skip pictures' }) : Promise.resolve(false))
            .then(function (ok) { if (!ok) { notes.push('Pictures skipped at your word; the concepts are drawn instead.'); return null; } return credits; });
        })
        .then(function (credits) {
          if (credits == null) return {};
          beat('Making the pictures');
          var reqs = plan.map(function (p, i) { return '- index ' + i + ' (' + p.id + '): aspect ' + p.aspect + '; prompt: ' + p.prompt; }).join('\n');
          return mcpAsk({ generate_image_batch: { enabled: true }, jobs_wait: { enabled: true } },
            'Make these pictures on Higgsfield now. Call generate_image_batch ONCE with one request per picture: { index: the index given, params: { model: "' + IMAGE_MODEL + '", prompt: the prompt exactly as written, aspect_ratio: the aspect given, use_unlim: false } }. Then call jobs_wait with every returned { index, job_id } until all are finished (call it again while any is still running). Never submit a picture twice. Then reply with one line per picture: the id (img…), a space, and its result URL.\n' + reqs, 12000)
            .then(function (g) {
              var subs = g.uses.filter(function (u) { return u.name === 'generate_image_batch'; }), asked = 0;
              subs.forEach(function (u) { asked += (u.input && Array.isArray(u.input.requests)) ? u.input.requests.length : 0; });
              Kin.hf.addUsed(credits); hfCredits = credits;
              if (asked > plan.length) notes.push('Higgsfield was asked for ' + asked + ' pictures where ' + plan.length + ' were approved; the extra cost may show on your Higgsfield account.');
              /* which picture is which: the index of each request, the job id it got, the URL the wait returned */
              var jobOf = {}, urlOf = {};
              g.results.forEach(function (b) {
                var j = null; try { j = JSON.parse(resultText(b)); } catch (e) {}
                walk(j, function (o) { if (o.job_id && typeof o.index === 'number' && plan[o.index]) jobOf[String(o.job_id).toLowerCase()] = plan[o.index].id; });
              });
              g.results.forEach(function (b) {
                var j = null; try { j = JSON.parse(resultText(b)); } catch (e) {}
                walk(j, function (o) {
                  var id = o.job_id ? jobOf[String(o.job_id).toLowerCase()] : null; if (!id && typeof o.index === 'number' && plan[o.index] && !o.job_id) id = plan[o.index].id;
                  var u = id ? urlIn(o) : ''; if (id && u && !urlOf[id]) urlOf[id] = u;
                });
              });
              String(g.text || '').split('\n').forEach(function (l) { var m = /^\s*[-*]?\s*(img\d+)\b\D*?(https:\/\/\S+)/i.exec(l); if (m && !urlOf[m[1]]) urlOf[m[1]] = m[2].replace(/[).,]+$/, ''); });
              beat('Placing the pictures');
              var pics = {};
              return Promise.all(plan.map(function (p) {
                var u = urlOf[p.id]; if (!u) { notes.push('Picture ' + p.id + ' did not come back from Higgsfield.'); return null; }
                if (!Kin.hf.okHost(u)) { notes.push('Picture ' + p.id + ' came from a host this page does not load (' + u.slice(0, 60) + ').'); return null; }
                return Kin.hf.toData(u, 1600).then(function (d) { pics[p.id] = { data: d.data, url: u, prompt: p.prompt }; }, function () { notes.push('Picture ' + p.id + ' could not be fetched into the design; its link: ' + u); });
              })).then(function () { return pics; });
            });
        })
        .catch(function (e) {
          if (e && e.hf === 'auth') { notes.push('Higgsfield did not accept the sign-in, so the concepts are drawn instead. Connect it again in settings.'); return {}; }
          if (e && e.hf === 'breach') return {};
          if (e && e.name === 'APIUserAbortError') throw e;
          notes.push('The pictures could not be made (' + String((e && e.message) || e).slice(0, 120) + '); the concepts are drawn instead.'); return {};
        });
    }

    /* ---- the job ---- */
    var est = estimate(kit, deep, hfOn);
    var gate = est > ASK_OVER && opts.confirm
      ? opts.confirm({ kind: 'cost', title: 'A full design job', lines: ['About $' + est.toFixed(2) + ' in Claude usage on ' + (/fable/.test(deep) ? 'Fable 5.2' : 'Opus 5.5') + ': a brief, three concepts, an art director and up to three rounds of refinement.', hfOn ? 'Pictures are priced and asked for separately.' : 'Higgsfield is not connected, so the concepts are drawn, not photographed.'], say: 'A full design job costs about ' + est.toFixed(2) + ' dollars, sir. Shall I go ahead?', yes: 'Go ahead', no: 'Not now' })
      : Promise.resolve(true);
    var brief = null, title = '', items = [], pics = {}, verdict = null;
    return gate.then(function (ok) {
      if (!ok) return { text: 'Understood, sir. Nothing was made and nothing was spent.', declined: true };
      beat('Writing the brief and three concepts');
      var books = kit.designPlaybooks(text);
      var user = [{ type: 'text', text: text + '\n\n[Today is ' + kit.today() + '.]' + (books ? '\n\n' + books : '') }];
      return toolCall(deep, 'high', kit.system().concat([{ type: 'text', text: conceptRules(hfOn) }]), user, CONCEPTS_TOOL, 64000, 'Drawing three concepts')
        .then(function (input) {
          brief = input.brief || {}; title = String(input.title || 'Design').slice(0, 120);
          var seen = {}, plan = [];
          items = (input.concepts || []).slice(0, 3).map(function (k) {
            (k.images || []).forEach(function (im) { if (!hfOn || plan.length >= 4 || seen[im.id] || !/^img\d{1,2}$/.test(im.id) || typeof im.prompt !== 'string') return; seen[im.id] = 1; plan.push({ id: im.id, prompt: im.prompt.slice(0, 1200), aspect: ASPECTS.indexOf(im.aspect) >= 0 ? im.aspect : '1:1' }); });
            return { name: String(k.name || '').slice(0, 60), idea: String(k.idea || '').slice(0, 300), src: String(k.svg || '') };
          });
          if (!items.length) throw new Error('No concepts came back.');
          return pictures(plan);
        })
        .then(function (p) { pics = p || {}; beat('Measuring the three concepts'); return Promise.all(items.map(function (it) { return prepare(it, pics); })); })
        .then(function () {
          items = items.filter(function (it) { return it.svg; }); if (!items.length) throw new Error('None of the concepts was a usable SVG.');
          beat('The art director is comparing the concepts'); return judge(brief, items);
        })
        .then(function (v) {
          verdict = v;
          /* the winner by score after the caps; the art director's pick breaks a tie */
          var best = 0; items.forEach(function (it, k) { var a = it.score == null ? -1 : it.score, b = items[best].score == null ? -1 : items[best].score; if (a > b || (a === b && k === v.winner)) best = k; });
          var win = items[best]; win.chosen = true; win.round = 1;
          function refine() {
            if (win.score == null || win.score >= PASS || win.round >= 3) return Promise.resolve(win);
            beat('Refining the winner, round ' + (win.round + 1) + ' of 3');
            var asks = (win.checked && win.checked.hard.length ? ['Measured problems, fix all of these first:\n- ' + win.checked.hard.join('\n- ')] : [])
              .concat(win.fixes.length ? ['The art director asks:\n- ' + win.fixes.join('\n- ')] : [])
              .concat(win.caps.indexOf('type only') >= 0 ? ['This is a type-only piece and the brief does not ask for minimalism. Add a real image: ' + (Object.keys(pics).length ? 'use the existing pictures (' + Object.keys(pics).map(function (k) { return 'hf:' + k; }).join(', ') + ') or ' : '') + 'draw an illustration in the SVG.'] : [])
              .concat(win.checked && win.checked.soft.length ? ['Also worth fixing:\n- ' + win.checked.soft.join('\n- ')] : []);
            var u = [{ type: 'text', text: 'Refine this design to an excellent, finished piece (the bar is ' + PASS + ' of 100; it scored ' + win.score + ').\nThe brief: ' + JSON.stringify(brief).slice(0, 3000) + '\nThe concept: ' + win.name + ': ' + win.idea + '\n\n' + asks.join('\n\n') + '\n\nKeep what works' + (win.notes.length ? ' (' + win.notes.join('; ') + ')' : '') + '. Picture references stay as href="hf:imgN". Here is the SVG:\n' + win.src.slice(0, 120000) + '\n\nCall revise_design with the complete revised SVG.' }];
            /* the brief, the three concepts and every critique run on the deep model; a refinement round applies
               concrete fixes, which Opus 5.5 does as well for about half the price */
            return toolCall(kit.MAIN, 'high', kit.system(), u, REVISE_TOOL, 48000, 'Refining the winner')
              .then(function (r) {
                var next = { name: win.name, idea: win.idea, src: String(r.svg || ''), changed: String(r.changed || '').slice(0, 200) };
                return prepare(next, pics).then(function () {
                  if (!next.svg) { win.round = 3; return win; }
                  beat('The art director is looking again'); return judge(brief, [next]).then(function () {
                    next.round = win.round + 1; next.chosen = true;
                    if (next.score != null && (win.score == null || next.score >= win.score)) { win.chosen = false; items[items.indexOf(win)] = next; win = next; } else win.round = next.round;
                    return refine();
                  });
                });
              }, function (e) { if (e && e.name === 'APIUserAbortError') throw e; notes.push('A refinement round failed (' + String((e && e.message) || e).slice(0, 100) + ').'); win.round = 3; return win; });
          }
          return refine();
        })
        .then(function (win) {
          var others = items.filter(function (it) { return it !== win; }).map(function (it) { return { name: it.name, idea: it.idea, svg: it.svg, score: it.score, caps: it.caps, notes: it.notes }; });
          var item = Kin.mind.addMade({ kind: 'design', title: title, note: [brief.format, Object.keys(pics).length ? 'Higgsfield pictures: ' + Object.keys(pics).length : 'drawn'].filter(Boolean).join(' · ').slice(0, 200),
            content: win.svg, src: win.src, brief: brief, concept: { name: win.name, idea: win.idea }, notes: win.notes, why: verdict && verdict.why || '', caps: win.caps,
            others: others, pictures: Object.keys(pics).map(function (k) { return { id: k, prompt: pics[k].prompt, url: pics[k].url }; }), credits: hfCredits, usd: Math.round(spent * 1e4) / 1e4, issues: notes.slice(0, 6) });
          item = Kin.mind.addMade({ id: item.id, score: win.score, round: win.round, fixes: (win.checked && win.checked.hard || []).concat(win.fixes).slice(0, 6) });
          madeIds.push(item.id); if (opts.onMade) opts.onMade(item);
          var s = win.score;
          var line = 'The ' + win.name + ' concept won, sir: ' + win.idea.replace(/\.$/, '') + '. ' + (s == null ? 'The art director could not be reached, so judge it yourself.' : 'The art director gave it ' + s + ' of 100' + (win.round > 1 ? ' after ' + win.round + ' rounds' : '') + '.') +
            (s != null && s < PASS && win.fixes.length ? ' The one thing I would still change: ' + win.fixes[0].replace(/\.$/, '') + '.' : '') + ' It is on your Made shelf with the brief and the two other concepts.' + (notes.length ? '\n\n' + notes.join(' ') : '');
          return { text: line, model: deep, made: madeIds, studio: true };
        });
    }).then(function (r) { r.cost = spent; r.route = 'make'; r.credits = hfCredits; if (fableOff) r.fableOff = fableOff; return r; },
      function (e) { if (e && typeof e === 'object') e.spent = spent; throw e; });
  }

  Kin.studio = { run: run, estimate: estimate, compose: compose, typeOnly: typeOnly, PASS: PASS, TYPE_CAP: TYPE_CAP };
})();
