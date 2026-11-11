/* whatsnew.js: the "What's new" sheet. A short list of the newest things Kin can do, the exact words to say for each,
   and a "Try it" pill that only opens the right panel. Nothing here sends, spends, books or calls: every panel it opens
   waits for its own tap before anything happens.

   Public surface (window.Kin.whatsNew):
     isRequest(text) -> true for "what's new", "what can you do now"
     open({ onTry(key), onSay(line) })  /  close()
     items() -> the list, for the rehearsal */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};

  var ITEMS = [
    { key: 'watch', title: 'Watch & listen', say: 'Watch this video', note: 'Drop in a video or a recording, or share a tab. I show the cost first, and nothing is sent until you tap Go.' },
    { key: 'devices', title: 'Bluetooth & USB lab', say: 'Connect my heart rate strap', note: 'In Chrome or Edge on a computer. Live readings from straps, scales and boards. Nothing is sent to a device unless you type it.' },
    { key: 'away', title: 'Away mode', say: 'I’m heading out', note: 'I log routine things, keep the rest for a summary, and only notify you about what cannot wait. I ask before turning it on.' },
    { key: 'book', title: 'Book a table', say: 'Book a table for three at Harbor Table at 7', note: 'I build a call card first. It is the practice line for now, so no real call is made.' },
    { key: 'talk', title: 'Talk over me', say: 'Hey Jarvis… / Stop', note: 'Wake me with “hey Jarvis” or your own phrase. Start talking, or say “stop”, to cut in while I speak.' },
    { key: 'gauntlet', title: 'The Gauntlet', say: 'Test yourself, Jarvis', note: 'Fifteen tasks under a budget cap you set. Nothing runs until you tap Run.' },
    { key: 'settings', title: 'Settings in sections', say: 'Tap the gear', note: 'Start, Voice, Brain, Brief, Away and Privacy, with a row of pills at the top to jump between them.' }
  ];

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svgClose() {
    var ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    ['M6 6l12 12', 'M18 6L6 18'].forEach(function (d) { var p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.appendChild(p); }); return s;
  }

  var cur = null;
  function close() {
    if (!cur) return; var c = cur; cur = null;
    document.removeEventListener('keydown', c.key, true);
    c.el.classList.add('wl-hide'); setTimeout(function () { c.el.remove(); }, 320);
  }

  function open(opts) {
    opts = opts || {};
    if (cur) { var old = cur; cur = null; document.removeEventListener('keydown', old.key, true); old.el.remove(); }
    var el = h('div', 'wl wn'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'What’s new');
    var panel = h('div', 'wl-panel wn-panel'); panel.tabIndex = -1; el.appendChild(panel);
    var head = h('div', 'wl-head'), ht = h('div');
    ht.appendChild(h('div', 'wl-eyebrow', 'Jarvis'));
    ht.appendChild(h('h2', 'wl-title', 'What’s new'));
    ht.appendChild(h('p', 'wl-lede', 'The newest things I can do, and what to say. Try it only opens the panel; nothing runs, spends or calls until you tap inside it.'));
    head.appendChild(ht);
    var x = h('button', 'wl-pill wl-icon'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.appendChild(svgClose()); x.addEventListener('click', close); head.appendChild(x);
    panel.appendChild(head);

    var list = h('ul', 'wn-list'); panel.appendChild(list);
    ITEMS.forEach(function (it) {
      var li = h('li', 'wn-item'); li.dataset.key = it.key;
      var mid = h('div', 'wn-mid');
      mid.appendChild(h('h3', 'wn-name', it.title));
      var say = h('p', 'wn-say'); say.appendChild(h('span', 'wn-k', 'Say')); say.appendChild(h('span', 'wn-phrase', '“' + it.say + '”')); mid.appendChild(say);
      mid.appendChild(h('p', 'wn-note', it.note));
      li.appendChild(mid);
      var b = h('button', 'wl-pill wn-try', 'Try it'); b.type = 'button'; b.setAttribute('aria-label', 'Try ' + it.title);
      b.addEventListener('click', function () { close(); if (opts.onTry) setTimeout(function () { opts.onTry(it.key); }, 60); });
      li.appendChild(b);
      list.appendChild(li);
    });

    var c = cur = { el: el };
    /* Escape closes this sheet only, not the Settings sheet under it */
    c.key = function (e) { if (e.key !== 'Escape' || cur !== c) return; e.stopImmediatePropagation(); e.preventDefault(); close(); };
    document.addEventListener('keydown', c.key, true);
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('wl-show'); if (Kin.focusPanel) Kin.focusPanel(panel); else panel.focus({ preventScroll: true }); });
    return { close: close, element: el };
  }

  var LEAD = /^(?:(?:hey|ok|okay)\s+)?(?:jarvis|kin)[,!.]?\s+/;
  function isRequest(text) {
    var t = String(text || '').trim().toLowerCase().replace(/[’']/g, "'").replace(LEAD, '').replace(/^(?:so|ok|okay)[, ]+/, '').replace(/\s+/g, ' ');
    return /^(?:what'?s new|what is new|what'?s new with you|what can you do now|what else can you do now|what can you do these days|show me what'?s new)(?:,? (?:jarvis|kin|sir))?[?.!]*$/.test(t);
  }

  Kin.whatsNew = { isRequest: isRequest, open: open, close: close, items: function () { return ITEMS.map(function (i) { return Object.assign({}, i); }); } };
})();
