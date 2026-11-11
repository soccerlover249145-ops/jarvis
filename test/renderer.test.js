'use strict';
/* the web UI's own scripts, run in a sandbox with a stand-in window */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const R = path.join(__dirname, '..', 'src', 'renderer');

function storage() {
  function Storage() { this._m = new Map(); }
  Storage.prototype.getItem = function (k) { return this._m.has(k) ? this._m.get(k) : null; };
  Storage.prototype.setItem = function (k, v) { this._m.set(k, String(v)); };
  Storage.prototype.removeItem = function (k) { this._m.delete(k); };
  Storage.prototype.clear = function () { this._m.clear(); };
  return Storage;
}
function load(files, win) {
  const ctx = vm.createContext(win);
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(R, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}
function baseWin(extra) {
  const Storage = storage();
  const w = Object.assign({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh) Electron', language: 'en-US', maxTouchPoints: 0, onLine: true }, location: { protocol: 'app:', hostname: 'jarvis', host: 'jarvis', pathname: '/index.html', origin: 'app://jarvis' },
    document: { querySelector: () => null, documentElement: {} }, setTimeout, clearTimeout, Promise, JSON, Storage, matchMedia: () => ({ matches: false }), addEventListener() {} }, extra || {});
  w.window = w; w.self = w; w.top = w;
  w.localStorage = new Storage(); w.sessionStorage = new Storage();
  return w;
}

test('wake phrases: the built-in ones, a custom one, and what was said after', () => {
  const w = load(['guard.js', 'ears.js'], baseWin());
  const e = w.Kin.ears;
  assert.equal(e.wakeIn('wake up, daddy\'s home', 'wake up daddys home', true).rest, '');
  assert.equal(e.wakeIn('Hey Jarvis open YouTube', 'wake up daddys home').rest, 'open YouTube');
  assert.equal(e.wakeIn('ok jarvis what is on today', 'x y').rest, 'what is on today');
  assert.ok(e.wakeIn('alright team', 'alright team', true), 'a custom phrase said alone');
  assert.equal(e.wakeIn('alright team let us build', 'alright team').rest, 'let us build');
  assert.equal(e.wakeIn('the weather is nice', 'wake up daddys home'), null);
  assert.equal(e.wakeIn('I told Jarvis about it yesterday and then went home', 'hey jarvis', true), null, 'a passing mention while awake-only check is not a wake');
  assert.ok(e.sleepIn('thats all for now jarvis'));
  assert.ok(e.stopIn('stop'));
  assert.ok(!e.stopIn('stop the music in the kitchen'));
});
test('guard: the app address counts as its own secure address only inside the app', () => {
  const inApp = load(['guard.js'], baseWin({ jarvisDesktop: {} }));
  assert.equal(inApp.Kin.desktop, true); assert.equal(inApp.Kin.shared, false); assert.equal(inApp.Kin.insecure, false);
  const fake = load(['guard.js'], baseWin());
  assert.equal(fake.Kin.desktop, false, 'without the app bridge, app: is not trusted');
  assert.equal(fake.Kin.shared, true);
});
test('the shim never stores a key in the window and hands new keys to the Keychain', async () => {
  const calls = [];
  const D = { secretsState: () => ({ have: { 'kin.key': 'PH-A', 'kin.tts.key': null, 'kin.gb.tok': null, 'kin.hf.tok': null }, placeholders: { anthropic: 'PH-A', elevenlabs: 'PH-E', relay: 'PH-R' } }),
    setSecret: (k, v) => { calls.push(['set', k, v]); return Promise.resolve({ ok: true }); }, delSecret: (k) => { calls.push(['del', k]); return Promise.resolve({ ok: true }); },
    relayUrl: (u) => { calls.push(['relay', u]); return Promise.resolve({ ok: true }); }, ui: { toast() {} } };
  const w = baseWin({ jarvisDesktop: D });
  w.localStorage._m.set('kin.tts.key', 'old-real-elevenlabs-key-from-before');   /* left by an older build */
  load(['desktop-shim.js'], w);
  assert.equal(w.localStorage._m.has('kin.tts.key'), false, 'old keys are wiped from storage');
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'kin.tts.key' && c[2] === 'old-real-elevenlabs-key-from-before'), 'and moved to the Keychain');
  assert.equal(w.localStorage.getItem('kin.key'), 'PH-A', 'reads get the placeholder');
  w.localStorage.setItem('kin.key', 'sk-ant-new-real-key');
  assert.equal(w.localStorage._m.has('kin.key'), false, 'a new key is not written to storage');
  assert.deepEqual(calls.filter((c) => c[1] === 'kin.key').pop(), ['set', 'kin.key', 'sk-ant-new-real-key']);
  assert.equal(w.localStorage.getItem('kin.key'), 'PH-A');
  w.localStorage.setItem('kin.hf.tok', '{"access":"x"}');
  assert.equal(w.localStorage.getItem('kin.hf.tok'), null); assert.ok(!calls.some((c) => c[1] === 'kin.hf.tok' && c[0] === 'set'));
  w.localStorage.setItem('kin.voice', 'arthur');
  assert.equal(w.localStorage.getItem('kin.voice'), 'arthur', 'other settings work as before');
  w.localStorage.setItem('kin.gb.url', 'https://relay.example.com');
  assert.deepEqual(calls.filter((c) => c[0] === 'relay').pop(), ['relay', 'https://relay.example.com']);
  w.localStorage.removeItem('kin.key');
  assert.equal(w.localStorage.getItem('kin.key'), null); assert.deepEqual(calls.filter((c) => c[0] === 'del').pop(), ['del', 'kin.key']);
  w.sessionStorage.setItem('kin.key', 'x'); assert.equal(w.sessionStorage.getItem('kin.key'), 'x', 'only localStorage is intercepted');
});
test('desktop ears: same shape as the browser ears, fed by the Swift helper', async () => {
  let push; const sent = [];
  const D = { ears: { onEvent: (f) => { push = f; }, start: () => sent.push('start'), stop: () => sent.push('stop'), hold: (on) => sent.push('hold:' + on), state: () => Promise.resolve({ state: 'listening', wanted: true }) },
    config: { get: () => Promise.resolve({ perms: { microphone: 'granted' } }) }, ui: { toast: (t, b) => sent.push('toast:' + b) } };
  const w = load(['guard.js', 'ears.js', 'desktop-ears.js'], baseWin({ jarvisDesktop: D }));
  const e = w.Kin.ears, got = [];
  e.on((ev) => got.push(JSON.parse(JSON.stringify(ev))));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(e.supported, true); assert.equal(e.desktop, true); assert.equal(e.listening(), true);
  push({ type: 'partial', text: 'hey jar' }); push({ type: 'final', text: 'hey jarvis' });
  assert.deepEqual(got.filter((g) => g.type !== 'state'), [{ type: 'partial', text: 'hey jar' }, { type: 'final', text: 'hey jarvis' }]);
  assert.ok(e.wakeIn('hey jarvis', 'x y'), 'wake logic is the web UI\'s own');
  push({ type: 'state', state: 'blocked', reason: 'mic-denied' });
  assert.deepEqual(got[got.length - 1], { type: 'state', state: 'blocked', reason: 'not-allowed' });
  assert.ok(sent.some((s) => /Privacy & Security, Microphone/.test(s)));
  assert.equal(e.wanted(), false);
  e.start(); e.hold(true); e.stop();
  assert.deepEqual(sent.filter((s) => !s.startsWith('toast')), ['start', 'hold:true', 'stop']);
  assert.equal(await e.permission(), 'granted');
});
