/* bust.js: Jarvis's living object, in two looks.
   The figure (the default on a computer): a head and shoulders made of points of light (three.js, figure.json),
   drawn in the dock's header. It dims when asleep, flares when woken, ripples while speaking and pulses with each word.
   The orb (CSS, see .orb in qc.css): one sphere that breathes, turns its rim and pulses. It is what a phone, a touch
   screen, reduced motion, a low-power device, no WebGL, or the founder's own choice ("Orb" in Settings, Voice) get.
   The hologram particle render is too noisy at small phone sizes, so phone always gets the orb.
   three.js and the figure file are loaded only when the figure is actually shown. The interface is unchanged:
   ready, setMood, wake, beat; plus look() / setLook() for the Settings choice (kept per device as kin.figure). */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var app = document.getElementById('app'), canvas = document.getElementById('gl');
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var KEY = 'kin.figure';
  var wakeT = 0, beatT = 0;
  function orbs() { return document.querySelectorAll('.orb, .mini-orb, .mark-orb'); }
  function pref() { try { return localStorage.getItem(KEY) === 'orb' ? 'orb' : 'figure'; } catch (e) { return 'figure'; } }
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  /* why the figure cannot be shown here, or '' when it can */
  function blocked() {
    if (reduced) return 'reduced';
    if (!mq('(min-width: 1100px)') || mq('(pointer: coarse)')) return 'phone';
    var n = navigator, c = n.connection;
    if ((c && c.saveData) || (n.deviceMemory && n.deviceMemory <= 2) || (n.hardwareConcurrency && n.hardwareConcurrency <= 2)) return 'lowpower';
    try { var t = document.createElement('canvas'); if (!(t.getContext('webgl2') || t.getContext('webgl'))) return 'nogl'; } catch (e) { return 'nogl'; }
    if (!canvas) return 'nogl';
    return '';
  }

  /* ---------------------------------------------------------------- the figure (three.js), as before the redesign */
  var T = null, S = { ok: false, mood: 'off', energy: 0.05, energyGoal: 0.05, sleepK: 0.45, sleepGoal: 0.45, scan: 0, wakeT: null, beatT: null, beatK: 1, time: 0, last: 0, raf: 0 };
  var renderer, scene, camera, mat, w = 0, h = 0, dpr = 1, loading = false;
  var VS = [
    'attribute vec3 aNormal; attribute float aRnd; attribute float aSize; attribute float aAlpha;',
    'uniform float uPx; uniform float uGain; uniform float uTime; uniform float uEnergy; uniform float uScan; uniform float uScanY; uniform float uDrift;',
    'varying vec3 vColor; varying float vAlpha;',
    'void main(){',
    '  float ph = aRnd * 61.0;',
    /* the figure dissolves below the collarbone and out past the shoulders */
    '  float bf = smoothstep(1.335, 1.475, position.y + (aRnd - 0.5) * 0.07) * (1.0 - smoothstep(0.128, 0.232, abs(position.x) + (aRnd - 0.5) * 0.04));',
    '  vec3 p = position + aNormal * (0.007 * (aRnd - 0.4) + uEnergy * 0.008 * (0.5 + 0.5 * sin(uTime * 5.0 - position.y * 16.0 + ph)));',
    '  p += (aNormal * 0.07 + vec3(0.0, -0.05, 0.0)) * (1.0 - bf) * aRnd;',
    '  p += aNormal * 0.0022 * sin(uTime * 1.15) * smoothstep(1.34, 1.44, position.y) * (1.0 - smoothstep(1.46, 1.53, position.y));',
    '  float sd = (position.y - uScanY) * 13.0;',
    '  float scan = uScan * exp(-sd * sd);',
    '  p += aNormal * scan * 0.006;',
    '  p += vec3(sin(uTime * 0.31 + ph), cos(uTime * 0.23 + ph * 1.7), sin(uTime * 0.27 + ph * 2.3)) * uDrift * (0.6 + uEnergy);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  vec3 n = normalize(normalMatrix * aNormal + vec3(0.0, 0.0, 0.00001)); vec3 v = normalize(-mv.xyz);',
    '  float ndv = min(abs(dot(n, v)), 1.0);',
    '  float lit = max(dot(n, normalize(vec3(-0.62, 0.42, 0.66))), 0.0);',
    '  float rim = 1.0 - ndv;',
    '  float shade = (0.34 + 0.66 * lit + 0.46 * rim * rim) * bf * bf;',
    '  float front = dot(n, v) > 0.0 ? 1.0 : 0.2;',
    '  float depth = -mv.z;',
    '  float ps = aSize * uPx / depth;',
    '  float k = clamp(ps / 1.2, 0.0, 1.0);',
    '  vAlpha = aAlpha * shade * front * k * k * uGain * (1.0 + 2.2 * scan);',
    '  vColor = mix(vec3(0.184, 0.482, 0.941), vec3(0.81, 0.91, 1.0), lit * lit * lit * 0.34 + rim * rim * rim * 0.30);',
    '  gl_PointSize = clamp(ps, 1.2, 20.0);',
    '  gl_Position = projectionMatrix * mv;',
    '}'].join('\n');
  var FS = [
    'precision mediump float; varying vec3 vColor; varying float vAlpha;',
    'void main(){',
    '  vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;',
    '  float a = 1.0 - smoothstep(0.55, 1.0, r);',
    '  if (a * vAlpha < 0.004) discard;',
    '  gl_FragColor = vec4(vColor, a * vAlpha);',
    '}'].join('\n');


  function off(why) { S.ok = false; if (app) { delete app.dataset.fig; app.dataset.figWhy = why || 'off'; } }
  function resize() {
    if (!renderer) return;
    w = canvas.clientWidth || 1; h = canvas.clientHeight || 1;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (mat) mat.uniforms.uPx.value = (h * dpr) / (2 * Math.tan(camera.fov * Math.PI / 360));
  }
  function frame(ms) {
    S.raf = requestAnimationFrame(frame);
    if (!S.ok || document.hidden) { S.last = 0; return; }
    var dt = S.last ? Math.min((ms - S.last) / 1000, 0.05) : 0.016; S.last = ms; S.time += dt;
    S.energy += (S.energyGoal - S.energy) * Math.min(1, dt * 4);
    S.sleepK += (S.sleepGoal - S.sleepK) * Math.min(1, dt * 2.2);
    S.scan += ((S.mood === 'thinking' ? 1 : 0) - S.scan) * Math.min(1, dt * 3);
    var wk = S.wakeT == null ? 9 : S.time - S.wakeT, flare = wk < 2.8 ? Math.exp(-wk * 1.6) : 0, sweep = wk < 1.3 ? wk / 1.3 : -1;
    var beat = S.beatT == null ? 0 : S.beatK * Math.exp(-(S.time - S.beatT) * 9);
    var u = mat.uniforms;
    u.uTime.value = S.time;
    u.uGain.value = (1 - 0.62 * S.sleepK) * (1 + 0.9 * flare + 0.17 * beat);
    u.uEnergy.value = S.energy + 1.3 * flare + 0.45 * beat;
    u.uScan.value = sweep >= 0 ? 1.5 : S.scan;
    u.uScanY.value = sweep >= 0 ? 1.3 + 0.54 * sweep : 1.34 + 0.44 * ((S.time * 0.42) % 1);
    /* framed for the dock's header: head and shoulders, a little to one side, drifting very slowly */
    var dist = 1.18, yaw = 0.24 + 0.05 * Math.sin(S.time * 0.21), pitch = 0.07, ty = 1.575;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, 0.02 + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(0, ty, 0.02);
    renderer.render(scene, camera);
  }
  function build(fig) {
    var raw = atob(fig.data), u8 = new Uint8Array(raw.length), i;
    for (i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    var buf = u8.buffer, n = new Uint32Array(buf, 0, 1)[0], q = new Uint16Array(buf, 4, n * 3), nb = new Int8Array(buf, 4 + n * 6, n * 3), pt = new Uint8Array(buf, 4 + n * 9, n);
    var use = Math.min(n, 160000);
    var pos = new Float32Array(use * 3), nor = new Float32Array(use * 3), rnd = new Float32Array(use), size = new Float32Array(use), alpha = new Float32Array(use);
    for (i = 0; i < use; i++) {
      var j = i * 3; pos[j] = q[j] / 65535 * 2 - 1; pos[j + 1] = q[j + 1] / 65535 * 2; pos[j + 2] = q[j + 2] / 65535 * 2 - 1;
      nor[j] = nb[j] / 127; nor[j + 1] = nb[j + 1] / 127; nor[j + 2] = nb[j + 2] / 127;
      rnd[i] = (i * 0.61803398875) % 1; size[i] = 0.0019 * (0.75 + 0.5 * rnd[i]) * (pt[i] === 11 ? 0.86 : 1); alpha[i] = (pt[i] === 0 || pt[i] === 11 ? 0.62 : 1) * 0.5 * (n / use);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aNormal', new T.BufferAttribute(nor, 3));
    g.setAttribute('aRnd', new T.BufferAttribute(rnd, 1)); g.setAttribute('aSize', new T.BufferAttribute(size, 1)); g.setAttribute('aAlpha', new T.BufferAttribute(alpha, 1));
    mat = new T.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
      uniforms: { uPx: { value: 600 }, uGain: { value: 0.4 }, uTime: { value: 0 }, uEnergy: { value: 0 }, uScan: { value: 0 }, uScanY: { value: 1.4 }, uDrift: { value: 0.0011 } } });
    var pts = new T.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
  }
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'vendor/three.min.js'; s.onload = function () { window.THREE ? res(window.THREE) : rej(new Error('three')); }; s.onerror = rej; document.head.appendChild(s); });
  }
  function startFigure() {
    if (S.ok || loading) return;
    loading = true;
    loadThree().then(function (three) {
      T = three;
      if (!renderer) {
        renderer = new T.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
        renderer.setClearColor(0x000000, 0);
        scene = new T.Scene(); camera = new T.PerspectiveCamera(30, 1, 0.01, 60);
        window.addEventListener('resize', function () { if (S.ok) resize(); apply(); });
        canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); renderer = null; off('nogl'); }, false);
        return fetch('figure.json').then(function (r) { if (!r.ok) throw new Error('figure ' + r.status); return r.json(); }).then(build);
      }
    }).then(function () {
      loading = false;
      if (look() !== 'figure') return;
      S.ok = true; if (app) { app.dataset.fig = 'on'; delete app.dataset.figWhy; } resize();
      if (!S.raf) S.raf = requestAnimationFrame(frame);
    }).catch(function () { loading = false; off('nogl'); });
  }
  function stopFigure(why) { off(why); if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } }

  /* which look is on screen now */
  function look() { return pref() === 'figure' && !blocked() ? 'figure' : 'orb'; }
  function apply() { var b = blocked(); if (pref() === 'figure' && !b) startFigure(); else stopFigure(pref() === 'orb' ? 'chosen' : b); }

  Kin.bust = {
    ready: true,
    /** call after a CSS-only size change (no real window resize) so the canvas keeps a sharp,
        undistorted render at its new box size instead of stretching the old buffer into it */
    resize: function () { resize(); },
    setMood: function (m) {
      if (app) app.dataset.orb = m || 'off';
      S.mood = m; S.energyGoal = { off: 0.04, asleep: 0.02, idle: 0.12, listening: 0.6, thinking: 0.4, speaking: 1 }[m] || 0.12; S.sleepGoal = m === 'asleep' || m === 'off' ? 0.45 : 0; /* dimmer when asleep, but always clearly there */
    },
    wake: function () {
      S.wakeT = S.time;
      if (reduced) return;
      Array.prototype.forEach.call(orbs(), function (o) { o.classList.remove('wake'); void o.offsetWidth; o.classList.add('wake'); });
      clearTimeout(wakeT); wakeT = setTimeout(function () { Array.prototype.forEach.call(orbs(), function (o) { o.classList.remove('wake'); }); }, 1400);
    },
    beat: function (k) {
      S.beatT = S.time; S.beatK = k == null ? 1 : k;
      if (reduced || !app) return;
      app.style.setProperty('--beat', String(Math.max(0, Math.min(1, k == null ? 1 : k))));
      clearTimeout(beatT); beatT = setTimeout(function () { app.style.setProperty('--beat', '0'); }, 140);
    },
    /* the Settings choice: 'figure' (default) or 'orb'; kept on this device only, never on a shared address */
    pref: pref,
    look: look,
    blocked: blocked,
    setLook: function (v) { v = v === 'orb' ? 'orb' : 'figure'; if (!Kin.shared) { try { localStorage.setItem(KEY, v); } catch (e) {} } apply(); return look(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
