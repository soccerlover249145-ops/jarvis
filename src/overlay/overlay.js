/* overlay.js: the status pill inside the red frame. Display only; it can send nothing back. */
(function () {
  'use strict';
  var O = window.jarvisOverlay; if (!O) return;
  var $ = function (id) { return document.getElementById(id); };
  var t0 = Date.now(), cap = { steps: 0, dollars: 0, minutes: 0 }, tick = 0;
  function clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  O.onInfo(function (i) { t0 = Date.now(); cap = (i && i.caps) || cap; clearInterval(tick); tick = setInterval(function () { $('clock').textContent = clock((Date.now() - t0) / 1000) + (cap.minutes ? ' / ' + cap.minutes + ':00' : ''); }, 500); });
  O.onUpdate(function (u) {
    if (!u) return;
    if (u.step != null) $('steps').textContent = 'step ' + u.step + (u.steps ? ' / ' + u.steps : '');
    if (u.spent != null) $('spend').textContent = '$' + Number(u.spent).toFixed(2) + (u.cap ? ' / $' + Number(u.cap).toFixed(2) : '');
    if (u.last) $('act').textContent = u.last;
    var near = (u.cap && u.spent > u.cap * 0.8) || (u.steps && u.step > u.steps * 0.8);
    document.body.classList.toggle('warn', !!near);
  });
})();
