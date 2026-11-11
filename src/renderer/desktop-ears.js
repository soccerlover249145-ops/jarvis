/* desktop-ears.js: in the Mac app, Jarvis hears through JarvisEars (Apple's speech recognizer, on
   the Mac) instead of the browser's speech service, which does not work inside an app.
   Same shape as Kin.ears from ears.js, so the rest of the UI does not change, and the wake, sleep
   and stop phrases are still decided by ears.js's own wakeIn, sleepIn and stopIn. */
(function () {
  'use strict';
  var Kin = window.Kin, D = window.jarvisDesktop;
  if (!D || !Kin || !Kin.ears) return;
  var base = Kin.ears;
  var subs = [], want = false, live = false, lastErr = '';
  function emit(ev) { subs.forEach(function (f) { try { f(ev); } catch (e) {} }); }
  /* the helper's reasons, in the words the UI already understands */
  var REASON = { 'mic-denied': 'not-allowed', 'speech-denied': 'not-allowed', 'speech-restricted': 'not-allowed', 'speech-not-allowed': 'not-allowed',
    'no-on-device': 'not-allowed', 'no-microphone': 'no-microphone' };
  var WHY = {
    'mic-denied': 'Jarvis may not use the microphone. Allow it in System Settings, Privacy & Security, Microphone.',
    'speech-denied': 'Speech recognition is off for Jarvis. Allow it in System Settings, Privacy & Security, Speech Recognition.',
    'speech-restricted': 'Speech recognition is restricted on this Mac (Screen Time or a profile).',
    'no-on-device': 'This Mac cannot turn speech into text on the Mac itself for this language. In Settings, Mac, you can allow Apple\'s servers to do it, or type instead.',
    'no-microphone': 'No microphone was found.',
    'helper-missing': 'The listening helper is missing. Rebuild it (native/build.sh) and reinstall Jarvis.',
    'stalled': 'Listening kept failing, so it is off. Click the mic to try again.'
  };
  D.ears.onEvent(function (ev) {
    if (!ev) return;
    if (ev.type === 'state') {
      if (ev.state === 'paused') return;
      if (ev.state === 'listening') { live = true; want = true; lastErr = ''; emit({ type: 'state', state: 'listening' }); return; }
      live = false;
      if (ev.state === 'blocked') {
        want = false; lastErr = ev.reason || 'blocked';
        if (WHY[ev.reason]) D.ui.toast('Listening is off', WHY[ev.reason]);
        emit({ type: 'state', state: 'blocked', reason: REASON[ev.reason] || 'not-allowed' }); return;
      }
      if (ev.state === 'off') {
        if (ev.reason && ev.reason !== 'stopped') { lastErr = ev.reason; want = false; if (WHY[ev.reason]) D.ui.toast('Listening is off', WHY[ev.reason]); }
        emit({ type: 'state', state: 'off', reason: ev.reason || 'stopped' }); return;
      }
      emit({ type: 'state', state: 'starting', reason: ev.reason || '' });
      return;
    }
    if (ev.type === 'partial' || ev.type === 'final') emit({ type: ev.type, text: String(ev.text || '') });
  });

  Kin.ears = {
    supported: true, isIOS: false, isSafari: false, standalone: true, desktop: true,
    on: function (f) { subs.push(f); },
    listening: function () { return live; },
    wanted: function () { return want; },
    lastError: function () { return lastErr; },
    start: function () { want = true; D.ears.start(); return true; },
    stop: function () { want = false; live = false; D.ears.stop(); emit({ type: 'state', state: 'off', reason: 'stopped' }); },
    hold: function (on) { D.ears.hold(!!on); },
    permission: function () {
      return D.config.get().then(function (c) { var m = c && c.perms && c.perms.microphone; return m === 'granted' ? 'granted' : m === 'denied' || m === 'restricted' ? 'denied' : 'prompt'; }, function () { return 'unknown'; });
    },
    norm: base.norm, wakeIn: base.wakeIn, sleepIn: base.sleepIn, stopIn: base.stopIn
  };
  /* the helper may already be listening (it starts with the app): pick up where it is */
  D.ears.state().then(function (s) {
    want = !!(s && s.wanted); live = !!(s && s.state === 'listening');
    if (live) emit({ type: 'state', state: 'listening' });
  }, function () {});
})();
