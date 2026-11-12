/* home.js: the plain stage. No dashboard sits on screen by default — just the date in the top bar,
   the holographic figure, the conversation and the composer. The brief, weather, today, what Jarvis
   is working on, devices and away mode are all still there: they open as panels on request ("brief me",
   the quick chips, or the matching settings section), exactly as before. This file only:
   (1) keeps the clock in the top bar current, and
   (2) shows a small pill when something in the conversation needs the founder's OK, so that waits for
       a tap instead of sitting as a permanent card. Nothing here is invented, and nothing here sends,
       spends or changes anything: the pill only opens what is already in the conversation.
   Built with textContent only, so no text from the pack or a reply can become markup. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var when = null, pill = null, timer = 0, renderT = 0, sig = '';

  function clock(d) { var hr = d.getHours() % 12 || 12; return hr + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'); }

  /* what is waiting right now: read straight from the conversation already on the page */
  function asks() {
    var t = document.getElementById('thread'), out = [];
    if (!t) return out;
    Array.prototype.forEach.call(t.querySelectorAll('.msg.ask:not(.job)'), function (c, i) {
      if (!c.querySelector('.askyes:not([disabled])')) return;
      var title = c.querySelector('.asktitle');
      out.push({ i: i, title: title ? title.textContent : 'Jarvis is asking before it goes on' });
    });
    return out;
  }

  function place() { try { return !Kin.shared && Kin.chart && Kin.chart.place ? (Kin.chart.place() || {}).name || '' : ''; } catch (e) { return ''; } }

  /* scroll the conversation to the card waiting there */
  function show(sel, i) {
    if (Kin.showThread) Kin.showThread();
    var t = document.getElementById('thread'), all = t ? t.querySelectorAll(sel) : [], el = all[i] || all[all.length - 1];
    if (el && el.scrollIntoView) setTimeout(function () { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('qpulse'); setTimeout(function () { el.classList.remove('qpulse'); }, 1600); }, 60);
  }

  function render() { try { draw(); } catch (e) {} }
  function draw() {
    var now = new Date(), a = asks(), p = place();
    var key = a.length + '|' + iso(now) + '|' + p;
    if (when) { when.textContent = ''; when.appendChild(doc(DAYS[now.getDay()].slice(0, 3) + ', ' + MON[now.getMonth()] + ' ' + now.getDate() + ' · ' + clock(now) + (p ? ' · ' + p : ''))); }
    if (key === sig) return; sig = key;
    if (!pill) return;
    if (!a.length) { pill.hidden = true; return; }
    var last = a[a.length - 1];
    pill.hidden = false;
    pill.textContent = '';
    pill.appendChild(doc((a.length > 1 ? a.length + ' need' : 'Needs') + ' your OK'));
    pill.onclick = function (e) { if (e.isTrusted) show('.msg.ask:not(.job)', last.i); };
  }
  function doc(t) { return document.createTextNode(t); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function soon() { clearTimeout(renderT); renderT = setTimeout(render, 120); }

  function init() {
    when = document.getElementById('when'); pill = document.getElementById('needsOk');
    var t = document.getElementById('thread');
    if (t && window.MutationObserver) new MutationObserver(soon).observe(t, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
    clearInterval(timer); timer = setInterval(function () { if (!document.hidden) render(); }, 20000);
    render();
  }

  Kin.home = { init: init, render: function () { sig = ''; render(); }, refresh: soon };
})();
