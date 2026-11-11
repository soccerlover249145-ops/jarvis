/* compact.js: the floating pill. It holds no brain and no keys: questions go to the full window
   (through the main process) and its state and words come back here. */
(function () {
  'use strict';
  var D = window.jarvisDesktop;
  var $ = function (id) { return document.getElementById(id); };
  var wrap = $('wrap'), q = $('q'), cap = $('cap'), mode = 'ask', capT = 0, toastUntil = 0;
  var LABEL = { off: 'Jarvis', asleep: 'Asleep · say “hey Jarvis”', idle: 'Jarvis', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };
  function setMode(m) {
    mode = m; wrap.setAttribute('data-mode', m);
    q.placeholder = m === 'control' ? 'What should Jarvis do on this Mac?' : 'Ask anything, or say “hey Jarvis”';
    $('tag').textContent = m === 'control' ? 'Take control · you confirm next' : LABEL[wrap.getAttribute('data-state')] || 'Jarvis';
    q.focus();
  }
  function show(t, s, isToast) {
    if (!t) { cap.hidden = true; return; }
    $('capT').textContent = t; $('capS').textContent = s || '';
    cap.classList.toggle('toast', !!isToast); cap.hidden = false;
    clearTimeout(capT); capT = setTimeout(function () { cap.hidden = true; }, isToast ? 4200 : 12000);
  }
  if (!D) return;
  D.compact.onState(function (st) {
    if (!st) return;
    wrap.setAttribute('data-state', st.state || 'off');
    if (mode === 'ask') $('tag').textContent = LABEL[st.state] || 'Jarvis';
    $('mic').classList.toggle('on', st.state === 'listening');
    if (Date.now() > toastUntil && st.caption) show(st.caption, st.small);
  });
  D.ui.onToast(function (t) { toastUntil = Date.now() + 4000; show(t.body || t.title, t.body ? t.title : '', true); });
  D.control.onDone(function (d) { setMode('ask'); show(d.body, d.title); });
  D.compact.onControl(function () { setMode('control'); });

  $('pill').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = q.value.trim(); if (!v) return;
    q.value = '';
    if (mode === 'control') { show('Waiting for you to confirm…', 'Take control'); D.control.start(v, 'you').then(function (r) { setMode('ask'); if (r && !r.ok && r.why) show(r.why, 'Not started'); }); }
    else { show(v, 'You'); D.compact.ask(v); }
  });
  $('mic').addEventListener('click', function () { D.compact.mic(); });
  $('ctl').addEventListener('click', function () { setMode(mode === 'control' ? 'ask' : 'control'); });
  $('open').addEventListener('click', function () { D.compact.open(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (mode === 'control') setMode('ask'); else D.compact.hide(); }
  });
  window.addEventListener('focus', function () { q.focus(); });
})();
