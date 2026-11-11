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

  var subs = [], rec = null, want = false, live = false, held = false, beganAt = 0, lastEvt = 0, quick = 0, restartT = 0, pending = false, lastErr = '', netStall = false, beatI = 0;
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
      if (lastErr === 'not-allowed' || lastErr === 'service-not-allowed') { want = false; emit({ type: 'state', state: 'blocked', reason: lastErr }); }
      else if (lastErr === 'audio-capture') { want = false; emit({ type: 'state', state: 'blocked', reason: 'no-microphone' }); }
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
    quick = failed || Date.now() - beganAt < 1500 ? quick + 1 : 0;
    if (quick > 5) {
      want = false; netStall = lastErr === 'network' || navigator.onLine === false;
      emit({ type: 'state', state: 'off', reason: 'stalled' }); return;
    }
    emit({ type: 'state', state: 'starting', reason: 'restart' });
    clearTimeout(restartT); pending = true; restartT = setTimeout(begin, quick ? Math.min(8000, Kin.T.retry * Math.pow(2, quick)) : Kin.T.retry);
  }
  function begin() {
    pending = false;
    if (!SR || !want || held || live || rec) return false;
    try { beganAt = Date.now(); rec = make(); rec.start(); emit({ type: 'state', state: 'starting' }); return true; }
    catch (e) { rec = null; lastErr = 'start-failed'; want = false; emit({ type: 'state', state: 'off', reason: 'start-failed' }); return false; }
  }
  /** let go of the current recognizer without waiting for the browser to say it ended (some never do) */
  function drop() { var r = rec; rec = null; live = false; if (r) { try { r.abort(); } catch (e) {} } }
  /** A heartbeat. It notices a recognizer that never confirmed it started, one that has gone silent for minutes
      (dead, on some browsers), and the case where nothing is running although listening is wanted. */
  function beat() {
    beatI = setTimeout(beat, Kin.T.beat);
    if (!want || held) return;
    var now = Date.now();
    if (!rec) { if (!pending) begin(); return; }
    if (!live && now - beganAt > Kin.T.noStart) { drop(); lastErr = 'no-start'; ended(true); }
    else if (live && now - lastEvt > 180000) { drop(); lastErr = ''; beganAt = 0; ended(false); }
  }
  try { window.addEventListener('online', function () { if (netStall) { netStall = false; Kin.ears.start(); } }); } catch (e) {}

  /* ---- wake, sleep and stop phrases ---- */
  function norm(s) { return String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function stem(w) { return w.replace(/ies$/, 'y').replace(/s$/, ''); }
  /** Is a wake phrase in these words? Returns what was said after it. whole: the words must be little else. */
  function wakeIn(text, phrase, whole) {
    var raw = String(text || '').trim().split(/\s+/), tok = [], at = [], first = -1, last = -1;
    raw.forEach(function (r, i) { norm(r).split(' ').forEach(function (t) { if (t) { tok.push(t); at.push(i); } }); });
    if (!tok.length) return null;
    var st = tok.map(stem), ph = norm(phrase).split(' ').filter(Boolean).map(stem), pos = 0, hit = 0, f = -1, l = -1;
    ph.forEach(function (p) { var ix = st.indexOf(p, pos); if (ix >= 0 && (f < 0 || ix - pos <= 2)) { hit++; if (f < 0) f = ix; l = ix; pos = ix + 1; } });
    if (ph.length >= 2 && hit >= Math.max(2, Math.ceil(ph.length * 0.75)) && l - f <= ph.length + 1) { first = f; last = l; }
    else {
      var n = tok.join(' '),
        m = /\b(?:(?:hey|hi|hello|ok|okay|yo) )?(?:jarvis|jarvi|javis)\b/.exec(n) ||
            /\b(wake up|rise and shine|daddys home|daddy is home|daddies home|honey im home|im home|i am home)\b/.exec(n) ||
            /\b(hey|hi|hello|ok|okay|yo) (kin|ken|kim|kyn|keen)\b/.exec(n);
      if (!m) return null;
      first = n.slice(0, m.index).split(' ').filter(Boolean).length; last = first + m[0].split(' ').length - 1;
    }
    while (last + 1 < tok.length && /^(kin|ken|jarvis|please|now)$/.test(tok[last + 1])) last++;
    if (whole && (first > 1 || tok.length - 1 - last > 0)) return null;
    return { rest: raw.slice(at[last] + 1).join(' ') };
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
    start: function () { if (!SR) return false; want = true; held = false; quick = 0; netStall = false; if (!beatI) beatI = setTimeout(beat, Kin.T.beat); return live || !!rec || pending || begin(); },
    /** Stop on purpose. Reported as "stopped" at once, whatever the browser says or fails to say afterwards. */
    stop: function () { want = false; held = false; netStall = false; clearTimeout(restartT); pending = false; drop(); lastErr = ''; emit({ type: 'state', state: 'off', reason: 'stopped' }); },
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
