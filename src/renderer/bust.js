/* bust.js: Kin's face, a head and shoulders made of points of light. It dims when asleep,
   flares when woken, ripples while speaking and pulses with each word. If WebGL or the
   sculpture file is missing, the page shows three thin rings instead (see .orb in style.css). */
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var T = window.THREE, app = document.getElementById('app'), canvas = document.getElementById('gl');
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var S = { ok: false, mood: 'off', energy: 0.05, energyGoal: 0.05, sleepK: 1, sleepGoal: 1, scan: 0, wakeT: null, beatT: null, beatK: 1, time: 0, last: 0 };
  var renderer, scene, camera, mat, w = 0, h = 0, dpr = 1;

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

  function fail() { S.ok = false; app.classList.add('nogl'); }

  function resize() {
    if (!renderer) return;
    w = canvas.clientWidth || window.innerWidth; h = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (mat) mat.uniforms.uPx.value = (h * dpr) / (2 * Math.tan(camera.fov * Math.PI / 360));
  }

  function frame(ms) {
    requestAnimationFrame(frame);
    if (!S.ok || document.hidden) { S.last = 0; return; }
    var dt = S.last ? Math.min((ms - S.last) / 1000, 0.05) : 0.016; S.last = ms; S.time += dt;
    S.energy += (S.energyGoal - S.energy) * Math.min(1, dt * 4);
    S.sleepK += (S.sleepGoal - S.sleepK) * (reduced ? 1 : Math.min(1, dt * 2.2));
    S.scan += ((S.mood === 'thinking' ? 1 : 0) - S.scan) * Math.min(1, dt * 3);
    var wk = S.wakeT == null ? 9 : S.time - S.wakeT, flare = wk < 2.8 ? Math.exp(-wk * 1.6) : 0, sweep = wk < 1.3 && !reduced ? wk / 1.3 : -1;
    var beat = reduced || S.beatT == null ? 0 : S.beatK * Math.exp(-(S.time - S.beatT) * 9);
    var u = mat.uniforms;
    u.uTime.value = S.time;
    u.uGain.value = (1 - 0.62 * S.sleepK) * (1 + 0.9 * flare + 0.17 * beat);
    u.uEnergy.value = S.energy + 1.3 * flare + 0.45 * beat;
    u.uScan.value = sweep >= 0 ? 1.5 : (reduced ? 0 : S.scan);
    u.uScanY.value = sweep >= 0 ? 1.3 + 0.54 * sweep : 1.34 + 0.44 * ((S.time * 0.42) % 1);
    /* the camera sits a little to one side and drifts very slowly */
    var portrait = w < h, dist = portrait ? 1.86 : 1.5, yaw = 0.24 + (reduced ? 0 : 0.05 * Math.sin(S.time * 0.21)), pitch = 0.07;
    var ty = 1.545 - (portrait ? 0.075 : 0.055) * dist;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, 0.02 + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(0, ty, 0.02);
    renderer.render(scene, camera);
  }

  function build(fig) {
    var raw = atob(fig.data), u8 = new Uint8Array(raw.length), i;
    for (i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    var buf = u8.buffer, n = new Uint32Array(buf, 0, 1)[0], q = new Uint16Array(buf, 4, n * 3), nb = new Int8Array(buf, 4 + n * 6, n * 3), pt = new Uint8Array(buf, 4 + n * 9, n);
    var small = Math.min(window.innerWidth, window.innerHeight) < 500, use = small ? Math.min(n, 150000) : n;
    var pos = new Float32Array(use * 3), nor = new Float32Array(use * 3), rnd = new Float32Array(use), size = new Float32Array(use), alpha = new Float32Array(use);
    for (i = 0; i < use; i++) {
      var j = i * 3; pos[j] = q[j] / 65535 * 2 - 1; pos[j + 1] = q[j + 1] / 65535 * 2; pos[j + 2] = q[j + 2] / 65535 * 2 - 1;
      nor[j] = nb[j] / 127; nor[j + 1] = nb[j + 1] / 127; nor[j + 2] = nb[j + 2] / 127;
      rnd[i] = (i * 0.61803398875) % 1; size[i] = 0.0017 * (0.75 + 0.5 * rnd[i]) * (pt[i] === 11 ? 0.86 : 1); alpha[i] = (pt[i] === 0 || pt[i] === 11 ? 0.62 : 1) * 0.40 * (n / use);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aNormal', new T.BufferAttribute(nor, 3));
    g.setAttribute('aRnd', new T.BufferAttribute(rnd, 1)); g.setAttribute('aSize', new T.BufferAttribute(size, 1)); g.setAttribute('aAlpha', new T.BufferAttribute(alpha, 1));
    mat = new T.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
      uniforms: { uPx: { value: 600 }, uGain: { value: 0.4 }, uTime: { value: 0 }, uEnergy: { value: 0 }, uScan: { value: 0 }, uScanY: { value: 1.4 }, uDrift: { value: reduced ? 0 : 0.0011 } } });
    var pts = new T.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
    S.ok = true; resize();
  }

  function init() {
    if (!T || !canvas) return fail();
    try { renderer = new T.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch (e) { return fail(); }
    renderer.setClearColor(0x000000, 1);
    scene = new T.Scene(); camera = new T.PerspectiveCamera(30, 1, 0.01, 60);
    window.addEventListener('resize', resize);
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); fail(); });
    app.classList.add('nogl'); /* rings until the sculpture has arrived */
    fetch('figure.json').then(function (r) { if (!r.ok) throw new Error('figure ' + r.status); return r.json(); })
      .then(function (fig) { build(fig); app.classList.remove('nogl'); Kin.bust.ready = true; })
      .catch(function () { fail(); });
    requestAnimationFrame(frame);
  }

  Kin.bust = {
    ready: false,
    setMood: function (m) { S.mood = m; S.energyGoal = { off: 0.04, asleep: 0.02, idle: 0.12, listening: 0.6, thinking: 0.4, speaking: 1 }[m] || 0.12; S.sleepGoal = m === 'asleep' || m === 'off' ? 1 : 0; },
    wake: function () { S.wakeT = S.time; },
    beat: function (k) { S.beatT = S.time; S.beatK = k == null ? 1 : k; }
  };
  init();
})();
