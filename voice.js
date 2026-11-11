/* voice.js: how Kin sounds.
   With a voice key (the owner's own ElevenLabs account, kept in this browser only) every sentence is
   spoken in the voice they picked, sentence by sentence, starting while the answer is still being written.
   Without a key, fixed lines are pre-recorded clips served from this site and everything else is spoken by
   the device's own voice. A chime marks waking and sleeping. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var noop = function () {};
  /* at an address shared with another site the voice key is neither read nor written (see guard.js) */
  var ls = { get: function (k, d) { if (Kin.shared) return d; try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: function (k, v) { if (Kin.shared) return false; try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }, del: function (k) { try { localStorage.removeItem(k); } catch (e) {} } };

  /* the lines that exist as recordings, in four voices */
  var CLIPS = {
    welcome: 'Welcome home, sir. I am awake and at your service.',
    service: 'At your service, sir.',
    listening: 'I’m listening, sir.',
    yes: 'Yes, sir?',
    done: 'Done, sir.',
    verygood: 'Very good, sir.',
    good: 'Good to see you, sir.',
    moment: 'One moment, sir.',
    standby: 'Standing by, sir.',
    error: 'I could not answer that, sir. The reason is on screen.'
  };
  var VOICES = ['arthur', 'alistair', 'sterling', 'callum'];
  var byText = {}; Object.keys(CLIPS).forEach(function (k) { byText[CLIPS[k]] = k; });

  var subs = [], on = false, run = 0, mode = 'jarvis', who = 'arthur', rate = 1, cur = null;
  var audio = null, AC = null, syn = window.speechSynthesis || null, sysVoice = null, keep = [];
  var SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

  function emit(ev) { subs.forEach(function (f) { try { f(ev); } catch (e) {} }); }
  function state(s, why) { var was = on; on = s === 'speaking'; if (was !== on) emit({ type: 'state', state: s, reason: why || '' }); }

  /** The browser's own voice. One that is made on this device is preferred: some browser voices (the ones
      named "Google ..." in Chrome) are spoken by the browser maker's servers, which means the text is sent there. */
  function pickSys() {
    if (!syn) return; var vs = []; try { vs = syn.getVoices() || []; } catch (e) {}
    vs = vs.filter(function (v) { return /^en[-_]/i.test(v.lang); });
    var want = [/Daniel.*(Enhanced|Premium)/i, /Oliver.*(Enhanced|Premium)/i, /Daniel/i, /Arthur/i, /Oliver/i, /Google UK English Male/i, /en[-_]GB/i, /Evan/i, /Google US English/i, /Samantha/i];
    function best(list) { var hit = null; for (var i = 0; i < want.length && !hit; i++) hit = list.filter(function (v) { return want[i].test(v.name) || want[i].test(v.lang); })[0] || null; return hit || list[0] || null; }
    var here = vs.filter(function (v) { return v.localService !== false && !/^Google /i.test(v.name); });
    sysVoice = best(here) || best(vs);
  }
  if (syn) { pickSys(); try { syn.addEventListener('voiceschanged', pickSys); } catch (e) {} }

  function sentences(text) {
    var out = [];
    (String(text).match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [String(text)]).forEach(function (x) {
      x = x.trim(); if (!x) return; var last = out[out.length - 1];
      if (last && (last + ' ' + x).length < 150) out[out.length - 1] = last + ' ' + x; else out.push(x);
    });
    return out;
  }

  /** play one sound through the shared element. Resolves true when it played to the end, false when it could not play. */
  function playSrc(src, my) {
    return new Promise(function (res) {
      if (!audio) audio = new Audio();
      var done = false, t = 0;
      function fin(ok) { if (done) return; done = true; clearTimeout(t); audio.onended = audio.onerror = null; res(ok); }
      audio.onended = function () { fin(true); }; audio.onerror = function () { fin(false); };
      audio.src = src; audio.playbackRate = 1;
      var p; try { p = audio.play(); } catch (e) { return fin(false); }
      if (p && p.catch) p.catch(function () { fin(false); });
      t = setTimeout(function () { try { audio.pause(); } catch (e) {} fin(false); }, 40000);
      (function watch() { if (done) return; if (my !== run) { try { audio.pause(); } catch (e) {} return fin(true); } setTimeout(watch, 120); })();
    });
  }
  function playClip(key, my) { return playSrc('voice/' + who + '/' + key + '.mp3', my); }

  /** one line in the device's own voice. The end of speech is not reported reliably everywhere, so it is also watched and timed. */
  function speakSys(text, my) {
    return new Promise(function (res) {
      if (!syn || typeof SpeechSynthesisUtterance === 'undefined') return res(false);
      var done = false, quiet = 0, iv = 0, cap = 0, started = false;
      function fin(ok) { if (done) return; done = true; clearInterval(iv); clearTimeout(cap); res(ok); }
      var u = new SpeechSynthesisUtterance(text);
      if (sysVoice) u.voice = sysVoice; u.lang = (sysVoice && sysVoice.lang) || 'en-GB'; u.rate = Math.max(0.8, Math.min(1.2, rate));
      u.onstart = function () { started = true; }; u.onend = function () { fin(true); }; u.onerror = function () { fin(started); };
      keep = [u];
      try { syn.speak(u); } catch (e) { return fin(false); }
      iv = setInterval(function () { if (my !== run) { try { syn.cancel(); } catch (e) {} return fin(true); } var busy = false; try { busy = syn.speaking || syn.pending; } catch (e) {} quiet = busy ? 0 : quiet + 1; if (quiet >= 4) fin(started); }, 300);
      cap = setTimeout(function () { fin(started); }, 3000 + text.length * 95);
    });
  }
  /** the voice used when there is no key, or when the keyed voice fails: a recording for a fixed line, else the device */
  function backupLine(line, my) {
    var key = mode === 'jarvis' ? byText[line] : null;
    return key ? playClip(key, my).then(function (ok) { return ok ? true : speakSys(line, my); }) : speakSys(line, my);
  }

  /* ------------------------------------------------------------ the keyed voice (ElevenLabs)
     Facts checked against their API reference and by calling the endpoints: POST /v1/text-to-speech/{voice_id}/stream
     returns audio; GET /v2/voices lists the account's voices; GET /v1/models lists models; the key goes in the
     xi-api-key header; the API answers cross-origin requests from any site. */
  var HOST = 'https://api.elevenlabs.io';
  var PREFER = ['eleven_flash_v2_5', 'eleven_v4_turbo', 'eleven_flash_v2', 'eleven_turbo_v2_5', 'eleven_multilingual_v2'];
  var T = { key: ls.get('kin.tts.key', ''), voice: ls.get('kin.tts.voice', ''), voiceName: ls.get('kin.tts.voiceName', ''), model: ls.get('kin.tts.model', PREFER[0]),
    voices: [], models: [], bad: '', why: '', calls: 0, chars: 0 };
  var cache = [];

  function ttsOn() { return !!(T.key && T.voice && !T.bad); }
  /** turn any failure into one plain sentence and a short code */
  function explain(status, body, err) {
    var d = body && body.detail, code = d && (d.code || d.status) || '', msg = d && d.message || '';
    if (typeof d === 'string') msg = d;
    if (err && err.name === 'AbortError') return { code: 'stopped', text: '' };
    if (!status) return { code: 'network', text: 'The voice service could not be reached.' };
    if (status === 401 || /invalid_api_key|unauthorized|missing_permissions/.test(code)) return { code: 'key', text: /missing_permissions/.test(code) ? 'The voice key is not allowed to do that. Give it Text to Speech and Voices access.' : 'The voice key was refused.' };
    if (/quota|credit|payment|limit_reached/.test(code + ' ' + msg) || status === 402) return { code: 'credit', text: 'The voice account is out of credit.' };
    if (status === 429 || /too_many|rate|busy|concurrent/.test(code)) return { code: 'busy', text: 'The voice service is busy.' };
    if (/voice_not_found|voice.*not/.test(code)) return { code: 'voice', text: 'That voice is no longer in the account. Pick another in settings.' };
    if (/model/.test(code)) return { code: 'model', text: 'That voice model is not available on this account. Pick another in settings.' };
    return { code: 'error', text: msg ? String(msg).slice(0, 140) : 'The voice service did not answer.' };
  }
  /** every request to the voice service has a time limit, so a hung connection cannot leave Kin "speaking" and deaf */
  function call(path, opt, key) {
    opt = opt || {}; opt.headers = Object.assign({ 'xi-api-key': key || T.key }, opt.headers || {});
    var ac = new AbortController(), slow = false, outer = opt.signal, t = setTimeout(function () { slow = true; try { ac.abort(); } catch (e) {} }, Kin.T.ttsWait);
    if (outer) { if (outer.aborted) ac.abort(); else outer.addEventListener('abort', function () { try { ac.abort(); } catch (e) {} }); }
    opt.signal = ac.signal;
    function late(err) { return slow ? { code: 'slow', text: 'The voice service took too long.' } : explain(0, null, err); }
    return fetch(HOST + path, opt).then(function (r) {
      if (!r.ok) { clearTimeout(t); return r.json().catch(function () { return null; }).then(function (b) { throw explain(r.status, b); }); }
      /* the body is read inside the same time limit */
      r.whole = function (kind) { return r[kind]().then(function (x) { clearTimeout(t); return x; }, function (err) { clearTimeout(t); throw late(err); }); };
      return r;
    }, function (err) { clearTimeout(t); throw late(err); });
  }
  function score(v) { var l = v.labels || {}, s = 0, all = [l.accent, l.gender, l.age, l.descriptive, l.description, l.use_case, v.description].join(' ').toLowerCase();
    if (/british|english|rp\b|received/.test(String(l.accent || '').toLowerCase()) && !/american|australian|irish|indian/.test(String(l.accent || '').toLowerCase())) s += 4;
    if (String(l.gender || '').toLowerCase() === 'male') s += 2; if (/middle|old|mature/.test(String(l.age || '').toLowerCase())) s += 1;
    if (/calm|butler|formal|narrat|refined|warm|deep|professional|conversational/.test(all)) s += 1; return s; }
  function loadVoices(key) {
    var out = [];
    function page(token, n) {
      return call('/v2/voices?page_size=100' + (token ? '&next_page_token=' + encodeURIComponent(token) : ''), {}, key).then(function (r) { return r.whole('json'); }).then(function (j) {
        (j.voices || []).forEach(function (v) { var l = v.labels || {}; out.push({ id: v.voice_id, name: String(v.name || 'Voice').slice(0, 60), tags: [l.accent, l.gender, l.age].filter(Boolean).join(', ').replace(/_/g, ' ').slice(0, 50), score: score(v) }); });
        if (j.has_more && j.next_page_token && n < 3) return page(j.next_page_token, n + 1);
      });
    }
    return page('', 0).then(function () { out.sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); }); return out; });
  }
  function loadModels(key) {
    return call('/v1/models', {}, key).then(function (r) { return r.whole('json'); }).then(function (j) {
      return (Array.isArray(j) ? j : []).filter(function (m) { return m.can_do_text_to_speech !== false; }).map(function (m) { return { id: m.model_id, name: String(m.name || m.model_id).slice(0, 50) }; });
    }).catch(function () { return []; });
  }
  function settle() {
    if (T.voices.length && !T.voices.some(function (v) { return v.id === T.voice; })) { T.voice = T.voices[0].id; }
    var v = T.voices.filter(function (x) { return x.id === T.voice; })[0]; if (v) T.voiceName = v.name;
    if (T.models.length && !T.models.some(function (m) { return m.id === T.model; })) { var pick = PREFER.filter(function (id) { return T.models.some(function (m) { return m.id === id; }); })[0]; T.model = pick || T.models[0].id; }
    ls.set('kin.tts.voice', T.voice); ls.set('kin.tts.voiceName', T.voiceName); ls.set('kin.tts.model', T.model);
  }
  /** one sentence to sound. Short repeated lines are kept so they play at once the next time. */
  function synth(text, signal) {
    var k = T.voice + '|' + T.model + '|' + rate + '|' + text, hit = cache.filter(function (c) { return c.k === k; })[0];
    if (hit) return Promise.resolve(hit.b);
    T.calls++; T.chars += text.length;
    return call('/v1/text-to-speech/' + encodeURIComponent(T.voice) + '/stream?output_format=mp3_44100_64', { method: 'POST', signal: signal,
      headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: text, model_id: T.model, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.max(0.8, Math.min(1.15, rate)) } }) })
      .then(function (r) { return r.whole('blob'); }).then(function (b) {
        if (!b || !b.size) throw { code: 'error', text: 'The voice service sent no sound.' };
        if (text.length <= 90) { cache.push({ k: k, b: b }); if (cache.length > 24) cache.shift(); }
        return b;
      }, function (e) { throw e && e.code ? e : explain(0, null, e); });
  }

  /** A run of lines spoken in order. Lines may be added while earlier ones are still playing.
      At most two are being fetched at a time. Any failure hands the rest of the run to the backup voice. */
  function queue(my, keyed) {
    var q = [], next = 0, inflight = 0, ended = false, playing = false, failed = '', finished = false, ctl = new AbortController(), fed = '', resolve, done = new Promise(function (r) { resolve = r; });
    function finish() { if (finished) return; finished = true; try { ctl.abort(); } catch (e) {} if (my === run) state('idle', 'completed'); resolve(); }
    function fail(e) {
      if (failed) return; failed = (e && e.text) || 'The voice service did not answer.'; try { ctl.abort(); } catch (x) {}
      T.why = failed; if (e && e.code === 'key') T.bad = failed;
      emit({ type: 'ttsfail', reason: failed, code: (e && e.code) || 'error' });
    }
    function load(it) { it.state = 'loading'; inflight++; synth(it.text, ctl.signal).then(function (b) { it.blob = b; it.state = 'ready'; }, function (e) { it.state = 'failed'; it.err = e; }).then(function () { inflight--; pump(); }); }
    function pump() {
      if (finished) return; if (my !== run) return finish();
      if (keyed && !failed) for (var k = next; k < q.length && inflight < 2; k++) if (!q[k].state) load(q[k]);
      if (playing) return;
      if (next >= q.length) { if (ended) finish(); return; }
      var it = q[next];
      if (!keyed || failed) { playing = true; next++; emit({ type: 'line', text: it.text }); backupLine(it.text, my).then(function () { playing = false; pump(); }); return; }
      if (it.state === 'failed') { if (it.err && it.err.code === 'stopped') return finish(); fail(it.err); return pump(); }
      if (it.state !== 'ready') return;
      playing = true; next++; emit({ type: 'line', text: it.text });
      var url = URL.createObjectURL(it.blob);
      playSrc(url, my).then(function (ok) {
        try { URL.revokeObjectURL(url); } catch (e) {}
        if (!ok && my === run) { fail({ code: 'play', text: 'This browser would not play the voice.' }); return backupLine(it.text, my).then(function () { playing = false; pump(); }); }
        playing = false; pump();
      });
    }
    function push(text) { text = String(text || '').trim(); if (!text || finished) return; q.push({ text: text, state: '' }); if (my === run) state('speaking'); pump(); }
    return {
      done: done, ctl: ctl,
      push: push,
      end: function () { ended = true; pump(); return done; },
      /** give the answer so far (plain words). Whole sentences that are new are spoken at once. */
      feed: function (clean) {
        clean = String(clean || ''); if (clean.indexOf(fed) !== 0) return;
        var rest = clean.slice(fed.length), re = /[.!?]["')\]]?\s/g, m, cut = -1;
        while ((m = re.exec(rest))) cut = m.index + m[0].length;
        if (cut <= 0) return; var chunk = rest.slice(0, cut); fed += chunk; sentences(chunk).forEach(push);
      },
      /** the whole answer is known: speak whatever has not been spoken yet, then finish */
      finish: function (clean) {
        clean = String(clean || ''); var rest = clean.indexOf(fed) === 0 ? clean.slice(fed.length) : (fed ? '' : clean);
        sentences(rest).forEach(push); ended = true; pump(); return done;
      }
    };
  }
  function begin() {
    var my = ++run; try { if (cur) cur.ctl.abort(); } catch (e) {}
    try { if (syn) syn.cancel(); } catch (e) {} try { if (audio) audio.pause(); } catch (e) {}
    cur = queue(my, ttsOn()); return cur;
  }

  Kin.voice = {
    CLIPS: CLIPS, VOICES: VOICES,
    on: function (f) { subs.push(f); },
    active: function () { return on; },
    canSpeak: function () { return ttsOn() || !!syn || mode === 'jarvis'; },
    /** true when every sentence will be spoken by the keyed voice */
    live: ttsOn,
    hasSystemVoice: function () { return !!syn; },
    systemVoiceName: function () { return sysVoice ? sysVoice.name : ''; },
    /** true when the browser's voice in use is spoken by the browser maker's servers */
    systemVoiceRemote: function () { return !!sysVoice && (sysVoice.localService === false || /^Google /i.test(sysVoice.name)); },
    set: function (o) { if (o.mode) mode = o.mode; if (o.who && VOICES.indexOf(o.who) >= 0) who = o.who; if (o.rate) rate = o.rate; },
    get: function () { return { mode: mode, who: who }; },
    /** call inside a tap or key press: lets sound and speech play later without one */
    unlock: function () {
      try { if (!audio) audio = new Audio(); if (!on) { audio.src = SILENT; var p = audio.play(); if (p && p.catch) p.catch(noop); } } catch (e) {}
      try { var C = window.AudioContext || window.webkitAudioContext; if (C) { if (!AC) AC = new C(); if (AC.state === 'suspended') { var r = AC.resume(); if (r && r.catch) r.catch(noop); } } } catch (e) {}
      try { if (syn && !on) { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; syn.speak(u); } } catch (e) {}
    },
    stop: function () { run++; try { if (cur) cur.ctl.abort(); } catch (e) {} try { if (audio) audio.pause(); } catch (e) {} try { if (syn) syn.cancel(); } catch (e) {} state('idle', 'stopped'); },
    /** Speak text. Resolves when the words are done (or could not be spoken). */
    say: function (text) {
      text = String(text || '').trim(); if (!text) return Promise.resolve();
      var s = begin(); (!ttsOn() && mode === 'jarvis' && byText[text] ? [text] : sentences(text)).forEach(s.push); return s.end();
    },
    /** Speak an answer while it is still being written: feed(textSoFar) as it grows, then finish(wholeText). */
    begin: begin,
    /** a soft rising chime for waking, a falling one for sleep. Needs unlock() to have run in a tap first. */
    chime: function (kind) {
      var a = AC; if (!a) return false; var t0 = Date.now(), notes = kind === 'sleep' ? [[880, 0], [587.33, 0.16]] : [[587.33, 0], [880, 0.1], [1174.66, 0.22]];
      function go() {
        try {
          var now = a.currentTime + 0.02, out = a.createGain(); out.gain.value = kind === 'sleep' ? 0.5 : 0.8; out.connect(a.destination);
          notes.forEach(function (n) { [[1, 0.1, 'sine'], [2, 0.022, 'triangle']].forEach(function (p) {
            var o = a.createOscillator(), g = a.createGain(), t = now + n[1]; o.type = p[2]; o.frequency.value = n[0] * p[0];
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p[1], t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
            o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.3);
          }); });
          Kin.voice.chimes = (Kin.voice.chimes || 0) + 1;
        } catch (e) {}
      }
      if (a.state === 'running') go(); else { try { var p = a.resume(); if (p && p.then) p.then(function () { if (Date.now() - t0 < 700) go(); }).catch(noop); } catch (e) {} }
      return true;
    },
    /** the owner's own text-to-speech account. The key never leaves this browser except to that service. */
    tts: {
      provider: 'ElevenLabs',
      hasKey: function () { return !!T.key; },
      keyHint: function () { return T.key ? T.key.slice(0, 3) + '…' + T.key.slice(-4) : ''; },
      status: function () { return { on: ttsOn(), bad: T.bad, why: T.why, voice: T.voice, voiceName: T.voiceName, model: T.model, voices: T.voices.slice(), models: T.models.slice(), calls: T.calls, chars: T.chars }; },
      /** Save a key after proving it works by reading the account's voices. Resolves { voices } or rejects { text }. */
      setKey: function (k) {
        k = String(k || '').trim();
        if (Kin.shared) return Promise.reject({ code: 'shared', text: Kin.SHARED_TEXT });
        if (/^sk-ant-/.test(k)) return Promise.reject({ code: 'shape', text: 'That is a Claude key. It goes under Brain, not here.' });
        if (!/^[A-Za-z0-9_\-]{20,200}$/.test(k)) return Promise.reject({ code: 'shape', text: 'That does not look like an ElevenLabs API key.' });
        return loadVoices(k).then(function (vs) {
          if (!vs.length) throw { code: 'voice', text: 'The key works, but the account has no voices. Add one to your voices in ElevenLabs first.' };
          if (!ls.set('kin.tts.key', k)) throw { code: 'storage', text: 'This browser would not save the key. Its storage is blocked or full (private browsing does this).' };
          T.key = k; T.bad = ''; T.why = ''; T.voices = vs; cache = [];
          return loadModels(k).then(function (ms) { T.models = ms; settle(); return { voices: vs }; });
        });
      },
      /** read the voices and models again with the saved key (after adding a voice to the account) */
      refresh: function () {
        if (!T.key) return Promise.resolve(false);
        return loadVoices().then(function (vs) { T.voices = vs; T.bad = ''; return loadModels(); }).then(function (ms) { T.models = ms; settle(); return true; }, function (e) { T.why = (e && e.text) || ''; if (e && e.code === 'key') T.bad = T.why; return false; });
      },
      setVoice: function (id) { var v = T.voices.filter(function (x) { return x.id === id; })[0]; if (!v) return; T.voice = v.id; T.voiceName = v.name; T.bad = ''; ls.set('kin.tts.voice', v.id); ls.set('kin.tts.voiceName', v.name); },
      setModel: function (id) { if (!id) return; T.model = id; T.bad = ''; ls.set('kin.tts.model', id); },
      dropKey: function () { T.key = ''; T.bad = ''; T.why = ''; T.voices = []; T.models = []; cache = []; ['kin.tts.key', 'kin.tts.voice', 'kin.tts.voiceName', 'kin.tts.model'].forEach(ls.del); T.voice = ''; T.voiceName = ''; T.model = PREFER[0]; },
      /** say one line with the chosen voice. Resolves { ok, reason }. Call it from a tap. */
      test: function (line) {
        if (!T.key || !T.voice) return Promise.resolve({ ok: false, reason: 'Save a key and pick a voice first.' });
        T.bad = ''; var failed = '', off = function (e) { if (e.type === 'ttsfail') failed = e.reason; }; subs.push(off);
        return Kin.voice.say(line || CLIPS.service).then(function () { subs.splice(subs.indexOf(off), 1); return { ok: !failed, reason: failed }; });
      }
    }
  };
})();
