/* bust.js: Kin's living object. It used to be a head and shoulders of points of light (three.js); it is now one
   orb drawn with CSS (see .orb in qc.css): it rests when asleep, breathes while listening, turns its rim while
   thinking and pulses with each spoken word. No WebGL and no figure file, so it costs almost nothing on a phone
   and draws the same in every browser. The interface (ready, setMood, wake, beat) is unchanged. */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var app = document.getElementById('app');
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var wakeT = 0, beatT = 0;
  function orbs() { return document.querySelectorAll('.orb, .mini-orb, .mark-orb'); }
  Kin.bust = {
    ready: true,
    setMood: function (m) { if (app) app.dataset.orb = m || 'off'; },
    wake: function () {
      if (reduced) return;
      Array.prototype.forEach.call(orbs(), function (o) { o.classList.remove('wake'); void o.offsetWidth; o.classList.add('wake'); });
      clearTimeout(wakeT); wakeT = setTimeout(function () { Array.prototype.forEach.call(orbs(), function (o) { o.classList.remove('wake'); }); }, 1400);
    },
    beat: function (k) {
      if (reduced || !app) return;
      app.style.setProperty('--beat', String(Math.max(0, Math.min(1, k == null ? 1 : k))));
      clearTimeout(beatT); beatT = setTimeout(function () { app.style.setProperty('--beat', '0'); }, 140);
    }
  };
})();
