/* app.js: ties ears, brain, voice and face together.
   Jarvis is off (not listening), asleep (listening only for the wake phrase) or awake (a spoken conversation). */
(function () {
  'use strict';
  var Kin = window.Kin, ears = Kin.ears, voice = Kin.voice, brain = Kin.brain, bust = Kin.bust;
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), cap = $('caption'), inp = $('ask');
  var WAKE_DEF = 'wake up, daddy\'s home';
  var ls = { get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);

  var S = Kin.state = { talk: 'off', busy: false, talking: false, hearing: false, micState: 'off', micWhy: '', wake: ls.get('kin.wake', WAKE_DEF), greeted: false,
    deafUntil: 0, said: '', saidAt: 0, unlocked: false, ctl: null, queued: '', wakes: 0, asks: 0, perm: 'unknown', lastEx: 0, snooze: 0, kbMic: false,
    line: '', lines: [], spokeAt: 0, bargeAt: 0, voiceBargeAt: 0, barges: 0, askN: 0, hushed: -1 };
  var buf = '', tail = '', hearT = 0, greetT = 0, idleT = 0, typeT = 0, capT = 0, flareT = 0, beatI = 0, pendWake = false, lastLen = 0, multi = 0, single = 0;
  voice.set({ mode: ls.get('kin.vmode', 'jarvis'), who: ls.get('kin.voice', 'arthur') });

  /* ------------------------------------------------------------ what is on screen */
  function caption(text, small, kind) {
    clearTimeout(capT);
    if (text == null) { cap.classList.remove('on', 'you'); return; }
    if (!S.unlocked && S.talk === 'awake' && kind !== 'you') small = 'Tap once so I can speak';
    cap.classList.toggle('you', kind === 'you'); $('capT').textContent = text; $('capS').textContent = small || ''; cap.classList.add('on');
    /* on a phone the line sits above the bar as a one-line hint and steps aside after six seconds (qc.css) */
    cap.classList.remove('qfade'); clearTimeout(fadeT); fadeT = setTimeout(function () { cap.classList.add('qfade'); }, 6000);
  }
  var fadeT = 0;
  function captionFade(ms) { clearTimeout(capT); capT = setTimeout(function () { if (!S.talking && !S.busy) caption(S.talk === 'asleep' ? sayPhrase() : null, S.talk === 'asleep' ? sleepHint() : ''); }, ms); }
  function sayPhrase() { return (ears.supported ? 'Say “hey Jarvis”' : 'Type “hey Jarvis”'); }
  function sleepHint() { return S.hearing ? 'Listening for it. Or tap here' : ears.supported ? 'Tap here so I can hear you' : 'Or tap here to wake Kin'; }
  function awakeHint() { if (S.talking) return ears.isSafari || !ears.supported ? 'Tap here to interrupt' : 'Just talk to interrupt'; return S.hearing ? 'Listening' : ears.supported ? 'Tap the mic so I can hear you' : coarse ? 'Tap the keyboard mic and talk' : 'Type to Jarvis'; }
  function flare(down) { var f = $('flare'); f.classList.remove('on'); f.classList.toggle('down', !!down); void f.offsetWidth; f.classList.add('on'); clearTimeout(flareT); flareT = setTimeout(function () { f.classList.remove('on'); }, 1700); if (!down) bust.wake(); }
  function paint() {
    var m = S.talking ? 'speaking' : S.busy ? 'thinking' : S.talk === 'asleep' ? 'asleep' : S.talk === 'awake' ? (S.hearing || !ears.supported ? 'listening' : 'idle') : 'off';
    app.dataset.state = S.talk; app.dataset.mood = m; bust.setMood(m);
    /* the state is shown once, in the pill at the top; this bottom pill is the conversation toggle and the mic */
    convLabel();
    $('stM').textContent = S.micState === 'listening' ? 'Mic on' : S.micState === 'starting' ? 'Mic starting' : S.micState === 'blocked' ? 'Mic blocked' : S.micState === 'paused' ? 'Mic paused' : 'Mic off';
    $('mic').setAttribute('aria-pressed', ears.wanted());
    /* no visible text bar while voice is actually working: it just listens. The bar comes back
       the moment it genuinely needs you -- no voice support, the mic blocked, or you turned it
       off yourself (Space does both: stop listening and bring the bar back to type instead) */
    app.dataset.composer = (!ears.supported || S.micState === 'blocked' || S.micState === 'off') ? 'show' : 'hide';
    /* the one-word state at the top: what Jarvis is doing right now */
    var ps = S.micState === 'paused' ? 'paused' : m === 'speaking' ? 'speaking' : m === 'thinking' ? 'thinking' : m === 'listening' ? 'listening' : m === 'asleep' ? 'sleeping' : m === 'idle' ? 'awake' : 'off',
      pl = { paused: 'Paused', speaking: 'Speaking', thinking: 'Thinking', listening: 'Listening', sleeping: 'Sleeping', awake: 'Awake', off: 'Off' }[ps],
      pt = { paused: 'Listening is paused while this tab is in the background. Come back to it and Kin listens again', speaking: S.talking && (ears.isSafari || !ears.supported) ? 'Jarvis is speaking. Tap to interrupt' : 'Jarvis is speaking. Just talk to interrupt', thinking: 'Jarvis is working on it', listening: 'Jarvis is listening. No wake phrase needed', sleeping: 'Asleep. Say hey Jarvis to wake Kin', awake: 'Awake. Tap the mic so Jarvis can hear you', off: 'Not listening. Tap to start' }[ps];
    var vp = $('vpill'); if (vp) { vp.dataset.s = ps; $('vpillT').textContent = pl; vp.setAttribute('aria-label', 'Kin: ' + pl + '. ' + pt); vp.title = pt; }
    inp.placeholder = S.talk === 'awake' ? (S.hearing ? 'Listening. Just talk.' : 'Ask Jarvis anything…') : ears.supported ? 'Say “hey Jarvis”, or type' : 'Ask Jarvis anything…';
  }
  function addMsg(who, text) {
    var t = $('thread'), e = t.querySelector('.empty'); if (e) e.remove();
    var d = document.createElement('div'); d.className = 'msg ' + who;
    var s = document.createElement('small'); s.textContent = who === 'you' ? 'You' : 'Jarvis'; var p = document.createElement('p'); p.textContent = text;
    d.appendChild(s); d.appendChild(p); t.appendChild(d); t.scrollTop = t.scrollHeight; return p;
  }
  /** a finished answer: rendered Markdown, then where it came from, what it cost, what was made, and two thumbs */
  function settle(p, text, r, q) {
    var d = p.parentNode, body = document.createElement('div'); body.className = 'md';
    Kin.mind.md(text, body); d.replaceChild(body, p);
    if (r.sources && r.sources.length) {
      var src = document.createElement('div'); src.className = 'src'; var h = document.createElement('small'); h.textContent = 'Sources'; src.appendChild(h);
      var ol = document.createElement('ol');
      r.sources.forEach(function (x) { var li = document.createElement('li'), a = document.createElement('a'), host = ''; try { host = new URL(x.url).hostname.replace(/^www\./, ''); } catch (e) {} a.href = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = x.title || host || x.url; li.appendChild(a); if (host && x.title) { var hs = document.createElement('span'); hs.textContent = ' · ' + host; li.appendChild(hs); } ol.appendChild(li); });
      src.appendChild(ol); d.appendChild(src);
    }
    (r.made || []).forEach(function (id) { var m = Kin.mind.getMade(id); if (!m || d.querySelector('[data-made="' + id + '"]')) return;
      if (m.kind === 'chart' && m.spec && Kin.chart) { var cc = document.createElement('div'); cc.className = 'chartcard'; d.appendChild(cc); try { Kin.chart.mount(cc, m.spec); } catch (e) { cc.remove(); } }
      var b = document.createElement('button'); b.type = 'button'; b.className = 'madeb'; b.dataset.made = id; b.textContent = 'Open ' + (m.kind === 'design' ? 'the design' : 'the ' + m.kind) + ': ' + m.title; d.appendChild(b); });
    if (r.source === 'claude' && !r.code && !r.declined) {
      var meta = document.createElement('div'); meta.className = 'meta'; var bits = [];
      var model = String(r.model || ''); bits.push(/haiku/.test(model) ? 'Quick' : 'Opus 5.5');
      if (r.route === 'make') bits.push('deep'); if (r.route === 'compute') bits.push('with code');
      if (r.searches) bits.push(r.searches + (r.searches === 1 ? ' search' : ' searches'));
      if (r.checked === 'ok') bits.push('checked'); else if (r.checked === 'revised') bits.push('checked and corrected');
      if (r.cost) bits.push('about $' + (r.cost < 0.01 ? r.cost.toFixed(3) : r.cost.toFixed(2)));
      var mt = document.createElement('span'); mt.textContent = bits.join(' · '); meta.appendChild(mt);
      ['Good', 'Not right'].forEach(function (lab, k) { var b = document.createElement('button'); b.type = 'button'; b.className = 'thumb'; b.textContent = lab; b.addEventListener('click', function () { if (meta.dataset.rated) return; meta.dataset.rated = '1'; Kin.mind.rate(q, text, k === 0); b.setAttribute('aria-pressed', 'true'); mt.textContent = bits.join(' · ') + (k === 0 ? ' · noted, sir' : ' · noted; I will do better, sir'); }); meta.appendChild(b); });
      d.appendChild(meta);
    }
    var t = $('thread'); t.scrollTop = t.scrollHeight;
  }

  /* ------------------------------------------------------------ speaking */
  /** what is said aloud is shorter than what is shown: plain words, the first few sentences */
  function plain(text) {
    /* a path like "Settings > Your data" is read (and captioned) as "Settings, then Your data" instead of losing its separators */
    return String(text).replace(/```[\s\S]*?```/g, ' ').replace(/^\s*>\s?/gm, '').replace(/(\S)[ \t]+(?:>|&gt;|›)[ \t]+(?=[A-Z])/g, '$1, then ').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1').replace(/\(?https?:\/\/[^\s)]+\)?/g, ' ').replace(/^\s*\|.*\|\s*$/gm, ' ').replace(/^#{1,4}\s+/gm, '').replace(/^\s*(?:[-*]|\d+[.)])\s+/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`>|]/g, '').replace(/#(\d+)/g, 'number $1').replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').replace(/:\./g, ':').replace(/\s+/g, ' ').trim();
  }
  /** the part of a long answer that is read aloud. It only ever grows as the answer grows, so it can be spoken while streaming. */
  function head(t) { if (t.length <= 620) return t; var cut = t.slice(0, 620), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? ')); return cut.slice(0, end > 200 ? end + 1 : 620); }
  function spoken(text) { var t = plain(text), h = head(t); return h.length < t.length ? h + ' The rest is on screen, sir.' : t; }
  /** A browser will not play sound until the page has had a tap or a key press. Until then nothing is spoken,
      and nothing is sent to the voice service either, so nothing is billed for words nobody hears. */
  function say(text, raw) { var t = raw ? String(text) : spoken(text); if (!S.unlocked) return Promise.resolve(); S.said = ears.norm(t); return voice.say(t); }
  voice.on(function (e) {
    if (e.type === 'ttsfail') { S.ttsWhy = e.reason; S.ttsShown = false; refreshSettings(); return; }
    if (e.type === 'line') { if (!S.line && S.talking) S.spokeAt = Date.now(); S.line = ears.norm(e.text); S.lines = S.lines.concat(S.line).slice(-4); if (S.talk !== 'off' || S.speakTyped || S.testing) { var why = S.ttsWhy && !S.ttsShown ? S.ttsWhy + ' Using the backup voice' : ''; caption(e.text, why || (S.talk === 'awake' ? awakeHint() : '')); } return; }
    var was = S.talking; S.talking = e.state === 'speaking';
    clearInterval(beatI);
    if (S.talking) {
      beatI = setInterval(function () { if (Math.random() < 0.8) bust.beat(0.55 + Math.random() * 0.45); duckCheck(); }, 170); if (ears.isSafari) ears.hold(true);
      /* the clock for "Jarvis has been speaking a moment" starts with the first words actually heard (the first line), not before them */
      if (!was) { S.spokeAt = Date.now() + 60000; S.line = ''; S.lines = []; }
      /* anything half-heard as Jarvis starts to speak is its own voice or is now out of date: let it go */
      tail = ''; clearTimeout(hearT); if (buf) hearT = setTimeout(commit, 800);
    }
    if (was && !S.talking) { var cut = Date.now() - S.voiceBargeAt < 1500; voice.duck(false);
      /* talked over by voice, where a meter showed someone actually speaking: what they go on to say is not cut off.
         A tap, a spoken "stop" or "wait" keeps the usual short deaf moment. The echo check stays on either way. */
      S.deafUntil = cut ? 0 : Date.now() + Kin.T.hard; S.softUntil = cut ? 0 : Date.now() + Kin.T.deaf; S.saidAt = Date.now(); if (S.ttsWhy) S.ttsShown = true; if (ears.isSafari) ears.hold(false); touch(); captionFade(3200); }
    paint();
  });
  /** why the browser will not let Kin listen, in a few words for the caption and in full for settings */
  function blockedWhy(reason) {
    if (reason === 'no-microphone') return { short: 'This device has no microphone I can use.', small: 'Plug one in or allow it, then reload', full: 'This device has no microphone I can use, or another app is holding it. Plug one in or close the other app, then reload.' };
    if (reason === 'service-not-allowed') return ears.isSafari
      ? { short: 'Safari’s speech service is off.', small: 'Turn on Dictation, then reload. Details in settings', full: 'Safari’s speech service is off. Turn on Dictation in System Settings > Keyboard, and allow Safari under Privacy & Security > Speech Recognition, then reload.' }
      : { short: 'The browser’s speech service refused.', small: 'Allow the microphone, then reload. Details in settings', full: 'This browser’s speech service refused to start. In Chrome, click the icon left of the address and allow the microphone for this site, then reload. If it still refuses, the browser’s speech service may be off on this computer.' };
    return { short: 'The microphone is blocked for this site.', small: 'Allow it, then reload. Details in settings', full: 'The microphone is blocked for this site. In Safari: Settings > Websites > Microphone > Allow (in Chrome: the icon left of the address), then reload.' };
  }
  function deaf() { return S.talking || Date.now() < S.deafUntil; }
  /** a tap on the pill or a spoken "stop" while Jarvis speaks: quiet now, and an answer still arriving is stopped too, so nothing more is spent on it */
  function hushNow() { S.bargeAt = Date.now(); S.hushed = S.askN; voice.stop(); if (S.busy && S.ctl) { try { S.ctl.abort(); } catch (e) {} } paint(); }

  /* ------------------------------------------------------------ talking over Kin */
  /** Talking while Jarvis speaks stops it. An open mic also hears Kin through the speakers (and a phone has no
      meter to tell a voice in the room from Kin's own), so the rules are strict:
      - The words must not be mostly what Jarvis has been saying: its last four spoken lines are checked, because
        recognizers deliver words late.
      - With no meter (phones, Safari, shared addresses): only a phrase that leads with an interrupting word
        ("stop", "wait", "hold on", "no Jarvis") counts, only once the recognizer has settled on it, and it only
        stops Kin. Anything said after it must pass the usual checks before it is sent.
      - With a meter (a computer, the browser's echo cancelling on): two or more words while the room is
        actually loud also count, and what is said goes on as the next question.
      - Not in the first moment of a reply, and only while awake. Asleep, only "stop" works. */
  var LEAD2 = /^(hold on|hang on|no jarvis|no kin|hey jarvis|excuse me|jarvis stop|jarvis wait|one second|one sec)\b/;
  var LEAD1 = /^(stop|wait|pause|enough|quiet|cancel)\b/;
  function loud() { var lv = ears.level(); return lv != null && lv >= Kin.T.bargeLevel; }
  function kinRef() { return ' ' + S.lines.join(' ') + ' ' + S.line + ' '; }
  function mostlyKin(words, ref) { if (!words.length) return false; var hit = 0; words.forEach(function (w) { if (ref.indexOf(' ' + w + ' ') >= 0) hit++; }); return hit / words.length >= 0.5; }
  function bargeIn(text, fin) {
    if (!S.talking || !Kin.T.barge || S.talk !== 'awake' || Date.now() - S.spokeAt < Kin.T.bargeGrace) return false;
    var n = ears.norm(text), a = n.split(' ').filter(Boolean); if (!a.length) return false;
    var ref = kinRef(), lead = (LEAD2.exec(n) || LEAD1.exec(n) || [''])[0];
    if (lead && ref.indexOf(' ' + lead + ' ') >= 0) lead = '';
    var rest = lead ? a.slice(lead.split(' ').length) : a;
    if (rest.length && mostlyKin(rest, ref)) return false;
    var lv = ears.level(), metered = lv != null;
    if (metered && lv < Kin.T.bargeLevel) return false;
    if (lead ? !fin : (!metered || a.length < 2)) return false;
    S.bargeAt = Date.now(); if (metered && !lead) S.voiceBargeAt = S.bargeAt; S.barges++; S.hushed = S.askN;
    voice.stop(); bust.beat(1); touch(); paint();
    if (metered && !lead) return text;
    /* after "wait" or "hold on", only the words that follow go on, and only through the usual echo checks */
    var words = String(text).trim().split(/\s+/), after = words.slice(lead.split(' ').length).join(' ');
    return after.split(/\s+/).filter(Boolean).length >= 2 ? after : '';
  }
  /** the words Kin was saying that ran into the start of what the founder said over it */
  function stripKin(q) {
    if (Date.now() - S.bargeAt > 8000) return q;
    /* only a run of two or more words that Kin said in that order, at the very start (all of it, if all of it was Kin) */
    var w = q.split(/\s+/), ref = kinRef(), k = 0;
    for (var j = 2; j <= w.length; j++) { var run = ears.norm(w.slice(0, j).join(' ')); if (run && ref.indexOf(' ' + run + ' ') >= 0) k = j; else break; }
    return k ? w.slice(k).join(' ') : q;
  }
  /** Where there is a meter, someone loud while Jarvis speaks turns Kin's voice down at once, before the words
      are even recognised; it comes back up if nothing is said within a moment. */
  var duckAt = 0;
  function duckCheck() {
    if (!S.talking || S.talk !== 'awake' || Date.now() - S.spokeAt < Kin.T.bargeGrace) return;
    var lv = ears.level(); if (lv == null) return;
    if (lv >= Kin.T.bargeLevel * 1.5) { if (!duckAt) voice.duck(true); duckAt = Date.now(); }
    else if (duckAt && Date.now() - duckAt > 1200) { duckAt = 0; voice.duck(false); }
  }
  /** An open mic also hears Kin. Words that are mostly what Kin just said are its echo, not a question.
      Soon after it spoke, most of its words coming back is enough; later only a long run of them is.
      A reply that opens with a word Kin did not say ("yes, draft the order") is the founder answering. */
  var OPENER = /^(yes|yeah|yep|yup|no|nope|nah|please|sure|ok|okay|do|go|dont|actually|and|but|then)$/;
  function echo(text) {
    if (!S.said) return false; var now = Date.now(), age = now - S.saidAt; if (!S.talking && age > Kin.T.echo) return false;
    var a = ears.norm(text).split(' ').filter(Boolean), said = ' ' + S.said + ' ' + S.lines.join(' ') + ' ', hit = 0, soft = now < (S.softUntil || 0);
    if (a.length < (soft ? 1 : 2)) return false;
    if (OPENER.test(a[0]) && said.indexOf(' ' + a[0] + ' ') < 0) return false;
    a.forEach(function (w) { if (said.indexOf(' ' + w + ' ') >= 0) hit++; });
    var r = hit / a.length;
    /* in the two seconds after Jarvis stops, recognizers are still finishing its last sentence: be strict */
    if (soft) return r >= 0.5;
    return (S.talking || age <= 6000) ? r >= 0.7 : (a.length >= 5 && r >= 0.85);
  }

  /* ------------------------------------------------------------ waking and sleeping */
  /** must run inside a tap or key press at least once: lets the page play sound and speak */
  function gesture() { var was = S.unlocked; voice.unlock(); ears.wakeMeter(); S.unlocked = true; if (!was && S.talk === 'awake' && cap.classList.contains('on') && !cap.classList.contains('you')) $('capS').textContent = awakeHint(); }
  /** An exchange just happened (a wake, a question sent, Kin finished speaking, a tap). Kin stays awake for a
      short while after one and then goes back to sleep. Speech that was merely overheard does not count, so a
      television or a meeting in the room cannot keep it awake and sending. */
  function touch() { S.lastEx = Date.now(); S.snooze = 0; clearTimeout(idleT); if (S.talk === 'awake') idleT = setTimeout(drowse, Kin.T.follow); }
  function drowse() {
    if (S.talk !== 'awake') return;
    if (S.busy || S.talking) { idleT = setTimeout(drowse, 3000); return; }
    /* someone is mid-sentence: give them one short extension, once */
    if ((buf || tail) && !S.snooze) { S.snooze = 1; idleT = setTimeout(drowse, 6000); return; }
    sleep(true);
  }
  function cue() { S.talk = 'awake'; S.wakes++; caption(null); flare(); voice.chime('wake'); touch(); paint(); }
  function greetNow(rest) {
    rest = String(rest || '').trim();
    if (rest.split(/\s+/).length >= 2 && !ears.sleepIn(rest)) { ask(rest); return; }
    var line = S.greeted ? voice.CLIPS.service : voice.CLIPS.welcome; S.greeted = true;
    caption(line, awakeHint()); say(line, true); paint();
  }
  function wakeNow() { gesture(); if (ears.supported && !ears.wanted()) ears.start(); if (S.talk === 'awake') { touch(); paint(); return; } cue(); greetNow(''); }
  function sleep(silent) {
    if (S.talk !== 'awake') return;
    S.talk = ears.wanted() ? 'asleep' : 'off'; buf = tail = ''; S.queued = ''; clearTimeout(hearT); clearTimeout(idleT); clearTimeout(typeT);
    voice.stop(); flare(true); voice.chime('sleep');
    if (!silent) say(voice.CLIPS.standby, true);
    caption(S.talk === 'asleep' ? sayPhrase() : 'Standing by, sir.', S.talk === 'asleep' ? sleepHint() : 'Tap here to wake Kin'); paint();
  }
  function stopAll() { voice.stop(); S.queued = ''; if (S.busy && S.ctl) S.ctl.abort(); if (Kin.bridge) Kin.bridge.stopAll(); if (Kin.gauntlet) Kin.gauntlet.stop(); if (Kin.mac && Kin.mac.busy()) Kin.mac.stop(); caption(null); }
  /** typed or spoken words that are orders to Kin itself, not questions */
  function command(text) {
    if (ears.wakeIn(text, S.wake, true)) { if (S.talk !== 'awake') cue(); else { flare(); voice.chime('wake'); touch(); } greetNow(''); return true; }
    if (S.talk !== 'awake') return false;
    if (ears.sleepIn(text)) { sleep(); return true; }
    if (ears.stopIn(text)) { stopAll(); return true; }
    return false;
  }

  /* ------------------------------------------------------------ hearing */
  function showHeard(t) { inp.value = t; if (t) caption(t.length > 150 ? '…' + t.slice(-147) : t, 'Listening', 'you'); }
  /** some phones repeat the whole phrase so far in each "final": keep the longer one instead of joining them */
  function join(a, b) { var na = ears.norm(a), nb = ears.norm(b); if (!na) return b; if (nb.indexOf(na) === 0) return b; if (na.length >= nb.length && na.slice(-nb.length) === nb) return a; return (a + ' ' + b).trim(); }
  function commit() {
    clearTimeout(hearT); var q = stripKin((buf + ' ' + tail).trim()), n = ears.norm(q); buf = tail = ''; if (!q || S.talk !== 'awake') return;
    /* a yes or no to a question Kin asked before spending: short words like "yeah" count here */
    if (pendingConfirm && !echo(q) && pendingConfirm.answer(q)) { showHeard(''); return; }
    if (n.length < 2 || /^(um+|uh+|hm+|mm+|ah+|oh|er+|okay|ok|yeah|yep|right|so|well|and|the|a|i)$/.test(n)) { showHeard(''); caption(null); return; }
    /* last line of defence: never send Kin its own words */
    if (echo(q)) { showHeard(''); caption(null); return; }
    /* nothing has passed between us for a while: these words were probably not meant for Kin */
    if (Date.now() - S.lastEx > Kin.T.follow + 7000 && !ears.wakeIn(q, S.wake)) { showHeard(''); sleep(true); return; }
    if (S.busy && !ears.sleepIn(q) && !ears.stopIn(q)) { S.queued = q; if (S.hushed === S.askN && S.ctl) { try { S.ctl.abort(); } catch (e) {} } return; }
    ask(q);
  }
  function heard(text, fin) {
    text = String(text || '').trim(); if (!text || S.talk === 'off') return;
    /* while Jarvis speaks, and for a moment after, nothing is taken in except "stop" */
    if (S.talking && ears.stopIn(text) && (fin || loud()) && kinRef().indexOf(' ' + ears.norm(text).split(' ').pop() + ' ') < 0) { hushNow(); if (fin) { tail = buf = ''; clearTimeout(hearT); showHeard(''); caption(null); } return; }
    if (deaf()) { var b = bargeIn(text, fin); if (!b) return; text = b; }
    /* Kin's own words, half-heard or whole: drop them, and drop the half-heard copy that was waiting */
    if (echo(text)) { tail = ''; clearTimeout(hearT); if (buf) hearT = setTimeout(commit, 800); return; }
    bust.beat(1);
    if (S.talk === 'asleep' || pendWake) {
      var m = ears.wakeIn(text, S.wake); if (!m && !pendWake) return;
      if (!pendWake) { pendWake = true; cue(); } clearTimeout(greetT);
      /* only words after a clearly heard wake phrase are sent on; anything else just wakes Kin */
      if (fin) { pendWake = false; greetNow(m ? m.rest : ''); }
      else greetT = setTimeout(function () { pendWake = false; greetNow(''); }, 1600);
      return;
    }
    if (fin) { tail = ''; buf = join(buf, text); clearTimeout(hearT); hearT = setTimeout(commit, 800); }
    else { tail = text; clearTimeout(hearT); hearT = setTimeout(commit, 3600); }
    showHeard((buf + ' ' + tail).trim());
  }
  ears.on(function (e) {
    if (e.type === 'partial') return heard(e.text, false);
    if (e.type === 'final') return heard(e.text, true);
    S.micState = e.state; S.micWhy = e.reason || ''; S.hearing = e.state === 'listening';
    if (e.state === 'paused') { buf = tail = ''; clearTimeout(hearT); if (!S.talking && !S.busy) caption('Listening is paused while this tab is in the background.', 'Come back to this tab and I listen again'); }
    if (e.state === 'starting' && e.reason === 'resume' && !S.talking && !S.busy) caption(S.talk === 'awake' ? 'Listening again, sir.' : sayPhrase(), S.talk === 'awake' ? '' : sleepHint());
    if (e.state === 'listening' && !coarse) ears.meter(true);
    if (e.state === 'listening') { ls.set('kin.micok', '1'); if (S.talk === 'off') { S.talk = 'asleep'; caption(sayPhrase(), sleepHint()); } else if (S.talk === 'asleep' && !S.talking) caption(sayPhrase(), sleepHint()); }
    if (e.state === 'blocked') { S.talk = S.talk === 'awake' ? 'awake' : 'off'; var bw = blockedWhy(e.reason); caption(bw.short, bw.small); }
    if (e.state === 'off' && e.reason !== 'stopped') { buf = tail = ''; clearTimeout(hearT); if (S.talk === 'asleep') S.talk = 'off'; if (!S.talking && !S.busy) caption(e.reason === 'stalled' ? 'Listening keeps cutting out here.' : 'The microphone closed.', e.reason === 'stalled' ? 'It should come back on its own in a moment. Or tap the mic' : 'Tap the mic to listen again'); }
    if (e.state === 'off' && e.reason === 'stopped' && S.talk === 'asleep') { S.talk = 'off'; caption(null); }
    paint(); refreshSettings();
  });

  /* Words arriving in the box from the keyboard's own dictation are sent on a pause. Only when the browser says
     the words were dictated, or after the mic button was tapped on a browser that cannot listen by itself:
     swipe typing and word suggestions also add several letters at once and must not send a half-typed line. */
  function typed(e) {
    var v = inp.value, grew = v.length - lastLen, it = (e && e.inputType) || ''; lastLen = v.length; if (!v) multi = single = 0;
    if (S.hearing) return; clearTimeout(typeT);
    if (/Paste|Drop|delete/i.test(it) || grew < 0) return;
    if (/ictation/i.test(it) || (S.kbMic && grew >= 3)) multi++; else if (grew === 1) single++;
    if (!(multi >= 1 && single <= multi * 2) || !v.trim()) return;
    bust.beat(0.8);
    typeT = setTimeout(function () { var q = inp.value.trim(); if (!q) return; if (S.busy) { S.queued = q; inp.value = ''; lastLen = 0; return; } ask(q); }, 1700);
  }

  /* ------------------------------------------------------------ asking */
  /* ------------------------------------------------------------ asking before spending
     A job that will cost real money (a big design job, Higgsfield credits) stops and asks once.
     The founder answers with the buttons, or by saying or typing yes or no. */
  var pendingConfirm = null;
  var YES = /^(yes|yeah|yep|yup|sure|ok|okay|go|go ahead|go for it|do it|make them|make it|please do|approved|approve|yes please|start|start it)( sir| kin| jarvis)?$/,
    NO = /^(no|nope|not now|skip|skip (them|pictures)|cancel|cancel (that|it)|stop|stop (it|that|the job)|decline|declined|dont|do not|dont do it|no thanks|no thank you)( sir| kin| jarvis)?$/,
    DRAW = /^(go )?(without|with no|no) pictures( please)?( sir| kin| jarvis)?$|^draw (it|them)( instead)?( sir| kin| jarvis)?$/;
  function el(tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }
  /** A card that asks before anything is spent. card: { label, title, price, priceNote, lines, say, choices: [{ k, label, kind: 'go' | 'alt' | 'stop', note }] }.
      Resolves { k, d } with the chosen key; the founder's stop, a spoken "no" or "decline", or the job being stopped resolve the 'stop' choice. */
  function choiceCard(card) {
    return new Promise(function (res) {
      var t = $('thread'), d = el('div', 'msg kin ask card'), choices = card.choices || [];
      var stopK = (choices.filter(function (c) { return c.kind === 'stop'; })[0] || choices[choices.length - 1] || {}).k;
      var head = el('div', 'chead'); head.appendChild(el('span', 'chip', card.label || 'Jarvis asks first')); if (card.kindName) head.appendChild(el('span', 'chip ghost', card.kindName)); d.appendChild(head);
      d.appendChild(el('p', 'asktitle', card.title));
      if (card.price) { var pr = el('div', 'cprice'); pr.appendChild(el('b', '', card.price)); if (card.priceNote) pr.appendChild(el('span', '', card.priceNote)); d.appendChild(pr); }
      var body = el('div', 'cbody'); (card.lines || []).forEach(function (l) { body.appendChild(el('p', 'cline', l)); }); d.appendChild(body);
      var bt = el('div', 'cbtns'), btns = [];
      choices.forEach(function (c) {
        var b = el('button', 'pill ' + (c.kind === 'go' ? 'go askyes' : c.kind === 'alt' ? 'alt askalt' : 'stop askno')); b.type = 'button'; b.dataset.k = c.k;
        b.appendChild(el('span', 'pl', c.label)); if (c.note) b.appendChild(el('span', 'pn', c.note));
        b.addEventListener('click', function () { gesture(); done(c.k); }); bt.appendChild(b); btns.push(b);
      });
      d.appendChild(bt);
      /* the question sits above the answer that is waiting on it */
      var cur = t.lastElementChild; if (S.busy && cur && cur.classList.contains('kin') && !cur.classList.contains('ask')) t.insertBefore(d, cur); else t.appendChild(d);
      function done(k) {
        if (!pendingConfirm || pendingConfirm.d !== d) return; pendingConfirm = null; S.confirming = false;
        btns.forEach(function (b) { b.disabled = true; });
        d.classList.add('answered'); d.dataset.chose = k;
        var c = choices.filter(function (x) { return x.k === k; })[0] || {};
        if (k === stopK) { d.classList.add('declined'); bt.remove(); body.remove(); var pr2 = d.querySelector('.cprice'); if (pr2) pr2.remove(); d.appendChild(el('p', 'cresult', card.noNote || 'Stopped. Nothing was spent.')); }
        else if (card.yesNote) d.appendChild(el('p', 'cresult', card.yesNote));
        if (!card.quiet) caption(k === stopK ? 'Understood, sir. Stopped.' : 'Thank you, sir. ' + (c.label === 'Go' ? 'Starting now.' : 'Working on it.'), k === stopK ? '' : 'Working');
        res({ k: k, d: d });
      }
      pendingConfirm = { d: d, done: done, answer: function (q) {
        var x = ears.norm(q), has = function (k) { return choices.some(function (c) { return c.k === k; }); };
        if (DRAW.test(x) && has('draw')) { done('draw'); return true; }
        if (/\bcompose\b/.test(x) && has('compose')) { done('compose'); return true; }
        if (YES.test(x)) { done(choices[0].k); return true; }
        if (NO.test(x)) { done(stopK); return true; }
        return false; } };
      S.confirming = true;
      if (S.ctl) S.ctl.signal.addEventListener('abort', function () { done(stopK); });
      showThread(); d.scrollIntoView({ block: 'end' });
      caption(card.title + (card.price ? ': ' + card.price : ''), 'Tap ' + choices.map(function (c) { return c.label; }).join(', ') + ', or say yes or no');
      if (card.say && (S.talk === 'awake' || S.speakTyped) && S.unlocked) say(card.say, true);
    });
  }
  /** the yes-or-no card other parts of the page use: resolves true or false */
  function confirmCard(card) {
    return choiceCard({ label: card.label || 'Jarvis asks before spending', title: card.title, lines: card.lines, say: card.say, quiet: card.quiet, noNote: card.noNote || 'Declined. Nothing was spent on this.', yesNote: card.yesNote || 'Approved.',
      choices: [{ k: 'yes', label: card.yes || 'Go ahead', kind: 'go' }, { k: 'no', label: card.no || 'Not now', kind: 'stop' }] }).then(function (r) { return r.k === 'yes'; });
  }

  /* ---- a design job, live: the card becomes this panel the moment the founder says Go ---- */
  var JOB_STEPS = [['brief', 'Brief'], ['concepts', 'Three concepts'], ['pictures', 'Pictures'], ['director', 'Art director'], ['refine', 'Refining'], ['done', 'Done']];
  var POSTER_STEPS = [['brief', 'Art direction'], ['pictures', 'Three posters'], ['director', 'Every word read'], ['refine', 'Refinement'], ['done', 'Done']];
  function money(v) { v = v || 0; return v > 0 && v < 0.005 ? '<$0.01' : '$' + v.toFixed(2); }
  function clock(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function jobPanel(d, card, k, question) {
    var t0 = Date.now(), cur = '', spentV = 0, ended = false, picsSent = false, pics = !!card.pics && k !== 'draw', steps = k === 'poster' ? POSTER_STEPS : JOB_STEPS;
    d.className = 'msg kin ask card job live'; d.innerHTML = '';
    var head = el('div', 'chead'), chip = el('span', 'chip live', 'Working'); head.appendChild(chip); var kn = k === 'poster' ? 'Poster job' : (card.kindName === 'Poster job' ? 'Design job' : card.kindName || 'Design job'); head.appendChild(el('span', 'chip ghost', kn + ' \u00b7 ' + (k === 'poster' ? 'Full poster' : pics ? 'With pictures' : 'Drawn'))); d.appendChild(head);
    d.appendChild(el('p', 'asktitle', card.title));
    var stats = el('div', 'jstats'), tm = el('b', 'jtime', '0:00'), sp = el('b', 'jspent', '$0.00');
    [['Time', tm], ['Spent so far', sp]].forEach(function (x) { var c = el('div', 'jstat'); c.appendChild(el('span', 'lab', x[0])); c.appendChild(x[1]); stats.appendChild(c); });
    d.appendChild(stats);
    var ol = el('ol', 'jsteps'), lis = {};
    function drawSteps() { ol.innerHTML = ''; lis = {}; steps.forEach(function (st) { if (st[0] === 'pictures' && !pics) return; var li = el('li', 'step', st[1]); li.dataset.k = st[0]; ol.appendChild(li); lis[st[0]] = li; }); }
    drawSteps(); d.appendChild(ol);
    var now = el('p', 'jnow', 'Starting…'); d.appendChild(now);
    var bt = el('div', 'cbtns'), stop = el('button', 'pill stop jstop'); stop.type = 'button'; stop.appendChild(el('span', 'pl', 'Stop the job')); var stopNote = el('span', 'pn', 'Stops every request now. Nothing more is spent.'); stop.appendChild(stopNote);
    stop.addEventListener('click', function () { gesture(); if (S.ctl) S.ctl.abort(); }); bt.appendChild(stop); d.appendChild(bt);
    var tick = setInterval(function () { if (ended) return clearInterval(tick); tm.textContent = clock(Date.now() - t0); }, 1000);
    function step(key) {
      if (ended || !lis[key]) return; cur = key; var seen = true;
      steps.forEach(function (st) { var li = lis[st[0]]; if (!li) return; if (st[0] === key) { seen = false; li.className = 'step on'; } else li.className = seen ? 'step ok' : 'step'; });
      if (key === 'done') lis.done.className = 'step ok';
    }
    var api = {
      step: step,
      /* the poster could not be made: the job carries on as a composed design, and the steps say so */
      reroute: function () { if (ended) return; steps = JOB_STEPS; pics = pics && !picsSent; drawSteps(); var gh = head.querySelector('.chip.ghost'); if (gh) gh.textContent = 'Design job (composed)' + (pics ? ' \u00b7 With pictures' : ''); },
      /* the picture batch has gone to Higgsfield: a stop can no longer take it back */
      sent: function () { if (ended) return; picsSent = true; stopNote.textContent = 'Stops every request now. Pictures already sent to Higgsfield may still be charged.'; },
      status: function (s) { if (!ended && s) now.textContent = s; },
      spend: function (v) { spentV = v || 0; sp.textContent = money(spentV); },
      /** the job is over: done, stopped by the founder, or failed (with the reason and what to do) */
      end: function (r, out) {
        if (ended) return; ended = true; clearInterval(tick); tm.textContent = clock(Date.now() - t0);
        var cost = r.cost != null ? r.cost : spentV; if (cost) sp.textContent = money(cost);
        bt.innerHTML = ''; d.classList.remove('live'); chip.classList.remove('live');
        if (r.made && r.made.length) {
          step('done'); d.classList.add('done'); chip.textContent = 'Done'; now.textContent = (/^.*?[.!?](\s|$)/.exec(out) || [out])[0].trim();
          var open = el('button', 'pill go'); open.type = 'button'; open.appendChild(el('span', 'pl', 'Open the design')); var id = r.made[r.made.length - 1];
          open.addEventListener('click', function () { gesture(); openShelf('made', id); }); bt.appendChild(open);
        } else {
          d.classList.add('bad'); chip.textContent = 'Stopped';
          if (lis[cur]) lis[cur].className = 'step bad';
          var by = r.code === 'stopped' && !r.stalled;
          now.textContent = by ? 'You stopped it' + (cur && lis[cur] ? ' at ' + lis[cur].textContent.toLowerCase() : '') + '. Spent about ' + money(cost) + (picsSent ? '. Pictures already sent to Higgsfield may still be charged.' : '; nothing more will be spent.') : out;
          if (!by && r.todo) d.insertBefore(el('p', 'jtodo', r.todo), bt);
          if (!by && r.detail) d.insertBefore(el('p', 'jdetail', r.detail), bt);
          var again = el('button', 'pill alt'); again.type = 'button'; again.appendChild(el('span', 'pl', 'Try again')); again.addEventListener('click', function () { gesture(); if (!S.busy) ask(question); }); bt.appendChild(again);
        }
      }
    };
    step('brief'); now.textContent = 'Writing the brief';
    return api;
  }
  Kin.confirm = confirmCard;

  function ask(text) {
    text = String(text || '').trim(); if (!text) return;
    if (pendingConfirm && pendingConfirm.answer(text)) { inp.value = ''; lastLen = 0; return; }
    /* "Turn on away mode, sir?" answered with a plain yes, within two minutes */
    if (awayYes && Date.now() < awayYes) { var yes = /^(?:yes|yeah|yep|yes please|please do|do it|go ahead|turn it on|sure)(?:,? sir)?[.!]*$/i.test(text.trim()); awayYes = 0; if (yes) { inp.value = ''; lastLen = 0; touch(); addMsg('you', text); awayAsk({ k: 'on' }); return; } }
    if (command(text)) { inp.value = ''; lastLen = 0; return; }
    /* "ask Grok Bot ...": handled on this device and by the founder's relay only; never sent to Claude */
    var gi = Kin.bridge && Kin.bridge.intent(text);
    if (gi) { bridgeAsk(text, gi.q); return; }
    if (!Kin.bridge && Kin.features && Kin.features.grokAsked(text)) { inp.value = ''; lastLen = 0; touch(); addMsg('you', text); gbReply('The Grok Bot bridge isn\u2019t switched on yet, sir.', 'Nothing was sent'); return; }
    /* at the desk: the screen, and tabs, only from the founder's own words; handled here, nothing goes to Claude */
    if (Kin.desk && deskAsk(text)) return;
    /* apps, files and "do it on my computer" need the Jarvis Mac app; in a browser, say so plainly instead of asking Claude */
    if (Kin.mac && !Kin.mac.available() && Kin.mac.needsMac(text)) { inp.value = ''; lastLen = 0; touch(); addMsg('you', text); var mq = localReply(Kin.mac.NEED_TEXT, 'Mac app only'); mq.parentNode.appendChild(Kin.mac.need()); showThread(); return; }
    /* "check my inbox" / "open my email": the inbox panel; reading itself waits for a tap (Google's window is a popup) */
    if (Kin.email && /^(?:jarvis |kin )?(?:(?:open|show)(?: me)? (?:my |the )?inbox|(?:check|read)(?: me)? (?:my |the )?(?:inbox|emails?|mail))\b/i.test(ears.norm ? ears.norm(text) : text)) {
      inp.value = ''; lastLen = 0; touch(); addMsg('you', text); openShelf('inbox');
      var il = Kin.email.canRead() ? 'Your inbox, sir. Tap Check inbox and I will read what is unread.' : 'To read your inbox I need your Google Client ID in Settings, Email, sir.';
      addMsg('kin', il); if (S.unlocked && voice.canSpeak()) say(il, true); return;
    }
    /* "open my calendar" / "what's on my calendar": the calendar panel; reading waits for a tap */
    if (Kin.email && /^(?:jarvis |kin )?(?:(?:open|show|check)(?: me)? (?:my |the )?(?:calendar|schedule|agenda)|whats on my (?:calendar|schedule))\b/i.test(ears.norm ? ears.norm(text) : text)) {
      inp.value = ''; lastLen = 0; touch(); addMsg('you', text); openShelf('cal');
      var cl = Kin.email.canRead() ? 'Your calendar, sir. Tap Next 3 days and I will read it.' : 'To read your calendar I need your Google Client ID in Settings, Email, sir.';
      addMsg('kin', cl); if (S.unlocked && voice.canSpeak()) say(cl, true); return;
    }
    /* "open my outbox" / "show my drafts": the outbox, no model call needed */
    if (Kin.email && /^(?:jarvis |kin )?(?:open|show|check)(?: me)? (?:my |the )?(?:outbox|drafts|email drafts|draft emails)\b/i.test(ears.norm ? ears.norm(text) : text)) {
      inp.value = ''; lastLen = 0; touch(); addMsg('you', text); openShelf('outbox');
      var n = Kin.email.waiting().length, line = n ? 'Your outbox, sir. ' + n + (n === 1 ? ' email is' : ' emails are') + ' waiting.' : 'Your outbox is empty, sir.';
      addMsg('kin', line); if (S.unlocked && voice.canSpeak()) say(line, true); return;
    }
    if (S.busy) return;
    if (Kin.briefBoard && Kin.briefBoard.isBriefRequest(text)) { inp.value = ''; lastLen = 0; touch(); brief(text); return; }
    /* a video or a recording, and Bluetooth or USB devices: their own panels; nothing is sent until the founder picks */
    if (Kin.watch && Kin.watch.isRequest(text)) { inp.value = ''; lastLen = 0; touch(); addMsg('you', text); watch(text); return; }
    if (Kin.devices && Kin.devices.isRequest(text)) { inp.value = ''; lastLen = 0; touch(); addMsg('you', text); devices(); return; }
    /* away mode and practice calls: handled on this device; nothing goes to Claude, and no real call is made */
    var ai = Kin.awayPanel && Kin.awayPanel.intent(text);
    if (ai) { inp.value = ''; lastLen = 0; touch(); addMsg('you', text); awayAsk(ai); return; }
    /* the Gauntlet: "test yourself" only opens the panel; nothing runs until the founder taps Run */
    if (Kin.gauntlet && Kin.gauntlet.isRequest(text)) { inp.value = ''; lastLen = 0; touch(); addMsg('you', text); gauntlet(true); return; }
    /* "what's new": a list of the newest abilities; each Try it only opens a panel */
    if (Kin.whatsNew && Kin.whatsNew.isRequest(text)) { inp.value = ''; lastLen = 0; touch(); addMsg('you', text); whatsNew(true); return; }
    var now = Kin.mind.instant(text);
    if (now) { instantly(text, now); return; }
    var me = ++S.askN, hushed = function () { return S.hushed === me; };
    var aloud = S.talk === 'awake', p = null, got = false, t0 = Date.now(), momT = 0, watchI = 0, sess = null, lastSign = Date.now(), stalled = false, pr, making = false, job = null;
    inp.value = ''; lastLen = 0; multi = single = 0; S.asks++; touch();
    addMsg('you', text); p = addMsg('kin', '…');
    caption(text.length > 150 ? text.slice(0, 147) + '…' : text, 'Thinking', 'you');
    S.busy = true; S.ctl = new AbortController(); S.speakTyped = !aloud && S.unlocked; paint();
    var speakIt = (aloud || S.speakTyped) && S.unlocked;
    /* a long silence feels broken: say so once, and never wait forever, before the first word or after it */
    momT = setTimeout(function () { if (S.busy && !got && !S.talking && speakIt && !hushed()) say(voice.CLIPS.moment, true); }, 6500);
    watchI = setInterval(function () { if (!S.busy) { clearInterval(watchI); return; } if (S.confirming) { lastSign = Date.now(); return; } if (Date.now() - lastSign > (making ? Kin.T.making : got ? Kin.T.quiet : Kin.T.firstText)) { stalled = true; try { S.ctl.abort(); } catch (e) {} } }, 1000);
    function finish(r) {
      S.last = { ms: Date.now() - t0, source: r.source, code: r.code || '', model: r.model || '' };
      var out = r.text || (r.code === 'stopped' ? (got ? p.textContent : 'Stopped.') : 'I have nothing to say to that, sir.');
      if (r.code === 'stopped' && stalled) { r.stalled = true; out = got ? p.textContent + ' … The answer stopped arriving, sir. Ask again.' : 'Claude is taking longer than usual, sir. Nothing came back in ' + Math.round((making ? Kin.T.making : Kin.T.firstText) / 1000) + ' seconds, so I stopped waiting.'; r.todo = 'Tap Retry, or ask again in a minute.'; brain.noteError({ code: 'timeout', type: 'no reply in time', model: r.model || '' }); }
      if (job) { job.end(r, out); if (r.code === 'stopped' && !r.stalled) out = 'Stopped, sir. Spent about $' + (r.cost || 0).toFixed(2) + '; nothing more will be spent.'; }
      if (r.source === 'local' && !S.toldLocal && !brain.hasKey()) { S.toldLocal = true; out = 'No Claude key on this device yet, sir, so this is only what I hold here. ' + out; }
      /* the detail of an error is for the eye only: it is never spoken and never sent to a voice service */
      var box = p.parentNode;
      if (r.detail) p.textContent = out + '\n' + r.detail; else settle(p, out, r, text);
      if (r.todo && !job && box) box.appendChild(el('p', 'note todo', r.todo));
      if ((r.stalled || /^(busy|api|network|timeout)$/.test(r.code || '')) && !job) { var rb = el('button', 'pill alt retry'); rb.type = 'button'; rb.appendChild(el('span', 'pl', 'Retry')); rb.addEventListener('click', function () { gesture(); rb.disabled = true; if (!S.busy) ask(text); }); if (box) box.appendChild(rb); }
      if (r.canContinue && !job && box) { var cb = el('button', 'pill go cont'); cb.type = 'button'; cb.appendChild(el('span', 'pl', 'Continue')); cb.addEventListener('click', function () { gesture(); cb.disabled = true; ask('Carry on with that from where you stopped, and finish it.'); }); box.appendChild(cb); }
      if (r.code === 'limit') { S.queued = ''; if (S.talk === 'awake') sleep(true); caption(out, 'Change the limit in settings'); if (speakIt) say(out, true); else captionFade(9000); refreshSettings(); return; }
      /* talked over: the rest of this answer stays on screen and is not read out; a new question goes next */
      if (r.code === 'stopped' && !stalled && hushed()) brain.keepTurn(text, got ? plain(p.textContent) + ' [interrupted by the founder]' : '[interrupted by the founder before the answer]');
      if (r.code === 'stopped' && got && !stalled) { if (sess && !hushed()) voice.stop(); if (!hushed()) caption(null); if (hushed() && S.queued && S.talk === 'awake') { var q0 = S.queued; S.queued = ''; setTimeout(function () { ask(q0); }, 120); } return; }
      if (sess && !hushed()) { var fin = spoken(out); S.said = ears.norm(fin); sess.finish(fin); }
      else if (speakIt && !hushed() && voice.canSpeak()) { var one = r.studio || job ? (/^.*?[.!?](\s|$)/.exec(plain(out)) || [plain(out)])[0].trim() : out; caption(spoken(one).slice(0, 190), r.detail || job ? 'The details are on screen' : ''); say(one, !!(r.studio || job)); }
      else { caption(spoken(out).slice(0, 260), r.source === 'local' ? 'From this device only' : !S.unlocked && aloud ? 'Tap once so I can speak' : ''); captionFade(9000); touch(); }
      /* what was made opens on the shelf; a typed answer with sources, or longer than what is read out, opens the conversation */
      if (Kin.desk && (job || (r.made && r.made.length))) Kin.desk.notify.done(r.made && r.made.length ? 'Kin finished it' : 'Kin stopped', (/^.*?[.!?](\s|$)/.exec(plain(out)) || [plain(out)])[0].trim());
      if (r.made && r.made.length) openShelf('made', r.made[r.made.length - 1]);
      else if (!aloud && !r.detail && ((r.sources && r.sources.length) || plain(out).length > 620)) showThread();
      else if (aloud && r.sources && r.sources.length && !S.talking) $('capS').textContent = 'Sources are in the conversation';
      if (S.queued && S.talk === 'awake') { var q = S.queued; S.queued = ''; setTimeout(function () { ask(q); }, 300); }
    }
    try {
      var aopts = { aloud: aloud, signal: S.ctl.signal,
        onText: function (t) { got = true; lastSign = Date.now(); p.textContent = t; var m = /^(.{30,190}?[.!?])(\s|$)/.exec(spoken(t)); if (m && !S.talking) caption(m[1], 'Jarvis');
          /* with a voice key, the first whole sentence is spoken while the rest is still arriving */
          /* only a spoken conversation is spoken while it streams: a typed answer is checked first, then its opening is read out */
          if (aloud && speakIt && !hushed() && voice.live()) { var c = head(plain(t)); if (!sess && /[.!?]["')\]]?\s/.test(c)) { clearTimeout(momT); sess = voice.begin(); } if (sess) { S.said = ears.norm(c); sess.feed(c); } } },
        onTool: function () { got = true; lastSign = Date.now(); },
        /* every event of a stream is a sign of life: thinking, a tool's input arriving, a search */
        onBeat: function () { lastSign = Date.now(); },
        onRoute: function (route) { making = route === 'make' || route === 'design'; },
        onStatus: function (st) { lastSign = Date.now(); if (job) job.status(st); if (!S.talking && !got) caption(text.length > 150 ? text.slice(0, 147) + '…' : text, st, 'you'); else if (!S.talking) $('capS').textContent = st; },
        onMade: function () { lastSign = Date.now(); refreshMade(); syncTouch(); },
        onRemember: function () { refreshSettings(); syncTouch(); },
        /* an email Kin wrote: a card under the answer; only the founder's tap sends it */
        onEmail: function (d) { lastSign = Date.now(); if (!Kin.email) return; var id = Kin.email.saveDraft(d), box = p && p.parentNode; if (box) box.appendChild(Kin.email.card(d, { id: id, onChange: outboxCount, onSay: function (t) { if (S.unlocked && voice.canSpeak()) say(t, true); } })); outboxCount(); showThread(); },
        /* a computer action inside the Mac app: a small card under the answer saying what was asked and what the Mac answered */
        onMac: function (node) { lastSign = Date.now(); var box = p && p.parentNode; if (box) box.appendChild(node); showThread(); },
        confirm: confirmCard,
        /* a design job: one card before anything is spent, then the same card shows the job live */
        plan: function (card) { return choiceCard(card).then(function (c) { if (/^(go|draw|poster|compose)$/.test(c.k)) { lastSign = Date.now(); job = jobPanel(c.d, card, c.k, text); } return c.k; }); },
        choose: function (card) { return choiceCard(card).then(function (c) { lastSign = Date.now(); if (c.k === 'stop' && S.ctl) S.ctl.abort(); return c.k; }); },
        onStep: function (k) { lastSign = Date.now(); if (job) job.step(k); },
        onSent: function () { if (job) job.sent(); },
        onReroute: function () { lastSign = Date.now(); if (job) job.reroute(); },
        onSpend: function (v) { if (job) job.spend(v); }
      };
      /* while the screen is shared, this question carries one downscaled snapshot of it, taken now and kept nowhere */
      var shot = Kin.desk && Kin.desk.screen.on() ? Kin.desk.screen.snap().catch(function () { return null; }) : Promise.resolve(null);
      pr = shot.then(function (img) { if (img) { aopts.image = img; aopts.onStatus('Looking at your screen'); } return brain.ask(text, aopts); });
    } catch (e) { pr = Promise.resolve({ text: 'Something went wrong on this page, sir. The reason is on screen.', detail: String((e && e.message) || e).slice(0, 200), source: 'local', code: 'error' }); }
    /* whatever happens, Kin must never be left "thinking" */
    function end() { clearTimeout(momT); clearInterval(watchI); S.busy = false; }
    Promise.resolve(pr).then(function (r) { end(); try { finish(r || { text: '', source: 'local', code: 'error' }); } catch (e) { caption('Something went wrong on this page, sir.', ''); captionFade(9000); } paint(); },
      function () { end(); caption('Something went wrong on this page, sir.', ''); captionFade(9000); paint(); });
  }
  Kin.ask = ask;

  /* ------------------------------------------------------------ at the desk: look at my screen, open a tab */
  function localReply(text, small) { var p = addMsg('kin', text); caption(text, small || ''); if (S.unlocked && (S.talk === 'awake' || S.speakTyped)) say(text, true); else captionFade(9000); return p; }
  function deskAsk(text) {
    var D = Kin.desk, done = function () { inp.value = ''; lastLen = 0; touch(); addMsg('you', text); };
    if (D.screen.stopAsked(text)) { done(); if (D.screen.on()) { D.screen.stop(); localReply('I have stopped looking at your screen, sir. Nothing was kept.'); } else localReply('I am not looking at your screen, sir.'); return true; }
    if (D.screen.asked(text)) {
      done();
      if (!D.screen.supported()) { localReply('I can look at your screen on a Mac, in Chrome or Safari, sir. Not on this device.'); return true; }
      if (D.screen.on()) { localReply('I can see your screen, sir. Ask away.', 'Sharing'); return true; }
      /* the browser only lets a page ask to share right after a tap or a key press; a spoken request has neither */
      var ua = navigator.userActivation;
      if (ua && !ua.isActive) {
        var q = localReply('Tap Share screen to start, sir.', 'The browser needs a tap'), sb = el('button', 'pill sm go sharebtn'); sb.type = 'button'; sb.appendChild(el('span', 'pl', 'Share screen'));
        sb.addEventListener('click', function () { gesture(); sb.disabled = true; shareScreen(); }); q.parentNode.appendChild(sb); showThread(); return true;
      }
      shareScreen(); return true;
    }
    var a = D.tab.asked(text); if (!a) return false;
    done(); var c = D.tab.check(a);
    if (!c.ok) { localReply(c.why, 'Nothing was opened'); return true; }
    /* inside the Jarvis Mac app the site opens in the default browser, after the Mac asks */
    if (Kin.mac && Kin.mac.available()) { var mp = localReply('Asking your Mac to open ' + c.host + ', sir.'); Kin.mac.openOwn(c.url, function (n) { mp.parentNode.appendChild(n); showThread(); }); return true; }
    var r = D.tab.open(c.url);
    if (r.opened) { localReply('Opened ' + c.host + ' in a new tab, sir.'); return true; }
    var p = localReply('The browser would not let me open ' + c.host + ' on my own, sir. Tap the link.', 'The link is in the conversation'), box = p.parentNode;
    var l = el('a', 'tablink', 'Open ' + c.host); l.href = c.url; l.target = '_blank'; l.rel = 'noopener noreferrer'; box.appendChild(l);
    if (r.hint) box.appendChild(el('p', 'tabhint', D.tab.hintText()));
    showThread(); return true;
  }
  function shareScreen() {
    var D = Kin.desk;
    caption('Choose the screen or window to share', 'Your browser asks', 'kin');
    D.screen.start().then(function () { localReply('I can see your screen now, sir. Each question you ask carries one snapshot of it; nothing is kept. Tap Stop on the pill to end it.', 'Sharing'); },
      function (e) { var n = e && e.name; localReply(n === 'NotAllowedError' || n === 'AbortError' ? 'Not shared, sir. Nothing was sent.' : 'The browser could not share the screen, sir (' + String((e && e.message) || e).slice(0, 80) + ').'); });
  }
  function screenUI(on) {
    var b = $('scr'), pill = $('sharePill'), D = Kin.desk; if (!b || !D) return;
    b.hidden = !D.screen.supported(); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', on ? 'Stop sharing your screen' : 'Look at my screen');
    pill.hidden = !on;
  }
  if (Kin.desk) {
    Kin.desk.screen.onChange(screenUI); screenUI(false);
    $('scr').addEventListener('click', function () { gesture(); if (Kin.desk.screen.on()) { Kin.desk.screen.stop(); localReply('I have stopped looking at your screen, sir. Nothing was kept.'); } else shareScreen(); });
    $('sharePill').addEventListener('click', function () { gesture(); Kin.desk.screen.stop(); localReply('I have stopped looking at your screen, sir. Nothing was kept.'); });
  }

  /* ------------------------------------------------------------ watch and listen, and the device lab */
  function panelSay(line) { if (!line) return; caption(line, ''); captionFade(6000); say(line); }
  function watch(text) {
    if (!brain.hasKey() || Kin.shared) { var m = Kin.shared ? Kin.SHARED_TEXT : 'Add your Claude key in Settings first, sir. Then I can watch it.'; addMsg('kin', m); panelSay(m); return; }
    Kin.watch.open({
      /* no fallback model here: the price shown ("at most") is for Opus 5.5 and holds */
      question: text, client: brain.client(), sttKey: voice.tts.canTranscribe(), sttPost: voice.tts.transcribe, betas: [], gate: brain.gate, limit: 0.5,
      onSpend: function (usd) { if (usd > 0) Kin.mind.addSpend(usd); },
      onSay: panelSay,
      onSave: function (item) { Kin.mind.addMade(item); refreshMade(); }
    });
  }
  function devices() { Kin.devices.open({ onSay: panelSay }); }
  var awayYes = 0;
  function awayAsk(it) {
    if (Kin.shared) { addMsg('kin', Kin.SHARED_TEXT); panelSay(Kin.SHARED_TEXT); return; }
    var line = Kin.awayPanel.handle(it, { onSay: panelSay });
    if (!line) return;
    var m = addMsg('kin', line); panelSay(line);
    if (it.k === 'ask-on' && m && m.parentNode) {
      /* away mode only comes on from a tap here or a spoken yes; nothing changes until then */
      awayYes = Date.now() + 120000;
      var b = el('button', 'pill sm go awayon'); b.type = 'button'; b.appendChild(el('span', 'pl', 'Turn on away mode'));
      b.addEventListener('click', function (e) { if (!e.isTrusted) return; gesture(); b.disabled = true; awayYes = 0; awayAsk({ k: 'on' }); });
      m.parentNode.appendChild(b); showThread();
    }
  }

  function gauntlet(said) {
    if (Kin.shared) { if (said) addMsg('kin', Kin.SHARED_TEXT); panelSay(Kin.SHARED_TEXT); return; }
    Kin.gauntlet.open({ onSay: panelSay });
    if (!said) return;
    var line = brain.hasKey() ? 'Here is the Gauntlet, sir. Nothing runs until you tap Run, and it stops at the budget cap.' : 'Here is the Gauntlet, sir. It needs your Claude key in Settings before it can run.';
    addMsg('kin', line); panelSay(line);
  }

  /* the What's new sheet: Try it opens the panel for that ability and nothing more; every panel waits for its own tap */
  function settingsAt(sg) {
    $('sheet').hidden = false; refreshSettings(); packCard();
    setTimeout(function () { var b = document.querySelector('#snav [data-sg="' + sg + '"]'); if (b) b.click(); }, 0);
  }
  function tryIt(k) {
    if (k === 'watch') { if (!brain.hasKey() || Kin.shared) $('sheet').hidden = true; if (Kin.watch) watch('watch this'); return; }
    if (k === 'devices') { if (Kin.devices) devices(); return; }
    if (k === 'away') { if (Kin.awayPanel) awayAsk({ k: 'settings' }); return; }
    if (k === 'book') {
      if (Kin.shared) { $('sheet').hidden = true; addMsg('kin', Kin.SHARED_TEXT); panelSay(Kin.SHARED_TEXT); return; }
      if (Kin.awayPanel) Kin.awayPanel.open('calls', { onSay: panelSay }); return;
    }
    if (k === 'talk') { settingsAt('voice'); return; }
    if (k === 'gauntlet') { if (Kin.gauntlet) gauntlet(false); return; }
    if (k === 'grok') { settingsAt('grok'); return; }
    if (k === 'move') { settingsAt('privacy'); return; }
    if (k === 'sync') { settingsAt('sync'); return; }
    if (k === 'pictures' || k === 'hftest') { settingsAt('pictures'); return; }
    if (k === 'email') { settingsAt('email'); return; }
    if (k === 'smart') { settingsAt('brain'); return; }
    if (k === 'settings') { settingsAt('start'); return; }
    if (k === 'mac') { $('sheet').hidden = true; var mp = localReply(Kin.mac && Kin.mac.available() ? 'You are in the Mac app, sir. Ask me to open an app, a file or a site, or to do something on your computer. Your Mac asks you before each one.' : Kin.mac.NEED_TEXT, 'Mac app'); if (Kin.mac && !Kin.mac.available()) mp.parentNode.appendChild(Kin.mac.need()); showThread(); return; }
  }
  /* the home board and the dock's quick chips only open things: every panel waits for its own tap before anything is sent or spent */
  Kin.go = function (k) {
    gesture();
    if (k === 'brief') { if (Kin.briefBoard && Kin.briefBoard.isOpen()) return; brief(); return; }
    if (k === 'whatsnew') { whatsNew(false); return; }
    if (k === 'weather') { settingsAt('brief'); return; }
    if (k === 'awaysummary') { awayAsk({ k: 'summary' }); return; }
    if (k === 'thread') { showThread(); return; }
    if (k === 'outbox') { openShelf('outbox'); return; }
    if (k === 'inbox') { openShelf('inbox'); return; }
    if (k === 'cal') { openShelf('cal'); return; }
    if (/^made:/.test(k)) { openShelf('made', k.slice(5)); return; }
    tryIt(k);
  };
  function whatsNew(said) {
    Kin.whatsNew.open({ onSay: panelSay, onTry: tryIt });
    if (!said) return;
    var line = 'Here is what’s new, sir. Try it only opens the panel; nothing runs until you tap inside it.';
    addMsg('kin', line); panelSay(line);
  }

  /* ------------------------------------------------------------ the morning brief board */
  var MARKET = 'kin.bb.market';
  function marketWatch() {
    var c = null; try { c = JSON.parse(localStorage.getItem(MARKET) || 'null'); } catch (e) {}
    /* a result, even an empty one, is kept for three hours; a failed search is not tried again for half an hour */
    if (c && Array.isArray(c.items) && Date.now() - c.at < (c.failed ? 1800000 : 3 * 3600000)) return Promise.resolve(c.items);
    function keepIt(items, failed) { if (Kin.shared) return; try { localStorage.setItem(MARKET, JSON.stringify({ at: Date.now(), items: items, failed: !!failed })); } catch (e) {} }
    return brain.job('Search the web for news from the last three days about the founder\'s competitors and product category, as named in the pack. Answer in one line.', { web: true, noTools: true, budget: 0.2 }).then(function (r) {
      var items = (r.sources || []).filter(function (x) { return /^https:\/\//.test(x.url); }).slice(0, 4).map(function (x) { return { title: x.title || x.url, url: x.url, source: (x.url.match(/^https?:\/\/(?:www\.)?([^\/]+)/) || [])[1] || '' }; });
      keepIt(items, r.code !== 'ok');
      return items;
    });
  }
  /* a job from the board: drafts, plans and research run as one bounded request with its own spending limit;
     a design goes through the normal design card (one card before anything is spent) */
  function boardJob(offer, o) {
    var B = Kin.briefBoard;
    if (offer.kind === 'design') { B.hide(); setTimeout(function () { if (!S.busy) ask('Design: ' + offer.task); }, 360); return Promise.resolve({ handedOver: true }); }
    var cap = B.settings.get().autoCap, budget = o.auto ? cap : Math.max(0.3, offer.est * 2);
    return brain.job(offer.prompt, { signal: o.signal, web: offer.kind === 'research', budget: budget, onMade: function () { refreshMade(); } }).then(function (r) {
      var cost = r.cost || 0, fail = function (msg, extra) { throw Object.assign(new Error(msg), { cost: cost }, extra || {}); };
      if (r.code === 'stopped' || (o.signal && o.signal.aborted)) fail('Stopped', { name: 'AbortError' });
      if (r.code !== 'ok') fail(r.text || 'It did not finish.');
      if (!r.made || !r.made.length) fail(r.cut ? 'Cut off before it was saved ($' + cost.toFixed(2) + ' spent). Tap Start again' : r.capped ? 'Stopped at its $' + budget.toFixed(2) + ' limit before saving' : 'It finished without saving anything');
      refreshMade(); if (Kin.desk) Kin.desk.notify.done('Kin finished a job', offer.label); return r;
    });
  }
  function brief(text) {
    var B = Kin.briefBoard;
    if (text) addMsg('you', text);
    caption('Pulling your brief together', 'One moment', 'kin');
    B.gather({ pack: Kin.pack.get(), timeoutMs: 7000, market: brain.hasKey() && !Kin.shared ? marketWatch : null }).then(function (data) {
      B.show(data, {
        brand: 'Jarvis',
        onRefresh: function () { B.hide(true); brief(); },
        onSettings: function () { B.hide(); $('sheet').hidden = false; refreshSettings(); var bs = $('briefSettings'); if (bs && bs.scrollIntoView) bs.scrollIntoView({ block: 'center' }); },
        onStart: brain.hasKey() ? boardJob : null,
        onOpenMade: function () { B.hide(); openShelf('made'); }
      });
      var line = B.summary(data); addMsg('kin', line); caption(line.slice(0, 190), '');
      if (S.unlocked && (S.talk === 'awake' || S.speakTyped)) say(line); else captionFade(9000);
    }, function (e) { localReply('The brief could not be put together, sir (' + String((e && e.message) || e).slice(0, 80) + ').'); });
  }
  Kin.brief = brief;

  /* ------------------------------------------------------------ the Grok Bot bridge
     Asked only by name ("ask Grok Bot ..."). The reply is Grok Bot's words: shown with its own label, spoken
     as a short summary only when the founder is here and talking, and never passed to Claude or back to Grok Bot. */
  var gbEls = {}, gbEngaged = {};
  var GB_STATE = { sending: 'Sending to Grok Bot…', queued: 'The relay has it. Waiting for Grok Bot to start…', accepted: 'Grok Bot has it and is working on it.', pending: 'Grok Bot is working on it.',
    needs_owner_approval: 'Grok Bot needs your OK for this, sir. It will ask you in its own chat.', error: 'Grok Bot could not answer.', unknown: '', not_sent: 'Not sent.' };
  function gbResumable(j) { return /^(queued|accepted|pending)$/.test(j.st); }
  function gbMsg(j) {
    if (gbEls[j.id]) return gbEls[j.id];
    var t = $('thread'), e = t.querySelector('.empty'); if (e) e.remove();
    var d = document.createElement('div'); d.className = 'msg grok'; d.dataset.gb = j.id;
    var s = document.createElement('small'); s.textContent = 'Grok Bot';
    var st = document.createElement('p'); st.className = 'gbst'; var rp = document.createElement('p'); rp.className = 'gbreply';
    var bt = document.createElement('div'); bt.className = 'btns';
    function btn(id, label, fn, dim) { var b = document.createElement('button'); b.type = 'button'; b.className = 'lnk' + (dim ? ' dim' : ''); b.dataset.act = id; b.textContent = label; b.addEventListener('click', function () { gesture(); fn(); }); bt.appendChild(b); return b; }
    btn('stop', 'Stop waiting', function () { Kin.bridge.stop(j.id); }, true);
    btn('resume', 'Resume', function () { if (!Kin.bridge.resume(j.id)) gbNoteLine(j.id, Kin.bridge.hasToken() ? 'This one can no longer be checked from here.' : Kin.bridge.REASON.no_token); });
    btn('again', 'Send again', function () { var x = Kin.bridge.job(j.id); if (x) { gbEngaged[j.id] = Date.now(); Kin.bridge.submit(x.q, null, j.id).then(gbAfterSubmit); } });
    btn('forget', 'Forget', function () { Kin.bridge.forget(j.id); d.remove(); delete gbEls[j.id]; }, true);
    d.appendChild(s); d.appendChild(st); d.appendChild(rp); d.appendChild(bt); t.appendChild(d); t.scrollTop = t.scrollHeight;
    gbEls[j.id] = { d: d, st: st, rp: rp, bt: bt }; return gbEls[j.id];
  }
  function gbNoteLine(id, text) { var el = gbEls[id]; if (el) el.st.textContent = text; }
  function gbPaint(j) {
    var el = gbMsg(j), term = Kin.bridge.terminal(j.st);
    var line = j.st === 'answered' ? '' : (GB_STATE[j.st] || '');
    if (j.err) line = line ? line + ' ' + j.err : j.err;
    el.st.textContent = line;
    /* untrusted words from another bot: text only, never markup, never a link that runs anything */
    el.rp.textContent = term ? j.reply : '';
    [].forEach.call(el.bt.children, function (b) {
      var a = b.dataset.act, show = a === 'stop' ? j.waiting : a === 'resume' ? !j.waiting && gbResumable(j) : a === 'again' ? (j.st === 'unknown' && /^(unknown|malformed)$/.test(j.local)) || (j.st === 'not_sent' && /^(rate|busy|unreachable)$/.test(j.local) && Date.now() >= (j.retryAt || 0)) : a === 'forget' ? !j.waiting && j.st !== 'sending' : false;
      b.hidden = !show;
    });
    /* after a rate or busy wait, offer "Send again" once the wait is over (still only on a tap) */
    if (j.st === 'not_sent' && j.retryAt > Date.now() && !el.wake) el.wake = setTimeout(function () { el.wake = 0; var n = Kin.bridge.job(j.id); if (n && gbEls[j.id]) gbPaint(n); }, Math.min(j.retryAt - Date.now() + 50, 3600000));
  }
  /** what Kin may say aloud about a reply: a fixed line, never Grok Bot's own words */
  function gbSummary(j) {
    if (j.st === 'needs_owner_approval') return 'Grok Bot needs your OK for that, sir. It will ask you in its own chat.';
    if (j.st === 'error') return 'Grok Bot could not answer, sir. The reason is on screen.';
    /* Grok Bot's own words are never spoken: they stay on screen as text */
    return 'Grok Bot answered, sir. It\u2019s on screen.';
  }
  function gbAfterSubmit(r) {
    if (!r || r.ok) return;
    if (r.code === 'in_flight') { caption('Grok Bot is still working on your last question, sir.', 'One question at a time through the bridge'); captionFade(8000); return; }
    var j = r.job; if (j) { caption(j.err || 'Not sent to Grok Bot.', ''); captionFade(9000); }
  }
  function gbReply(text, small) { var p = addMsg('kin', text); caption(text, small || ''); if (S.unlocked && S.talk === 'awake') say(text, true); else captionFade(9000); return p; }
  function bridgeAsk(text, q) {
    var B = Kin.bridge; inp.value = ''; lastLen = 0; multi = single = 0; touch(); addMsg('you', text);
    if (!B.available()) return gbReply(Kin.shared ? Kin.SHARED_TEXT : 'This browser cannot use the Grok Bot bridge.');
    if (!B.enabled()) return gbReply('The Grok Bot bridge is off, sir. Turn it on in Settings, under Grok Bot bridge.', 'Nothing was sent');
    if (!B.hasToken()) return gbReply('There is no device token on this device, sir. Paste it in Settings, under Grok Bot bridge.', 'Nothing was sent');
    if (!q || q.split(/\s+/).length < 2) return gbReply('What should I ask Grok Bot, sir?', 'Say “ask Grok Bot” and the question');
    if (B.pending().length) { var w = B.pending()[0]; gbPaint(w); return gbReply('Grok Bot is still working on your last question, sir. I will show its answer here.', 'One question at a time through the bridge'); }
    function go(ctx) {
      var t0 = Date.now();
      B.submit(q, ctx).then(function (r) { if (r && r.job) gbEngaged[r.job.id] = t0; gbAfterSubmit(r); });
    }
    var ex = B.ctxOn() && Kin.pack.get() ? Kin.pack.search(q, 3).map(function (n) { return (n.t + (n.s ? ': ' + n.s : '')).slice(0, 1000); }).filter(Boolean) : [];
    if (!ex.length) { go([]); return; }
    confirmCard({ label: 'Jarvis asks before sharing', title: 'Send these pack excerpts to Grok Bot with the question?', lines: ex.map(function (x) { return '· ' + x.slice(0, 160) + (x.length > 160 ? '…' : ''); }), yes: 'Send with them', no: 'Question only', yesNote: 'Sent with the excerpts.', noNote: 'Sent without the excerpts.', quiet: true })
      .then(function (v) { go(v ? ex : []); });
  }
  Kin.bridge && Kin.bridge.on(function (e) {
    var j = e.job; if (!j) return;
    if (!gbEls[j.id] && !j.here && !Kin.bridge.terminal(j.st) && !/^(queued|accepted|pending)$/.test(j.st)) return;
    gbPaint(j); refreshSettings();
    if (!e.arrived) { if (j.st === 'accepted' || j.st === 'queued') { if (!S.talking && !S.busy) { caption(GB_STATE[j.st], 'Grok Bot'); captionFade(6000); } } return; }
    Kin.bridge.markSeen(j.id);
    var line = gbSummary(j), engaged = S.talk === 'awake' || (gbEngaged[j.id] && Date.now() - gbEngaged[j.id] < 180000 && document.visibilityState === 'visible');
    if (S.talking || S.busy) return;
    caption(line.length > 190 ? line.slice(0, 187) + '…' : line, 'Grok Bot · the whole reply is in the conversation');
    if (S.unlocked && engaged) say(line, true); else captionFade(12000);
    if (S.talk !== 'awake') showThread();
  });
  /** a phrase handled on this device at once: a log line, a timer, a protocol, help */
  function instantly(text, r) {
    inp.value = ''; lastLen = 0; multi = single = 0; touch();
    addMsg('you', text); var p = addMsg('kin', ''); Kin.mind.md(r.show, p); p.className = 'md';
    var speakIt = (S.talk === 'awake' || S.unlocked) && S.unlocked;
    caption(r.say, r.protocol || 'Done here, no call needed');
    if (speakIt) say(r.say, true).then(function () { if (r.sleep && S.talk === 'awake') sleep(true); }); else { captionFade(7000); if (r.sleep && S.talk === 'awake') sleep(true); }
    if (r.open) openShelf(r.open);
    refreshMade();
  }

  /* ------------------------------------------------------------ controls */
  $('bar').addEventListener('submit', function (e) {
    e.preventDefault(); gesture(); var v = inp.value;
    if (!v.trim() && S.talking) { voice.stop(); return; }
    if (S.busy && !v.trim()) { if (S.ctl) S.ctl.abort(); return; }
    buf = tail = ''; clearTimeout(hearT); clearTimeout(typeT); ask(v);
  });
  inp.addEventListener('input', typed);
  $('mic').addEventListener('click', function () {
    gesture();
    if (!ears.supported) { S.kbMic = true; S.talk = 'awake'; touch(); caption('This browser cannot listen by itself.', coarse ? 'Tap the keyboard mic and talk. I send when you pause' : 'Type to Jarvis, or use your computer’s dictation key'); inp.focus(); paint(); return; }
    if (ears.wanted()) { ears.stop(); S.talk = 'off'; voice.stop(); caption(null); paint(); return; }
    ears.start(); cue(); caption('I’m listening, sir. Go ahead.', 'Listening');
    /* Safari cannot listen and speak at once, and it wants listening to begin inside the tap, so it stays quiet here */
    if (!ears.isSafari) say(voice.CLIPS.listening, true);
    paint();
  });
  /* the state pill: tap it to start listening, to interrupt, or to wake Kin */
  $('vpill').addEventListener('click', function () {
    gesture();
    if (S.talking) { hushNow(); return; }
    if (ears.supported && (!ears.wanted() || ears.paused())) { ears.start(); if (S.talk !== 'awake') wakeNow(); paint(); return; }
    if (S.talk !== 'awake') wakeNow(); else touch();
  });
  cap.addEventListener('click', function () { gesture(); if (S.talk !== 'awake') wakeNow(); else if (S.talking) voice.stop(); else touch(); });
  /** open the conversation at its newest answer, from the top of that answer */
  function convLabel() { var t = $('thread'), on = t && !t.hidden; $('stS').textContent = on ? 'Hide conversation' : 'Conversation'; $('status').setAttribute('aria-expanded', on ? 'true' : 'false'); }
  if (window.MutationObserver) new MutationObserver(convLabel).observe($('thread'), { attributes: true, attributeFilter: ['hidden'] });
  /* the big figure shrinks to a small presence at the bottom middle whenever Settings, Made or
     the conversation comes up, and grows back the moment none of them are open */
  function syncStage() {
    var up = !$('sheet').hidden || !$('shelf').hidden || !$('thread').hidden;
    var was = app.dataset.stage === 'compact';
    app.dataset.stage = up ? 'compact' : '';
    if (was !== up && bust.resize) setTimeout(bust.resize, 280);
  }
  if (window.MutationObserver) { var stageObs = new MutationObserver(syncStage); [$('sheet'), $('shelf'), $('thread')].forEach(function (el) { if (el) stageObs.observe(el, { attributes: true, attributeFilter: ['hidden'] }); }); }
  syncStage();
  Kin.showThread = function () { showThread(); };
  function showThread() { var t = $('thread'); t.hidden = false; var m = t.querySelector('.msg.kin:last-child'); t.scrollTop = m && m.offsetTop > 0 && m.offsetHeight > t.clientHeight * 0.6 ? Math.max(0, (m.previousElementSibling || m).offsetTop - 12) : t.scrollHeight; }
  /* on a phone the small orb in the bar opens and closes the conversation; the dock's chips open a panel */
  if ($('miniOrb')) $('miniOrb').addEventListener('click', function () { gesture(); $('status').click(); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) { b.addEventListener('click', function (e) { if (e.isTrusted) Kin.go(b.dataset.go); }); });
  /* the composer: chips for what Jarvis is working with, and a + menu of quick actions; every item only opens a panel */
  (function () {
    var pk = $('packname'), cp = $('ctxPack'), ct = $('ctxPackT');
    function syncPack() { var n = pk.textContent.trim(); cp.hidden = !n; ct.textContent = n; }
    if (pk && cp && ct) { syncPack(); if (window.MutationObserver) new MutationObserver(syncPack).observe(pk, { childList: true, characterData: true, subtree: true }); }
    var wt = $('ctxWhereT'); if (wt) wt.textContent = Kin.mac && Kin.mac.available() ? 'This computer' : 'This browser';
    var plus = $('bplus'), bar = $('bar'), menu = null;
    var ITEMS = [['brief', 'Brief me'], ['whatsnew', 'What\u2019s new'], ['inbox', 'Inbox'], ['outbox', 'Outbox'], ['cal', 'Calendar'], ['watch', 'Watch or listen to something'], ['devices', 'Bluetooth and USB devices'], ['gauntlet', 'Test yourself'], ['settings', 'Settings']];
    function close() { if (!menu) return; menu.remove(); menu = null; plus.setAttribute('aria-expanded', 'false'); }
    function open() {
      menu = document.createElement('div'); menu.className = 'bmenu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Quick actions');
      ITEMS.forEach(function (it) { var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.k = it[0]; b.textContent = it[1]; b.addEventListener('click', function () { close(); Kin.go(it[0]); }); menu.appendChild(b); });
      menu.addEventListener('keydown', function (e) {
        var items = [].slice.call(menu.children), i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
      });
      bar.appendChild(menu); plus.setAttribute('aria-expanded', 'true'); menu.firstChild.focus();
    }
    if (plus && bar) {
      plus.addEventListener('click', function () { gesture(); if (menu) close(); else open(); });
      document.addEventListener('pointerdown', function (e) { if (menu && !menu.contains(e.target) && !plus.contains(e.target)) close(); }, true);
      /* Escape closes the menu only; it does not also stop Jarvis talking */
      document.addEventListener('keydown', function (e) { if (menu && e.key === 'Escape') { e.stopPropagation(); close(); plus.focus(); } }, true);
    }
  })();
  $('status').addEventListener('click', function () { var t = $('thread'); if (!t.hidden) { t.hidden = true; return; } showThread(); if (!t.children.length) { var d = document.createElement('p'); d.className = 'empty'; d.textContent = 'Nothing said yet.'; t.appendChild(d); } });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input';
    if (e.key === 'Escape') { if (!$('sheet').hidden) { $('sheet').hidden = true; return; } stopAll(); }
    else if (e.key === ' ' && !typing && !(e.target.closest && e.target.closest('button,label'))) { e.preventDefault(); $('mic').click(); }
  });
  /* the first tap or key anywhere lets the page speak, and starts the ears where the browser wanted a tap first */
  function first() {
    document.removeEventListener('pointerup', first, true); document.removeEventListener('keydown', first, true);
    gesture(); if (ears.supported && !ears.wanted() && S.autoListen && S.micState !== 'blocked') ears.start();
  }
  document.addEventListener('pointerup', first, true); document.addEventListener('keydown', first, true);

  /* ------------------------------------------------------------ the shelf: what Kin made, and the logbook */
  var shelfTab = 'made', shelfOpen = '';
  function openShelf(tab, id) { shelfTab = tab || 'made'; shelfOpen = id || ''; $('shelf').hidden = false; refreshMade(); }
  /* the window look: an app icon per tab, a coloured initial for each person, and times that read like a mail app */
  var WICON = { made: 'M12 3l2.2 5.3L19.5 10l-5.3 2.2L12 17.5l-2.2-5.3L4.5 10l5.3-1.7z', log: 'M7 4h10v16H7zM10 8h4M10 12h4', inbox: 'M4 6h16v12H4zM4 7l8 6 8-6', outbox: 'M4 12l16-8-5 16-3-6.5z', cal: 'M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4' };
  var AVC = ['#4FA8F5', '#F2685C', '#3CC46E', '#A47CF0', '#F5B43C', '#2EC4B0', '#F27BB5'];
  function avatar(name) {
    var n = String(name || '?').replace(/^[^A-Za-z0-9]+/, ''), h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    var a = document.createElement('span'); a.className = 'av'; a.setAttribute('aria-hidden', 'true'); a.textContent = (n.charAt(0) || '?').toUpperCase(); a.style.background = AVC[h % AVC.length]; return a;
  }
  function relTime(t) {
    if (!t) return ''; var d = new Date(t), now = new Date(), ms = now - d;
    if (ms >= 0 && ms < 15 * 60e3) return 'Just now';
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === new Date(now - 864e5).toDateString()) return 'Yesterday';
    if (ms > 0 && ms < 6 * 864e5) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function refreshMade() {
    var el = $('shelfbody'); if (!el || $('shelf').hidden) return; el.textContent = '';
    [].forEach.call(document.querySelectorAll('#shelftabs button'), function (b) { b.setAttribute('aria-pressed', b.dataset.tab === shelfTab); if (b.dataset.tab === shelfTab) { var t = $('shelftabs'); if (t.scrollWidth > t.clientWidth) t.scrollLeft = Math.max(0, b.offsetLeft - t.clientWidth / 2 + b.offsetWidth / 2); } });
    var sh = $('shelf').querySelector('.sheethead h2'); if (sh) sh.textContent = { log: 'Logbook', inbox: 'Inbox', outbox: 'Outbox', cal: 'Calendar' }[shelfTab] || 'Made';
    var ic = $('shelficon'); if (ic) { ic.dataset.tab = WICON[shelfTab] ? shelfTab : 'made'; ic.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + (WICON[shelfTab] || WICON.made) + '"/></svg>'; }
    if (shelfTab === 'outbox') { outboxShelf(el); return; }
    if (shelfTab === 'inbox') { inboxShelf(el); return; }
    if (shelfTab === 'cal') { calShelf(el); return; }
    if (shelfTab === 'log') {
      var log = Kin.mind.log();
      if (!log.length) { var e0 = document.createElement('p'); e0.className = 'empty'; e0.textContent = 'Nothing logged yet. Say "bench, 135 for 8" or "log that I changed the brake pads".'; el.appendChild(e0); return; }
      log.slice(0, 200).forEach(function (x) { var r = document.createElement('div'); r.className = 'logrow'; var k = document.createElement('small'); k.textContent = new Date(x.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + x.kind; var t = document.createElement('p'); t.textContent = x.text; var del = document.createElement('button'); del.type = 'button'; del.className = 'lnk dim'; del.textContent = 'Delete'; del.addEventListener('click', function () { Kin.mind.dropLog(x.id); refreshMade(); }); r.appendChild(k); r.appendChild(t); r.appendChild(del); el.appendChild(r); });
      return;
    }
    var made = Kin.mind.made(), m = shelfOpen && Kin.mind.getMade(shelfOpen);
    if (m) {
      var back = document.createElement('button'); back.type = 'button'; back.className = 'lnk'; back.textContent = 'All made things'; back.addEventListener('click', function () { shelfOpen = ''; refreshMade(); }); el.appendChild(back);
      var h = document.createElement('h3'); h.className = 'mtitle'; h.textContent = m.title; el.appendChild(h);
      var sub = document.createElement('p'); sub.className = 'note'; sub.textContent = [m.kind, m.note, m.score != null ? 'art director ' + m.score + ' of 100' : '', m.round > 1 ? 'round ' + m.round : ''].filter(Boolean).join(' · '); el.appendChild(sub);
      var bt = document.createElement('div'); bt.className = 'btns';
      if (m.kind === 'chart' && m.spec && Kin.chart) { chartShelf(el, m); return; }
      var dl = document.createElement('button'); dl.type = 'button'; dl.className = 'lnk'; dl.textContent = 'Download'; dl.addEventListener('click', function () { if (m.kind !== 'design') { Kin.mind.download(Kin.mind.fileName(m), m.content, 'text/markdown'); return; }
        /* the downloaded file carries its fonts, so it looks the same wherever it is opened */
        Kin.mind.withFonts(m.content).then(function (full) { Kin.mind.download(Kin.mind.fileName(m), full, 'image/svg+xml'); }, function () { Kin.mind.download(Kin.mind.fileName(m), m.content, 'image/svg+xml'); }); });
      var cp = document.createElement('button'); cp.type = 'button'; cp.className = 'lnk'; cp.textContent = 'Copy'; cp.addEventListener('click', function () { try { navigator.clipboard.writeText(m.content).then(function () { cp.textContent = 'Copied'; }, function () { cp.textContent = 'Copy failed'; }); } catch (e) { cp.textContent = 'Copy failed'; } });
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'lnk dim'; rm.textContent = 'Remove'; rm.addEventListener('click', function () { Kin.mind.dropMade(m.id); shelfOpen = ''; refreshMade(); });
      bt.appendChild(dl); bt.appendChild(cp); bt.appendChild(rm); el.appendChild(bt);
      if (m.kind === 'design') { var fig = document.createElement('div'); fig.className = 'design'; var img = document.createElement('img'); img.alt = m.title; img.onload = function () { setTimeout(function () { try { URL.revokeObjectURL(img.src); } catch (e) {} }, 1000); };
          /* a picture cannot reach the page's fonts, so the fonts go inside it, as they did for the art director */
          Kin.mind.withFonts(m.content).then(function (full) { img.src = Kin.mind.svgUrl(full); }, function () { img.src = Kin.mind.svgUrl(m.content); }); fig.appendChild(img); el.appendChild(fig);
        if (m.fixes && m.fixes.length && m.score != null && m.score < 85) { var fx = document.createElement('p'); fx.className = 'note'; fx.textContent = 'Still open: ' + m.fixes.join(' '); el.appendChild(fx); }
        studioDetails(el, m); }
      else { var doc = document.createElement('div'); doc.className = 'md doc'; Kin.mind.md(m.content, doc); el.appendChild(doc); }
      return;
    }
    if (!made.length) { var e1 = document.createElement('p'); e1.className = 'empty'; e1.textContent = 'Nothing made yet. Ask for a document, a plan, a table or a design, and it lands here.'; el.appendChild(e1); return; }
    made.forEach(function (x) { var b = document.createElement('button'); b.type = 'button'; b.className = 'mrow'; var k = document.createElement('small'); k.textContent = x.kind + ' · ' + new Date(x.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + (x.score != null ? ' · ' + x.score : ''); var t = document.createElement('span'); t.textContent = x.title; b.appendChild(k); b.appendChild(t); b.addEventListener('click', function () { shelfOpen = x.id; refreshMade(); }); el.appendChild(b); });
  }
  /** the outbox: every email Kin drafted, newest first, editable in place; a batch is sent one after another */
  function outboxCount() {
    var b = document.querySelector('#shelftabs [data-tab="outbox"]'); if (!b || !Kin.email) return;
    var n = Kin.email.waiting().length; b.textContent = n ? 'Outbox ' + n : 'Outbox';
  }
  function outboxShelf(host) {
    if (!Kin.email) return;
    outboxCount();
    var all = Kin.email.outbox(), wait = all.filter(function (m) { return m.status !== 'sent'; }), sent = all.length - wait.length;
    if (!all.length) { var e0 = document.createElement('p'); e0.className = 'empty'; e0.textContent = 'No drafts yet. Say "email Sam about Friday" or "write to all three suppliers asking for prices", and each email lands here to check and send.'; host.appendChild(e0); return; }
    var sum = document.createElement('p'); sum.className = 'note'; sum.textContent = wait.length + (wait.length === 1 ? ' email waiting' : ' emails waiting') + (sent ? ', ' + sent + ' sent' : '') + '. Nothing is sent until you send it.'; host.appendChild(sum);
    var bt = el('div', 'btns pills'); host.appendChild(bt);
    function pb(label, cls, fn) { var b = el('button', 'pill sm ' + cls); b.type = 'button'; b.appendChild(el('span', 'pl', label)); b.addEventListener('click', function () { gesture(); fn(b); }); bt.appendChild(b); return b; }
    var cards = {};
    /* browsers allow one new window per tap, so a batch goes out one tap at a time, oldest first */
    if (wait.length) pb(wait.length > 1 ? 'Open next in Gmail' : 'Open in Gmail', 'go', function () {
      var next = Kin.email.outbox().filter(function (m) { return m.status === 'draft'; }).pop() || Kin.email.waiting().pop();
      if (next && cards[next.id]) { cards[next.id].openInGmail(); cards[next.id].scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    });
    if (wait.length) pb('Copy all', 'alt', function (b) {
      var t = Kin.email.waiting().map(function (m) { return 'To: ' + m.to + '\nSubject: ' + m.subject + '\n\n' + m.body; }).join('\n\n----------\n\n');
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.querySelector('.pl').textContent = 'Copied'; }, function () { b.querySelector('.pl').textContent = 'Copy failed'; });
    });
    if (sent) pb('Clear sent', 'stop', function () { Kin.email.clearSent(); outboxCount(); refreshMade(); });
    all.forEach(function (m) {
      var wrap = document.createElement('div'); wrap.className = 'obrow';
      var hd = document.createElement('div'); hd.className = 'obhead'; hd.appendChild(avatar(m.to || '?'));
      var hm = document.createElement('div'); hm.className = 'ibmain'; var tw = document.createElement('b'); tw.className = 'ibwho'; tw.textContent = m.to ? 'To ' + m.to : 'No recipient yet'; hm.appendChild(tw);
      var hs = document.createElement('p'); hs.className = 'ibsub'; hs.textContent = m.subject || '(no subject)'; hm.appendChild(hs); hd.appendChild(hm);
      var when = document.createElement('small'); when.className = 'obwhen'; when.textContent = relTime(m.at); when.title = new Date(m.at).toLocaleString(); hd.appendChild(when); wrap.appendChild(hd);
      var c = Kin.email.card(m, { id: m.id, status: m.status, onChange: outboxCount, onSay: function (t) { if (S.unlocked && voice.canSpeak()) say(t, true); } });
      cards[m.id] = c; wrap.appendChild(c);
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'lnk dim'; rm.textContent = 'Remove'; rm.addEventListener('click', function () { Kin.email.dropDraft(m.id); outboxCount(); refreshMade(); }); wrap.appendChild(rm);
      host.appendChild(wrap);
    });
  }
  /** the inbox: unread Gmail, read on a tap with a read-only permission, held in memory for this visit only.
      Nothing from it goes to Claude unless the founder taps Draft reply or Summarize these. */
  /* panel buttons that hand a job to Jarvis: while an answer is still running, say so on the button instead of dropping the tap */
  function handOff(btn, q) {
    if (S.busy) { var lab = btn.querySelector('.pl') || btn, was = lab.textContent; if (was.indexOf('Still') === 0) return; lab.textContent = 'Still answering, one moment'; setTimeout(function () { lab.textContent = was; }, 2500); return; }
    $('shelf').hidden = true; ask(q);
  }
  var inboxCache = null, inboxBusy = false, inboxErr = '';
  function nameOf(from) { var m = /^\s*"?([^"<]+?)"?\s*</.exec(from || ''); return m ? m[1].trim() : String(from || '').replace(/[<>]/g, ''); }
  function inboxShelf(host) {
    if (!Kin.email) return;
    function note(t) { var p = document.createElement('p'); p.className = 'note'; p.textContent = t; host.appendChild(p); return p; }
    if (!Kin.email.canRead()) {
      var e0 = document.createElement('p'); e0.className = 'empty'; e0.textContent = Kin.shared ? Kin.SHARED_TEXT : 'To read your inbox here, add your Google Client ID in Settings, Email (the same one used for sending). Reading asks Google for a separate, read-only permission.'; host.appendChild(e0);
      if (!Kin.shared) { var go = el('button', 'pill sm go'); go.type = 'button'; go.appendChild(el('span', 'pl', 'Open Email settings')); go.addEventListener('click', function () { $('shelf').hidden = true; settingsAt('email'); }); host.appendChild(go); }
      return;
    }
    var bt = el('div', 'btns pills'); host.appendChild(bt);
    function pb(label, cls, fn) { var b = el('button', 'pill sm ' + cls); b.type = 'button'; b.appendChild(el('span', 'pl', label)); b.addEventListener('click', function () { gesture(); fn(b); }); bt.appendChild(b); return b; }
    function load(all) {
      if (inboxBusy) return; inboxBusy = true; inboxErr = ''; refreshMade();
      Kin.email.loadGis().then(function () { return Kin.email.inbox({ all: all }); }).then(function (list) { inboxCache = { list: list, all: all, at: Date.now() }; }, function (err) { inboxErr = String((err && err.message) || err); })
        .then(function () { inboxBusy = false; refreshMade(); });
    }
    pb(inboxCache ? 'Check again' : 'Check inbox', 'go', function () { load(false); });
    pb('Recent, read or not', 'alt', function () { load(true); });
    if (inboxBusy) { note('Reading your inbox…'); return; }
    if (inboxErr) { note(inboxErr); return; }
    if (!inboxCache) { note('Tap Check inbox. Google asks once for read-only access; the messages stay on this page and are not stored.'); return; }
    var list = inboxCache.list;
    if (!list.length) { note(inboxCache.all ? 'Your inbox is empty.' : 'Nothing unread, sir.'); return; }
    note(list.length + (inboxCache.all ? ' recent' : ' unread') + (list.length === 1 ? ' email' : ' emails') + ', checked ' + new Date(inboxCache.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + '.');
    pb('Summarize these', 'alt', function (b) {
      handOff(b, 'Here are my ' + (inboxCache.all ? 'recent' : 'unread') + ' emails (From, Subject, the start of each):\n\n' + list.map(function (m, i) { return (i + 1) + '. ' + nameOf(m.from) + ' | ' + m.subject + ' | ' + m.snippet; }).join('\n') + '\n\nTell me what needs me, most urgent first, in a few short lines, and which deserve a reply.');
    });
    list.forEach(function (m) {
      var r = document.createElement('div'); r.className = 'ibrow' + (m.unread ? ' unread' : ''); r.tabIndex = 0; r.setAttribute('role', 'button');
      r.appendChild(avatar(nameOf(m.from)));
      var mid = document.createElement('div'); mid.className = 'ibmain';
      var who = document.createElement('b'); who.className = 'ibwho'; who.textContent = nameOf(m.from); mid.appendChild(who);
      var sj = document.createElement('p'); sj.className = 'ibsub'; sj.textContent = m.subject; mid.appendChild(sj);
      var sn = document.createElement('p'); sn.className = 'ibsnip'; sn.textContent = m.snippet; mid.appendChild(sn);
      r.appendChild(mid);
      var when = document.createElement('small'); when.className = 'ibwhen'; when.textContent = relTime(m.date); if (m.date) when.title = new Date(m.date).toLocaleString(); r.appendChild(when);
      r.addEventListener('click', function (e) { if (e.target.closest('button')) return; r.classList.toggle('open'); });
      r.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === r) { e.preventDefault(); r.classList.toggle('open'); } });
      var acts = document.createElement('div'); acts.className = 'btns ibacts';
      var rep = document.createElement('button'); rep.type = 'button'; rep.className = 'lnk'; rep.textContent = 'Draft reply';
      rep.addEventListener('click', function () { gesture(); handOff(rep, 'Draft a reply to this email, in my voice, short. From: ' + m.from + '. Subject: ' + m.subject + '. It says: "' + m.snippet + '". Put it in an email draft to them with "Re: ' + m.subject.replace(/^re:\s*/i, '') + '" as the subject.'); });
      var op = document.createElement('button'); op.type = 'button'; op.className = 'lnk dim'; op.textContent = 'Open in Gmail';
      op.addEventListener('click', function () { window.open(Kin.email.threadUrl(m), '_blank', 'noopener,noreferrer'); });
      acts.appendChild(rep); acts.appendChild(op); r.appendChild(acts); host.appendChild(r);
    });
  }
  /** the calendar: the next few days from Google Calendar, read on a tap, held in memory for this visit only */
  var calCache = null, calBusy = false, calErr = '';
  function calShelf(host) {
    if (!Kin.email) return;
    function note(t) { var p = document.createElement('p'); p.className = 'note'; p.textContent = t; host.appendChild(p); return p; }
    if (!Kin.email.canRead()) {
      var e0 = document.createElement('p'); e0.className = 'empty'; e0.textContent = Kin.shared ? Kin.SHARED_TEXT : 'To see your calendar here, add your Google Client ID in Settings, Email. Google asks once for read-only calendar access.'; host.appendChild(e0);
      if (!Kin.shared) { var go = el('button', 'pill sm go'); go.type = 'button'; go.appendChild(el('span', 'pl', 'Open Email settings')); go.addEventListener('click', function () { $('shelf').hidden = true; settingsAt('email'); }); host.appendChild(go); }
      return;
    }
    var bt = el('div', 'btns pills'); host.appendChild(bt);
    function pb(label, cls, fn) { var b = el('button', 'pill sm ' + cls); b.type = 'button'; b.appendChild(el('span', 'pl', label)); b.addEventListener('click', function () { gesture(); fn(b); }); bt.appendChild(b); return b; }
    function load(days) {
      if (calBusy) return; calBusy = true; calErr = ''; refreshMade();
      Kin.email.loadGis().then(function () { return Kin.email.calendar({ days: days }); }).then(function (list) { calCache = { list: list, days: days, at: Date.now() }; }, function (err) { calErr = String((err && err.message) || err); })
        .then(function () { calBusy = false; refreshMade(); });
    }
    pb(calCache ? 'Check again' : 'Next 3 days', 'go', function () { load(calCache ? calCache.days : 3); });
    pb('Next 7 days', 'alt', function () { load(7); });
    if (calBusy) { note('Reading your calendar…'); return; }
    if (calErr) { note(calErr); return; }
    if (!calCache) { note('Tap Next 3 days. Google asks once for read-only calendar access; nothing is stored on this device.'); return; }
    var list = calCache.list;
    if (!list.length) { note('Nothing on your calendar for the next ' + calCache.days + ' days, sir.'); return; }
    function hm(t) { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
    function span(e) {
      if (e.allDay) return 'All day';
      var a = hm(e.start), b = e.end ? hm(e.end) : '', ma = /\s?[AP]M$/i.exec(a), mb = /\s?[AP]M$/i.exec(b);
      if (ma && mb && ma[0].trim() === mb[0].trim()) a = a.slice(0, ma.index);
      return b ? a + '–' + b : a;
    }
    pb('Plan my day', 'alt', function (b) {
      handOff(b, 'Here is my calendar for the next ' + calCache.days + ' days:\n\n' + list.map(function (e) { return new Date(e.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + span(e) + ': ' + e.title + (e.where ? ' (' + e.where + ')' : '') + (e.who.length ? ' with ' + e.who.join(', ') : ''); }).join('\n') + '\n\nGive me a short plan: what matters most, where the free time is, and anything I should prepare for.');
    });
    var lastDay = '';
    list.forEach(function (e) {
      var d = new Date(e.start), day = d.toDateString();
      if (day !== lastDay) {
        lastDay = day; var h = document.createElement('h4'); h.className = 'calday';
        var today = new Date(), tom = new Date(today.getTime() + 864e5);
        h.textContent = day === today.toDateString() ? 'Today' : day === tom.toDateString() ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
        host.appendChild(h);
      }
      var r = document.createElement('div'); r.className = 'calrow' + (!e.allDay && e.end && e.end < Date.now() ? ' past' : '');
      var bar = document.createElement('i'); bar.className = 'calbar'; bar.style.background = AVC[(e.title || '').length % AVC.length]; r.appendChild(bar); var t = document.createElement('span'); t.className = 'caltime'; t.textContent = span(e);
      var body = document.createElement('div'); body.className = 'calbody';
      var ti = document.createElement('b'); ti.textContent = e.title; body.appendChild(ti);
      var meta = [e.where, e.who.length ? 'with ' + e.who.join(', ') : ''].filter(Boolean).join(' · ');
      if (meta) { var m = document.createElement('small'); m.textContent = meta; body.appendChild(m); }
      var acts = document.createElement('div'); acts.className = 'btns';
      if (e.meet) { var jn = document.createElement('button'); jn.type = 'button'; jn.className = 'lnk'; jn.textContent = 'Join'; jn.addEventListener('click', function () { window.open(e.meet, '_blank', 'noopener,noreferrer'); }); acts.appendChild(jn); }
      if (e.link) { var op = document.createElement('button'); op.type = 'button'; op.className = 'lnk dim'; op.textContent = 'Open'; op.addEventListener('click', function () { window.open(e.link, '_blank', 'noopener,noreferrer'); }); acts.appendChild(op); }
      if (acts.children.length) body.appendChild(acts);
      r.appendChild(body); r.appendChild(t); host.appendChild(r);
    });
  }
  /** a chart on the shelf: the chart itself (hover or tap for values), Download SVG, Download PNG, Copy, Remove */
  function chartShelf(host, m) {
    var bt = el('div', 'btns pills');
    function pb(label, cls, fn) { var b = el('button', 'pill sm ' + cls); b.type = 'button'; b.appendChild(el('span', 'pl', label)); b.addEventListener('click', function () { gesture(); fn(b); }); bt.appendChild(b); return b; }
    function full() { return Kin.mind.withFonts(m.content).catch(function () { return m.content; }); }
    function png() { return full().then(function (sv) { var w = +(/width="(\d+)"/.exec(sv) || [0, 960])[1], h = +(/height="(\d+)"/.exec(sv) || [0, 600])[1]; return Kin.mind.svgToPng(sv, w, h, 1920); }); }
    pb('Download SVG', 'go', function () { full().then(function (sv) { Kin.mind.download(Kin.mind.fileName(m), sv, 'image/svg+xml'); }); });
    pb('Download PNG', 'alt', function () { png().then(function (b64) { if (!b64) return; var a = document.createElement('a'); a.href = 'data:image/png;base64,' + b64; a.download = Kin.mind.fileName(m).replace(/\.svg$/, '.png'); document.body.appendChild(a); a.click(); a.remove(); }); });
    pb('Copy', 'alt', function (b) {
      var done = function (t) { b.querySelector('.pl').textContent = t; setTimeout(function () { b.querySelector('.pl').textContent = 'Copy'; }, 2200); };
      var asText = function () { return navigator.clipboard.writeText(Kin.chart.tsv(m.spec)).then(function () { done('Numbers copied'); }); };
      try { if (window.ClipboardItem && navigator.clipboard.write) { navigator.clipboard.write([new ClipboardItem({ 'image/png': png().then(function (b64) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: 'image/png' }); }) })]).then(function () { done('Copied'); }, function () { asText().catch(function () { done('Copy failed'); }); }); }
        else asText().catch(function () { done('Copy failed'); }); } catch (e) { done('Copy failed'); }
    });
    pb('Remove', 'stop', function () { Kin.mind.dropMade(m.id); shelfOpen = ''; refreshMade(); });
    host.appendChild(bt);
    var box = el('div', 'chartcard big'); host.appendChild(box); Kin.chart.mount(box, m.spec);
  }
  /** a design from the studio: the idea, the art director's view, the brief, and the two concepts that lost */
  function studioDetails(el, m) {
    function sec(title) { var h = document.createElement('h4'); h.className = 'sech'; h.textContent = title; el.appendChild(h); }
    function line(text, cls) { if (!text) return; var q = document.createElement('p'); q.className = cls || 'note'; q.textContent = text; el.appendChild(q); return q; }
    if (m.concept) { sec('The idea'); line(m.concept.name + ': ' + m.concept.idea, 'idea'); }
    if ((m.notes && m.notes.length) || m.why) { sec('Art director'); if (m.why) line(m.why); (m.notes || []).forEach(function (x) { line('· ' + x); }); if (m.caps && m.caps.length) line('Held below the bar for: ' + m.caps.join(', ') + '.'); }
    if (m.others && m.others.length) {
      sec('The other concepts'); var g = document.createElement('div'); g.className = 'others';
      m.others.forEach(function (o) {
        var f = document.createElement('figure'), im = document.createElement('img'); im.alt = o.name;
        Kin.mind.withFonts(o.svg || '').then(function (full) { im.src = Kin.mind.svgUrl(full); }, function () { im.src = Kin.mind.svgUrl(o.svg || ''); });
        var cap = document.createElement('figcaption'); cap.textContent = o.name + (o.score != null ? ' · ' + o.score : '') + (o.caps && o.caps.length ? ' (' + o.caps.join(', ') + ')' : '');
        var idea = document.createElement('span'); idea.textContent = o.idea; cap.appendChild(document.createElement('br')); cap.appendChild(idea);
        f.appendChild(im); f.appendChild(cap); g.appendChild(f);
      });
      el.appendChild(g);
    }
    if (m.brief) { sec('The brief'); var b = m.brief; [['For', b.audience], ['Message', b.message], ['Territory', b.idea], ['References', b.references], ['Constraints', b.constraints], ['Format', b.format]].forEach(function (r) { if (r[1]) line(r[0] + ': ' + r[1]); }); }
    if (m.usd) line('Claude usage for this job: ' + (m.usd < 0.01 ? 'less than a cent' : 'about $' + m.usd.toFixed(2)) + '.');
    if (m.pictures && m.pictures.length) { sec('Pictures from Higgsfield'); line(m.pictures.length + (m.pictures.length === 1 ? ' picture' : ' pictures') + (m.credits ? ', about ' + m.credits + ' credits' : '') + '.'); }
    if (m.issues && m.issues.length) { sec('Worth knowing'); m.issues.forEach(function (x) { line(x); }); }
  }
  $('shelfb').addEventListener('click', function () { gesture(); openShelf(shelfTab); });
  $('shelfx').addEventListener('click', function () { $('shelf').hidden = true; });
  $('shelftabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; shelfTab = b.dataset.tab; shelfOpen = ''; refreshMade(); });
  outboxCount();
  $('thread').addEventListener('click', function (e) { var b = e.target.closest('[data-made]'); if (b) openShelf('made', b.dataset.made); });
  Kin.mind.onTimer(function (t) {
    var el = $('stT');
    if (t && t.done) { el.hidden = true; flare(); voice.chime('wake'); caption(t.label + ' is up, sir.', 'Timer'); if (S.unlocked) say(voice.CLIPS.done, true); captionFade(8000); return; }
    if (!t) { el.hidden = true; return; }
    el.hidden = false; el.textContent = t.label + ' ' + Math.floor(t.left / 60) + ':' + ('0' + t.left % 60).slice(-2);
  });

  /* ------------------------------------------------------------ settings */
  function stepGo(go) {
    return function () {
      if (go === 'mic') { $('sheet').hidden = true; gesture(); if (ears.supported) $('mic').click(); return; }
      if (go === 'wake') { $('sheet').hidden = true; wakeNow(); return; }
      settingsAt(go.sg); setTimeout(function () { var f = $(go.focus); if (f) f.focus(); }, 60);
    };
  }
  function steps() {
    var micOk = S.micState === 'listening' || ls.get('kin.micok', '') === '1', p = Kin.pack.get(), rows = [
      [micOk, 'Allow the microphone', ears.supported ? 'Tap the mic once and choose Allow. The browser remembers it for this site. The browser, not this page, turns your speech into text, on its maker’s servers.' : 'This browser cannot listen by itself. Use the keyboard’s mic or type.', 'mic'],
      [brain.hasKey(), 'Paste a Claude API key', 'From console.anthropic.com. With one, your questions and the parts of the pack Jarvis looks up go to Anthropic for an answer. Without one Jarvis answers only from the pack on this device.', { sg: 'brain', focus: 'apiKey' }],
      [voice.tts.hasKey(), 'Optional: paste a voice key', 'From elevenlabs.io. With one, every sentence Jarvis speaks is sent there and spoken in the voice you pick. Without one, the browser’s own voice reads the answers.', { sg: 'voice', focus: 'ttsKey' }],
      [!!p, 'Import your Kin pack', 'In the Atlas: Kin’s settings > Your data > Export everything. Then here: Settings > Import Kin pack (below). The file is stored on this device only.', { sg: 'brain', focus: 'packFile' }],
      [S.wakes > 0, 'Say “hey Jarvis”', 'Or your own wake phrase. Then just talk.', 'wake']
    ];
    var el = $('steps'); el.textContent = '';
    rows.forEach(function (r, i) {
      var d = document.createElement('button'); d.type = 'button'; d.className = 'step' + (r[0] ? ' done' : ''); d.disabled = !!r[0];
      var b = document.createElement('b'); b.textContent = r[0] ? 'OK' : '0' + (i + 1); var pp = document.createElement('p'); pp.textContent = r[1]; var sm = document.createElement('small'); sm.textContent = r[2]; pp.appendChild(sm); d.appendChild(b); d.appendChild(pp);
      if (!r[0]) d.addEventListener('click', stepGo(r[3]));
      el.appendChild(d);
    });
  }
  /** the keyed voice: who speaks, with which model, and anything that went wrong */
  function voiceSettings() {
    var t = voice.tts.status(), has = voice.tts.hasKey(), vs = $('ttsVoice'), ms = $('ttsModel');
    $('ttsVoiceRow').hidden = !(has && t.voices.length); $('ttsModelRow').hidden = !(has && t.models.length > 1); $('ttsTestRow').hidden = !has;
    vs.textContent = ''; t.voices.forEach(function (v) { var o = document.createElement('option'); o.value = v.id; o.textContent = v.name + (v.tags ? ' · ' + v.tags : ''); if (v.id === t.voice) o.selected = true; vs.appendChild(o); });
    ms.textContent = ''; t.models.forEach(function (m) { var o = document.createElement('option'); o.value = m.id; o.textContent = m.name; if (m.id === t.model) o.selected = true; ms.appendChild(o); });
    var n = $('ttsNote');
    if (S.ttsBusy) n.textContent = S.ttsBusy;
    else if (!has) n.textContent = Kin.shared ? Kin.SHARED_TEXT : 'No voice key on this device. The recorded voice says the fixed lines and the browser’s own voice says the rest.';
    else if (t.bad) n.textContent = t.bad + ' Until that is fixed Jarvis uses the backup voice.';
    else if (t.why) n.textContent = 'Last problem: ' + t.why + ' Kin used the backup voice for that answer.';
    else if (!t.voices.length) n.textContent = 'A key is saved (' + voice.tts.keyHint() + '). Tap Reload voices to read the account’s voices.';
    else n.textContent = 'A key is saved (' + voice.tts.keyHint() + '). Every sentence is spoken as ' + (t.voiceName || 'the chosen voice') + '.' + (t.calls ? ' This visit: ' + t.calls + (t.calls === 1 ? ' sentence, ' : ' sentences, ') + t.chars + ' characters sent.' : '');
    $('ttsKey').value = '';
  }

  /* the place for the weather: looked up once by name, then only its coordinates are used */
  function wxSettings() {
    if (!Kin.chart || !$('wxNote')) return;
    var pl = Kin.chart.place();
    $('wxNote').textContent = Kin.shared ? 'Not available at this address.' : pl ? 'Weather for ' + [pl.name, pl.region, pl.country].filter(Boolean).join(', ') + '.' : 'No place set. Type your town and tap Find it.';
    $('wxDrop').hidden = !pl; $('wxTown').disabled = $('wxFind').disabled = !!Kin.shared;
    var u = Kin.chart.units(); [].forEach.call($('wxUnits').children, function (b) { b.setAttribute('aria-pressed', b.dataset.u === u ? 'true' : 'false'); b.disabled = !!Kin.shared; });
    if (Kin.briefBoard && $('briefSettings') && !$('briefSettings').firstChild) Kin.briefBoard.settingsUI($('briefSettings'));
    deskSettings();
  }
  function deskSettings() {
    var D = Kin.desk; if (!D || !$('notifyNote')) return;
    $('deskScreenNote').textContent = D.screen.supported()
      ? 'Look at my screen: tap the screen button by the mic, or say "look at my screen". Your browser asks which screen or window to share. While it is shared, each question you ask sends one downscaled snapshot of it to Anthropic with the question; nothing is recorded or kept. Tap Stop on the red pill to end it.'
      : 'Look at my screen works on a Mac in Chrome or Safari; it is not offered on this device.';
    var perm = D.notify.permission(), b = $('notifyOn');
    b.hidden = perm === 'granted' || perm === 'unsupported' || perm === 'denied';
    $('notifyNote').textContent = perm === 'unsupported' ? 'This browser cannot show notifications.' : perm === 'granted' ? 'On. When a design or a job from the brief finishes while this page is in the background, Kin tells you, and the app icon counts what is waiting.' : perm === 'denied' ? 'Blocked for this site. Allow notifications in the browser\'s site settings to turn them on.' : 'Off. Jarvis only asks when you tap the button; it then tells you when a long job finishes while the page is in the background.';
  }
  function wxFind() {
    var name = $('wxTown').value.trim(), box = $('wxPick'); box.textContent = ''; if (name.length < 2) return;
    $('wxNote').textContent = 'Looking up ' + name + '…';
    Kin.chart.findPlace(name).then(function (list) {
      if (!list.length) { $('wxNote').textContent = 'Open-Meteo found no place called ' + name + '. Try the nearest town.'; return; }
      $('wxNote').textContent = list.length === 1 ? '' : 'Which one?';
      function pick(p) { Kin.chart.setPlace(p); box.textContent = ''; $('wxTown').value = ''; wxSettings(); }
      if (list.length === 1) { pick(list[0]); return; }
      list.forEach(function (p) { var b = el('button', 'pill sm alt'); b.type = 'button'; b.appendChild(el('span', 'pl', [p.name, p.region, p.country].filter(Boolean).join(', '))); b.addEventListener('click', function () { pick(p); }); box.appendChild(b); });
    }, function (e) { $('wxNote').textContent = 'Open-Meteo could not be reached (' + ((e && e.message) || e) + ').'; });
  }
  function gbSettings() {
    var B = Kin.bridge; $('gbSection').hidden = !B; if ($('sg-grok')) $('sg-grok').hidden = !B; var gbPill = document.querySelector('#snav [data-sg="grok"]'); if (gbPill) gbPill.hidden = !B; $('leavesGB').hidden = !B; if (!B) return;
    var n = $('gbNote'), on = B.enabled();
    $('gbUrl').value = B.relay(); $('gbKeep').checked = B.kept(); $('gbCtx').checked = B.ctxOn(); $('gbTok').value = '';
    $('gbOn').textContent = on ? 'Turn off' : 'Turn on'; $('gbOn').dataset.sure = '';
    if (!B.available()) { n.textContent = Kin.shared ? Kin.SHARED_TEXT : 'This browser cannot use the bridge.'; ['gbSave', 'gbOn', 'gbTest', 'gbDrop'].forEach(function (id) { $(id).disabled = true; }); }
    else n.textContent = (on ? 'On.' : 'Off. Nothing is sent to Grok Bot.') + ' ' + (B.hasToken() ? (B.kept() ? 'A device token is kept on this device.' : 'A device token is saved for this tab only.') : 'No device token on this device.') + (B.relay() !== B.DEFAULT_RELAY ? ' Note: only ' + B.DEFAULT_RELAY + ' is allowed by this page, so another relay address will not connect.' : '');
    var el = $('gbJobs'); el.textContent = '';
    B.jobs().slice(-5).reverse().forEach(function (j) {
      var r = document.createElement('div'); r.className = 'gbjob'; var p = document.createElement('p'); var k = document.createElement('small'); k.textContent = j.st.replace(/_/g, ' ') + (j.waiting ? ' · checking' : '');
      p.appendChild(k); p.appendChild(document.createTextNode(' ' + (j.q.length > 90 ? j.q.slice(0, 87) + '…' : j.q))); r.appendChild(p);
      var bt = document.createElement('div'); bt.className = 'btns';
      if (!j.waiting && /^(queued|accepted|pending)$/.test(j.st)) { var rs = document.createElement('button'); rs.type = 'button'; rs.className = 'lnk'; rs.textContent = 'Resume'; rs.addEventListener('click', function () { gesture(); B.resume(j.id); refreshSettings(); }); bt.appendChild(rs); }
      if (j.waiting) { var sp = document.createElement('button'); sp.type = 'button'; sp.className = 'lnk dim'; sp.textContent = 'Stop'; sp.addEventListener('click', function () { B.stop(j.id); refreshSettings(); }); bt.appendChild(sp); }
      r.appendChild(bt); el.appendChild(r);
    });
  }
  /* ------------------------------------------------------------ sync across computers (Drive, off by default; every Google step needs a tap) */
  var syncDrawn = false;
  function syncTouch() { if (Kin.sync) Kin.sync.touch(); }
  function syncCard() { if (!Kin.sync || syncDrawn || !$('syncCard')) return; syncDrawn = true; Kin.sync.render($('syncCard')); }
  var SYNC_CHIP = { 'needs-tap': 'Tap to sync', syncing: 'Syncing', synced: 'Synced', conflict: 'Check sync', error: 'Not synced', locked: 'Sync locked' };
  function syncChip(v) {
    var b = $('syncChip'); if (!b) return;
    var t = v && v.enabled && !Kin.shared ? SYNC_CHIP[v.status] : '';
    if (t === 'Synced' && v.last) { var m = Math.round((Date.now() - new Date(v.last)) / 60000); t = m < 2 ? 'Synced just now' : m < 90 ? 'Synced ' + m + ' min ago' : 'Synced'; }
    b.hidden = !t; b.textContent = t || ''; b.dataset.s = v ? v.status : 'off';
  }
  function syncStart() {
    if (!Kin.sync || Kin.shared) return;
    Kin.sync.onChange(syncChip);
    Kin.sync.boot().then(syncChip, function () {});
    setInterval(function () { syncChip(Kin.sync.view()); }, 60000);
  }
  function refreshSettings() {
    if ($('sheet').hidden) return;
    syncCard();
    steps();
    var en = $('earsNote');
    if (!ears.supported) en.textContent = 'This browser has no built-in speech recognition, so Jarvis cannot hear a wake phrase here. Use Chrome or Edge on a computer, Chrome on Android, or Safari on an iPhone. You can still talk through the keyboard’s mic.';
    else if (ears.standalone && ears.isIOS) en.textContent = 'Opened from the iPhone home screen. Apple does not offer speech recognition to home-screen web apps, so if the mic does nothing here, open this address in Safari itself.';
    else if (S.micState === 'listening') en.textContent = S.startedByLoad ? 'Listening since the page opened. The browser already had your Allow for this site.' : 'Listening. It started after your tap.';
    else if (S.micState === 'blocked') en.textContent = blockedWhy(S.micWhy).full;
    else en.textContent = S.perm === 'granted' && !ears.isSafari ? 'The microphone is allowed. Jarvis starts listening when the page opens.' : 'The browser wants one tap before it will listen. Tap the mic, or anywhere on the page.' + (ears.isSafari ? ' Safari may ask for the microphone again on later visits, and it cannot listen while Jarvis is speaking.' : '');
    if (ears.supported) en.textContent += ' Your speech is turned into text by the browser maker’s servers (Google in Chrome, Microsoft in Edge, Apple in Safari) whenever the mic is on, including while Jarvis is asleep and waiting for the wake phrase.';
    $('wakeP').value = S.wake; voiceSettings();
    var seg = $('voiceSeg'), cur = voice.get(); seg.textContent = '';
    voice.VOICES.concat(['device']).forEach(function (v) { var b = document.createElement('button'); b.type = 'button'; b.textContent = v; b.setAttribute('aria-pressed', (v === 'device' ? cur.mode === 'device' : cur.mode === 'jarvis' && cur.who === v)); b.dataset.v = v; seg.appendChild(b); });
    var sysName = voice.systemVoiceName(), remote = voice.systemVoiceRemote() ? ' That voice is spoken by the browser maker’s servers, so the sentences are sent there.' : '';
    $('voiceNote').textContent = voice.live() ? 'Used only if the voice key fails.' + remote : cur.mode === 'device' ? 'Everything is spoken by the browser’s own voice' + (sysName ? ' (' + sysName + ').' : '.') + remote : 'The recorded voice says the fixed lines (welcome, one moment, standing by). Answers use the browser’s own voice' + (sysName ? ' (' + sysName + ')' : '') + '. Tap a name to hear it.' + remote;
    $('keyNote').textContent = Kin.shared ? Kin.SHARED_TEXT : brain.hasKey() ? 'A key is saved on this device: ' + brain.keyHint() + '. Small talk uses ' + brain.QUICK + ', real questions use ' + brain.MAIN + '.' + (Kin.mac && Kin.mac.keptOnMac('claude') ? ' Kept in your Mac\u2019s Keychain.' : '') : 'No key on this device. Jarvis answers from the pack only.';
    $('webCap').value = Kin.mind.webCap();
    hfSettings(); gbSettings(); wxSettings(); lookSettings(); mailSettings();
    var sp = Kin.mind.spendToday();
    $('webNote').textContent = 'Web searches today: ' + Kin.mind.webToday() + ' of ' + Kin.mind.webCap() + '. Each search costs about one US cent, on top of the words. Reading a page has no extra charge. At the limit Jarvis answers without the web and says so.';
    var le = brain.lastError && brain.lastError(), leEl = $('lastErr');
    if (leEl) { leEl.hidden = !le; if (le) leEl.textContent = 'Last error: ' + new Date(le.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · ' + [le.status ? 'status ' + le.status : '', le.type, le.code, le.model, le.request ? 'request ' + le.request : ''].filter(Boolean).join(' · ') + (le.message ? '\n' + le.message : ''); }
    $('spendNote').textContent = sp.n ? 'Today on this device: ' + sp.n + (sp.n === 1 ? ' answer' : ' answers') + ', about $' + sp.usd.toFixed(2) + '. An estimate from the token counts Anthropic reports; your Console shows the real bill.' : 'Nothing spent today on this device.';
    var mem = Kin.mind.memory(), ml = $('memList'); ml.textContent = '';
    if (!mem.length) { var e0 = document.createElement('p'); e0.className = 'note'; e0.textContent = 'Nothing yet. Say "remember that …", or use the thumbs under an answer.'; ml.appendChild(e0); }
    mem.slice().sort(function (a, b) { return b.at - a.at; }).forEach(function (m) { var r = document.createElement('div'); r.className = 'memrow'; var t = document.createElement('p'); var k = document.createElement('small'); k.textContent = { fact: 'Fact', preference: 'Preference', correction: 'Correction', good: 'Worked', bad: 'Not right', lesson: 'Lesson' }[m.kind] || m.kind; t.appendChild(k); t.appendChild(document.createTextNode(' ' + m.text)); var del = document.createElement('button'); del.type = 'button'; del.className = 'lnk dim'; del.textContent = 'Forget'; del.addEventListener('click', function () { Kin.mind.forget(m.id); refreshSettings(); }); r.appendChild(t); r.appendChild(del); ml.appendChild(r); });
    var u = brain.limits(); $('limH').value = u.perHour; $('limD').value = u.perDay;
    $('limNote').textContent = 'Jarvis stops sending questions to Claude after this many in an hour or in a day, says so, and goes to sleep. Used this hour: ' + u.hour + ' of ' + u.perHour + '. Today: ' + u.day + ' of ' + u.perDay + '.';
    $('moveExport').disabled = $('moveFile').disabled = $('moveTurns').disabled = !!Kin.shared; if (Kin.shared) $('moveNote').textContent = Kin.SHARED_TEXT;
    $('sharedNote').hidden = !Kin.shared; $('sharedNote').textContent = Kin.shared ? Kin.SHARED_TEXT + ' You can still try it here without keys.' : '';
    $('apiKey').value = '';
    var p = Kin.pack.get(); $('packNote').textContent = p ? p.name + ': ' + p.nodes.length + ' entries, ' + p.skills.length + ' playbooks' + (p.exported ? ', exported ' + p.exported.slice(0, 10) : '') + '.' : Kin.shared ? Kin.SHARED_TEXT : 'No pack on this device yet. ' + brain.PACK_STEPS;
    $('packname').textContent = p ? p.name : '';
    $('about').textContent = 'This page is a shell. It holds no company data and no keys. Your keys, your pack and the last few exchanges are stored only in this browser on this device, and are never uploaded to this website. What leaves the device is listed at the top of these settings.' + (ears.isSafari ? ' Safari forgets a site’s saved data after about a week without a visit, so you may need to paste the keys and import the pack again.' : '');
  }
  $('gear').addEventListener('click', function () { $('sheet').hidden = false; refreshSettings(); });
  if ($('syncChip')) $('syncChip').addEventListener('click', function (ev) {
    gesture();
    var v = Kin.sync && Kin.sync.view();
    if (v && v.status === 'needs-tap') { Kin.sync.syncNow(ev).then(function () { syncChip(Kin.sync.view()); }, function () { settingsAt('sync'); }); return; }
    settingsAt('sync');
  });
  $('sheetx').addEventListener('click', function () { $('sheet').hidden = true; packCard(); });
  /* settings sections: the pills jump to a section, and the pill of the section in view is lit */
  (function () {
    var nav = $('snav'), body = document.querySelector('#sheet .sheetbody'); if (!nav || !body) return;
    var pills = Array.prototype.slice.call(nav.querySelectorAll('button'));
    /* on a wide window the sections sit in a sidebar, so the nav takes no height above the content */
    function navH() { return nav.offsetWidth > body.clientWidth * 0.6 ? nav.offsetHeight : 0; }
    function lit() {
      var top = body.getBoundingClientRect().top + Math.max(navH() + 24, body.clientHeight * 0.35), cur = pills[0];
      pills.forEach(function (b) { var g = $('sg-' + b.dataset.sg); if (g && !g.hidden && g.getBoundingClientRect().top <= top) cur = b; });
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) cur = pills[pills.length - 1];
      pills.forEach(function (b) { if (b === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      if (cur && cur.scrollIntoView && nav.scrollWidth > nav.clientWidth) { var l = cur.offsetLeft - 16; if (l < nav.scrollLeft || cur.offsetLeft + cur.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = l; }
    }
    pills.forEach(function (b) { var g0 = $('sg-' + b.dataset.sg); if (g0) b.setAttribute('aria-label', g0.getAttribute('aria-label')); b.addEventListener('click', function () { var g = $('sg-' + b.dataset.sg); if (!g) return; body.scrollTop = b.dataset.sg === 'start' ? 0 : Math.max(0, g.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - navH() - 8); lit(); }); });
    body.addEventListener('scroll', lit, { passive: true });
    $('gear').addEventListener('click', function () { setTimeout(lit, 0); });
    lit();
  })();
  $('wakeP').addEventListener('change', function (e) { var v = e.target.value.replace(/\s+/g, ' ').trim().slice(0, 48); if (ears.norm(v).split(' ').filter(Boolean).length < 2) v = WAKE_DEF; S.wake = v; ls.set('kin.wake', v); e.target.value = v; });
  $('voiceSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; gesture(); var v = b.dataset.v; if (v === 'device') { voice.set({ mode: 'device' }); ls.set('kin.vmode', 'device'); } else { voice.set({ mode: 'jarvis', who: v }); ls.set('kin.vmode', 'jarvis'); ls.set('kin.voice', v); } refreshSettings(); say(voice.CLIPS.service, true); });
  function ttsBusy(msg) { S.ttsBusy = msg || ''; voiceSettings(); }
  $('ttsSave').addEventListener('click', function () {
    gesture(); var k = $('ttsKey').value; ttsBusy('Checking the key with ElevenLabs…');
    voice.tts.setKey(k).then(function () { S.ttsWhy = ''; ttsBusy(''); refreshSettings(); if (Kin.mac) Kin.mac.saveKey('elevenlabs', k, function () { refreshSettings(); }); }, function (e) { ttsBusy(''); $('ttsNote').textContent = (e && e.text) || 'That key could not be checked.'; });
  });
  $('ttsDrop').addEventListener('click', function () { voice.stop(); voice.tts.dropKey(); S.ttsWhy = ''; refreshSettings(); });
  $('ttsVoice').addEventListener('change', function (e) { voice.tts.setVoice(e.target.value); S.ttsWhy = ''; voiceSettings(); });
  $('ttsModel').addEventListener('change', function (e) { voice.tts.setModel(e.target.value); S.ttsWhy = ''; voiceSettings(); });
  $('ttsReload').addEventListener('click', function () { ttsBusy('Reading the account’s voices…'); voice.tts.refresh().then(function () { ttsBusy(''); refreshSettings(); }); });
  $('ttsTest').addEventListener('click', function () {
    gesture(); S.testing = true; ttsBusy('Speaking…'); S.said = ears.norm(voice.CLIPS.service);
    voice.tts.test(voice.CLIPS.service).then(function (r) { S.testing = false; ttsBusy(''); if (!r.ok && r.reason) $('ttsNote').textContent = r.reason + ' You heard the backup voice.'; });
  });
  function clearTalk() { brain.forget(); var t = $('thread'); t.textContent = ''; }
  $('keySave').addEventListener('click', function () {
    var kv = $('apiKey').value, r = brain.setKey(kv); $('apiKey').value = ''; refreshSettings();
    if (r.ok && Kin.mac) Kin.mac.saveKey('claude', kv, function () { refreshSettings(); }); kv = '';
    if (!r.ok) $('keyNote').textContent = r.why === 'shared' ? Kin.SHARED_TEXT : r.why === 'storage' ? 'This browser would not save the key. Its storage is blocked or full (private browsing does this).' : 'That does not look like an Anthropic API key. It should start with sk-ant-.';
  });
  /* the conversation holds pieces of the pack and is sent again as history, so it goes when the key or the pack goes */
  $('keyDrop').addEventListener('click', function () { brain.dropKey(); clearTalk(); refreshSettings(); });
  function setLimit(e) { var h = parseInt($('limH').value, 10), d = parseInt($('limD').value, 10); brain.setLimits({ perHour: h, perDay: d }); refreshSettings(); }
  $('limH').addEventListener('change', setLimit); $('limD').addEventListener('change', setLimit);
  function hfSettings() {
    var on = Kin.hf.connected(), st = Kin.hf.status();
    $('hfConnect').hidden = on; $('hfDrop').hidden = !on;
    $('hfState').classList.toggle('on', on); $('hfStateText').textContent = Kin.shared ? 'Not available at this address' : on ? 'Connected' : 'Not connected';
    $('hfNote').textContent = Kin.shared ? Kin.SHARED_TEXT : (st.why ? st.why + ' ' : st.last && !on ? st.last + ' ' : '') + (on
      ? 'Connected on this device. Design jobs can use real pictures: Kin prices them first and asks you before any credits are spent. The sign-in token stays on this device and is handed to Anthropic with each picture job, which then talks to Higgsfield.'
      : 'Not connected. Without it, designs are drawn rather than photographed. Connecting opens Higgsfield\'s sign-in page and brings you back here. It needs a paid Higgsfield plan.');
    $('hfCap').value = Kin.hf.cap();
    $('hfCapNote').textContent = 'Jarvis will not approve pictures past this many Higgsfield credits a day. Used today on this device: ' + Kin.hf.used() + ' of ' + Kin.hf.cap() + '. A full poster needs about 13.5 credits left. Credits are only counted for pictures Higgsfield actually started.';
    if ($('hfCimd')) { $('hfCimd').textContent = Kin.hf.usingCimd() ? 'Use the usual sign-in' : 'Try the other sign-in'; $('hfCimd').disabled = !!Kin.shared; }
    if ($('hfTest')) $('hfTest').disabled = !!Kin.shared;
  }
  Kin.onHf = function () { refreshSettings(); };
  /* Email: the Google Client ID for Send now, and the daily limit */
  function mailSettings() {
    if (!Kin.email || !$('mailCid')) return;
    var id = Kin.email.clientId();
    $('mailCid').value = id; $('mailCid').disabled = !!Kin.shared; $('mailSave').disabled = !!Kin.shared;
    $('mailCap').value = Kin.email.cap();
    $('mailNote').textContent = Kin.shared ? Kin.SHARED_TEXT : id ? 'Send now is on for this device. Sent from here today: ' + Kin.email.sentToday() + ' of ' + Kin.email.cap() + '.' : 'Not set up: emails open in Gmail for you to send.';
  }
  if ($('mailSave')) $('mailSave').addEventListener('click', function () { gesture(); var r = Kin.email.setClientId($('mailCid').value); if (!r.ok) { $('mailNote').textContent = r.why; return; } mailSettings(); });
  if ($('mailDrop')) $('mailDrop').addEventListener('click', function () { Kin.email.setClientId(''); mailSettings(); });
  if ($('mailCap')) $('mailCap').addEventListener('change', function () { Kin.email.setCap($('mailCap').value); mailSettings(); });
  /* one check that makes nothing: Higgsfield prices one picture through Claude, and its exact reply is shown */
  if ($('hfTest')) $('hfTest').addEventListener('click', function () {
    gesture(); var b = $('hfTest'), n = $('hfTestNote'); b.disabled = true; n.hidden = false; n.textContent = 'Asking Higgsfield for one price (nothing is made)…';
    Kin.hf.test().then(function (r) { b.disabled = false; n.textContent = (r.ok ? 'Working. ' : 'Not working. ') + r.text + (r.cost ? ' (about $' + r.cost.toFixed(3) + ' of Claude usage)' : ''); refreshSettings(); });
  });
  if ($('hfCimd')) $('hfCimd').addEventListener('click', function () {
    gesture(); var on = !Kin.hf.usingCimd(); Kin.hf.useCimd(on);
    $('hfTestNote').hidden = false; $('hfTestNote').textContent = on ? 'Switched to the other sign-in (this site\'s published client). Tap Connect Higgsfield to sign in again, then Test.' : 'Back to the usual sign-in. Tap Connect Higgsfield to sign in again.';
    refreshSettings();
  });
  $('wxFind').addEventListener('click', wxFind);
  $('wxTown').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); wxFind(); } });
  $('wxDrop').addEventListener('click', function () { Kin.chart.dropPlace(); wxSettings(); });
  [].forEach.call($('wxUnits').children, function (b) { b.addEventListener('click', function () { Kin.chart.setUnits(b.dataset.u); wxSettings(); }); });
  /* how Jarvis looks: the figure (default on a computer) or the orb; kept on this device (bust.js) */
  var LOOK_WHY = { phone: 'On a phone or a touch screen Jarvis is always the orb.', reduced: 'Your device asks for reduced motion, so Jarvis is the orb.', lowpower: 'This device is set to save power or data, so Jarvis is the orb.', nogl: 'This browser cannot draw the figure (no WebGL), so Jarvis is the orb.' };
  function lookSettings() {
    if (!$('lookSeg') || !Kin.bust || !Kin.bust.pref) return;
    var p = Kin.bust.pref(), why = Kin.bust.blocked();
    [].forEach.call($('lookSeg').children, function (b) { b.setAttribute('aria-pressed', b.dataset.look === p ? 'true' : 'false'); b.disabled = !!Kin.shared; });
    $('lookNote').textContent = p === 'orb' ? 'The orb: one quiet sphere that breathes while it listens.' : why ? LOOK_WHY[why] || '' : 'The figure: a head and shoulders made of light, in the panel beside the conversation.';
  }
  if ($('lookSeg')) [].forEach.call($('lookSeg').children, function (b) { b.addEventListener('click', function () { gesture(); if (Kin.shared) return; Kin.bust.setLook(b.dataset.look); lookSettings(); }); });
  if ($('gauntletOpen')) $('gauntletOpen').addEventListener('click', function () { gesture(); if (Kin.gauntlet) gauntlet(false); });
  if ($('whatsNewOpen')) $('whatsNewOpen').addEventListener('click', function () { gesture(); if (Kin.whatsNew) whatsNew(false); });
  if ($('awayOpen')) $('awayOpen').addEventListener('click', function () { gesture(); if (Kin.shared) { localReply(Kin.SHARED_TEXT); return; } if (Kin.awayPanel) Kin.awayPanel.open('settings', { onSay: panelSay }); });
  $('notifyOn').addEventListener('click', function () { gesture(); if (Kin.desk) Kin.desk.notify.ask().then(function () { deskSettings(); }); });
  $('hfConnect').addEventListener('click', function () { gesture(); Kin.hf.connect().catch(function (e) { $('hfNote').textContent = (e && e.message) || 'Could not start the sign-in.'; }); });
  $('hfDrop').addEventListener('click', function () { Kin.hf.disconnect(); refreshSettings(); });
  $('hfCap').addEventListener('change', function () { Kin.hf.setCap($('hfCap').value); refreshSettings(); });

  /* the Grok Bot bridge settings */
  if (Kin.bridge) $('gbSave').addEventListener('click', function () {
    var r = Kin.bridge.setToken($('gbTok').value, $('gbKeep').checked); $('gbTok').value = ''; refreshSettings();
    if (!r.ok) $('gbNote').textContent = r.why === 'shared' ? Kin.SHARED_TEXT : r.why === 'storage' ? 'This browser would not save the token. Its storage is blocked or full.' : 'That does not look like a device token. Paste the whole token, with nothing around it.';
  });
  if (Kin.bridge) $('gbKeep').addEventListener('change', function () { /* moving a saved token between tab-only and kept needs it pasted again, so nothing is copied around */ if (Kin.bridge.hasToken()) { Kin.bridge.dropToken(); $('gbNote').textContent = 'Paste the token again to save it ' + ($('gbKeep').checked ? 'on this device.' : 'for this tab only.'); } });
  if (Kin.bridge) $('gbOn').addEventListener('click', function () {
    var B = Kin.bridge, b = $('gbOn');
    if (B.enabled()) { B.setEnabled(false); refreshSettings(); return; }
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to turn it on'; $('gbNote').textContent = 'Turning it on means a sentence you start with “ask Grok Bot” is sent to your relay and private mailbox, as described above. Nothing else.'; setTimeout(function () { if (b.dataset.sure === '1') { b.dataset.sure = ''; b.textContent = 'Turn on'; } }, 6000); return; }
    B.setEnabled(true); refreshSettings();
  });
  if (Kin.bridge) $('gbTest').addEventListener('click', function () { var n = $('gbNote'); n.textContent = 'Checking the relay…'; Kin.bridge.health().then(function (r) { n.textContent = r.ok ? 'The relay is up and answers this page. The token is checked when you ask; if it is refused, Jarvis says so then.' : 'The relay did not answer from here' + (r.status ? ' (HTTP ' + r.status + ')' : '') + '. It may be down, or not allowing this address.'; }); });
  if (Kin.bridge) $('gbDrop').addEventListener('click', function () { Kin.bridge.stopAll(); Kin.bridge.dropToken(); refreshSettings(); });
  if (Kin.bridge) $('gbUrl').addEventListener('change', function () { var r = Kin.bridge.setRelay($('gbUrl').value); refreshSettings(); if (!r.ok) $('gbNote').textContent = r.why; });
  if (Kin.bridge) $('gbCtx').addEventListener('change', function () { Kin.bridge.setCtx($('gbCtx').checked); refreshSettings(); });
  $('webCap').addEventListener('change', function () { Kin.mind.setWebCap(parseInt($('webCap').value, 10)); refreshSettings(); });
  $('memAll').addEventListener('click', function () { var b = $('memAll'); if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to forget everything Jarvis remembers'; setTimeout(function () { b.dataset.sure = ''; b.textContent = 'Forget all'; }, 5000); return; } Kin.mind.forgetAll(); b.dataset.sure = ''; b.textContent = 'Forget all'; refreshSettings(); });
  /* with no pack, one button on the main screen opens the file picker; the two steps sit beside it */
  function packCard() { var c = $('loadCard'); if (c) c.hidden = !!Kin.pack.get() || Kin.shared || !$('sheet').hidden; if (Kin.home) Kin.home.refresh(); }
  Kin.packCard = packCard;
  $('packFile2').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return; gesture(); $('loadNote').textContent = 'Reading…';
    Kin.pack.importFile(f).then(function (p) { $('loadNote').textContent = ''; $('packname').textContent = p.name; packCard(); caption('Your data is loaded, sir. ' + p.nodes.length + ' entries.', 'Ask me anything'); captionFade(8000); }, function (err) { $('loadNote').textContent = (err && err.message) || 'That file could not be read.'; });
    e.target.value = '';
  });
  $('packFile').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (!f) return; $('packNote').textContent = 'Reading…'; Kin.pack.importFile(f).then(function () { refreshSettings(); }, function (err) { $('packNote').textContent = (err && err.message) || 'That file could not be read.'; }); e.target.value = ''; });
  $('packDrop').addEventListener('click', function () { clearTalk(); Kin.pack.remove().then(refreshSettings, refreshSettings).then(packCard); });
  /* ------------------------------------------------------------ move to another computer: export, then a checked import that waits for a tap */
  var movePlan = null;
  function moveShow(plan) {
    var list = $('moveList'); list.textContent = ''; movePlan = plan;
    var pv = plan.preview, li = function (b, rest) { var x = document.createElement('li'), s = document.createElement('b'); s.textContent = b; x.appendChild(s); x.appendChild(document.createTextNode(rest)); list.appendChild(x); };
    li(pv.memory + ' ', pv.memory === 1 ? 'thing it remembers, added' : 'things it remembers, added');
    li(pv.made + ' ', pv.made === 1 ? 'piece for the Made shelf' : 'pieces for the Made shelf');
    li(pv.log + ' ', pv.log === 1 ? 'logbook entry' : 'logbook entries');
    if (pv.replaced.length) li('Replaced: ', pv.replaced.join(', '));
    if (pv.added.length) li('Added: ', pv.added.join(', '));
    var cl = $('moveChangeList'); cl.textContent = '';
    (pv.changes || []).forEach(function (c) { var x = document.createElement('li'), s = document.createElement('b'); s.textContent = c.what + ': '; x.appendChild(s); x.appendChild(document.createTextNode(c.from + ' → ' + c.to)); cl.appendChild(x); });
    $('moveChanges').hidden = !(pv.changes && pv.changes.length);
    /* the conversation stays out unless the founder ticks it here, after reading the warning */
    $('moveInTurns').checked = false; $('moveInTurnsRow').hidden = !pv.turns; $('moveInTurnsWarn').hidden = !pv.turns;
    if (plan.rejected) li(plan.rejected + ' ', 'other items were left out, because this page does not move them');
    $('moveWhen').textContent = plan.exported ? ' · exported ' + plan.exported.slice(0, 10) : '';
    $('movePreview').hidden = false; $('moveNote').textContent = 'Nothing has changed yet. Tap Bring it in to apply it, or Cancel.';
  }
  function moveHide() { movePlan = null; $('movePreview').hidden = true; $('moveList').textContent = ''; $('moveChangeList').textContent = ''; $('moveInTurns').checked = false; }
  $('moveExport').addEventListener('click', function (e) {
    if (!e.isTrusted) return; gesture();
    if (Kin.shared) { $('moveNote').textContent = Kin.SHARED_TEXT; return; }
    $('moveNote').textContent = 'Preparing the file…';
    Kin.move.exportNow({ turns: $('moveTurns').checked }).then(function (r) {
      var c = r.counts; $('moveNote').textContent = 'Saved ' + r.name + ': ' + c.memory + ' remembered, ' + c.made + ' made, ' + c.log + ' logbook, ' + c.settings + ' settings' + (c.turns ? ', and the conversation' : '') + '. No keys or tokens are in it.';
    }, function (err) { $('moveNote').textContent = (err && err.message) || 'The file could not be made.'; });
  });
  $('moveFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; gesture(); moveHide();
    if (Kin.shared) { $('moveNote').textContent = Kin.SHARED_TEXT; return; }
    $('moveNote').textContent = 'Reading…';
    Kin.move.read(f).then(moveShow, function (err) { $('moveNote').textContent = (err && err.message) || 'That file could not be read.'; });
  });
  $('moveCancel').addEventListener('click', function () { moveHide(); $('moveNote').textContent = 'Cancelled. Nothing changed.'; });
  $('moveApply').addEventListener('click', function (e) {
    if (!e.isTrusted || !movePlan) return; gesture();
    var plan = movePlan, withTurns = $('moveInTurns').checked === true; moveHide(); $('moveNote').textContent = 'Bringing it in…';
    Kin.move.apply(plan, { turns: withTurns }).then(function (r) {
      $('moveNote').textContent = 'Done: ' + r.memory + ' remembered, ' + r.made + ' made, ' + r.log + ' logbook, ' + r.settings + ' settings' + (r.refused ? '; ' + r.refused + ' left out by the never-keep rules' : '') + '. Reloading…';
      setTimeout(function () { location.reload(); }, 1600);
    }, function (err) { $('moveNote').textContent = (err && err.message) || 'It could not be applied.'; });
  });
  $('erase').addEventListener('click', function () {
    var b = $('erase'); if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to erase the keys, tokens, the pack and the conversation'; setTimeout(function () { b.dataset.sure = ''; b.textContent = 'Erase everything on this device'; }, 5000); return; }
    if (Kin.gauntlet) Kin.gauntlet.stop();
    ears.stop(); voice.stop(); voice.tts.dropKey(); brain.wipe(); Kin.mind.wipe(); if (Kin.hf) { Kin.hf.disconnect(); Kin.hf.wipe(); } if (Kin.bridge) Kin.bridge.wipe(); if (Kin.email) Kin.email.wipe(); if (Kin.sync) Kin.sync.wipe(); try { Object.keys(sessionStorage).forEach(function (k) { if (/^kin\./.test(k)) sessionStorage.removeItem(k); }); } catch (e) {} try { Object.keys(localStorage).forEach(function (k) { if (/^kin\./.test(k)) localStorage.removeItem(k); }); } catch (e) {}
    Kin.pack.kv.wipe().then(function () { location.reload(); });
  });

  /* ------------------------------------------------------------ start */
  /* coming back from Higgsfield's sign-in page: finish it, then say so */
  var hfBack = Kin.hf.finish().catch(function () { return false; });
  Promise.all([Kin.pack.load(), Kin.mind.load().catch(function () {})]).then(function (r) { var p = r[0];
    $('packname').textContent = p ? p.name : '';
    return ears.permission();
  }).then(function (perm) {
    S.perm = perm; S.autoListen = ears.supported && ls.get('kin.micok', '') === '1';
    /* Where the browser already holds an Allow for this site, listen from the moment the page opens.
       Safari wants a tap first, so does any browser that has not been asked yet. */
    if (ears.supported && perm === 'granted' && !ears.isSafari) { S.startedByLoad = true; ears.start(); }
    else if (ears.supported) caption(S.autoListen ? 'Tap anywhere and I’ll listen, sir.' : 'Tap the mic and choose Allow.', S.autoListen ? 'This browser wants one tap first' : 'Then say “hey Jarvis”');
    else caption('This browser cannot listen by itself.', 'Type, or use the keyboard’s mic');
    paint(); Kin.ready = true; packCard(); if (Kin.home) Kin.home.init();
    syncStart();
    /* a Grok Bot question still waiting from before the page was closed: show it, and keep checking if the token is here */
    if (Kin.bridge) { var gbw = Kin.bridge.restore(); gbw.forEach(gbPaint); if (gbw.length) caption('A Grok Bot question is still waiting, sir.', Kin.bridge.hasToken() && Kin.bridge.enabled() ? 'Checking for the answer' : 'Paste the device token in settings to check'); }
    if (voice.tts.hasKey()) voice.tts.refresh().then(function () { refreshSettings(); });
    if (Kin.shared || (!brain.hasKey() && !Kin.pack.get() && !S.autoListen)) { $('sheet').hidden = false; refreshSettings(); }
    /* said last, so the start-up lines do not cover it */
    return hfBack.then(function (ok) { if (ok === true) { caption('Higgsfield is connected, sir.', 'Designs can use real pictures now'); captionFade(9000); } else if (ok === false) { $('sheet').hidden = false; refreshSettings(); } });
  });
  /* inside the Jarvis Mac app: a key this page lacks comes from the Mac's Keychain (never shown), and a finished task is reported */
  if (Kin.mac) {
    Kin.mac.prefill(function () { refreshSettings(); });
    Kin.mac.onDone(function (o) { localReply(o.title + (o.body ? ' ' + o.body : ''), 'Your Mac'); showThread(); });
  }
  paint();
})();
