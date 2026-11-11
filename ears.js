/* ears.js: how Kin hears. The browser's own speech recognition (Web Speech API) turns
   speech into text. One Allow from the browser, then it keeps listening and restarts
   itself whenever the browser ends a session. Also the wake, sleep and stop phrases. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isSafari = isIOS || (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua));
  var standalone = !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));

  var subs = [], rec = null, want = false, live = false, held = false, beganAt = 0, lastEvt = 0, quick = 0, restartT = 0, pending = false, lastErr = '', netStall = false, beatI = 0, paused = '';
  function emit(ev) { subs.forEach(function (f) { try { f(ev); } catch (e) {} }); }
  function blockedErr(x) { return x === 'not-allowed' || x === 'service-not-allowed' || x === 'audio-capture'; }

  function make() {
    var r = new SR();
    r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.lang = (navigator.language && /^en/i.test(navigator.language)) ? navigator.language : 'en-US';
    /* events from a recognizer that has already been let go of are ignored */
    r.onstart = function () { if (rec !== r) return; live = true; lastEvt = Date.now(); lastErr = ''; emit({ type: 'state', state: 'listening' }); };
    r.onaudiostart = r.onsoundstart = r.onspeechstart = r.onspeechend = function () { if (rec === r) lastEvt = Date.now(); };
    r.onerror = function (e) {
      if (rec !== r) return;
      lastErr = (e && e.error) || 'error';
      if (lastErr === 'not-allowed' || lastErr === 'service-not-allowed') { want = false; meterOff(); emit({ type: 'state', state: 'blocked', reason: lastErr }); }
      else if (lastErr === 'audio-capture') { want = false; meterOff(); emit({ type: 'state', state: 'blocked', reason: 'no-microphone' }); }
    };
    r.onend = function () { if (rec !== r) return; live = false; rec = null; ended(false); };
    r.onresult = function (e) {
      if (rec !== r) return;
      lastEvt = Date.now();
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var res = e.results[i], txt = (res[0] && res[0].transcript) || '';
        if (res.isFinal) { if (txt.trim()) emit({ type: 'final', text: txt.trim() }); } else interim += txt;
      }
      if (interim.trim()) emit({ type: 'partial', text: interim.trim() });
    };
    return r;
  }
  /** A session is over. The browser ends them all the time (silence, a time limit, the network), so start a
      new one. If sessions keep dying at once, or never start, wait longer each time and then give up with a
      clear state, so the page never spins up recognizers for ever. */
  function ended(failed) {
    if (!want || held) { if (!held && !blockedErr(lastErr)) emit({ type: 'state', state: 'off', reason: lastErr || 'stopped' }); return; }
    /* the tab is in the background: browsers stop listening there (an iPhone always does). Wait for it to come
       back instead of counting this as a failure, and say so. */
    if (hidden() && (isIOS || failed || Date.now() - beganAt < 1500)) { pause('hidden'); return; }
    quick = failed || Date.now() - beganAt < 1500 ? quick + 1 : 0;
    if (quick > 5) {
      want = false; meterOff(); netStall = lastErr === 'network' || navigator.onLine === false;
      emit({ type: 'state', state: 'off', reason: 'stalled' }); return;
    }
    emit({ type: 'state', state: 'starting', reason: 'restart' });
    clearTimeout(restartT); pending = true; restartT = setTimeout(begin, quick ? Math.min(8000, Kin.T.retry * Math.pow(2, quick)) : Kin.T.retry);
  }
  function hidden() { return document.visibilityState === 'hidden'; }
  function pause(why) { clearTimeout(restartT); pending = false; drop(); meterOff(); if (paused === why) return; paused = why; emit({ type: 'state', state: 'paused', reason: why }); }
  function resume() { if (!paused) return; paused = ''; quick = 0; if (want && !held) { emit({ type: 'state', state: 'starting', reason: 'resume' }); begin(); } }
  try {
    document.addEventListener('visibilitychange', function () {
      if (!want) return;
      if (hidden()) { if (isIOS) pause('hidden'); }
      else resume();
    });
  } catch (e) {}
  function begin() {
    pending = false;
    if (!SR || !want || held || live || rec || paused) return false;
    try { beganAt = Date.now(); rec = make(); rec.start(); emit({ type: 'state', state: 'starting' }); return true; }
    catch (e) { rec = null; lastErr = 'start-failed'; want = false; meterOff(); emit({ type: 'state', state: 'off', reason: 'start-failed' }); return false; }
  }
  /** let go of the current recognizer without waiting for the browser to say it ended (some never do) */
  function drop() { var r = rec; rec = null; live = false; if (r) { try { r.abort(); } catch (e) {} } }
  /** A heartbeat. It notices a recognizer that never confirmed it started, one that has gone silent for minutes
      (dead, on some browsers), and the case where nothing is running although listening is wanted. */
  function beat() {
    beatI = setTimeout(beat, Kin.T.beat);
    if (!want || held || paused) return;
    var now = Date.now();
    if (!rec) { if (!pending) begin(); return; }
    if (!live && now - beganAt > Kin.T.noStart) { drop(); lastErr = 'no-start'; ended(true); }
    else if (live && now - lastEvt > 180000) { drop(); lastErr = ''; beganAt = 0; ended(false); }
  }
  try { window.addEventListener('online', function () { if (netStall) { netStall = false; Kin.ears.start(); } }); } catch (e) {}

  /* ---- a level meter for interrupting: is someone actually talking, or is it only Kin's own voice? ---- */
  var meter = null, meterBusy = false, meterGen = 0;
  function meterOff() { meterGen++; var m = meter; meter = null; if (m) m.close(); }
  function meterOn() {
    if (meter || meterBusy || isSafari || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || Kin.shared) return;
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    meterBusy = true; var gen = meterGen;
    Kin.ears.permission().then(function (st) {
      if (st !== 'granted' || !want || gen !== meterGen) { meterBusy = false; return; }
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
        meterBusy = false;
        /* listening was turned off or paused while the browser was opening the mic: let it go at once */
        if (!want || paused || gen !== meterGen) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        var ac = new C(), src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 512; src.connect(an);
        var buf = new Float32Array(an.fftSize), peakAt = 0, peak = 0;
        meter = {
          /* a page may only start sound after a tap: until the meter's context runs, there is no reading at all */
          level: function () {
            if (ac.state !== 'running') return null;
            try { an.getFloatTimeDomainData(buf); } catch (e) { return null; }
            var sum = 0; for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            var rms = Math.min(1, Math.sqrt(sum / buf.length) * 4), now = Date.now();
            /* hold the loudest moment for half a second: speech has gaps between words */
            if (rms >= peak || now - peakAt > 500) { peak = rms; peakAt = now; }
            return peak;
          },
          wake: function () { try { if (ac.state === 'suspended') { var r = ac.resume(); if (r && r.catch) r.catch(function () {}); } } catch (e) {} },
          close: function () { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} try { ac.close(); } catch (e) {} }
        };
      });
    }).catch(function () { meterBusy = false; });
  }

  /* ---- wake, sleep and stop phrases ---- */
  function norm(s) { return String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function stem(w) { return w.replace(/ies$/, 'y').replace(/s$/, ''); }
  /** Is a wake phrase in these words? Returns { rest } with what was said after it, or null.
      whole: the words must be little else. Only these wake Kin:
      - the owner's own phrase ("wake up, daddy's home"), said whole; a close mishearing of it wakes Kin too;
      - "hey", "ok", "hi" or "hello" right before "Jarvis" (or "Kin"); a mishearing of Jarvis only counts with
        that word before it;
      - "Jarvis" as the very first word;
      - "daddy's home" when it is all that was said.
      A name in the middle of a sentence ("I read about Jarvis", "hey Travis") never wakes it. A misheard wake
      (fuzzy: true) only wakes Kin: the words after it are not sent anywhere, since they may be misheard too. */
  var FUZZY = 'jarvi|javis|jervis|jarvas|jarvus|jarbis|jarviss';
  function wakeIn(text, phrase, whole) {
    var raw = String(text || '').trim().split(/\s+/), tok = [], at = [];
    raw.forEach(function (r, i) { norm(r).split(' ').forEach(function (t) { if (t) { tok.push(t); at.push(i); } }); });
    if (!tok.length) return null;
    var n = tok.join(' '), first = -1, last = -1, fuzzy = false, homeish = false, m;
    /* the owner's own phrase, in order, near the start */
    var st = tok.map(stem), ph = norm(phrase).split(' ').filter(Boolean).map(stem), pos = 0, hit = 0, f = -1, l = -1;
    ph.forEach(function (p) { var ix = st.indexOf(p, pos); if (ix >= 0 && (f < 0 || ix - pos <= 1)) { hit++; if (f < 0) f = ix; l = ix; pos = ix + 1; } });
    if (ph.length >= 2 && f >= 0 && f <= 1 && st[f] === ph[0] && hit >= Math.max(2, Math.ceil(ph.length * 0.75)) && l - f <= ph.length) {
      first = f; last = l; fuzzy = hit < ph.length; homeish = true;
    } else if ((m = /^(?:(?:hey|hi|hello|ok|okay) )?(?:jarvis|kin)\b/.exec(n))) {
      first = 0; last = m[0].split(' ').length - 1; fuzzy = !/ /.test(m[0]); /* a bare name may be about someone else: wake only */
    } else if ((m = new RegExp('^(?:hey|hi|hello|ok|okay) (?:' + FUZZY + ')\\b').exec(n))) {
      first = 0; last = 1; fuzzy = true;
    } else if (/^(?:daddys|daddy is) home$/.test(n)) {
      first = 0; last = tok.length - 1; homeish = true;
    } else return null;
    var tailRe = homeish ? /^(kin|jarvis|please|daddys|home)$/ : /^(kin|jarvis|please)$/;
    while (last + 1 < tok.length && tailRe.test(tok[last + 1])) last++;
    if (whole && (first > 1 || tok.length - 1 - last > 0)) return null;
    var rest = raw.slice(at[last] + 1).join(' ');
    return fuzzy ? { rest: '', fuzzy: true } : { rest: rest };
  }
  function sleepIn(text) { return /^(ok |okay |thanks |thank you |alright |all right )?(kin |ken |jarvis )?(go (back )?to sleep|sleep( now)?|thats all( for now)?|that is all( for now)?|that will be all|stand down|stand by|standby|goodnight|good night|im done|we are done|were done|goodbye|bye)( kin| ken| jarvis)?( thanks| thank you)?$/.test(norm(text)); }
  function stopIn(text) { return /^(kin |ken |jarvis )?(stop|quiet|enough|hold on|wait|pause|shut up|never mind|nevermind|cancel)( kin| ken| jarvis)?$/.test(norm(text)); }

  Kin.ears = {
    supported: !!SR, isIOS: isIOS, isSafari: isSafari, standalone: standalone,
    on: function (f) { subs.push(f); },
    listening: function () { return live; },
    wanted: function () { return want; },
    lastError: function () { return lastErr; },
    /** Start listening and keep listening. Safe to call again: it does nothing when already listening. */
    start: function () { if (!SR) return false; want = true; held = false; quick = 0; netStall = false; if (paused && !hidden()) paused = ''; if (!beatI) beatI = setTimeout(beat, Kin.T.beat); return live || !!rec || pending || begin(); },
    /** Stop on purpose. Reported as "stopped" at once, whatever the browser says or fails to say afterwards. */
    stop: function () { want = false; held = false; netStall = false; paused = ''; clearTimeout(restartT); pending = false; drop(); lastErr = ''; meterOff(); emit({ type: 'state', state: 'off', reason: 'stopped' }); },
    /** why listening is paused ('hidden'), or '' */
    paused: function () { return paused; },
    /** How loud the room is right now, 0 to 1, from the microphone with the browser's echo cancelling on,
        so Kin's own voice from the speakers mostly cancels out. null where there is no meter (it is only
        opened on a computer, never in Safari, and only once the microphone is already allowed). */
    level: function () { return meter ? meter.level() : null; },
    meter: function (on) { if (on) meterOn(); else meterOff(); },
    /** call inside a tap or key press: lets the meter's sound context run */
    wakeMeter: function () { if (meter) meter.wake(); },
    /** Safari cannot listen and speak at once: let go of the mic while Kin talks, take it back after. */
    hold: function (on) {
      if (!SR || !want) return;
      if (on && !held) { held = true; clearTimeout(restartT); pending = false; drop(); }
      else if (!on && held) { held = false; clearTimeout(restartT); pending = true; restartT = setTimeout(begin, 250); }
    },
    /** what the browser says about the microphone without asking: granted, prompt, denied or unknown */
    permission: function () {
      try { if (navigator.permissions && navigator.permissions.query) return navigator.permissions.query({ name: 'microphone' }).then(function (p) { return p.state; }).catch(function () { return 'unknown'; }); } catch (e) {}
      return Promise.resolve('unknown');
    },
    norm: norm, wakeIn: wakeIn, sleepIn: sleepIn, stopIn: stopIn
  };
})();
