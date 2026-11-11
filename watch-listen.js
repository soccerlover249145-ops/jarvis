/* watch-listen.js: Jarvis watches videos and listens to audio.

   Say "watch this video", "listen to this" or "what happens in this clip" and a glass panel opens with
   three ways in: pick a file (video or audio, or drop it on the panel), share a tab or window (a YouTube
   video playing in another tab works, with "Share tab audio" on), or paste a link to a media file.

   How it sees and hears. Claude reads pictures and text, not video or sound, so:
     - Pictures: the page samples frames from the video in the browser. It looks at twice as many moments
       as it keeps and keeps the one in each stretch where the picture changed most (scene changes), so
       a short clip gets a frame every few seconds and a long one still covers the whole length.
     - Sound: the audio (or the whole file, which ElevenLabs accepts) goes to ElevenLabs speech to text
       with the owner's own voice key. It comes back as words with times and speakers.
     - Then Opus 5.5 gets the frames, each labelled with its time, and the timed transcript, and answers
       the question. Follow-up questions reuse the same frames and transcript (prompt caching).

   Cost. Before anything is sent the page works out what the look will cost (Claude tokens for the frames
   and the transcript, plus ElevenLabs minutes). Above the limit (default $0.50) it shows a rounded card:
   Go / Go quicker / Stop. Nothing is sent until then. The spend is reported through opts.onSpend.

   Public surface (window.Kin.watch):
     isRequest(text)            -> true for "watch this", "listen to this", "transcribe this", ...
     support()                  -> { file, screen, record, why }
     open(opts)                 -> shows the panel. opts: { client, sttKey, question, betas, onSpend,
                                   onSave(item), onSay(line), onClose, limit, fetch }
     close()
     analyze(source, opts)      -> Promise<result>, no panel (for a brain tool). source: File|Blob|{ url }
     _                          -> the pure helpers, for tests.

   Privacy: frames and sound go only to Anthropic (the owner's Claude key) and ElevenLabs (the owner's voice
   key). Nothing is stored except what onSave keeps. All model and transcript text is drawn with
   textContent; nothing is parsed as HTML. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var Kin = root.Kin = root.Kin || {};

  var MODEL = 'claude-opus-5-5';
  var PRICE = { in: 4, out: 20, cacheRead: 0.2 };        /* $ per million tokens, Opus 5.5 */
  var STT_PER_HOUR = 0.22;                                /* ElevenLabs Scribe v2, batch, per audio hour */
  var STT_MODEL = 'scribe_v2';
  var STT_HOST = 'https://api.elevenlabs.io';
  var OUT_GUESS = 4500;                                   /* answer plus thinking, tokens, for the estimate */
  var MAX_OUT = 8000;                                     /* the most one answer may write: the worst case the limit is held to */
  var DETAIL = {
    quick:  { name: 'Quick',  every: 10, min: 4, max: 10, edge: 768 },
    normal: { name: 'Normal', every: 5,  min: 6, max: 24, edge: 1024 },
    close:  { name: 'Close',  every: 2,  min: 8, max: 60, edge: 1568 }
  };

  /* ------------------------------------------------------------ pure helpers (tested in node) */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
  }
  function money(usd) { return usd < 0.01 ? 'under 1¢' : usd < 1 ? Math.round(usd * 100) + '¢' : '$' + usd.toFixed(2); }
  /** how many frames to keep for a clip this long, and how big */
  function framePlan(duration, detail) {
    var d = DETAIL[detail] || DETAIL.normal;
    if (!(duration > 0) || !isFinite(duration)) return { n: d.min, edge: d.edge };
    return { n: clamp(Math.round(duration / d.every), Math.min(d.min, Math.max(1, Math.floor(duration))), d.max), edge: d.edge };
  }
  /** twice as many moments as frames kept, evenly spread, never the very first or last instant */
  function candidateTimes(duration, n) {
    var k = n * 2, out = [];
    for (var i = 0; i < k; i++) out.push(+(duration * (i + 0.5) / k).toFixed(3));
    return out;
  }
  /** how different two tiny grey thumbnails are, 0..1 */
  function diff(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    var s = 0; for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / (a.length * 255);
  }
  /** keep n of the candidates: split them into n stretches, keep the most changed moment in each */
  function pickScenes(cands, n) {
    if (cands.length <= n) return cands.slice();
    var scored = cands.map(function (c, i) { return Object.assign({}, c, { change: i ? diff(cands[i - 1].sig, c.sig) : 1 }); });
    var out = [], per = scored.length / n;
    for (var b = 0; b < n; b++) {
      var lo = Math.floor(b * per), hi = Math.max(lo + 1, Math.floor((b + 1) * per)), best = scored[lo];
      for (var j = lo + 1; j < hi; j++) if (scored[j].change > best.change) best = scored[j];
      out.push(best);
    }
    return out;
  }
  function fitSize(w, h, edge) {
    if (!(w > 0 && h > 0)) return { w: edge, h: Math.round(edge * 9 / 16) };
    var s = Math.min(1, edge / Math.max(w, h)); return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  function imageTokens(w, h) { return Math.ceil(w * h / 750); }
  /** what one look will cost. transcriptChars may be unknown (null): then speech is guessed at 200 tokens a minute */
  function estimate(o) {
    var imgs = (o.frames || 0) * imageTokens(o.w || 1024, o.h || 576);
    var mins = (o.duration || 0) / 60;
    var words = o.transcriptChars != null ? Math.ceil(o.transcriptChars / 3.6) : (o.hasAudio ? Math.ceil(mins * 200) : 0);
    var inTok = imgs + words + 1400 + (o.questionChars ? Math.ceil(o.questionChars / 3.6) : 40);
    var claude = (inTok * PRICE.in + (o.low ? OUT_GUESS / 2 : OUT_GUESS) * PRICE.out) / 1e6;
    var stt = o.hasAudio && !o.transcriptKnown ? mins / 60 * STT_PER_HOUR : 0;
    /* worst: every input token at full price (a cache write costs a quarter more) and the whole output allowance */
    var worst = (inTok * PRICE.in * 1.25 + MAX_OUT * PRICE.out) / 1e6 + stt;
    return { tokensIn: inTok, imageTokens: imgs, claude: claude, stt: stt, total: claude + stt, worst: worst };
  }
  /** ElevenLabs words -> lines a person can read: break at a sentence end, a pause, a new speaker, or 22 words */
  function segments(stt) {
    var words = stt && Array.isArray(stt.words) ? stt.words : [], out = [], cur = null, last = null;
    function flush() { if (cur && cur.text.trim()) { cur.text = cur.text.replace(/\s+/g, ' ').trim(); out.push(cur); } cur = null; }
    words.forEach(function (w) {
      if (!w || w.type === 'spacing') { if (cur) cur.text += ' '; return; }
      var text = w.type === 'audio_event' ? '(' + String(w.text || '').replace(/[()]/g, '') + ')' : String(w.text || '');
      var start = +w.start || 0, end = +w.end || start, spk = w.speaker_id || '';
      /* a laugh or applause belongs to the line it follows, however long the pause */
      var ev = w.type === 'audio_event';
      if (cur && (spk !== cur.speaker && !(ev && !spk) || (!ev && last != null && start - last > 1.2) || cur.n >= 22)) flush();
      var prev = out[out.length - 1];
      if (ev && !cur && prev && (prev.speaker === spk || !spk) && start - prev.end < 4) { prev.text += ' ' + text; prev.end = end; last = end; return; }
      if (!cur) cur = { start: start, end: end, speaker: spk, text: '', n: 0 };
      cur.text += (cur.text && !/\s$/.test(cur.text) ? ' ' : '') + text; cur.end = end; cur.n++; last = end;
      if (/[.!?]["')\]]?$/.test(text) && cur.n >= 6) flush();
    });
    flush();
    if (!out.length && stt && stt.text) out.push({ start: 0, end: 0, speaker: '', text: String(stt.text).trim() });
    var names = {}, k = 0;
    out.forEach(function (s) { if (s.speaker && !names[s.speaker]) names[s.speaker] = 'Speaker ' + (++k); s.who = s.speaker ? names[s.speaker] : ''; delete s.n; });
    if (k < 2) out.forEach(function (s) { s.who = ''; });
    return out;
  }
  /** "watch this video" alone is not a question; "watch this and tell me what he says about pricing" is */
  function cleanQuestion(t) {
    t = String(t || '').trim();
    var rest = t.replace(/^(hey |ok |okay )?(jarvis|kin)[, ]*/i, '').replace(/^(can you |could you |please )*(watch|listen to|look at|transcribe)( this| that| the)?( video| clip| audio| recording| tab)?( for me)?[\s,.:;-]*(and )?/i, '').trim();
    return rest.length >= 8 ? rest.charAt(0).toUpperCase() + rest.slice(1) : '';
  }
  function transcriptText(segs) { return segs.map(function (s) { return '[' + fmtTime(s.start) + '] ' + (s.who ? s.who + ': ' : '') + s.text; }).join('\n'); }
  /* only clear asks about a video or a recording: "summarize this document" or "watch out for that" go to the conversation */
  var MEDIA = '(video|clip|film|footage|recording|audio|podcast|voice ?(memo|note)|episode|interview|track|song|screencast|vlog)';
  var LEAD = /^\s*(?:(?:hey |ok |okay )?(?:jarvis|kin)[,.!]*\s*)?(?:(?:can|could|would|will) you |please |go |now )*/i.source;
  var REQ_START = new RegExp(LEAD + '(watch|listen to|transcribe)\\s+(this|that|it|the|my|a|an)\\b(?!\\s+(space|one|out|guy|person|spending|budget|market|stock|price|number))', 'i');
  var REQ_MEDIA = new RegExp('\\b(watch|look at|listen to|transcribe|summari[sz]e|recap|break down|what happens in|what (is|was) said in|what do(es)? (he|she|they) say in)\\b[^.?!]{0,60}\\b' + MEDIA + 's?\\b', 'i');
  function isRequest(text) {
    var t = String(text || '');
    if (/^\s*(?:(?:hey |ok )?(?:jarvis|kin)[,.!]*\s*)?watch out\b/i.test(t)) return false;
    return REQ_START.test(t) || REQ_MEDIA.test(t) || /\b(youtube|youtu\.be)\b/i.test(t) && /\b(watch|summari[sz]e|what|explain)\b/i.test(t);
  }
  var SYSTEM = [
    'You are Kin, the founder\'s assistant, with the manner of a calm, precise British butler. Address the founder as "sir", at most once.',
    'You are watching a video or listening to audio for the founder. You cannot see moving pictures or hear sound directly: you get still frames, each labelled with its time, and a transcript made by speech recognition with times and, when there is more than one voice, speakers.',
    'Rules:',
    '- Ground everything in the frames and the transcript. Name the time ("at 2:14") for each claim that comes from a moment.',
    '- Say what you could not tell: motion between frames, tone of voice, music, anything off screen. If the transcript looks garbled in a stretch, say so instead of guessing.',
    '- Speech recognition can mishear names and numbers. Flag any that matter and look unsure.',
    '- Lead with the answer. Then at most six short bullets with times. No em dashes. Plain words.',
    '- If it is the founder\'s own footage (a taste night, a pitch, a build), finish with the one thing you would change or do next.',
    '- Do not describe people by appearance beyond what the question needs. Never guess who a stranger is.'
  ].join('\n');
  /** the content of the first message: frames with times, then the transcript, then the question */
  function buildContent(meta, frames, segs, question) {
    var c = [{ type: 'text', text: 'Source: ' + (meta.name || 'a clip') + (meta.duration ? ', ' + fmtTime(meta.duration) + ' long' : '') + (meta.kind === 'audio' ? ', sound only' : '') + (meta.live ? ', captured live from a shared ' + (meta.surface || 'screen') : '') + '.' }];
    if (frames.length) {
      c.push({ type: 'text', text: frames.length + ' frames follow, in order. Each is preceded by its time.' });
      frames.forEach(function (f) {
        c.push({ type: 'text', text: '[' + fmtTime(f.t) + ']' });
        c.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: String(f.jpeg).replace(/^data:image\/jpeg;base64,/, '') } });
      });
    }
    c.push({ type: 'text', text: segs.length ? 'Transcript (speech recognition, times in m:ss):\n' + transcriptText(segs) : (meta.heard === false ? 'There is no transcript: the sound was not ' + (meta.heardError ? 'transcribed (' + meta.heardError + ')' : 'sent') + '. Say so if the question needs it.' : 'The transcript is empty: no speech was heard.'), cache_control: { type: 'ephemeral' } });
    c.push({ type: 'text', text: 'Question: ' + (String(question || '').trim() || 'Tell me what this is and what matters in it.') });
    return c;
  }
  function costOf(usage) {
    if (!usage) return 0;
    var its = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations : [usage];
    return its.reduce(function (s, u) { return s + ((u.input_tokens || 0) * PRICE.in + (u.cache_creation_input_tokens || 0) * PRICE.in * 1.25 + (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.output_tokens || 0) * PRICE.out) / 1e6; }, 0);
  }
  function sttError(status, body) {
    var d = body && body.detail, code = String(d && (d.code || d.status) || ''), msg = String(d && d.message || (typeof d === 'string' ? d : '') || '');
    if (!status) return 'ElevenLabs could not be reached.';
    if (/missing_permissions/.test(code + msg)) return 'The voice key is not allowed to transcribe. In ElevenLabs, give the key Speech to Text access.';
    if (status === 401) return 'ElevenLabs refused the voice key.';
    if (status === 402 || /quota|credit|limit_reached/.test(code + msg)) return 'The ElevenLabs account is out of credit.';
    if (status === 413) return 'That file is too big for ElevenLabs.';
    if (status === 429) return 'ElevenLabs is busy. Try again in a minute.';
    if (status === 422 || status === 400) return 'ElevenLabs could not read that file' + (msg ? ': ' + msg.slice(0, 120) : '.');
    return 'ElevenLabs did not transcribe it' + (msg ? ': ' + msg.slice(0, 120) : '.');
  }

  /* ------------------------------------------------------------ browser pieces */
  function support() {
    var nav = root.navigator || {}, md = nav.mediaDevices;
    var screen = !!(md && typeof md.getDisplayMedia === 'function'), record = typeof root.MediaRecorder === 'function';
    var why = screen ? '' : /iPhone|iPad/.test(nav.userAgent || '') ? 'An iPhone cannot share its screen with a web page. Pick a file instead.' : 'This browser cannot share a tab. Chrome or Edge can.';
    return { file: true, screen: screen && record, record: record, why: why };
  }
  function wait(el, ev, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { off(); rej(new Error('The ' + (ev === 'seeked' ? 'video would not move to that moment' : 'file would not open') + '.')); }, ms || 15000);
      function ok() { off(); res(); } function bad() { off(); rej(new Error('This browser cannot play that file. MP4, MOV, WebM, MP3, M4A and WAV usually work.')); }
      function off() { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); }
      el.addEventListener(ev, ok); el.addEventListener('error', bad);
    });
  }
  /** open a File/Blob or URL as a <video>; works out its real length (recorded WebM reports Infinity) */
  function openMedia(src) {
    var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    var isBlob = typeof Blob !== 'undefined' && src instanceof Blob, url = isBlob ? URL.createObjectURL(src) : String(src.url || src);
    v.src = url;
    return wait(v, 'loadedmetadata', 20000).then(function () {
      if (isFinite(v.duration) && v.duration > 0) return;
      v.currentTime = 1e7; return wait(v, 'seeked', 8000).catch(function () {}).then(function () { v.currentTime = 0; });
    }).then(function () {
      var mime = isBlob ? String(src.type || '') : '', audioOnly = /^audio\//.test(mime) || !(v.videoWidth > 0);
      return { el: v, url: url, revoke: isBlob ? function () { URL.revokeObjectURL(url); } : function () {}, duration: isFinite(v.duration) ? v.duration : 0, w: v.videoWidth, h: v.videoHeight, kind: audioOnly ? 'audio' : 'video', name: isBlob ? (src.name || 'recording') : url.split(/[?#]/)[0].split('/').pop() || 'link' };
    });
  }
  function signature(src, tiny) {
    var x = tiny.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, tiny.width, tiny.height);
    var d = x.getImageData(0, 0, tiny.width, tiny.height).data, g = new Array(tiny.width * tiny.height);
    for (var i = 0; i < g.length; i++) g[i] = Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
    return g;
  }
  function grabAt(m, t, size, canvas, tiny) {
    m.el.currentTime = Math.min(Math.max(0, t), Math.max(0, m.duration - 0.05));
    return wait(m.el, 'seeked', 10000).then(function () {
      canvas.width = size.w; canvas.height = size.h;
      var c = canvas.getContext('2d'); c.drawImage(m.el, 0, 0, size.w, size.h);
      var jpeg;
      try { jpeg = canvas.toDataURL('image/jpeg', 0.8); } catch (e) { throw new Error('That site does not let a web page read its video. Download the file and pick it, or share the tab instead.'); }
      return { t: t, jpeg: jpeg, sig: signature(canvas, tiny) };
    });
  }
  /** sample a video: look at 2n moments, keep n (one per stretch, where the picture changed most) */
  function sampleFrames(m, detail, onFrame, signal) {
    var plan = framePlan(m.duration, detail), size = fitSize(m.w, m.h, plan.edge), times = candidateTimes(m.duration, plan.n);
    var canvas = document.createElement('canvas'), tiny = document.createElement('canvas'); tiny.width = 16; tiny.height = 9;
    var cands = [], i = 0;
    function next() {
      if (signal && signal.aborted) return Promise.reject(abortErr());
      if (i >= times.length) return Promise.resolve(pickScenes(cands, plan.n).map(function (c) { return { t: c.t, jpeg: c.jpeg, w: size.w, h: size.h }; }));
      return grabAt(m, times[i++], size, canvas, tiny).then(function (f) { cands.push(f); if (onFrame) onFrame(f, i, times.length); return next(); });
    }
    return next();
  }
  function abortErr() { var e = new Error('Stopped.'); e.name = 'AbortError'; return e; }
  /** send sound (or a whole video file) to ElevenLabs speech to text */
  function transcribe(blob, name, key, opt) {
    opt = opt || {};
    var f = opt.fetch || root.fetch.bind(root), fd = new FormData();
    fd.append('model_id', STT_MODEL); fd.append('diarize', 'true'); fd.append('tag_audio_events', 'true'); fd.append('timestamps_granularity', 'word');
    fd.append('file', blob, name || 'audio.webm');
    return f(STT_HOST + '/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd, signal: opt.signal }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return null; }).then(function (b) { throw new Error(sttError(r.status, b)); });
      return r.json();
    }, function (e) { if (e && e.name === 'AbortError') throw e; throw new Error(sttError(0)); });
  }
  /** share a tab or window: sample frames live, record its sound, until stopped or maxSec */
  function capture(opt) {
    var nav = root.navigator, every = opt.every || 5, maxSec = opt.maxSec || 300;
    return nav.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: true, systemAudio: 'include', selfBrowserSurface: 'exclude' }).then(function (stream) {
      var vt = stream.getVideoTracks()[0], ats = stream.getAudioTracks(), surface = vt && vt.getSettings && vt.getSettings().displaySurface || 'screen';
      var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream;
      var rec = null, chunks = [], frames = [], t0 = Date.now(), timer = null, done = false;
      var canvas = document.createElement('canvas'), tiny = document.createElement('canvas'); tiny.width = 16; tiny.height = 9;
      if (ats.length && typeof root.MediaRecorder === 'function') {
        var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].filter(function (m) { return !root.MediaRecorder.isTypeSupported || root.MediaRecorder.isTypeSupported(m); })[0];
        try { rec = new root.MediaRecorder(new MediaStream(ats), mime ? { mimeType: mime } : undefined); rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); }; rec.start(1000); } catch (e) { rec = null; }
      }
      var api = { stream: stream, video: v, surface: surface, hasAudio: !!rec, frames: frames, elapsed: function () { return (Date.now() - t0) / 1000; } };
      api.done = new Promise(function (res) {
        function snap() {
          if (done || !(v.videoWidth > 0)) return;
          var size = fitSize(v.videoWidth, v.videoHeight, (DETAIL[opt.detail] || DETAIL.normal).edge); canvas.width = size.w; canvas.height = size.h;
          canvas.getContext('2d').drawImage(v, 0, 0, size.w, size.h);
          var f = { t: api.elapsed(), jpeg: canvas.toDataURL('image/jpeg', 0.8), sig: signature(canvas, tiny), w: size.w, h: size.h };
          var prev = frames[frames.length - 1];
          /* a still screen is not worth a frame: keep one when the picture moved, or every 30 s anyway */
          if (!prev || diff(prev.sig, f.sig) > 0.02 || f.t - prev.t >= 30) { frames.push(f); if (opt.onFrame) opt.onFrame(f, frames.length); }
          /* over 60: keep every other one, so the whole share stays covered, not just its end */
          if (frames.length > 60) { var kept = frames.filter(function (x, i) { return i % 2 === 0 || i === frames.length - 1; }); frames.length = 0; [].push.apply(frames, kept); }
        }
        api.stop = function () {
          if (done) return; snap(); done = true; clearInterval(timer);
          var fin = function () { stream.getTracks().forEach(function (t) { t.stop(); }); res({ frames: frames.map(function (f) { return { t: f.t, jpeg: f.jpeg, w: f.w, h: f.h }; }), audio: chunks.length ? new Blob(chunks, { type: chunks[0].type || 'audio/webm' }) : null, duration: api.elapsed(), surface: surface }); };
          if (rec && rec.state !== 'inactive') { rec.onstop = fin; try { rec.stop(); } catch (e) { fin(); } } else fin();
        };
        v.play().catch(function () {}).then(function () { setTimeout(snap, 1200); });
        timer = setInterval(function () { snap(); if (opt.onTick) opt.onTick(api.elapsed()); if (api.elapsed() >= maxSec) api.stop(); }, every * 1000);
        if (vt) vt.addEventListener('ended', function () { api.stop(); });
      });
      return api;
    });
  }
  /** ask Opus 5.5. messages are kept for follow-ups. Resolves { text, cost, model } */
  function askClaude(client, messages, opt) {
    if (!client) return Promise.reject(new Error('Add your Claude key in Settings first.'));
    /* the page's own hourly and daily limits on questions to Claude apply here too */
    var no = opt.gate ? opt.gate() : ''; if (no) return Promise.reject(new Error(no));
    var params = { model: MODEL, max_tokens: MAX_OUT, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: opt.effort || 'medium' }, system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], messages: messages };
    var s;
    if (opt.betas && opt.betas.length && client.beta) { params.betas = opt.betas; params.fallbacks = 'default'; s = client.beta.messages.stream(params, { signal: opt.signal }); }
    else s = client.messages.stream(params, { signal: opt.signal });
    if (opt.onThinking && s.on) s.on('thinking', function (d, snap) { var t = String(snap || '').trim().split(/\n+/).pop(); if (t) opt.onThinking(t.slice(0, 160)); });
    if (opt.onText && s.on) s.on('text', function (d, snap) { opt.onText(snap); });
    return s.finalMessage().then(function (m) {
      var cost = costOf(m.usage);
      if (m.stop_reason === 'refusal') return { text: 'I would rather not go into that one, sir.', cost: cost, model: m.model, refused: true };
      var text = (m.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim();
      return { text: text || 'I could not make anything of it, sir.', cost: cost, model: m.model, cut: m.stop_reason === 'max_tokens', content: m.content };
    });
  }

  /* ------------------------------------------------------------ the look itself (no panel) */
  /** prepare: open the media, sample frames. Returns a look you can price, then run. */
  function prepare(source, opt) {
    opt = opt || {};
    if (source && source.live) return Promise.resolve({ meta: { name: 'shared ' + source.live.surface, duration: source.live.duration, kind: source.live.frames.length ? 'video' : 'audio', live: true, surface: source.live.surface }, frames: source.live.frames, audio: source.live.audio, audioName: 'tab-audio.webm' });
    return openMedia(source).then(function (m) {
      var meta = { name: m.name, duration: m.duration, kind: m.kind, w: m.w, h: m.h };
      var frames = m.kind === 'video' ? sampleFrames(m, opt.detail, opt.onFrame, opt.signal) : Promise.resolve([]);
      return frames.then(function (fr) { m.revoke(); return { meta: meta, frames: fr, audio: typeof Blob !== 'undefined' && source instanceof Blob ? source : null, audioName: meta.name }; }, function (e) { m.revoke(); throw e; });
    });
  }
  function price(look, question, sttKey, low) {
    var f = look.frames[0] || {};
    return estimate({ low: !!low, frames: look.frames.length, w: f.w, h: f.h, duration: look.meta.duration, hasAudio: !!(look.audio && sttKey), questionChars: String(question || '').length });
  }
  /** transcribe (when there is sound and a key) and ask. Resolves the full result. */
  function run(look, question, opt) {
    opt = opt || {};
    /* the limits are checked (and the question counted) before anything is sent, sound included */
    var no = opt.gate ? opt.gate() : ''; if (no) return Promise.reject(new Error(no));
    opt = Object.assign({}, opt, { gate: null });
    var heard = !!(look.audio && opt.sttKey);
    if (opt.onStep) opt.onStep(heard ? 'hear' : 'think');
    if (heard && look.audio.size > 1e9) { heard = false; look.meta.heardError = 'The sound was not sent: the file is over 1 GB.'; }
    var stt = heard ? transcribe(look.audio, look.audioName, opt.sttKey, { fetch: opt.fetch, signal: opt.signal }).catch(function (e) {
      /* a failed transcript should not waste the frames: carry on with pictures only, and say why */
      if (e && e.name === 'AbortError') throw e; if (!look.frames.length) throw e;
      heard = false; look.meta.heardError = e && e.message || 'The sound could not be transcribed.'; return null;
    }) : Promise.resolve(null);
    return stt.then(function (j) {
      var segs = j ? segments(j) : [], sttCost = heard ? (look.meta.duration || 0) / 3600 * STT_PER_HOUR : 0;
      if (sttCost && opt.onSttCost) opt.onSttCost(sttCost);
      look.meta.heard = heard; look.segments = segs; look.language = j && j.language_code || '';
      if (opt.onStep) opt.onStep('think', { segments: segs });
      look.messages = [{ role: 'user', content: buildContent(look.meta, look.frames, segs, question) }];
      return askClaude(opt.client, look.messages, opt).then(function (r) {
        look.messages.push({ role: 'assistant', content: (r.content || [{ type: 'text', text: r.text }]).filter(function (b) { return b.type === 'text' || b.type === 'thinking' || b.type === 'redacted_thinking'; }) });
        return { text: r.text, cost: r.cost + sttCost, sttCost: sttCost, segments: segs, frames: look.frames, meta: look.meta, refused: r.refused, cut: r.cut, look: look };
      });
    });
  }
  /** a follow-up question about the same look: same frames and transcript, read from the cache */
  function followUp(look, question, opt) {
    look.messages.push({ role: 'user', content: [{ type: 'text', text: String(question) }] });
    return askClaude(opt.client, look.messages, opt).then(function (r) {
      look.messages.push({ role: 'assistant', content: (r.content || [{ type: 'text', text: r.text }]).filter(function (b) { return b.type === 'text' || b.type === 'thinking' || b.type === 'redacted_thinking'; }) });
      return r;
    }, function (e) { look.messages.pop(); throw e; });
  }
  function analyze(source, opt) {
    opt = opt || {};
    return prepare(source, opt).then(function (look) {
      var est = price(look, opt.question, opt.sttKey), limit = opt.limit != null ? opt.limit : 0.5;
      if (est.total > limit && !opt.approved) { var e = new Error('This look would cost about ' + money(est.total) + ', over the ' + money(limit) + ' limit.'); e.code = 'cost'; e.estimate = est; throw e; }
      return run(look, opt.question, opt);
    });
  }

  /* ------------------------------------------------------------ the panel */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function icon(d) { var s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); d.split('|').forEach(function (p) { var e = document.createElementNS(SVGNS, 'path'); e.setAttribute('d', p); s.appendChild(e); }); return s; }
  var I = {
    file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z|M14 3v5h5|M10 11.5v5l4-2.5z',
    tab: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|M8 21h8|M12 18v3',
    link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1|M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
    close: 'M6 6l12 12|M18 6L6 18', stop: 'M7 7h10v10H7z', send: 'M5 12h13|M13 6l6 6-6 6', copy: 'M9 9h10v10H9z|M5 15V5h10', save: 'M5 4h11l3 3v13H5z|M8 4v5h7V4|M8 20v-6h8v6'
  };
  /** answers come back as light Markdown; show paragraphs and bullets, bold as plain text. Never as HTML. */
  function renderAnswer(el, text) {
    el.textContent = '';
    var list = null;
    String(text || '').split(/\n/).forEach(function (line) {
      var t = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/, '').trimEnd();
      var m = t.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) { if (!list) { list = h('ul', 'wl-ul'); el.appendChild(list); } var li = h('li'); stamp(li, m[1]); list.appendChild(li); return; }
      list = null; if (t.trim()) { var p = h('p'); stamp(p, t); el.appendChild(p); }
    });
  }
  /* "at 2:14" becomes a little time pill the founder can tap to see that frame */
  var stampHook = null;
  function stamp(el, text) {
    var re = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g, at = 0, m;
    while ((m = re.exec(text))) {
      el.appendChild(document.createTextNode(text.slice(at, m.index)));
      var b = h('button', 'wl-ts', m[1]); b.type = 'button'; (function (ts) { b.addEventListener('click', function () { if (stampHook) stampHook(ts); }); })(m[1]);
      el.appendChild(b); at = m.index + m[0].length;
    }
    el.appendChild(document.createTextNode(text.slice(at)));
  }
  function secs(ts) { return ts.split(':').reduce(function (a, b) { return a * 60 + (+b); }, 0); }

  var cur = null;
  function close() {
    if (!cur) return; var c = cur; cur = null;
    if (c.ac) try { c.ac.abort(); } catch (e) {}
    if (c.live && c.live.stop) try { c.live.stop(); } catch (e) {}
    document.removeEventListener('keydown', c.key);
    c.el.classList.add('wl-hide'); setTimeout(function () { c.el.remove(); }, 320);
    if (c.opts.onClose) c.opts.onClose();
  }
  function open(opts) {
    close(); opts = opts || {};
    var sup = support(), limit = opts.limit != null ? opts.limit : 0.5, spent = 0, detail = 'normal';
    var el = h('div', 'wl'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Watch and listen');
    var panel = h('div', 'wl-panel'); panel.tabIndex = -1; el.appendChild(panel);
    if (opts.test) panel.appendChild(h('span', 'wl-test', 'Test data'));
    var head = h('div', 'wl-head'), ht = h('div');
    ht.appendChild(h('div', 'wl-eyebrow', 'Watch & listen'));
    var title = h('h2', 'wl-title', 'What shall I watch, sir?'); ht.appendChild(title);
    var lede = h('div', 'wl-lede', 'A video, a voice memo, a podcast or a tab you are playing. I look at the pictures, read what is said, and answer.'); ht.appendChild(lede);
    head.appendChild(ht);
    var x = h('button', 'wl-pill wl-icon'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.appendChild(icon(I.close)); x.addEventListener('click', close); head.appendChild(x);
    panel.appendChild(head);
    var body = h('div', 'wl-body'); panel.appendChild(body);
    var c = cur = { el: el, opts: opts, ac: null, live: null, look: null };
    c.key = function (e) { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', c.key);

    /* ---- step 1: the question and the source */
    function chooser(msg) {
      body.textContent = ''; title.textContent = 'What shall I watch, sir?'; lede.hidden = false;
      var q = h('div', 'wl-ask');
      var qi = h('textarea', 'wl-q'); qi.rows = 2; qi.maxLength = 600; qi.placeholder = 'What do you want to know? Leave it empty for a summary.'; qi.value = cleanQuestion(opts.question);
      q.appendChild(h('label', 'wl-label', 'Your question')); q.appendChild(qi);
      var seg = h('div', 'wl-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'How closely to look');
      Object.keys(DETAIL).forEach(function (k) {
        var b = h('button', 'wl-segb' + (k === detail ? ' wl-on' : ''), DETAIL[k].name); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === detail));
        b.addEventListener('click', function () { detail = k; [].forEach.call(seg.children, function (s) { s.classList.toggle('wl-on', s === b); s.setAttribute('aria-checked', String(s === b)); }); });
        seg.appendChild(b);
      });
      var row = h('div', 'wl-row'); row.appendChild(h('span', 'wl-label', 'How closely')); row.appendChild(seg); q.appendChild(row);
      body.appendChild(q);

      var grid = h('div', 'wl-sources');
      var fileIn = h('input'); fileIn.type = 'file'; fileIn.accept = 'video/*,audio/*'; fileIn.hidden = true;
      function src(ic, name, sub, on, disabled, why) {
        var b = h('button', 'wl-src'); b.type = 'button'; b.disabled = !!disabled;
        var i = h('span', 'wl-srci'); i.appendChild(icon(ic)); b.appendChild(i);
        var t = h('span', 'wl-srct'); t.appendChild(h('b', null, name)); t.appendChild(h('span', null, disabled ? why : sub)); b.appendChild(t);
        b.addEventListener('click', on); grid.appendChild(b); return b;
      }
      src(I.file, 'Pick a file', 'Video or audio from this device. Or drop it here.', function () { fileIn.click(); });
      src(I.tab, 'Share a tab', 'A YouTube video in another tab works. Turn on "Share tab audio".', function () { startLive(qi.value); }, !sup.screen, sup.why);
      var linkB = src(I.link, 'Paste a link', 'A link straight to a media file (.mp4, .mp3).', function () { linkRow.hidden = false; li.focus(); });
      body.appendChild(grid); body.appendChild(fileIn);
      var linkRow = h('div', 'wl-linkrow'); linkRow.hidden = true;
      var li = h('input', 'wl-in'); li.type = 'url'; li.placeholder = 'https://…/clip.mp4'; li.setAttribute('aria-label', 'Link to a media file');
      var go = h('button', 'wl-pill wl-primary', 'Watch'); go.type = 'button';
      go.addEventListener('click', function () {
        var u = li.value.trim();
        if (/youtu\.?be|vimeo\.com|tiktok\.com|instagram\.com/i.test(u)) { note.textContent = 'That is a page, not a file, and those sites do not hand their video to other pages. Play it in a tab and choose Share a tab.'; note.hidden = false; return; }
        if (!/^https:\/\//i.test(u)) { note.textContent = 'Paste a link that starts with https://.'; note.hidden = false; return; }
        begin({ url: u }, qi.value);
      });
      linkRow.appendChild(li); linkRow.appendChild(go); body.appendChild(linkRow);
      var note = h('div', 'wl-note' + (msg ? ' wl-bad' : ''), msg || ''); note.hidden = !msg; body.appendChild(note);
      fileIn.addEventListener('change', function () { if (fileIn.files[0]) begin(fileIn.files[0], qi.value); });
      el.ondragover = function (e) { e.preventDefault(); el.classList.add('wl-drop'); };
      el.ondragleave = function () { el.classList.remove('wl-drop'); };
      el.ondrop = function (e) { e.preventDefault(); el.classList.remove('wl-drop'); var f = e.dataTransfer && e.dataTransfer.files[0]; if (f && /^(video|audio)\//.test(f.type)) begin(f, qi.value); };
      var foot = h('div', 'wl-fine', 'Pictures go to Claude and sound to ElevenLabs, each with your own key. Nothing else leaves this device.' + (opts.sttKey ? '' : ' No voice key is saved, so I can only look, not listen.'));
      body.appendChild(foot);
      linkB.setAttribute('aria-controls', 'wl-link');
      setTimeout(function () { qi.focus(); }, 60);
    }

    /* ---- step 2: working */
    var steps, strip, thinkLine, stopB;
    function working(name) {
      body.textContent = ''; lede.hidden = true; title.textContent = name;
      steps = h('ol', 'wl-steps');
      [['look', 'Looking'], ['hear', 'Listening'], ['think', 'Thinking']].forEach(function (s) { var li = h('li', 'wl-step'); li.dataset.step = s[0]; li.appendChild(h('i')); li.appendChild(h('span', null, s[1])); steps.appendChild(li); });
      body.appendChild(steps);
      strip = h('div', 'wl-strip'); body.appendChild(strip);
      thinkLine = h('div', 'wl-think'); thinkLine.setAttribute('aria-live', 'polite'); body.appendChild(thinkLine);
      var bar = h('div', 'wl-bar'); stopB = h('button', 'wl-pill', null); stopB.type = 'button'; stopB.appendChild(icon(I.stop)); stopB.appendChild(document.createTextNode('Stop'));
      stopB.addEventListener('click', function () { if (c.ac) c.ac.abort(); chooser('Stopped. Nothing more was sent.'); }); bar.appendChild(stopB); body.appendChild(bar);
    }
    function step(name, skip) {
      var hit = false; [].forEach.call(steps.children, function (li) {
        if (li.dataset.step === name) { hit = true; li.className = 'wl-step wl-now'; }
        else if (!hit) li.className = 'wl-step ' + (li.classList.contains('wl-skip') || (skip && skip[li.dataset.step]) ? 'wl-skip' : 'wl-done');
      });
    }
    function thumb(f, big) {
      var fig = h('figure', 'wl-frame' + (big ? ' wl-big' : '')); var img = h('img'); img.src = f.jpeg; img.alt = 'Frame at ' + fmtTime(f.t); fig.appendChild(img);
      fig.appendChild(h('figcaption', null, fmtTime(f.t))); fig.dataset.t = f.t; return fig;
    }

    function begin(source, question) {
      c.ac = new AbortController(); var sig = c.ac.signal; spent = 0;
      working(source.live ? 'Reading what I saw' : 'Watching ' + (source.name || 'the clip')); step('look');
      prepare(source, { detail: detail, signal: sig, onFrame: function (f, i, n) { if (!strip.childNodes.length || i % 2 === 0) { var t = thumb(f); strip.appendChild(t); while (strip.childNodes.length > 14) strip.removeChild(strip.firstChild); } thinkLine.textContent = 'Looking at moment ' + i + ' of ' + n; } })
        .then(function (look) {
          if (sig.aborted) return;
          c.look = look; strip.textContent = ''; look.frames.forEach(function (f) { strip.appendChild(thumb(f)); });
          thinkLine.textContent = look.frames.length ? 'Kept ' + look.frames.length + ' frames' + (look.meta.duration ? ' across ' + fmtTime(look.meta.duration) : '') + '.' : 'Sound only.';
          var est = price(look, question, opts.sttKey);
          if (est.worst > limit) return confirm(look, question, est);
          return go(look, question);
        })
        .catch(fail);
    }
    function confirm(look, question, est) {
      var card = h('div', 'wl-cost'); card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-label', 'Cost check');
      card.appendChild(h('div', 'wl-eyebrow', 'Before I send it'));
      card.appendChild(h('div', 'wl-costbig', 'About ' + money(est.total)));
      card.appendChild(h('div', 'wl-costsub', look.frames.length + ' frames and ' + (look.audio && opts.sttKey ? fmtTime(look.meta.duration) + ' of sound' : 'no sound') + '. Claude ' + money(est.claude) + (est.stt ? ', ElevenLabs ' + money(est.stt) : '') + '. At most ' + money(est.worst) + '; your limit is ' + money(limit) + '.'));
      /* quicker: at most 6 frames and a lighter think; offered only when it saves a real share */
      var quick = look.frames.length > 6 ? look.frames.filter(function (f, i) { return i % Math.ceil(look.frames.length / 6) === 0; }) : look.frames;
      var qe = price({ frames: quick, meta: look.meta, audio: look.audio }, question, opts.sttKey, true);
      if (qe.total > est.total * 0.8) quick = null;
      var qlabel = quick ? 'Go quicker · ' + money(qe.total) : '';
      [].forEach.call(steps.children, function (li) { if (li.dataset.step === 'look') li.className = 'wl-step wl-done'; });
      var row = h('div', 'wl-bar');
      var g = h('button', 'wl-pill wl-primary', 'Go'); g.type = 'button'; g.addEventListener('click', function () { card.remove(); go(look, question); }); row.appendChild(g);
      if (quick) { var gq = h('button', 'wl-pill', qlabel); gq.type = 'button'; gq.addEventListener('click', function () { card.remove(); look.frames = quick; strip.textContent = ''; quick.forEach(function (f) { strip.appendChild(thumb(f)); }); go(look, question, true); }); row.appendChild(gq); }
      var s = h('button', 'wl-pill wl-ghost', 'Stop'); s.type = 'button'; s.addEventListener('click', function () { chooser('Stopped before anything was sent.'); }); row.appendChild(s);
      card.appendChild(row); body.insertBefore(card, stopB.parentNode); stopB.parentNode.hidden = true; g.focus();
    }
    function go(look, question, low) {
      if (stopB) stopB.parentNode.hidden = false;
      var sig = c.ac.signal, skip = { hear: !(look.audio && opts.sttKey) };
      var sttTold = 0;
      return run(look, question, { effort: low ? 'low' : 'medium', client: opts.client, sttKey: opts.sttKey, fetch: opts.fetch, betas: opts.betas, signal: sig, gate: opts.gate,
        onSttCost: function (v) { sttTold = v; spent += v; if (opts.onSpend) opts.onSpend(v); },
        onStep: function (s, info) { step(s, skip); if (s === 'hear') thinkLine.textContent = 'Listening to ' + (look.meta.duration ? fmtTime(look.meta.duration) + ' of sound' : 'the sound'); if (s === 'think') thinkLine.textContent = info && info.segments ? (info.segments.length ? 'Heard ' + info.segments.length + ' lines. Thinking.' : 'No speech heard. Thinking.') : 'Thinking.'; },
        onThinking: function (t) { thinkLine.textContent = t; } })
        .then(function (r) { var rest = r.cost - sttTold; spent += rest; if (opts.onSpend) opts.onSpend(rest); if (sig.aborted) return; result(r, question); })
        .catch(fail);
    }
    function fail(e) {
      if (!cur || cur !== c) return;
      if (e && e.name === 'AbortError') return;
      var msg = e && e.message || 'Something went wrong.';
      if (e && e.status === 401) msg = 'Claude refused the key. Check it in Settings.';
      chooser(msg);
    }

    /* ---- step 3: the answer */
    function result(r, question) {
      body.textContent = ''; title.textContent = r.meta.name ? 'On ' + r.meta.name : 'What I saw';
      lede.hidden = false; lede.textContent = [r.meta.duration ? fmtTime(r.meta.duration) : '', r.frames.length ? r.frames.length + ' frames' : 'sound only', r.segments.length ? r.segments.length + ' lines heard' : (r.meta.heard ? 'no speech heard' : 'not listened to'), money(r.cost)].filter(Boolean).join('  ·  ');
      var grid = h('div', 'wl-result');
      var ans = h('div', 'wl-card wl-answer'); ans.appendChild(h('div', 'wl-h', question && question.trim() ? 'Your question' : 'Summary'));
      if (question && question.trim()) ans.appendChild(h('div', 'wl-qecho', question.trim()));
      var at = h('div', 'wl-text'); renderAnswer(at, r.text); ans.appendChild(at);
      if (r.cut) ans.appendChild(h('div', 'wl-note', 'The answer was cut short. Ask me to carry on.'));
      if (r.meta.heardError) ans.appendChild(h('div', 'wl-note wl-warn', r.meta.heardError + ' I answered from the pictures only.'));
      var more = h('form', 'wl-more'); var mi = h('input', 'wl-in'); mi.placeholder = 'Ask more about it'; mi.maxLength = 600; mi.setAttribute('aria-label', 'Ask more about it');
      var mb = h('button', 'wl-pill wl-primary wl-icon'); mb.type = 'submit'; mb.setAttribute('aria-label', 'Ask'); mb.appendChild(icon(I.send));
      more.appendChild(mi); more.appendChild(mb); ans.appendChild(more);
      var thread = h('div', 'wl-thread'); ans.insertBefore(thread, more);
      /* each follow-up is held to the same limit: past it, one tap on "Ask anyway" allows that one question */
      var pass = false, warn = null;
      function followWorst() { var f = r.frames[0] || {}; var e = estimate({ frames: r.frames.length, w: f.w, h: f.h, transcriptChars: transcriptText(r.segments).length, questionChars: 600 }); return e.worst + (r.look.messages.length - 1) * 2000 * PRICE.in * 1.25 / 1e6; }
      more.addEventListener('submit', function (e) {
        e.preventDefault(); var q = mi.value.trim(); if (!q || mb.disabled) return;
        if (warn) { warn.remove(); warn = null; }
        var fw = followWorst();
        if (!pass && spent + fw > limit) {
          warn = h('div', 'wl-cost wl-costmini'); warn.setAttribute('role', 'alertdialog'); warn.setAttribute('aria-label', 'Cost check');
          warn.appendChild(h('div', 'wl-costsub', 'So far ' + money(spent) + ' on this clip. Another answer could cost up to ' + money(fw) + ', past your ' + money(limit) + ' limit.'));
          var wr = h('div', 'wl-bar'); var ok = h('button', 'wl-pill wl-primary', 'Ask anyway'); ok.type = 'button';
          ok.addEventListener('click', function () { pass = true; warn.remove(); warn = null; more.requestSubmit ? more.requestSubmit() : more.dispatchEvent(new Event('submit', { cancelable: true })); });
          var no = h('button', 'wl-pill wl-ghost', 'Not now'); no.type = 'button'; no.addEventListener('click', function () { warn.remove(); warn = null; });
          wr.appendChild(ok); wr.appendChild(no); warn.appendChild(wr); ans.insertBefore(warn, more); ok.focus(); return;
        }
        pass = false;
        mi.value = ''; mb.disabled = true; var qa = h('div', 'wl-qa'); qa.appendChild(h('div', 'wl-qecho', q)); var a = h('div', 'wl-text wl-wait', 'Thinking'); qa.appendChild(a); thread.appendChild(qa);
        c.ac = new AbortController();
        followUp(r.look, q, { client: opts.client, betas: opts.betas, gate: opts.gate, signal: c.ac.signal, onThinking: function (t) { a.textContent = t; } }).then(function (x) {
          a.classList.remove('wl-wait'); renderAnswer(a, x.text); spent += x.cost; if (opts.onSpend) opts.onSpend(x.cost); mb.disabled = false; mi.focus();
          lede.textContent = lede.textContent.replace(/[^·]*$/, ' ' + money(spent));
        }, function (err) { a.classList.remove('wl-wait'); a.textContent = err && err.name === 'AbortError' ? 'Stopped.' : (err && err.message || 'That did not work.'); mb.disabled = false; });
      });
      grid.appendChild(ans);

      var side = h('div', 'wl-side');
      var big = null;
      if (r.frames.length) {
        var fc = h('div', 'wl-card wl-frames'); fc.appendChild(h('div', 'wl-h', 'What I looked at'));
        big = thumb(r.frames[0], true); fc.appendChild(big);
        var fs = h('div', 'wl-strip wl-pick');
        r.frames.forEach(function (f, i) { var t = thumb(f); t.tabIndex = 0; t.setAttribute('role', 'button'); if (!i) t.classList.add('wl-sel'); t.addEventListener('click', function () { show(f); }); t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(f); } }); fs.appendChild(t); });
        fc.appendChild(fs); side.appendChild(fc);
      }
      function show(f) { if (!big) return; var nb = thumb(f, true); big.replaceWith(nb); big = nb; [].forEach.call(side.querySelectorAll('.wl-pick .wl-frame'), function (t) { t.classList.toggle('wl-sel', +t.dataset.t === f.t); }); }
      stampHook = function (ts) { var s = secs(ts), best = null; r.frames.forEach(function (f) { if (!best || Math.abs(f.t - s) < Math.abs(best.t - s)) best = f; }); if (best) { show(best); big.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } var line = side.querySelector('[data-at="' + Math.floor(s) + '"]') || [].filter.call(side.querySelectorAll('.wl-line'), function (l) { return +l.dataset.t <= s; }).pop(); if (line) { line.classList.add('wl-hl'); setTimeout(function () { line.classList.remove('wl-hl'); }, 1600); line.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };
      if (r.segments.length) {
        var tc = h('div', 'wl-card wl-tx'); var th = h('div', 'wl-ch'); th.appendChild(h('div', 'wl-h', 'What was said'));
        var cp = h('button', 'wl-pill wl-small'); cp.type = 'button'; cp.appendChild(icon(I.copy)); cp.appendChild(document.createTextNode('Copy'));
        cp.addEventListener('click', function () { var t = transcriptText(r.segments); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { cp.lastChild.textContent = 'Copied'; }, function () { cp.lastChild.textContent = 'Copy failed'; }); });
        th.appendChild(cp); tc.appendChild(th);
        var list = h('div', 'wl-lines');
        r.segments.forEach(function (s) { var l = h('div', 'wl-line'); l.dataset.t = s.start; var b = h('button', 'wl-ts', fmtTime(s.start)); b.type = 'button'; b.addEventListener('click', function () { stampHook(fmtTime(s.start)); }); l.appendChild(b); if (s.who) l.appendChild(h('b', null, s.who)); l.appendChild(h('span', null, s.text)); list.appendChild(l); });
        tc.appendChild(list); side.appendChild(tc);
      }
      grid.appendChild(side); body.appendChild(grid);
      var bar = h('div', 'wl-bar wl-end');
      if (opts.onSave) { var sv = h('button', 'wl-pill'); sv.type = 'button'; sv.appendChild(icon(I.save)); sv.appendChild(document.createTextNode('Keep on the Made shelf')); sv.addEventListener('click', function () { opts.onSave({ kind: 'document', title: (r.meta.name || 'Clip') + ': notes', content: '# ' + (r.meta.name || 'Clip') + '\n\n' + r.text + (r.segments.length ? '\n\n## Transcript\n\n' + transcriptText(r.segments) : '') }); sv.disabled = true; sv.lastChild.textContent = 'Kept'; }); bar.appendChild(sv); }
      var again = h('button', 'wl-pill', 'Watch something else'); again.type = 'button'; again.addEventListener('click', function () { chooser(); }); bar.appendChild(again);
      body.appendChild(bar);
      if (opts.onSay) { var first = String(r.text).split(/\n/).filter(function (l) { return l.trim(); })[0] || ''; opts.onSay(first.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '').slice(0, 240)); }
    }

    /* ---- live: share a tab */
    function startLive(question) {
      c.ac = new AbortController();
      var clock = null, max = opts.maxLiveSec || 300;
      capture({ detail: detail, every: detail === 'close' ? 2 : detail === 'quick' ? 10 : 5, maxSec: max,
        onFrame: function (f) { if (strip) { strip.appendChild(thumb(f)); while (strip.childNodes.length > 14) strip.removeChild(strip.firstChild); } },
        onTick: function (s) { if (clock) clock.textContent = fmtTime(s) + ' / ' + fmtTime(max); } })
        .then(function (live) {
          c.live = live;
          body.textContent = ''; lede.hidden = false; title.textContent = 'Watching your ' + (live.surface === 'browser' ? 'tab' : live.surface);
          lede.textContent = 'Play it now. Tap Done when you have seen enough' + (live.hasAudio ? '.' : '. No sound is coming through: next time turn on "Share tab audio".');
          var pv = h('div', 'wl-live'); live.video.className = 'wl-preview'; pv.appendChild(live.video);
          var rec = h('span', 'wl-rec'); rec.appendChild(h('i')); clock = h('span', null, '0:00 / ' + fmtTime(max)); rec.appendChild(clock); pv.appendChild(rec); body.appendChild(pv);
          strip = h('div', 'wl-strip'); body.appendChild(strip);
          live.frames.forEach(function (f) { strip.appendChild(thumb(f)); });
          var bar = h('div', 'wl-bar'); var done = h('button', 'wl-pill wl-primary', 'Done, tell me'); done.type = 'button';
          var cancel = h('button', 'wl-pill wl-ghost', 'Cancel'); cancel.type = 'button';
          bar.appendChild(done); bar.appendChild(cancel); body.appendChild(bar);
          done.addEventListener('click', function () { live.stop(); });
          cancel.addEventListener('click', function () { c.ac.abort(); live.stop(); });
          live.done.then(function (got) {
            c.live = null; if (cur !== c) return;
            if (c.ac.signal.aborted) return chooser('Cancelled. Nothing was sent.');
            if (!got.frames.length && !got.audio) return chooser('Nothing came through from the shared ' + got.surface + '.');
            begin({ live: got }, question);
          });
        }, function (e) { chooser(e && e.name === 'NotAllowedError' ? 'Sharing was cancelled.' : 'The tab could not be shared: ' + (e && e.message || 'unknown reason') + '.'); });
    }

    chooser();
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('wl-show'); panel.focus({ preventScroll: true }); });
    if (opts.file) begin(opts.file, opts.question || '');
    else if (opts.onSay) opts.onSay('Pick the file or share the tab, sir.');
    return { close: close, element: el };
  }

  Kin.watch = {
    isRequest: isRequest, support: support, open: open, close: close, analyze: analyze, prepare: prepare, run: run, followUp: followUp, price: price,
    _: { fmtTime: fmtTime, money: money, framePlan: framePlan, candidateTimes: candidateTimes, diff: diff, pickScenes: pickScenes, fitSize: fitSize, imageTokens: imageTokens, estimate: estimate, segments: segments, transcriptText: transcriptText, buildContent: buildContent, cleanQuestion: cleanQuestion, costOf: costOf, sttError: sttError, DETAIL: DETAIL, MODEL: MODEL, SYSTEM: SYSTEM }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Kin.watch;
})();
