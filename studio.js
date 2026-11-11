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

   Every Claude step runs on Opus 5.5. Before anything is spent, ONE card shows the price (about $1.62 in Claude usage,
   $1.80 with pictures, and at most what is left of the day's Higgsfield credits) with Go, Go without pictures, and Stop.
   Stop ends the job there and nothing is sent. After Go the card is a live panel: the step, the time, the money spent
   from real usage, and Stop, which aborts every request in flight; no further request is made for that job.
   Each step has a time limit, and every failure is reported in plain words. If the pictures would cost more credits
   than were approved, Kin stops and asks again.

   Marketing pieces (posters, invites, flyers, social graphics) with Higgsfield connected take the full-poster route by
   default: Opus 5.5 art-directs one idea with the exact copy, Higgsfield's image model renders the WHOLE piece (type,
   product, light and colour as one object) in three variants, the art director reads every word in every render and
   picks, and one refinement render follows when it falls short. The card shows the credits this will take. The composed
   SVG route above is the fallback: when Higgsfield is not connected, when there is too much exact copy for a picture,
   when the founder picks "Compose it instead", or when no poster could be made. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var PASS = 90, TYPE_CAP = 70, FAULT_CAP = PASS - 4;
  var MCP_BETA = 'mcp-client-2026-09-15';
  var ASPECTS = ['1:1', '3:4', '4:3', '4:5', '9:16', '16:9', '2:3', '3:2'];
  function noop() {}
  /* how long each step may take before Kin stops it and says so */
  /* each request may go this long with no stream event at all (the clock restarts on every event) ... */
  var LIMIT = { concepts: 420000, pictures: 300000, director: 240000, refine: 360000 };
  /* ... and never longer than this in total, however busy it is */
  var HARD = { concepts: 900000, pictures: 600000, director: 480000, refine: 720000 };
  var STEP_NAME = { concepts: 'brief and three concepts', pictures: 'pictures', director: 'art director', refine: 'refinement' };

  /* ---------------------------------------------------------------- what a job costs, roughly (for the notes and the tests; the answer line shows the real cost) */
  function estimate(kit, pictures) {
    var cost = Kin.mind.costOf, m = kit.MAIN;
    var usd = cost(m, { input_tokens: 34000, output_tokens: 30000 }) +      /* brief and three concepts */
      cost(m, { input_tokens: 7000, output_tokens: 3000 }) +                  /* the art director, three pictures */
      2 * cost(m, { input_tokens: 16000, output_tokens: 14000 }) +            /* up to two refinement rounds */
      2 * cost(m, { input_tokens: 4000, output_tokens: 2000 });               /* their reviews */
    if (pictures) usd += 2 * cost(m, { input_tokens: 9000, output_tokens: 2500 }); /* price check and making the pictures */
    return Math.round(usd * 100) / 100;
  }

  /* ---------------------------------------------------------------- the full-poster route */
  var POSTER_CREDITS = 4.5, POSTER_VARIANTS = 3;      /* about 4.5 credits a render at xhigh, 2k (priced for real before anything is made) */
  var POSTER_PARAMS = ', quality: "xhigh", resolution: "2k"';
  var MARKETING = /\b(poster|invite|invitation|flyer|flier|social (?:post|graphic|tile)|instagram|story graphic|banner|announcement|advert|ad creative|billboard)\b/i;
  var TOO_FACTUAL = /\b(schedule|menu|table|ledger|price ?list|timetable|agenda|itinerary|spreadsheet|chart)\b/i;
  function posterEstimate(kit) {
    var cost = Kin.mind.costOf, m = kit.MAIN;
    var usd = cost(m, { input_tokens: 14000, output_tokens: 7000 }) +       /* the art direction and three prompts */
      cost(m, { input_tokens: 9000, output_tokens: 2500 }) * 2 +             /* price check and making the posters */
      cost(m, { input_tokens: 16000, output_tokens: 3000 }) +                /* the art director reads every word in three renders */
      cost(m, { input_tokens: 8000, output_tokens: 2500 }) +                 /* the refinement prompt */
      cost(m, { input_tokens: 9000, output_tokens: 2500 }) * 2 +             /* pricing and making the refinement */
      cost(m, { input_tokens: 7000, output_tokens: 1500 });                  /* reading the refinement */
    return Math.round(usd * 100) / 100;
  }
  var POSTER_TOOL = { name: 'submit_poster', description: 'Hand over the idea, the exact copy and three full-poster prompts. Call it once, with everything.', eager_input_streaming: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['title', 'idea', 'aspect', 'copy', 'too_much_copy', 'variants'], properties: {
      title: { type: 'string', description: 'A short title for the piece.' },
      idea: { type: 'string', description: 'The one idea, from the facts of this event or product, in one sentence.' },
      aspect: { type: 'string', enum: ['4:5', '2:3', '1:1', '9:16'], description: '4:5 for phones and social, 2:3 for print, 9:16 for stories.' },
      copy: { type: 'array', maxItems: 8, items: { type: 'string' }, description: 'Every line of text the piece carries, exactly as it must be spelled, in reading order.' },
      too_much_copy: { type: 'boolean', description: 'True when the piece needs more exact facts than a picture can carry reliably (a schedule, a menu, a table, or more than about 40 words).' },
      variants: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['name', 'prompt'], properties: {
        name: { type: 'string', description: 'Two or three words.' }, prompt: { type: 'string', description: 'The complete art direction prompt for the image model.' } } } } } } };
  var REPROMPT_TOOL = { name: 'submit_refined', description: 'Hand over the refined prompt.', eager_input_streaming: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['prompt'], properties: { prompt: { type: 'string' } } } };
  var POSTER_RULES = [
    'You are art-directing a finished marketing piece (a poster, an invite or a social graphic) that an image model will render WHOLE: type, the hero object, light and colour come out as one designed object. Work in this order.',
    '1. The idea comes first, and it must come from the facts of this event or product. Test: if the headline would work for any other brand, it is not the idea yet. One hero object, one headline, one accent line, one details line. No icon badges and no bullet lists unless the piece is a schedule.',
    '2. Style: follow the founder\'s brand rules and any marketing direction in their pack. Where the pack sets none, pick a direction that fits the audience; the quiet thin-line look of this app is for the app, not for marketing.',
    '3. Write each prompt as an art direction brief, in this order: what it is ("a finished, award-level event poster for ..."); the style and the restraint rule ("executed with modern restraint: few elements, huge scale contrast, exact alignment, generous even margins"); the ground and colour; then each element top to bottom with its type style, colour and EXACT copy in quotes; then the hero object (photoreal, glossy rim light, fine detail, a soft contact shadow on a real surface); then a closing list of what must not appear.',
    '4. Copy: every word in quotes, "spelled exactly as written", short lines (under 8 words), a separate quoted string per line. For a wordmark of several words ask for "clearly separated words with normal word spaces". Type with contrast reads as designed: a chunky display face against a refined serif or a condensed sans, with at most one hand-lettered accent used once.',
    '5. End every prompt with: "No icons, no bullet lists, no social handles, no website, no phone number, no people, no other text."',
    '6. Never put private facts in a prompt: no personal names, no street address, no phone number, no email. A brand name, an event name, a date and a time are fine for a public piece. Follow the brand\'s copy rules exactly.',
    '7. At most about 40 words of copy in all. If the piece needs more exact facts (a schedule, a menu, a table), set too_much_copy to true: the page then composes it in SVG instead.',
    '8. Three variants: the same idea and the same exact copy, three different executions (layout, type pairing, light). Aspect: 4:5 for phones and social, 2:3 for print.',
    'Then call submit_poster once. Do not write anything else.'
  ].join('\n');
  var POSTER_CRITIC = [
    'You are a demanding senior art director. You see finished poster renders from an image model, with the exact copy each was meant to carry. Read every word in every picture, letter by letter, before you judge.',
    'Score each from 0 to 100: 70 is competent, 80 good, 90 excellent (it could appear in a design annual).',
    'It FAILS (under 70) for: any misspelled, missing or extra word; any invented handle, address, phone number or website; a wordmark with missing word spaces; generic copy that would fit any brand; icon-and-bullet clutter; text closer than about 5% of the width to an edge; a hero object smaller than about 40% of the height; anything that breaks the brand rules you were given.',
    'For each render give: the score, whether every word is exactly right (words_ok), the words that are wrong or invented, at most three notes, and at most four fixes written as instructions for the next render (bigger hero, word spacing, where a line sits). Then pick the winner and say why in one sentence.',
    'Reply with JSON only: {"posters":[{"score":number,"words_ok":boolean,"wrong_words":[string],"notes":[string],"fixes":[string]}],"winner":number (0-based),"why":string}'
  ].join('\n');

  /* ---------------------------------------------------------------- the concepts request */
  var CONCEPTS_TOOL = { name: 'submit_concepts', description: 'Hand over the creative brief and exactly three design concepts. Call it once, with everything.', eager_input_streaming: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['title', 'brief', 'concepts'], properties: {
      title: { type: 'string', description: 'A short title for the piece, e.g. "Spring open house invite".' },
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
    var c = kit.client(), deep = kit.deepModel(), status = opts.onStatus || noop, signal = opts.signal;
    var spent = 0, hfCredits = 0, notes = [], madeIds = [], budget = 0;
    var hfOn = !!(Kin.hf && Kin.hf.connected());
    var onStep = opts.onStep || noop, onSpend = opts.onSpend || noop;
    function add(m) { spent += Kin.mind.costOf(m.model, m.usage); onSpend(spent); }
    function beat(s) { status(s); }
    /* the founder stopped the job: no further request is made */
    function abortErr() { var e = new Error('Request was aborted.'); e.name = 'APIUserAbortError'; e.byFounder = true; return e; }
    function alive() { if (signal && signal.aborted) throw abortErr(); }
    function isAbort(e) { return !!e && (e.name === 'APIUserAbortError' || e.name === 'AbortError' || !!(window.Anthropic && e instanceof window.Anthropic.APIUserAbortError)); }
    function limit(step) { return (Kin.T && Kin.T['studio_' + step]) || LIMIT[step] || 300000; }
    function hardLimit(step) { return (Kin.T && Kin.T['studio_hard_' + step]) || HARD[step] || 600000; }
    function span(ms) { var m = Math.round(ms / 60000), sec = Math.round(ms / 1000); return m >= 1 ? m + (m === 1 ? ' minute' : ' minutes') : sec + (sec === 1 ? ' second' : ' seconds'); }
    /* one request's own stop switch: tripped by the founder's Stop, by a stream that goes quiet, or by the step's overall limit.
       g.poke() runs on every stream event, so a stream that is still producing is never cut off by the quiet limit. */
    function guard(step) {
      alive();
      var ctl = new AbortController(), g = { timedOut: '', over: false, opts: { signal: ctl.signal } }, t = null;
      function outer() { ctl.abort(); }
      function arm() { clearTimeout(t); t = setTimeout(function () { g.timedOut = 'quiet'; ctl.abort(); }, limit(step)); }
      if (signal) signal.addEventListener('abort', outer);
      arm();
      var h = setTimeout(function () { g.timedOut = 'hard'; ctl.abort(); }, hardLimit(step));
      g.poke = function () { if (!g.over && !g.timedOut) arm(); };
      g.done = function () { g.over = true; clearTimeout(t); clearTimeout(h); if (signal) signal.removeEventListener('abort', outer); };
      /* an error from this request, in plain terms: the founder's stop, the time limit, or what Anthropic said */
      g.fail = function (e) {
        g.done();
        if (signal && signal.aborted) return abortErr();
        if (g.timedOut === 'hard') return Object.assign(new Error('The ' + STEP_NAME[step] + ' step took longer than ' + span(hardLimit(step)) + ', so I stopped it.'), { code: 'timeout', step: step });
        if (g.timedOut) return Object.assign(new Error('The ' + STEP_NAME[step] + ' step went quiet for ' + span(limit(step)) + ', so I stopped it.'), { code: 'timeout', step: step });
        return e;
      };
      return g;
    }
    /* every event of every stream keeps the page's watchdog fed; a stream that stops part way is still counted */
    function meter(st, model, g) {
      var pm = { model: model, start: null, chars: 0, counted: false };
      st.on('streamEvent', function (ev) {
        if (g) g.poke();
        if (opts.onBeat) opts.onBeat();
        if (ev.type === 'message_start' && ev.message) { pm.start = ev.message.usage; pm.model = ev.message.model || model; }
        else if (ev.type === 'content_block_delta' && ev.delta) pm.chars += String(ev.delta.text || ev.delta.thinking || ev.delta.partial_json || '').length;
      });
      pm.lost = function () { if (!pm.counted && pm.start) { pm.counted = true; spent += Kin.mind.partialCost(pm.model, pm.start, pm.chars); onSpend(spent); } };
      return pm;
    }

    /* one streamed request with a single local tool the model must hand its work to */
    function toolCall(model, effort, system, user, tool, room, label, step, onJson) {
      var tries = 0;
      function once(msgs) {
        var g = guard(step);
        var s = c.beta.messages.stream({ model: model, max_tokens: room, betas: [kit.FALLBACK_BETA], fallbacks: 'default', thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: effort },
          system: system, messages: msgs, tools: [tool] }, g.opts), n = 0, pm = meter(s, model, g), js = '';
        s.on('streamEvent', function (ev) { if (++n % 40 === 0) beat(label); if (onJson && ev.type === 'content_block_delta' && ev.delta && ev.delta.partial_json) { js += ev.delta.partial_json; onJson(js); } });
        return s.finalMessage().then(function (m) {
          g.done(); add(m);
          if (m.stop_reason === 'refusal') throw Object.assign(new Error('refused'), { refused: true });
          var u = (m.content || []).filter(function (b) { return b.type === 'tool_use' && b.name === tool.name; })[0];
          if (u && u.input && typeof u.input === 'object') return u.input;
          if (++tries > 1) throw new Error('The designer did not hand the work over.');
          return once(msgs.concat([{ role: 'assistant', content: m.content }, { role: 'user', content: [{ type: 'text', text: 'Call ' + tool.name + ' now with the complete work. Nothing else.' }] }]));
        }, function (e) { pm.lost(); throw g.fail(e); });
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
      var g = guard('director');
      var st = c.beta.messages.stream({ model: deep, max_tokens: 12000, betas: [kit.FALLBACK_BETA], fallbacks: 'default', thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'high' }, system: STRICT, messages: [{ role: 'user', content: content }] }, g.opts), n = 0, jm = meter(st, deep, g);
      st.on('streamEvent', function () { if (++n % 40 === 0) beat('The art director is looking'); });
      return st.finalMessage()
        .then(function (m) {
          g.done(); add(m); var j = jsonIn(textOf(m)) || {}, list = Array.isArray(j.concepts) ? j.concepts : [];
          items.forEach(function (it, k) {
            var r = list[k] || {}, s = typeof r.score === 'number' ? Math.max(0, Math.min(100, Math.round(r.score))) : null;
            it.raw = s; it.notes = (Array.isArray(r.notes) ? r.notes : []).map(String).slice(0, 3); it.fixes = (Array.isArray(r.fixes) ? r.fixes : []).map(String).slice(0, 4); it.caps = [];
            if (s != null && it.checked && !it.checked.failed && it.checked.hard.length && s > FAULT_CAP) { s = FAULT_CAP; it.caps.push('measured faults'); }
            if (s != null && it.typeOnly && !brief.minimal && s > TYPE_CAP) { s = TYPE_CAP; it.caps.push('type only'); }
            it.score = s;
          });
          return { winner: typeof j.winner === 'number' ? j.winner : 0, why: String(j.why || '').slice(0, 300) };
        }, function (e) { jm.lost(); e = g.fail(e); if (isAbort(e)) throw e; items.forEach(function (it) { it.score = null; it.notes = []; it.fixes = []; it.caps = []; }); notes.push('The art director could not be reached (' + String((e && e.message) || e).slice(0, 100) + ').'); return { winner: 0, why: '', failed: true }; });
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
          var g = guard('pictures');
          var s = c.beta.messages.stream({ model: kit.MAIN, max_tokens: room || 8000, betas: [MCP_BETA, kit.FALLBACK_BETA], fallbacks: 'default', output_config: { effort: 'low' },
            mcp_servers: [{ type: 'url', url: Kin.hf.MCP_URL, name: 'higgsfield', authorization_token: tok }],
            tools: [{ type: 'mcp_toolset', mcp_server_name: 'higgsfield', default_config: { enabled: false }, configs: enable }], messages: msgs }, g.opts), n = 0, mm = meter(s, kit.MAIN, g);
          s.on('streamEvent', function () { if (++n % 30 === 0) beat('Talking to Higgsfield'); });
          return s.finalMessage().catch(function (e) { mm.lost(); throw g.fail(e); }).then(function (m) {
            g.done(); add(m);
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
        if (isAbort(e) || (e && e.code === 'timeout')) throw e;
        if (e && !e.hf && /mcp|authori[sz]|401|403|token/i.test(String(e.message || ''))) { Kin.hf.rejected(String(e.message || '').slice(0, 80)); throw Object.assign(new Error('Higgsfield turned the sign-in down.'), { hf: 'auth' }); }
        throw e;
      });
    }
    function pictures(plan, po) {
      po = po || {}; var extra = po.params || '';
      if (!plan.length) return Promise.resolve({});
      var list = plan.map(function (p) { return '- ' + p.id + ': aspect ' + p.aspect + '; prompt: ' + p.prompt; }).join('\n');
      beat('Pricing the pictures');
      return mcpAsk({ generate_image: { enabled: true } },
        'PRICE CHECK ONLY. For each picture below call generate_image exactly once with params { model: "' + IMAGE_MODEL + '", prompt: the prompt exactly as written, aspect_ratio: the aspect given' + extra + ', get_cost: true, use_unlim: false }, so nothing is generated. Do not call anything else. Then reply with one line per picture: the id and its credit cost.\n' + list, 6000)
        .then(function (q) {
          var bad = q.uses.filter(function (u) { return u.name !== 'generate_image' || !deepSearch(u.input, 'get_cost', true); });
          if (bad.length) { notes.push('A price check asked Higgsfield to make a picture instead of pricing it, so I stopped there. Check your Higgsfield account for a charge.'); throw Object.assign(new Error('price check breach'), { hf: 'breach', credits: bad.length }); }
          var credits = 0, priced = 0;
          q.results.forEach(function (b) { var n = creditsIn(resultText(b)); if (!b.is_error && n >= 0) { credits += n; priced++; } });
          if (priced < plan.length) { notes.push('Higgsfield did not price every picture, so none were made.'); return null; }
          credits = Math.round(credits * 100) / 100;
          var used = Kin.hf.used(), cap = Kin.hf.cap();
          if (po.quiet && !(credits <= budget && used + credits <= cap)) { notes.push('The refinement render would have cost ' + credits + ' credits, more than is left of what you approved, so I kept the best of the first renders.'); return null; }
          /* approved on the card: at most what was left of today's limit. More than that: stop and ask again */
          if (credits <= budget && used + credits <= cap) return credits;
          var over = { kind: 'credits', label: 'Kin stopped to ask', title: 'The pictures cost more than you approved', price: credits + ' credits',
            lines: ['Higgsfield priced ' + plan.length + (plan.length === 1 ? ' picture' : ' pictures') + ' at ' + credits + ' credits. You approved up to ' + budget + ' (today: ' + used + ' of ' + cap + ' used).', 'Raise the daily limit in settings to allow more. Nothing has been made on Higgsfield.'],
            say: 'The pictures cost ' + credits + ' credits, more than you approved, sir. Draw them instead, or stop?',
            choices: [{ k: 'draw', label: 'Draw them instead', kind: 'go', note: 'Carries on without pictures. Claude usage continues.' }, { k: 'stop', label: 'Stop the job', kind: 'stop', note: 'Ends the job now. Nothing more is spent.' }] };
          return (opts.choose ? opts.choose(over) : Promise.resolve('draw')).then(function (k) {
            if (k === 'stop') throw abortErr();
            notes.push('The pictures would have cost ' + credits + ' credits, more than the ' + budget + ' approved, so the concepts are drawn instead.'); return null;
          });
        })
        .then(function (credits) {
          if (credits == null) return {};
          beat('Making the pictures');
          /* counted against today's limit now, before the batch goes out: a stop, a time-out or an error after this point
             can still leave pictures being made (and charged) on Higgsfield, and the next card must not offer those credits again */
          Kin.hf.addUsed(credits); hfCredits = Math.round((hfCredits + credits) * 100) / 100; budget = Math.max(0, Math.round((budget - credits) * 100) / 100); if (opts.onSent) opts.onSent();
          var reqs = plan.map(function (p, i) { return '- index ' + i + ' (' + p.id + '): aspect ' + p.aspect + '; prompt: ' + p.prompt; }).join('\n');
          return mcpAsk({ generate_image_batch: { enabled: true }, jobs_wait: { enabled: true } },
            'Make these pictures on Higgsfield now. Call generate_image_batch ONCE with one request per picture: { index: the index given, params: { model: "' + IMAGE_MODEL + '", prompt: the prompt exactly as written, aspect_ratio: the aspect given' + extra + ', use_unlim: false } }. Then call jobs_wait with every returned { index, job_id } until all are finished (call it again while any is still running). Never submit a picture twice. Then reply with one line per picture: the id (img…), a space, and its result URL.\n' + reqs, 12000)
            .then(function (g) {
              var subs = g.uses.filter(function (u) { return u.name === 'generate_image_batch'; }), asked = 0;
              subs.forEach(function (u) { asked += (u.input && Array.isArray(u.input.requests)) ? u.input.requests.length : 0; });
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
                return Kin.hf.toData(u, po.max || 1600).then(function (d) { pics[p.id] = { data: d.data, url: u, prompt: p.prompt }; }, function () { notes.push('Picture ' + p.id + ' could not be fetched into the design; its link: ' + u); });
              })).then(function () { return pics; });
            });
        })
        .catch(function (e) {
          if (e && e.hf === 'auth') { notes.push('Higgsfield did not accept the sign-in, so the concepts are drawn instead. Connect it again in settings.'); return {}; }
          if (e && e.hf === 'breach') return {};
          if (isAbort(e)) throw e;
          if (e && e.code === 'timeout') { notes.push(e.message + ' The concepts are drawn instead; Higgsfield may still finish the pictures and count the credits.'); return {}; }
          notes.push('The pictures could not be made (' + String((e && e.message) || e).slice(0, 120) + '); the concepts are drawn instead.'); return {};
        });
    }

    /* ---- the job ---- */
    /* the card's title is the job's own name ("Label for the delta kite"), not its kind */
    function jobName(t) {
      var n = String(t || '').replace(/\s+/g, ' ').trim()
        .replace(/^(hey |ok |okay |hi )?(jarvis|kin)[,.:]?\s*/i, '')
        .replace(/^(can you|could you|would you|will you|please|i need you to|i want you to|go ahead and)\s+/i, '').replace(/^please\s+/i, '')
        .replace(/^(design|make|create|draw|build|mock up|put together|do|come up with|whip up|sketch)\s+(me|us)?\s*/i, '')
        .replace(/^(a|an|the|some)\s+/i, '').replace(/[\s?.!]+$/, '');
      if (n.length < 3) return '';
      if (n.length > 52) n = n.slice(0, 50).replace(/\s+\S*$/, '') + '\u2026';
      return n.charAt(0).toUpperCase() + n.slice(1);
    }
    var jname = jobName(text);
    var brief = null, title = '', items = [], pics = {}, verdict = null;
    /* ONE card before anything is spent: the price, then Go, Go without pictures (when Higgsfield is connected), or Stop */
    var hfLeft = hfOn ? Math.max(0, Math.round((Kin.hf.cap() - Kin.hf.used()) * 100) / 100) : 0;
    var withPics = hfOn && hfLeft > 0, usdDraw = estimate(kit, false), usdPics = estimate(kit, true);
    var posterCredits = POSTER_CREDITS * (POSTER_VARIANTS + 1), usdPoster = posterEstimate(kit);
    var poster = withPics && MARKETING.test(text) && !TOO_FACTUAL.test(text) && hfLeft >= POSTER_CREDITS * POSTER_VARIANTS;
    var card = poster ? { kind: 'job', label: 'Needs your OK', kindName: 'Poster job', title: jname || 'Poster job', price: '$' + usdPoster.toFixed(2), priceNote: 'estimated Claude usage · Opus 5.5', pics: true, route: 'poster',
      lines: ['One idea with the exact copy, rendered whole by Higgsfield\'s image model in ' + POSTER_VARIANTS + ' variants; the art director reads every word in each, picks one, and asks for one refinement render if it falls short.',
        'Credits: about ' + posterCredits + ' (' + POSTER_VARIANTS + ' posters and 1 refinement, about ' + POSTER_CREDITS + ' each), priced before anything is made; at most ' + hfLeft + ' (what is left of today\'s ' + Kin.hf.cap() + ').',
        'The product and artwork in the picture are the image model\'s invention, not your real packaging. It stays a draft until you say go.'],
      say: 'A poster job costs about ' + usdPoster.toFixed(2) + ' dollars and about ' + posterCredits + ' Higgsfield credits, sir. Go, or stop?',
      choices: [{ k: 'poster', label: 'Go', kind: 'go', note: 'The full poster on Higgsfield, priced first.' },
        { k: 'compose', label: 'Compose it instead', kind: 'alt', note: 'About $' + usdPics.toFixed(2) + ': three composed concepts, pictures only where they help.' },
        { k: 'draw', label: 'Go without pictures', kind: 'alt', note: 'About $' + usdDraw.toFixed(2) + ', no Higgsfield credits.' },
        { k: 'stop', label: 'Stop', kind: 'stop', note: 'Nothing is sent and nothing is spent.' }] } : { kind: 'job', label: 'Needs your OK', kindName: 'Design job', title: jname || 'Design job', price: '$' + (withPics ? usdPics : usdDraw).toFixed(2), priceNote: 'estimated Claude usage · Opus 5.5',
      pics: withPics, route: 'compose',
      lines: [withPics ? 'A brief, three concepts, real pictures where they help, a strict art director, and up to three rounds of refinement.' : 'A brief, three drawn concepts, a strict art director, and up to three rounds of refinement.',
        withPics ? 'Pictures: up to 4 on Higgsfield, priced first, at most ' + hfLeft + ' credits (what is left of today\'s ' + Kin.hf.cap() + ').' : hfOn ? 'Pictures: today\'s Higgsfield limit is used up, so the concepts are drawn.' : 'Higgsfield is not connected, so the concepts are drawn.'],
      say: 'A design job costs about ' + (withPics ? usdPics : usdDraw).toFixed(2) + ' dollars, sir. Go, or stop?',
      choices: [{ k: 'go', label: 'Go', kind: 'go', note: withPics ? 'Starts now, with pictures.' : 'Starts now.' }]
        .concat(withPics ? [{ k: 'draw', label: 'Go without pictures', kind: 'alt', note: 'About $' + usdDraw.toFixed(2) + ', no Higgsfield credits.' }] : [])
        .concat([{ k: 'stop', label: 'Stop', kind: 'stop', note: 'Nothing is sent and nothing is spent.' }]) };
    var gate = opts.plan ? opts.plan(card) : Promise.resolve('stop'); /* no one to ask: nothing is spent */
    /* the composed route: a brief, three SVG concepts (pictures where they help), the art director, refinement */
    function composeRoute(k) {
      alive();
      hfOn = withPics && (k === 'go' || k === 'compose'); budget = hfOn ? Math.max(0, Math.round(Math.min(hfLeft - hfCredits, Kin.hf.cap() - Kin.hf.used()) * 100) / 100) : 0;
      onStep('brief'); beat('Writing the brief');
      var books = kit.designPlaybooks(text);
      var user = [{ type: 'text', text: text + '\n\n[Today is ' + kit.today() + '.]' + (books ? '\n\n' + books : '') }];
      var onConcepts = false;
      return toolCall(deep, 'high', kit.system().concat([{ type: 'text', text: conceptRules(hfOn) }]), user, CONCEPTS_TOOL, 64000, 'Drawing three concepts', 'concepts',
        function (js) { if (!onConcepts && /"concepts"\s*:/.test(js)) { onConcepts = true; onStep('concepts'); beat('Drawing three concepts'); } })
        .then(function (input) {
          if (!onConcepts) onStep('concepts');
          brief = input.brief || {}; title = String(input.title || 'Design').slice(0, 120);
          var seen = {}, plan = [];
          items = (input.concepts || []).slice(0, 3).map(function (k) {
            (k.images || []).forEach(function (im) { if (!hfOn || plan.length >= 4 || seen[im.id] || !/^img\d{1,2}$/.test(im.id) || typeof im.prompt !== 'string') return; seen[im.id] = 1; plan.push({ id: im.id, prompt: im.prompt.slice(0, 1200), aspect: ASPECTS.indexOf(im.aspect) >= 0 ? im.aspect : '1:1' }); });
            return { name: String(k.name || '').slice(0, 60), idea: String(k.idea || '').slice(0, 300), src: String(k.svg || '') };
          });
          if (!items.length) throw new Error('No concepts came back.');
          if (plan.length) onStep('pictures');
          return pictures(plan);
        })
        .then(function (p) { pics = p || {}; beat('Measuring the three concepts'); return Promise.all(items.map(function (it) { return prepare(it, pics); })); })
        .then(function () {
          items = items.filter(function (it) { return it.svg; }); if (!items.length) throw new Error('None of the concepts was a usable SVG.');
          onStep('director'); beat('The art director is comparing the concepts'); return judge(brief, items);
        })
        .then(function (v) {
          verdict = v;
          /* the winner by score after the caps; the art director's pick breaks a tie */
          var best = 0; items.forEach(function (it, k) { var a = it.score == null ? -1 : it.score, b = items[best].score == null ? -1 : items[best].score; if (a > b || (a === b && k === v.winner)) best = k; });
          var win = items[best]; win.chosen = true; win.round = 1;
          function refine() {
            if (win.score == null || win.score >= PASS || win.round >= 3) return Promise.resolve(win);
            onStep('refine'); beat('Refining the winner, round ' + (win.round + 1) + ' of 3');
            var asks = (win.checked && win.checked.hard.length ? ['Measured problems, fix all of these first:\n- ' + win.checked.hard.join('\n- ')] : [])
              .concat(win.fixes.length ? ['The art director asks:\n- ' + win.fixes.join('\n- ')] : [])
              .concat(win.caps.indexOf('type only') >= 0 ? ['This is a type-only piece and the brief does not ask for minimalism. Add a real image: ' + (Object.keys(pics).length ? 'use the existing pictures (' + Object.keys(pics).map(function (k) { return 'hf:' + k; }).join(', ') + ') or ' : '') + 'draw an illustration in the SVG.'] : [])
              .concat(win.checked && win.checked.soft.length ? ['Also worth fixing:\n- ' + win.checked.soft.join('\n- ')] : []);
            var u = [{ type: 'text', text: 'Refine this design to an excellent, finished piece (the bar is ' + PASS + ' of 100; it scored ' + win.score + ').\nThe brief: ' + JSON.stringify(brief).slice(0, 3000) + '\nThe concept: ' + win.name + ': ' + win.idea + '\n\n' + asks.join('\n\n') + '\n\nKeep what works' + (win.notes.length ? ' (' + win.notes.join('; ') + ')' : '') + '. Picture references stay as href="hf:imgN". Here is the SVG:\n' + win.src.slice(0, 120000) + '\n\nCall revise_design with the complete revised SVG.' }];
            /* the brief, the three concepts and every critique run on the deep model; a refinement round applies
               concrete fixes, which Opus 5.5 does as well for about half the price */
            return toolCall(kit.MAIN, 'high', kit.system(), u, REVISE_TOOL, 48000, 'Refining the winner', 'refine')
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
              }, function (e) { if (isAbort(e)) throw e; notes.push('A refinement round failed (' + String((e && e.message) || e).slice(0, 100) + ').'); win.round = 3; return win; });
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
          onStep('done');
          return { text: line, model: deep, made: madeIds, studio: true };
        });
    }

    /* the full-poster route: resolves null when no poster could be made, and the composed route takes over */
    function posterRoute() {
      hfOn = true; budget = hfLeft;
      onStep('brief'); beat('Writing the art direction');
      var books = kit.designPlaybooks(text), pb = null, renders = [];
      var user = [{ type: 'text', text: text + '\n\n[Today is ' + kit.today() + '.]' + (books ? '\n\n' + books : '') }];
      function wrap(r, w, h) { return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><image href="' + r.data + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="xMidYMid slice"/></svg>'; }
      function size(aspect) { return aspect === '2:3' ? [1400, 2100] : aspect === '1:1' ? [1080, 1080] : aspect === '9:16' ? [1080, 1920] : [1080, 1350]; }
      /* the art director reads every word in each render against the exact copy */
      function read(list) {
        var content = [];
        list.forEach(function (r, k) {
          content.push({ type: 'text', text: 'Render ' + String.fromCharCode(65 + k) + ' (index ' + k + '): ' + r.name });
          var m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(r.data || '');
          if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
        });
        content.push({ type: 'text', text: 'The exact copy, line by line:\n' + pb.copy.map(function (l) { return '"' + l + '"'; }).join('\n') + '\n\nThe idea: ' + pb.idea });
        var g = guard('director');
        var st = c.beta.messages.stream({ model: deep, max_tokens: 12000, betas: [kit.FALLBACK_BETA], fallbacks: 'default', thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'high' },
          system: kit.system().concat([{ type: 'text', text: POSTER_CRITIC }]), messages: [{ role: 'user', content: content }] }, g.opts), n = 0, jm = meter(st, deep, g);
        st.on('streamEvent', function () { if (++n % 40 === 0) beat('The art director is reading every word'); });
        return st.finalMessage().then(function (m) {
          g.done(); add(m); var j = jsonIn(textOf(m)) || {}, ps = Array.isArray(j.posters) ? j.posters : [];
          list.forEach(function (r, k) {
            var v = ps[k] || {}, sc = typeof v.score === 'number' ? Math.max(0, Math.min(100, Math.round(v.score))) : null;
            r.wrong = (Array.isArray(v.wrong_words) ? v.wrong_words : []).map(String).slice(0, 6); r.wordsOk = v.words_ok === true && !r.wrong.length;
            r.notes = (Array.isArray(v.notes) ? v.notes : []).map(String).slice(0, 3); r.fixes = (Array.isArray(v.fixes) ? v.fixes : []).map(String).slice(0, 4);
            /* a misspelled or invented word fails the piece, whatever else it does well */
            r.score = sc == null ? null : r.wordsOk ? sc : Math.min(sc, 60);
          });
          return String(j.why || '').slice(0, 300);
        }, function (e) { jm.lost(); e = g.fail(e); if (isAbort(e)) throw e; notes.push('The art director could not read the posters (' + String((e && e.message) || e).slice(0, 100) + ').'); list.forEach(function (r) { r.score = null; r.notes = []; r.fixes = []; r.wrong = []; }); return ''; });
      }
      return toolCall(deep, 'high', kit.system().concat([{ type: 'text', text: POSTER_RULES }]), user, POSTER_TOOL, 16000, 'Writing the art direction', 'concepts')
        .then(function (input) {
          pb = { title: String(input.title || 'Poster').slice(0, 120), idea: String(input.idea || '').slice(0, 300), aspect: ['4:5', '2:3', '1:1', '9:16'].indexOf(input.aspect) >= 0 ? input.aspect : '4:5',
            copy: (Array.isArray(input.copy) ? input.copy : []).map(String).filter(Boolean).slice(0, 8), variants: (Array.isArray(input.variants) ? input.variants : []).slice(0, POSTER_VARIANTS) };
          title = pb.title;
          if (input.too_much_copy || !pb.variants.length || !pb.copy.length) { notes.push('This piece carries more exact copy than a picture can hold reliably, so it is composed instead.'); return null; }
          onStep('pictures');
          var plan = pb.variants.map(function (v, k) { return { id: 'img' + (k + 1), name: String(v.name || 'Variant ' + (k + 1)).slice(0, 60), prompt: String(v.prompt || '').slice(0, 3000), aspect: pb.aspect }; });
          return pictures(plan, { params: POSTER_PARAMS, max: 2240 }).then(function (got) {
            renders = plan.filter(function (p) { return got && got[p.id]; }).map(function (p) { return { id: p.id, name: p.name, prompt: p.prompt, data: got[p.id].data, url: got[p.id].url }; });
            if (!renders.length) return null;
            onStep('director'); beat('The art director is reading every word');
            return read(renders).then(function (why) {
              var best = renders.slice().sort(function (a, b) { return (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score); })[0]; best.round = 1; best.why = why;
              if (best.score == null || best.score >= PASS || !best.fixes.length) return best;
              /* one refinement render, with the fixes written as instructions */
              onStep('refine'); beat('Writing the refinement');
              var u = [{ type: 'text', text: 'Rewrite this full-poster prompt so the next render fixes what the art director found. Keep the idea, the exact copy and everything that works; change only what the fixes ask.\n\nThe prompt:\n' + best.prompt +
                '\n\nThe art director scored it ' + best.score + ' of 100.' + (best.wrong.length ? '\nWords that came out wrong: ' + best.wrong.join(', ') + '.' : '') + '\nFixes:\n- ' + best.fixes.join('\n- ') + '\n\nThe exact copy:\n' + pb.copy.map(function (l) { return '"' + l + '"'; }).join('\n') }];
              return toolCall(kit.MAIN, 'medium', kit.system().concat([{ type: 'text', text: POSTER_RULES }]), u, REPROMPT_TOOL, 8000, 'Writing the refinement', 'refine')
                .then(function (r) {
                  var p2 = { id: 'img' + (renders.length + 1), name: best.name + ' (refined)', prompt: String(r.prompt || '').slice(0, 3000), aspect: pb.aspect };
                  if (!p2.prompt) return best;
                  return pictures([p2], { params: POSTER_PARAMS, max: 2240, quiet: true }).then(function (got) {
                    if (!got || !got[p2.id]) return best;
                    var nr = { id: p2.id, name: p2.name, prompt: p2.prompt, data: got[p2.id].data, url: got[p2.id].url };
                    beat('The art director is reading the refinement');
                    return read([nr]).then(function () { renders.push(nr); nr.round = 2; nr.why = best.why; return nr.score != null && nr.score >= (best.score || 0) ? nr : best; });
                  });
                }, function (e) { if (isAbort(e)) throw e; notes.push('The refinement could not be written (' + String((e && e.message) || e).slice(0, 100) + ').'); return best; });
            });
          });
        })
        .then(function (win) {
          if (!win) { onStep('brief'); return null; }
          var wh = size(pb.aspect), others = renders.filter(function (r) { return r !== win; }).map(function (r) { return { name: r.name, idea: pb.idea, svg: wrap(r, wh[0], wh[1]), score: r.score, caps: r.wordsOk ? [] : ['words'], notes: r.notes }; });
          var honest = 'The product and artwork in the picture are the image model\'s invention, not your real packaging.';
          var item = Kin.mind.addMade({ kind: 'design', title: pb.title, note: ['Full poster, ' + pb.aspect + ', ' + wh[0] + ' by ' + wh[1], 'Higgsfield ' + IMAGE_MODEL + ' at xhigh, 2k'].join(' · '),
            content: wrap(win, wh[0], wh[1]), src: win.prompt, brief: { idea: pb.idea, format: pb.aspect + ' full poster', copy: pb.copy.join(' / ') }, concept: { name: win.name, idea: pb.idea }, notes: win.notes, why: win.why || '', caps: win.wordsOk ? [] : ['words'],
            others: others, pictures: renders.map(function (r) { return { id: r.id, prompt: r.prompt, url: r.url }; }), credits: hfCredits, usd: Math.round(spent * 1e4) / 1e4, issues: [honest].concat(notes).slice(0, 6) });
          item = Kin.mind.addMade({ id: item.id, score: win.score, round: win.round, fixes: (win.score != null && win.score < PASS ? win.fixes : []).slice(0, 6) });
          madeIds.push(item.id); if (opts.onMade) opts.onMade(item);
          var s2 = win.score;
          var line = 'The ' + win.name + ' poster won, sir. ' + (s2 == null ? 'The art director could not read it, so check every word yourself.' : 'The art director gave it ' + s2 + ' of 100' + (win.wordsOk ? ', every word checked' : ', but some words came out wrong (' + win.wrong.join(', ') + '); do not use it as it is') + '.') +
            ' It is a draft on your Made shelf with the other renders. ' + honest + ' Nothing is posted until you say so.' + (notes.length ? '\n\n' + notes.join(' ') : '');
          onStep('done');
          return { text: line, model: deep, made: madeIds, studio: true, poster: true };
        });
    }

    return gate.then(function (k) {
      if (k !== 'go' && k !== 'draw' && k !== 'compose' && k !== 'poster') return { text: 'Stopped, sir. Nothing was spent.', declined: true };
      alive();
      if (k !== 'poster') return composeRoute(k);
      /* no poster came of it (too much copy, over the credits, Higgsfield refused). Composing it costs more than the card the
         founder approved, so Kin asks again with the new price; nothing more is spent unless they choose to compose it */
      return posterRoute().then(function (r) {
        if (r) return r; alive();
        var left = Math.max(0, Math.round(Math.min(hfLeft - hfCredits, Kin.hf.cap() - Kin.hf.used()) * 100) / 100), canPics = left > 0 && hfCredits === 0;
        var why = notes.length ? notes[notes.length - 1] : 'No poster came back from Higgsfield.';
        var rc = { kind: 'reroute', label: 'Kin stopped to ask', title: 'The poster could not be made', price: '$' + (canPics ? usdPics : usdDraw).toFixed(2), priceNote: 'more Claude usage to compose it instead · Opus 5.5',
          lines: [why, 'Spent so far: about $' + spent.toFixed(2) + (hfCredits ? ' and ' + hfCredits + ' Higgsfield credits' : '') + '. Nothing more is spent unless you choose to compose it.'],
          say: 'The poster could not be made, sir. Compose it instead for about ' + (canPics ? usdPics : usdDraw).toFixed(2) + ' dollars more, or stop?',
          choices: [{ k: canPics ? 'compose' : 'draw', label: 'Compose it', kind: 'go', note: canPics ? 'Pictures only where they help, at most ' + left + ' credits.' : 'Drawn, no Higgsfield credits.' }]
            .concat(canPics ? [{ k: 'draw', label: 'Without pictures', kind: 'alt', note: 'About $' + usdDraw.toFixed(2) + ', no Higgsfield credits.' }] : [])
            .concat([{ k: 'stop', label: 'Stop the job', kind: 'stop', note: 'Ends the job here. Nothing more is spent.' }]) };
        return (opts.choose ? opts.choose(rc) : Promise.resolve('stop')).then(function (k2) {
          if (k2 !== 'compose' && k2 !== 'draw') throw abortErr();
          alive(); if (opts.onReroute) opts.onReroute('compose'); return composeRoute(k2);
        });
      });
    }).then(function (r) { r.cost = spent; r.route = 'make'; r.credits = hfCredits; return r; },
      function (e) { if (e && typeof e === 'object') e.spent = spent; throw e; });
  }

  Kin.studio = { run: run, estimate: estimate, posterEstimate: posterEstimate, compose: compose, typeOnly: typeOnly, PASS: PASS, TYPE_CAP: TYPE_CAP, MARKETING: MARKETING, POSTER_CREDITS: POSTER_CREDITS };
})();
