/* guard.js: runs first. Decides whether this address is a safe place to keep keys and a pack.

   A browser keeps saved data per ADDRESS (scheme + host), not per folder. If this page is served from a
   folder of a site that belongs to something else (for example example.com/kin/), every script that ever
   runs anywhere on that site could read the keys and the pack saved here. So unless the page is at the
   root of its own address, or the person who deployed it added
       <meta name="kin-own-origin" content="yes">
   to say "this whole address belongs to Kin", nothing private is stored or loaded. The page still works
   as a demo without keys.

   It also refuses to run inside another page's frame: a policy written in a meta tag cannot forbid framing. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var framed = false; try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (framed) { try { document.documentElement.hidden = true; } catch (e) {} }
  var dir = String(location.pathname || '/').replace(/[^/]*$/, '');
  var own = !!document.querySelector('meta[name="kin-own-origin"]');
  Kin.framed = framed;
  /** true when keys and a pack must not be kept here */
  /* a plain http page can be altered on the way to the browser, so nothing private is kept there either.
     Addresses ending in .test and localhost are for rehearsals on this machine only. */
  var host = String(location.hostname || '');
  var insecure = location.protocol !== 'https:' && !/(\.test|^localhost|^127\.0\.0\.1)$/.test(host);
  Kin.insecure = insecure;
  Kin.shared = framed || insecure || (dir !== '/' && !own);
  Kin.SHARED_TEXT = insecure
    ? 'This is the plain http address. Keys and your pack are only kept at the secure address. Open https://' + host + '/ once it is ready.'
    : 'This address is shared with another website, so keys and your pack are not safe here. Open Kin at its own address.';
  /** timings and limits in one place, so a rehearsal can shorten them */
  Kin.T = {
    follow: 45000,     /* after an exchange, how long Kin stays awake waiting for the next thing said */
    hard: 900,         /* right after Kin stops speaking, everything heard is ignored for this long */
    deaf: 2000,        /* and until this long after, anything that is half Kin's own words is ignored, single words too */
    echo: 15000,       /* how long a phrase that repeats Kin's last words is treated as an echo */
    firstText: 75000,  /* give up when nothing at all has come back by then */
    quiet: 45000,      /* give up when an answer that started arriving goes quiet for this long */
    making: 240000,    /* a job of making something (a document, a design) may go this long without a sign of life: long thinking is silent */
    ttsWait: 15000,    /* one sentence of the keyed voice may take this long to arrive */
    retry: 300,        /* wait before listening again after the browser ends a session; doubles each time one dies at once */
    stallRetry: 20000, /* after giving up (too many quick deaths in a row), try again on its own after this long --
                           most real stalls are the browser's speech backend, not an actual dropped connection, so
                           waiting it out and trying again beats leaving it off until someone notices and taps the mic */
    beat: 5000,        /* how often the listening heartbeat looks */
    noStart: 8000,     /* a recognizer that has not confirmed it started by then is given up on */
    barge: true,       /* talking while Kin speaks stops it */
    bargeGrace: 600,   /* but not in the first moment of a reply, while its first words may still be heard back */
    bargeLevel: 0.12,  /* where there is a level meter, how loud the room must be for words to count as talking over Kin */
    perHour: 40, perDay: 200
  };

  /* panels open with focus on the panel itself, so the page reads its title; a pointer or a voice opens it with no ring.
     Someone moving with the keyboard gets focus on the panel's first control instead, where the ring belongs. */
  var kb = false;
  try {
    document.addEventListener('keydown', function (e) { if (e.key === 'Tab' || /^Arrow/.test(e.key) || e.key === 'Enter' || e.key === ' ') kb = true; }, true);
    document.addEventListener('pointerdown', function () { kb = false; }, true);
  } catch (e) {}
  Kin.keyboardNav = function () { return kb; };
  Kin.focusPanel = function (panel) {
    if (!panel) return;
    try {
      if (kb) {
        var all = panel.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]');
        for (var i = 0; i < all.length; i++) { if (all[i].offsetParent !== null || all[i].getClientRects().length) { all[i].focus({ preventScroll: true }); return; } }
      }
      panel.focus({ preventScroll: true });
    } catch (e) {}
  };
})();
