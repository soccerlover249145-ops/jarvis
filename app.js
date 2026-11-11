/* app.js: ties ears, brain, voice and face together.
   Kin is off (not listening), asleep (listening only for the wake phrase) or awake (a spoken conversation). */
(function () {
  'use strict';
  var Kin = window.Kin, ears = Kin.ears, voice = Kin.voice, brain = Kin.brain, bust = Kin.bust;
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), cap = $('caption'), inp = $('ask');
  var WAKE_DEF = 'wake up, daddy\'s home';
  var ls = { get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);

  var S = Kin.state = { talk: 'off', busy: false, talking: false, hearing: false, micState: 'off', micWhy: '', wake: ls.get('kin.wake', WAKE_DEF), greeted: false,
    deafUntil: 0, said: '', saidAt: 0, unlocked: false, ctl: null, queued: '', wakes: 0, asks: 0, perm: 'unknown', lastEx: 0, snooze: 0, kbMic: false };
  var buf = '', tail = '', hearT = 0, greetT = 0, idleT = 0, typeT = 0, capT = 0, flareT = 0, beatI = 0, pendWake = false, lastLen = 0, multi = 0, single = 0;
  voice.set({ mode: ls.get('kin.vmode', 'jarvis'), who: ls.get('kin.voice', 'arthur') });

  /* ------------------------------------------------------------ what is on screen */
  function caption(text, small, kind) {
    clearTimeout(capT);
    if (text == null) { cap.classList.remove('on', 'you'); return; }
    if (!S.unlocked && S.talk === 'awake' && kind !== 'you') small = 'Tap once so I can speak';
    cap.classList.toggle('you', kind === 'you'); $('capT').textContent = text; $('capS').textContent = small || ''; cap.classList.add('on');
  }
  function captionFade(ms) { clearTimeout(capT); capT = setTimeout(function () { if (!S.talking && !S.busy) caption(S.talk === 'asleep' ? sayPhrase() : null, S.talk === 'asleep' ? sleepHint() : ''); }, ms); }
  function sayPhrase() { return (ears.supported ? 'Say “hey Jarvis”' : 'Type “hey Jarvis”'); }
  function sleepHint() { return S.hearing ? 'Listening for it. Or tap here' : ears.supported ? 'Tap here so I can hear you' : 'Or tap here to wake Kin'; }
  function awakeHint() { return S.hearing ? 'Listening' : ears.supported ? 'Tap the mic so I can hear you' : coarse ? 'Tap the keyboard mic and talk' : 'Type to Kin'; }
  function flare(down) { var f = $('flare'); f.classList.remove('on'); f.classList.toggle('down', !!down); void f.offsetWidth; f.classList.add('on'); clearTimeout(flareT); flareT = setTimeout(function () { f.classList.remove('on'); }, 1700); if (!down) bust.wake(); }
  function paint() {
    var m = S.talking ? 'speaking' : S.busy ? 'thinking' : S.talk === 'asleep' ? 'asleep' : S.talk === 'awake' ? (S.hearing || !ears.supported ? 'listening' : 'idle') : 'off';
    app.dataset.state = S.talk; app.dataset.mood = m; bust.setMood(m);
    $('stS').textContent = 'Status: ' + (m === 'off' ? 'resting' : m);
    $('stM').textContent = S.micState === 'listening' ? 'Mic on' : S.micState === 'starting' ? 'Mic starting' : S.micState === 'blocked' ? 'Mic blocked' : 'Mic off';
    $('mic').setAttribute('aria-pressed', ears.wanted());
    inp.placeholder = S.talk === 'awake' ? (S.hearing ? 'Listening. Just talk.' : 'Ask Kin') : ears.supported ? 'Say “hey Jarvis”, or type' : 'Type to Kin';
  }
  function addMsg(who, text) {
    var t = $('thread'), e = t.querySelector('.empty'); if (e) e.remove();
    var d = document.createElement('div'); d.className = 'msg ' + who;
    var s = document.createElement('small'); s.textContent = who === 'you' ? 'You' : 'Kin'; var p = document.createElement('p'); p.textContent = text;
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
    (r.made || []).forEach(function (id) { var m = Kin.mind.getMade(id); if (!m || d.querySelector('[data-made="' + id + '"]')) return; var b = document.createElement('button'); b.type = 'button'; b.className = 'madeb'; b.dataset.made = id; b.textContent = 'Open ' + (m.kind === 'design' ? 'the design' : 'the ' + m.kind) + ': ' + m.title; d.appendChild(b); });
    if (r.source === 'claude' && !r.code && !r.declined) {
      var meta = document.createElement('div'); meta.className = 'meta'; var bits = [];
      var model = String(r.model || ''); bits.push(/haiku/.test(model) ? 'Quick' : /fable/.test(model) ? 'Fable 5.2' : 'Opus 5.5' + (r.fableOff ? ' (Fable 5.2 was not open to this key)' : ''));
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
    return String(text).replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1').replace(/\(?https?:\/\/[^\s)]+\)?/g, ' ').replace(/^\s*\|.*\|\s*$/gm, ' ').replace(/^#{1,4}\s+/gm, '').replace(/^\s*(?:[-*]|\d+[.)])\s+/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`>|]/g, '').replace(/#(\d+)/g, 'number $1').replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').replace(/:\./g, ':').replace(/\s+/g, ' ').trim();
  }
  /** the part of a long answer that is read aloud. It only ever grows as the answer grows, so it can be spoken while streaming. */
  function head(t) { if (t.length <= 620) return t; var cut = t.slice(0, 620), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? ')); return cut.slice(0, end > 200 ? end + 1 : 620); }
  function spoken(text) { var t = plain(text), h = head(t); return h.length < t.length ? h + ' The rest is on screen, sir.' : t; }
  /** A browser will not play sound until the page has had a tap or a key press. Until then nothing is spoken,
      and nothing is sent to the voice service either, so nothing is billed for words nobody hears. */
  function say(text, raw) { var t = raw ? String(text) : spoken(text); if (!S.unlocked) return Promise.resolve(); S.said = ears.norm(t); return voice.say(t); }
  voice.on(function (e) {
    if (e.type === 'ttsfail') { S.ttsWhy = e.reason; S.ttsShown = false; refreshSettings(); return; }
    if (e.type === 'line') { if (S.talk !== 'off' || S.speakTyped || S.testing) { var why = S.ttsWhy && !S.ttsShown ? S.ttsWhy + ' Using the backup voice' : ''; caption(e.text, why || (S.talk === 'awake' ? awakeHint() : '')); } return; }
    var was = S.talking; S.talking = e.state === 'speaking';
    clearInterval(beatI);
    if (S.talking) {
      beatI = setInterval(function () { if (Math.random() < 0.8) bust.beat(0.55 + Math.random() * 0.45); }, 170); if (ears.isSafari) ears.hold(true);
      /* anything half-heard as Kin starts to speak is its own voice or is now out of date: let it go */
      tail = ''; clearTimeout(hearT); if (buf) hearT = setTimeout(commit, 800);
    }
    if (was && !S.talking) { S.deafUntil = Date.now() + Kin.T.hard; S.softUntil = Date.now() + Kin.T.deaf; S.saidAt = Date.now(); if (S.ttsWhy) S.ttsShown = true; if (ears.isSafari) ears.hold(false); touch(); captionFade(3200); }
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
  /** An open mic also hears Kin. Words that are mostly what Kin just said are its echo, not a question.
      Soon after it spoke, most of its words coming back is enough; later only a long run of them is.
      A reply that opens with a word Kin did not say ("yes, draft the order") is the founder answering. */
  var OPENER = /^(yes|yeah|yep|yup|no|nope|nah|please|sure|ok|okay|do|go|dont|actually|and|but|then)$/;
  function echo(text) {
    if (!S.said) return false; var now = Date.now(), age = now - S.saidAt; if (!S.talking && age > Kin.T.echo) return false;
    var a = ears.norm(text).split(' ').filter(Boolean), said = ' ' + S.said + ' ', hit = 0, soft = now < (S.softUntil || 0);
    if (a.length < (soft ? 1 : 2)) return false;
    if (OPENER.test(a[0]) && said.indexOf(' ' + a[0] + ' ') < 0) return false;
    a.forEach(function (w) { if (said.indexOf(' ' + w + ' ') >= 0) hit++; });
    var r = hit / a.length;
    /* in the two seconds after Kin stops, recognizers are still finishing its last sentence: be strict */
    if (soft) return r >= 0.5;
    return (S.talking || age <= 6000) ? r >= 0.7 : (a.length >= 5 && r >= 0.85);
  }

  /* ------------------------------------------------------------ waking and sleeping */
  /** must run inside a tap or key press at least once: lets the page play sound and speak */
  function gesture() { var was = S.unlocked; voice.unlock(); S.unlocked = true; if (!was && S.talk === 'awake' && cap.classList.contains('on') && !cap.classList.contains('you')) $('capS').textContent = awakeHint(); }
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
  function stopAll() { voice.stop(); S.queued = ''; if (S.busy && S.ctl) S.ctl.abort(); caption(null); }
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
    clearTimeout(hearT); var q = (buf + ' ' + tail).trim(), n = ears.norm(q); buf = tail = ''; if (!q || S.talk !== 'awake') return;
    /* a yes or no to a question Kin asked before spending: short words like "yeah" count here */
    if (pendingConfirm && !echo(q) && pendingConfirm.answer(q)) { showHeard(''); return; }
    if (n.length < 2 || /^(um+|uh+|hm+|mm+|ah+|oh|er+|okay|ok|yeah|yep|right|so|well|and|the|a|i)$/.test(n)) { showHeard(''); caption(null); return; }
    /* last line of defence: never send Kin its own words */
    if (echo(q)) { showHeard(''); caption(null); return; }
    /* nothing has passed between us for a while: these words were probably not meant for Kin */
    if (Date.now() - S.lastEx > Kin.T.follow + 7000 && !ears.wakeIn(q, S.wake)) { showHeard(''); sleep(true); return; }
    if (S.busy && !ears.sleepIn(q) && !ears.stopIn(q)) { S.queued = q; return; }
    ask(q);
  }
  function heard(text, fin) {
    text = String(text || '').trim(); if (!text || S.talk === 'off') return;
    /* while Kin speaks, and for a moment after, nothing is taken in except "stop" */
    if (deaf()) { if (fin && ears.stopIn(text)) voice.stop(); return; }
    /* Kin's own words, half-heard or whole: drop them, and drop the half-heard copy that was waiting */
    if (echo(text)) { tail = ''; clearTimeout(hearT); if (buf) hearT = setTimeout(commit, 800); return; }
    bust.beat(1);
    if (S.talk === 'asleep' || pendWake) {
      var m = ears.wakeIn(text, S.wake); if (!m && !pendWake) return;
      if (!pendWake) { pendWake = true; cue(); } clearTimeout(greetT);
      if (fin) { pendWake = false; greetNow(m ? m.rest : text.split(/\s+/).length > 6 ? text : ''); }
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
    if (e.state === 'listening') { ls.set('kin.micok', '1'); if (S.talk === 'off') { S.talk = 'asleep'; caption(sayPhrase(), sleepHint()); } else if (S.talk === 'asleep' && !S.talking) caption(sayPhrase(), sleepHint()); }
    if (e.state === 'blocked') { S.talk = S.talk === 'awake' ? 'awake' : 'off'; var bw = blockedWhy(e.reason); caption(bw.short, bw.small); }
    if (e.state === 'off' && e.reason !== 'stopped') { buf = tail = ''; clearTimeout(hearT); if (S.talk === 'asleep') S.talk = 'off'; if (!S.talking && !S.busy) caption(e.reason === 'stalled' ? 'Listening keeps cutting out here.' : 'The microphone closed.', 'Tap the mic to listen again'); }
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
  var YES = /^(yes|yeah|yep|yup|sure|ok|okay|go|go ahead|do it|make them|make it|please do|approved|yes please)( sir| kin| jarvis)?$/, NO = /^(no|nope|not now|skip|skip (them|pictures)|cancel|stop|dont|do not|no thanks)( sir| kin| jarvis)?$/;
  function confirmCard(card) {
    return new Promise(function (res) {
      var t = $('thread'), d = document.createElement('div'); d.className = 'msg kin ask';
      var sm = document.createElement('small'); sm.textContent = 'Kin asks before spending'; d.appendChild(sm);
      var h = document.createElement('p'); h.className = 'asktitle'; h.textContent = card.title; d.appendChild(h);
      (card.lines || []).forEach(function (l) { var q = document.createElement('p'); q.className = 'note'; q.textContent = l; d.appendChild(q); });
      var bt = document.createElement('div'); bt.className = 'btns';
      var y = document.createElement('button'); y.type = 'button'; y.className = 'askyes'; y.textContent = card.yes || 'Go ahead';
      var n = document.createElement('button'); n.type = 'button'; n.className = 'lnk dim'; n.textContent = card.no || 'Not now';
      bt.appendChild(y); bt.appendChild(n); d.appendChild(bt);
      /* the question sits above the answer that is waiting on it */
      var cur = t.lastElementChild; if (S.busy && cur && cur.classList.contains('kin') && !cur.classList.contains('ask')) t.insertBefore(d, cur); else t.appendChild(d);
      function done(v) {
        if (!pendingConfirm || pendingConfirm.d !== d) return; pendingConfirm = null; S.confirming = false; y.disabled = n.disabled = true;
        var r = document.createElement('p'); r.className = 'note'; r.textContent = v ? 'Approved.' : 'Declined. Nothing was spent on this.'; d.appendChild(r);
        caption(v ? 'Thank you, sir. Working on it.' : 'Understood, sir.', v ? 'Working' : ''); res(v);
      }
      pendingConfirm = { d: d, done: done, answer: function (q) { var x = ears.norm(q); if (YES.test(x)) { done(true); return true; } if (NO.test(x)) { done(false); return true; } return false; } };
      S.confirming = true;
      y.addEventListener('click', function () { gesture(); done(true); }); n.addEventListener('click', function () { gesture(); done(false); });
      if (S.ctl) S.ctl.signal.addEventListener('abort', function () { done(false); });
      showThread(); d.scrollIntoView({ block: 'end' });
      caption(card.title, 'Tap ' + (card.yes || 'Go ahead') + ', or say yes or no');
      if (card.say && (S.talk === 'awake' || S.speakTyped) && S.unlocked) say(card.say, true);
    });
  }
  Kin.confirm = confirmCard;

  function ask(text) {
    text = String(text || '').trim(); if (!text) return;
    if (pendingConfirm && pendingConfirm.answer(text)) { inp.value = ''; lastLen = 0; return; }
    if (command(text)) { inp.value = ''; lastLen = 0; return; }
    if (S.busy) return;
    var now = Kin.mind.instant(text);
    if (now) { instantly(text, now); return; }
    var aloud = S.talk === 'awake', p = null, got = false, t0 = Date.now(), momT = 0, watchI = 0, sess = null, lastSign = Date.now(), stalled = false, pr, making = false;
    inp.value = ''; lastLen = 0; multi = single = 0; S.asks++; touch();
    addMsg('you', text); p = addMsg('kin', '…');
    caption(text.length > 150 ? text.slice(0, 147) + '…' : text, 'Thinking', 'you');
    S.busy = true; S.ctl = new AbortController(); S.speakTyped = !aloud && S.unlocked; paint();
    var speakIt = (aloud || S.speakTyped) && S.unlocked;
    /* a long silence feels broken: say so once, and never wait forever, before the first word or after it */
    momT = setTimeout(function () { if (S.busy && !got && !S.talking && speakIt) say(voice.CLIPS.moment, true); }, 6500);
    watchI = setInterval(function () { if (!S.busy) { clearInterval(watchI); return; } if (S.confirming) { lastSign = Date.now(); return; } if (Date.now() - lastSign > (making ? Kin.T.making : got ? Kin.T.quiet : Kin.T.firstText)) { stalled = true; try { S.ctl.abort(); } catch (e) {} } }, 1000);
    function finish(r) {
      S.last = { ms: Date.now() - t0, source: r.source, code: r.code || '', model: r.model || '' };
      var out = r.text || (r.code === 'stopped' ? (got ? p.textContent : 'Stopped.') : 'I have nothing to say to that, sir.');
      if (r.code === 'stopped' && stalled) out = got ? p.textContent + ' … The answer stopped arriving, sir. Ask again.' : 'Claude did not answer, sir. Check the connection and the key in settings, then ask again.';
      if (r.source === 'local' && !S.toldLocal && !brain.hasKey()) { S.toldLocal = true; out = 'No Claude key on this device yet, sir, so this is only what I hold here. ' + out; }
      /* the detail of an error is for the eye only: it is never spoken and never sent to a voice service */
      if (r.detail) p.textContent = out + '\n' + r.detail; else settle(p, out, r, text);
      if (r.code === 'limit') { S.queued = ''; if (S.talk === 'awake') sleep(true); caption(out, 'Change the limit in settings'); if (speakIt) say(out, true); else captionFade(9000); refreshSettings(); return; }
      if (r.code === 'stopped' && got && !stalled) { if (sess) voice.stop(); caption(null); return; }
      if (sess) { var fin = spoken(out); S.said = ears.norm(fin); sess.finish(fin); }
      else if (speakIt && voice.canSpeak()) { caption(spoken(out).slice(0, 190), r.detail ? 'The reason is in the conversation' : ''); say(out); }
      else { caption(spoken(out).slice(0, 260), r.source === 'local' ? 'From this device only' : !S.unlocked && aloud ? 'Tap once so I can speak' : ''); captionFade(9000); touch(); }
      /* what was made opens on the shelf; a typed answer with sources, or longer than what is read out, opens the conversation */
      if (r.made && r.made.length) openShelf('made', r.made[r.made.length - 1]);
      else if (!aloud && !r.detail && ((r.sources && r.sources.length) || plain(out).length > 620)) showThread();
      else if (aloud && r.sources && r.sources.length && !S.talking) $('capS').textContent = 'Sources: tap the status line';
      if (S.queued && S.talk === 'awake') { var q = S.queued; S.queued = ''; setTimeout(function () { ask(q); }, 300); }
    }
    try {
      pr = brain.ask(text, { aloud: aloud, signal: S.ctl.signal,
        onText: function (t) { got = true; lastSign = Date.now(); p.textContent = t; var m = /^(.{30,190}?[.!?])(\s|$)/.exec(spoken(t)); if (m && !S.talking) caption(m[1], 'Kin');
          /* with a voice key, the first whole sentence is spoken while the rest is still arriving */
          /* only a spoken conversation is spoken while it streams: a typed answer is checked first, then its opening is read out */
          if (aloud && speakIt && voice.live()) { var c = head(plain(t)); if (!sess && /[.!?]["')\]]?\s/.test(c)) { clearTimeout(momT); sess = voice.begin(); } if (sess) { S.said = ears.norm(c); sess.feed(c); } } },
        onTool: function () { got = true; lastSign = Date.now(); },
        /* every event of a stream is a sign of life: thinking, a tool's input arriving, a search */
        onBeat: function () { lastSign = Date.now(); },
        onRoute: function (route) { making = route === 'make' || route === 'design'; },
        onStatus: function (st) { lastSign = Date.now(); if (!S.talking && !got) caption(text.length > 150 ? text.slice(0, 147) + '…' : text, st, 'you'); else if (!S.talking) $('capS').textContent = st; },
        onMade: function () { lastSign = Date.now(); refreshMade(); },
        onRemember: function () { refreshSettings(); },
        confirm: confirmCard
      });
    } catch (e) { pr = Promise.resolve({ text: 'Something went wrong on this page, sir. The reason is on screen.', detail: String((e && e.message) || e).slice(0, 200), source: 'local', code: 'error' }); }
    /* whatever happens, Kin must never be left "thinking" */
    function end() { clearTimeout(momT); clearInterval(watchI); S.busy = false; }
    Promise.resolve(pr).then(function (r) { end(); try { finish(r || { text: '', source: 'local', code: 'error' }); } catch (e) { caption('Something went wrong on this page, sir.', ''); captionFade(9000); } paint(); },
      function () { end(); caption('Something went wrong on this page, sir.', ''); captionFade(9000); paint(); });
  }
  Kin.ask = ask;
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
    if (!ears.supported) { S.kbMic = true; S.talk = 'awake'; touch(); caption('This browser cannot listen by itself.', coarse ? 'Tap the keyboard mic and talk. I send when you pause' : 'Type to Kin, or use your computer’s dictation key'); inp.focus(); paint(); return; }
    if (ears.wanted()) { ears.stop(); S.talk = 'off'; voice.stop(); caption(null); paint(); return; }
    ears.start(); cue(); caption('I’m listening, sir. Go ahead.', 'Listening');
    /* Safari cannot listen and speak at once, and it wants listening to begin inside the tap, so it stays quiet here */
    if (!ears.isSafari) say(voice.CLIPS.listening, true);
    paint();
  });
  cap.addEventListener('click', function () { gesture(); if (S.talk !== 'awake') wakeNow(); else if (S.talking) voice.stop(); else touch(); });
  /** open the conversation at its newest answer, from the top of that answer */
  function showThread() { var t = $('thread'); t.hidden = false; var m = t.querySelector('.msg.kin:last-child'); t.scrollTop = m && m.offsetTop > 0 && m.offsetHeight > t.clientHeight * 0.6 ? Math.max(0, (m.previousElementSibling || m).offsetTop - 12) : t.scrollHeight; }
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
  function refreshMade() {
    var el = $('shelfbody'); if (!el || $('shelf').hidden) return; el.textContent = '';
    [].forEach.call(document.querySelectorAll('#shelftabs button'), function (b) { b.setAttribute('aria-pressed', b.dataset.tab === shelfTab); });
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
  $('thread').addEventListener('click', function (e) { var b = e.target.closest('[data-made]'); if (b) openShelf('made', b.dataset.made); });
  Kin.mind.onTimer(function (t) {
    var el = $('stT');
    if (t && t.done) { el.hidden = true; flare(); voice.chime('wake'); caption(t.label + ' is up, sir.', 'Timer'); if (S.unlocked) say(voice.CLIPS.done, true); captionFade(8000); return; }
    if (!t) { el.hidden = true; return; }
    el.hidden = false; el.textContent = t.label + ' ' + Math.floor(t.left / 60) + ':' + ('0' + t.left % 60).slice(-2);
  });

  /* ------------------------------------------------------------ settings */
  function steps() {
    var micOk = S.micState === 'listening' || ls.get('kin.micok', '') === '1', p = Kin.pack.get(), rows = [
      [micOk, 'Allow the microphone', ears.supported ? 'Tap the mic once and choose Allow. The browser remembers it for this site. The browser, not this page, turns your speech into text, on its maker’s servers.' : 'This browser cannot listen by itself. Use the keyboard’s mic or type.'],
      [brain.hasKey(), 'Paste a Claude API key', 'From console.anthropic.com. With one, your questions and the parts of the pack Kin looks up go to Anthropic for an answer. Without one Kin answers only from the pack on this device.'],
      [voice.tts.hasKey(), 'Optional: paste a voice key', 'From elevenlabs.io. With one, every sentence Kin speaks is sent there and spoken in the voice you pick. Without one, the browser’s own voice reads the answers.'],
      [!!p, 'Import your Kin pack', 'In the Atlas: Kin’s settings > Your data > Export everything. Then here: Settings > Import Kin pack (below). The file is stored on this device only.'],
      [S.wakes > 0, 'Say “hey Jarvis”', 'Or your own wake phrase. Then just talk.']
    ];
    var el = $('steps'); el.textContent = '';
    rows.forEach(function (r, i) { var d = document.createElement('div'); d.className = 'step' + (r[0] ? ' done' : ''); var b = document.createElement('b'); b.textContent = r[0] ? 'OK' : '0' + (i + 1); var pp = document.createElement('p'); pp.textContent = r[1]; var sm = document.createElement('small'); sm.textContent = r[2]; pp.appendChild(sm); d.appendChild(b); d.appendChild(pp); el.appendChild(d); });
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
    else if (t.bad) n.textContent = t.bad + ' Until that is fixed Kin uses the backup voice.';
    else if (t.why) n.textContent = 'Last problem: ' + t.why + ' Kin used the backup voice for that answer.';
    else if (!t.voices.length) n.textContent = 'A key is saved (' + voice.tts.keyHint() + '). Tap Reload voices to read the account’s voices.';
    else n.textContent = 'A key is saved (' + voice.tts.keyHint() + '). Every sentence is spoken as ' + (t.voiceName || 'the chosen voice') + '.' + (t.calls ? ' This visit: ' + t.calls + (t.calls === 1 ? ' sentence, ' : ' sentences, ') + t.chars + ' characters sent.' : '');
    $('ttsKey').value = '';
  }
  function refreshSettings() {
    if ($('sheet').hidden) return;
    steps();
    var en = $('earsNote');
    if (!ears.supported) en.textContent = 'This browser has no built-in speech recognition, so Kin cannot hear a wake phrase here. Use Chrome or Edge on a computer, Chrome on Android, or Safari on an iPhone. You can still talk through the keyboard’s mic.';
    else if (ears.standalone && ears.isIOS) en.textContent = 'Opened from the iPhone home screen. Apple does not offer speech recognition to home-screen web apps, so if the mic does nothing here, open this address in Safari itself.';
    else if (S.micState === 'listening') en.textContent = S.startedByLoad ? 'Listening since the page opened. The browser already had your Allow for this site.' : 'Listening. It started after your tap.';
    else if (S.micState === 'blocked') en.textContent = blockedWhy(S.micWhy).full;
    else en.textContent = S.perm === 'granted' && !ears.isSafari ? 'The microphone is allowed. Kin starts listening when the page opens.' : 'The browser wants one tap before it will listen. Tap the mic, or anywhere on the page.' + (ears.isSafari ? ' Safari may ask for the microphone again on later visits, and it cannot listen while Kin is speaking.' : '');
    if (ears.supported) en.textContent += ' Your speech is turned into text by the browser maker’s servers (Google in Chrome, Microsoft in Edge, Apple in Safari) whenever the mic is on, including while Kin is asleep and waiting for the wake phrase.';
    $('wakeP').value = S.wake; voiceSettings();
    var seg = $('voiceSeg'), cur = voice.get(); seg.textContent = '';
    voice.VOICES.concat(['device']).forEach(function (v) { var b = document.createElement('button'); b.type = 'button'; b.textContent = v; b.setAttribute('aria-pressed', (v === 'device' ? cur.mode === 'device' : cur.mode === 'jarvis' && cur.who === v)); b.dataset.v = v; seg.appendChild(b); });
    var sysName = voice.systemVoiceName(), remote = voice.systemVoiceRemote() ? ' That voice is spoken by the browser maker’s servers, so the sentences are sent there.' : '';
    $('voiceNote').textContent = voice.live() ? 'Used only if the voice key fails.' + remote : cur.mode === 'device' ? 'Everything is spoken by the browser’s own voice' + (sysName ? ' (' + sysName + ').' : '.') + remote : 'The recorded voice says the fixed lines (welcome, one moment, standing by). Answers use the browser’s own voice' + (sysName ? ' (' + sysName + ')' : '') + '. Tap a name to hear it.' + remote;
    $('keyNote').textContent = Kin.shared ? Kin.SHARED_TEXT : brain.hasKey() ? 'A key is saved on this device: ' + brain.keyHint() + '. Small talk uses ' + brain.QUICK + ', real questions use ' + brain.MAIN + '.' : 'No key on this device. Kin answers from the pack only.';
    var dp = Kin.mind.deep(); [].forEach.call(document.querySelectorAll('#deepSeg button'), function (b) { b.setAttribute('aria-pressed', b.dataset.deep === dp); });
    $('webCap').value = Kin.mind.webCap();
    hfSettings();
    var sp = Kin.mind.spendToday();
    $('webNote').textContent = 'Web searches today: ' + Kin.mind.webToday() + ' of ' + Kin.mind.webCap() + '. Each search costs about one US cent, on top of the words. Reading a page has no extra charge. At the limit Kin answers without the web and says so.';
    $('spendNote').textContent = sp.n ? 'Today on this device: ' + sp.n + (sp.n === 1 ? ' answer' : ' answers') + ', about $' + sp.usd.toFixed(2) + '. An estimate from the token counts Anthropic reports; your Console shows the real bill.' : 'Nothing spent today on this device.';
    var mem = Kin.mind.memory(), ml = $('memList'); ml.textContent = '';
    if (!mem.length) { var e0 = document.createElement('p'); e0.className = 'note'; e0.textContent = 'Nothing yet. Say "remember that …", or use the thumbs under an answer.'; ml.appendChild(e0); }
    mem.slice().sort(function (a, b) { return b.at - a.at; }).forEach(function (m) { var r = document.createElement('div'); r.className = 'memrow'; var t = document.createElement('p'); var k = document.createElement('small'); k.textContent = { fact: 'Fact', preference: 'Preference', correction: 'Correction', good: 'Worked', bad: 'Not right', lesson: 'Lesson' }[m.kind] || m.kind; t.appendChild(k); t.appendChild(document.createTextNode(' ' + m.text)); var del = document.createElement('button'); del.type = 'button'; del.className = 'lnk dim'; del.textContent = 'Forget'; del.addEventListener('click', function () { Kin.mind.forget(m.id); refreshSettings(); }); r.appendChild(t); r.appendChild(del); ml.appendChild(r); });
    var u = brain.limits(); $('limH').value = u.perHour; $('limD').value = u.perDay;
    $('limNote').textContent = 'Kin stops sending questions to Claude after this many in an hour or in a day, says so, and goes to sleep. Used this hour: ' + u.hour + ' of ' + u.perHour + '. Today: ' + u.day + ' of ' + u.perDay + '.';
    $('sharedNote').hidden = !Kin.shared; $('sharedNote').textContent = Kin.shared ? Kin.SHARED_TEXT + ' You can still try it here without keys.' : '';
    $('apiKey').value = '';
    var p = Kin.pack.get(); $('packNote').textContent = p ? p.name + ': ' + p.nodes.length + ' entries, ' + p.skills.length + ' playbooks' + (p.exported ? ', exported ' + p.exported.slice(0, 10) : '') + '.' : Kin.shared ? Kin.SHARED_TEXT : 'No pack on this device yet. ' + brain.PACK_STEPS;
    $('packname').textContent = p ? p.name : '';
    $('about').textContent = 'This page is a shell. It holds no company data and no keys. Your keys, your pack and the last few exchanges are stored only in this browser on this device, and are never uploaded to this website. What leaves the device is listed at the top of these settings.' + (ears.isSafari ? ' Safari forgets a site’s saved data after about a week without a visit, so you may need to paste the keys and import the pack again.' : '');
  }
  $('gear').addEventListener('click', function () { $('sheet').hidden = false; refreshSettings(); });
  $('sheetx').addEventListener('click', function () { $('sheet').hidden = true; packCard(); });
  $('wakeP').addEventListener('change', function (e) { var v = e.target.value.replace(/\s+/g, ' ').trim().slice(0, 48); if (ears.norm(v).split(' ').filter(Boolean).length < 2) v = WAKE_DEF; S.wake = v; ls.set('kin.wake', v); e.target.value = v; });
  $('voiceSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; gesture(); var v = b.dataset.v; if (v === 'device') { voice.set({ mode: 'device' }); ls.set('kin.vmode', 'device'); } else { voice.set({ mode: 'jarvis', who: v }); ls.set('kin.vmode', 'jarvis'); ls.set('kin.voice', v); } refreshSettings(); say(voice.CLIPS.service, true); });
  function ttsBusy(msg) { S.ttsBusy = msg || ''; voiceSettings(); }
  $('ttsSave').addEventListener('click', function () {
    gesture(); var k = $('ttsKey').value; ttsBusy('Checking the key with ElevenLabs…');
    voice.tts.setKey(k).then(function () { S.ttsWhy = ''; ttsBusy(''); refreshSettings(); }, function (e) { ttsBusy(''); $('ttsNote').textContent = (e && e.text) || 'That key could not be checked.'; });
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
    var r = brain.setKey($('apiKey').value); $('apiKey').value = ''; refreshSettings();
    if (!r.ok) $('keyNote').textContent = r.why === 'shared' ? Kin.SHARED_TEXT : r.why === 'storage' ? 'This browser would not save the key. Its storage is blocked or full (private browsing does this).' : 'That does not look like an Anthropic API key. It should start with sk-ant-.';
  });
  /* the conversation holds pieces of the pack and is sent again as history, so it goes when the key or the pack goes */
  $('keyDrop').addEventListener('click', function () { brain.dropKey(); clearTalk(); refreshSettings(); });
  function setLimit(e) { var h = parseInt($('limH').value, 10), d = parseInt($('limD').value, 10); brain.setLimits({ perHour: h, perDay: d }); refreshSettings(); }
  $('limH').addEventListener('change', setLimit); $('limD').addEventListener('change', setLimit);
  $('deepSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; Kin.mind.setDeep(b.dataset.deep); refreshSettings(); });
  function hfSettings() {
    var on = Kin.hf.connected(), st = Kin.hf.status();
    $('hfConnect').hidden = on; $('hfDrop').hidden = !on;
    $('hfNote').textContent = Kin.shared ? Kin.SHARED_TEXT : (st.why ? st.why + ' ' : st.last && !on ? st.last + ' ' : '') + (on
      ? 'Connected on this device. Design jobs can use real pictures: Kin prices them first and asks you before any credits are spent. The sign-in token stays on this device and is handed to Anthropic with each picture job, which then talks to Higgsfield.'
      : 'Not connected. Without it, designs are drawn rather than photographed. Connecting opens Higgsfield\'s sign-in page and brings you back here. It needs a paid Higgsfield plan.');
    $('hfCap').value = Kin.hf.cap();
    $('hfCapNote').textContent = 'Kin will not approve pictures past this many Higgsfield credits a day. Used today on this device: ' + Kin.hf.used() + ' of ' + Kin.hf.cap() + '.';
  }
  Kin.onHf = function () { refreshSettings(); };
  $('hfConnect').addEventListener('click', function () { gesture(); Kin.hf.connect().catch(function (e) { $('hfNote').textContent = (e && e.message) || 'Could not start the sign-in.'; }); });
  $('hfDrop').addEventListener('click', function () { Kin.hf.disconnect(); refreshSettings(); });
  $('hfCap').addEventListener('change', function () { Kin.hf.setCap($('hfCap').value); refreshSettings(); });
  $('webCap').addEventListener('change', function () { Kin.mind.setWebCap(parseInt($('webCap').value, 10)); refreshSettings(); });
  $('memAll').addEventListener('click', function () { var b = $('memAll'); if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to forget everything Kin remembers'; setTimeout(function () { b.dataset.sure = ''; b.textContent = 'Forget all'; }, 5000); return; } Kin.mind.forgetAll(); b.dataset.sure = ''; b.textContent = 'Forget all'; refreshSettings(); });
  /* with no pack, one button on the main screen opens the file picker; the two steps sit beside it */
  function packCard() { var c = $('loadCard'); if (c) c.hidden = !!Kin.pack.get() || Kin.shared || !$('sheet').hidden; }
  Kin.packCard = packCard;
  $('packFile2').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return; gesture(); $('loadNote').textContent = 'Reading…';
    Kin.pack.importFile(f).then(function (p) { $('loadNote').textContent = ''; $('packname').textContent = p.name; packCard(); caption('Your data is loaded, sir. ' + p.nodes.length + ' entries.', 'Ask me anything'); captionFade(8000); }, function (err) { $('loadNote').textContent = (err && err.message) || 'That file could not be read.'; });
    e.target.value = '';
  });
  $('packFile').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (!f) return; $('packNote').textContent = 'Reading…'; Kin.pack.importFile(f).then(function () { refreshSettings(); }, function (err) { $('packNote').textContent = (err && err.message) || 'That file could not be read.'; }); e.target.value = ''; });
  $('packDrop').addEventListener('click', function () { clearTalk(); Kin.pack.remove().then(refreshSettings, refreshSettings).then(packCard); });
  $('erase').addEventListener('click', function () {
    var b = $('erase'); if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to erase the key, the pack and the conversation'; setTimeout(function () { b.dataset.sure = ''; b.textContent = 'Erase everything on this device'; }, 5000); return; }
    ears.stop(); voice.stop(); voice.tts.dropKey(); brain.wipe(); Kin.mind.wipe(); if (Kin.hf) { Kin.hf.disconnect(); Kin.hf.wipe(); } try { Object.keys(localStorage).forEach(function (k) { if (/^kin\./.test(k)) localStorage.removeItem(k); }); } catch (e) {}
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
    paint(); Kin.ready = true; packCard();
    if (voice.tts.hasKey()) voice.tts.refresh().then(function () { refreshSettings(); });
    if (Kin.shared || (!brain.hasKey() && !Kin.pack.get() && !S.autoListen)) { $('sheet').hidden = false; refreshSettings(); }
    /* said last, so the start-up lines do not cover it */
    return hfBack.then(function (ok) { if (ok === true) { caption('Higgsfield is connected, sir.', 'Designs can use real pictures now'); captionFade(9000); } else if (ok === false) { $('sheet').hidden = false; refreshSettings(); } });
  });
  paint();
})();
