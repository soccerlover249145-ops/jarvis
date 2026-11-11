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
  Kin.shared = framed || (dir !== '/' && !own);
  Kin.SHARED_TEXT = 'This address is shared with another website, so keys and your pack are not safe here. Open Kin at its own address.';
  /** timings and limits in one place, so a rehearsal can shorten them */
  Kin.T = {
    follow: 45000,     /* after an exchange, how long Kin stays awake waiting for the next thing said */
    hard: 900,         /* right after Kin stops speaking, everything heard is ignored for this long */
    deaf: 2000,        /* and until this long after, anything that is half Kin's own words is ignored, single words too */
    echo: 15000,       /* how long a phrase that repeats Kin's last words is treated as an echo */
    firstText: 75000,  /* give up when nothing at all has come back by then */
    quiet: 45000,      /* give up when an answer that started arriving goes quiet for this long */
    ttsWait: 15000,    /* one sentence of the keyed voice may take this long to arrive */
    retry: 300,        /* wait before listening again after the browser ends a session; doubles each time one dies at once */
    beat: 5000,        /* how often the listening heartbeat looks */
    noStart: 8000,     /* a recognizer that has not confirmed it started by then is given up on */
    perHour: 40, perDay: 200
  };
})();
