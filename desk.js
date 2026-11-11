/* desk.js: what Kin can do at the founder's desk, in the browser itself.

   - Look at my screen: the founder shares a screen or window (the browser asks, every time). While it is shared,
     each question carries one downscaled snapshot of it to Claude, taken at that moment. Nothing is recorded, kept
     or stored: the snapshot lives only in that one request. A "Sharing" pill with Stop shows while it is on.
     Offered on a Mac in Chrome or Safari only; hidden on phones and tablets.
   - Open a tab: "open example.com" opens it in a new tab. Only https addresses, and only from the founder's own
     words (typed or said); Claude cannot open anything. If the browser blocks it, a link is shown, with a one-time
     hint about allowing pop-ups.
   - Notifications: asked for only from a tap in settings. When a long job finishes while the page is in the
     background, a notification says so, and the app icon's badge counts what is waiting (where the browser has one).

   Public surface: Kin.desk = { screen: {...}, tab: {...}, notify: {...} } */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------------------------------------------------------------- look at my screen */
  var nav = window.navigator || {}, ua = String(nav.userAgent || '');
  /* a Mac, in Chrome or Safari (not Firefox, not Edge), with a mouse: an iPad also says "Macintosh" but has touch points */
  var mac = /Macintosh/.test(ua) && !(nav.maxTouchPoints > 1);
  var engine = /Firefox\//.test(ua) || /Edg\//.test(ua) || /OPR\//.test(ua) ? '' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : '';
  var canShare = !!(nav.mediaDevices && typeof nav.mediaDevices.getDisplayMedia === 'function');
  var MAX_W = 1280, MAX_H = 1280, QUALITY = 0.72;
  var stream = null, video = null, listeners = [];
  function changed() { listeners.forEach(function (fn) { try { fn(!!stream); } catch (e) {} }); }
  var screen = {
    /** shown at all: a Mac in Chrome or Safari that can share a screen */
    supported: function () { return !!(Kin.T && Kin.T.forceScreen) || (canShare && mac && !!engine); },
    on: function () { return !!stream; },
    onChange: function (fn) { listeners.push(fn); },
    /** must be called from a tap or a typed Enter: the browser asks which screen or window to share */
    start: function () {
      if (stream) return Promise.resolve(true);
      if (!canShare) return Promise.reject(new Error('This browser cannot share a screen.'));
      return nav.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: false }).then(function (s) {
        stream = s; video = document.createElement('video'); video.muted = true; video.playsInline = true; video.autoplay = true; video.srcObject = s;
        /* kept in the page, tiny and invisible: some browsers do not decode frames for a video that is not in the document */
        Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' }); video.setAttribute('aria-hidden', 'true'); document.body.appendChild(video);
        s.getVideoTracks().forEach(function (t) { t.addEventListener('ended', function () { screen.stop(); }); });
        var pl = video.play(); if (pl && pl.catch) pl.catch(function () {});
        changed(); return true;
      });
    },
    stop: function () {
      var s = stream; stream = null;
      if (s) s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      if (video) { try { video.srcObject = null; video.remove(); } catch (e) {} video = null; }
      changed();
    },
    /** one snapshot, now, downscaled: { media_type, data } in base64, or null. Not kept anywhere. */
    snap: function () {
      if (!stream || !video) return Promise.resolve(null);
      function grab() {
        var w = video.videoWidth, h = video.videoHeight; if (!w || !h) return null;
        var k = Math.min(1, MAX_W / w, MAX_H / h), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
        var c = document.createElement('canvas'); c.width = cw; c.height = ch; c.getContext('2d').drawImage(video, 0, 0, cw, ch);
        var url = c.toDataURL('image/jpeg', QUALITY); c.width = c.height = 0;
        var m = /^data:(image\/jpeg);base64,(.+)$/.exec(url); return m ? { media_type: m[1], data: m[2], w: cw, h: ch } : null;
      }
      var got = grab(); if (got) return Promise.resolve(got);
      /* the first frame may not have arrived yet */
      try { var pl = video.play(); if (pl && pl.catch) pl.catch(function () {}); } catch (e) {}
      return new Promise(function (res) { var n = 0, t = setInterval(function () { var g = video ? grab() : null; if (g || !video || ++n > 40) { clearInterval(t); res(g); } }, 100); });
    }
  };
  /* a typed or spoken "look at my screen" */
  screen.asked = function (t) { return /^(?:(?:hey|ok|okay)\s+)?(?:(?:jarvis|kin)[,!.]?\s+)?(?:please\s+|can you\s+|could you\s+)?(?:look at|see|watch|check|share)\s+(?:my|the)\s+(?:screen|window|display)\b[.!?]*$/i.test(String(t || '').trim()); };
  screen.stopAsked = function (t) { return /^(?:(?:jarvis|kin)[,!.]?\s+)?(?:stop|end|quit)\s+(?:sharing|looking at)(?:\s+(?:my|the)\s+(?:screen|window))?[.!?]*$/i.test(String(t || '').trim()); };

  /* ---------------------------------------------------------------- open a tab */
  var HINT = 'kin.tabhint';
  var tab = {
    /** "open example.com", "go to https://example.com/x", "pull up example.com": the address, or null */
    asked: function (t) {
      var m = /^(?:(?:hey|ok|okay)\s+)?(?:(?:jarvis|kin)[,!.]?\s+)?(?:please\s+)?(?:open(?:\s+up)?|go to|pull up|bring up|take me to)\s+(?:the\s+)?(?:(?:web\s*)?site|page|link|tab)?\s*(\S+?)[.!?]*$/i.exec(String(t || '').trim());
      if (!m) return null;
      var a = m[1];
      /* an address, or something with a dot that reads like one; anything else is a question for Kin */
      return /^[a-z][a-z0-9+.-]*:/i.test(a) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(?::\d+)?(\/\S*)?$/i.test(a) ? a : null;
    },
    /** https only, no user name or password in it: the URL, or why not */
    check: function (a) {
      a = String(a || '').trim();
      if (/^[a-z][a-z0-9+.-]*:/i.test(a) && !/^https:\/\//i.test(a)) return { ok: false, why: 'I only open https addresses, sir.' };
      var u; try { u = new URL(/^https:\/\//i.test(a) ? a : 'https://' + a); } catch (e) { return { ok: false, why: 'That does not look like a web address, sir.' }; }
      if (u.protocol !== 'https:') return { ok: false, why: 'I only open https addresses, sir.' };
      if (u.username || u.password) return { ok: false, why: 'I will not open an address with a name or password in it, sir.' };
      if (!/\./.test(u.hostname)) return { ok: false, why: 'That does not look like a web address, sir.' };
      return { ok: true, url: u.href, host: u.hostname.replace(/^www\./, '') };
    },
    /** opens it; { opened: true } or { opened: false, hint: true the first time a tab is blocked } */
    open: function (url) {
      var w = null; try { w = window.open(url, '_blank'); } catch (e) { w = null; }
      if (w) { try { w.opener = null; } catch (e) {} return { opened: true }; }
      var first = ls.get(HINT) !== '1'; if (first) ls.set(HINT, '1');
      return { opened: false, hint: first };
    },
    hintText: function () {
      return /Safari\//.test(ua) && !/Chrome\//.test(ua)
        ? 'Safari blocked the new tab. To let Kin open tabs: Safari menu, Settings for this website, Pop-up Windows: Allow. Until then, tap the link.'
        : 'The browser blocked the new tab. To let Kin open tabs: click the blocked pop-up icon at the right of the address bar and choose Always allow. Until then, tap the link.';
    }
  };

  /* ---------------------------------------------------------------- notifications and the badge */
  var unseen = 0;
  function badge() {
    try {
      if (unseen > 0 && typeof nav.setAppBadge === 'function') { var p = nav.setAppBadge(unseen); if (p && p.catch) p.catch(function () {}); }
      else if (unseen === 0 && typeof nav.clearAppBadge === 'function') { var q = nav.clearAppBadge(); if (q && q.catch) q.catch(function () {}); }
    } catch (e) {}
  }
  var notify = {
    supported: function () { return typeof window.Notification === 'function'; },
    permission: function () { return notify.supported() ? Notification.permission : 'unsupported'; },
    /** only ever called from a tap in settings */
    ask: function () {
      if (!notify.supported()) return Promise.resolve('unsupported');
      try { var r = Notification.requestPermission(); return r && r.then ? r : Promise.resolve(Notification.permission); } catch (e) { return Promise.resolve(Notification.permission); }
    },
    /** something finished: counted on the badge while the page is out of sight, and a notification if allowed */
    done: function (title, body) {
      if (!document.hidden) return false;
      unseen++; badge();
      if (notify.permission() !== 'granted') return false;
      try { var n = new Notification(String(title || 'Kin').slice(0, 60), { body: String(body || '').slice(0, 160), tag: 'kin-done', silent: false }); n.onclick = function () { try { window.focus(); } catch (e) {} n.close(); }; return true; } catch (e) { return false; }
    },
    unseen: function () { return unseen; },
    seen: function () { unseen = 0; badge(); }
  };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) notify.seen(); });
  window.addEventListener('focus', function () { notify.seen(); });

  Kin.desk = { screen: screen, tab: tab, notify: notify };
})();
