'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { makeEars, parseLine } = require('../src/main/ears');
const { makeHands } = require('../src/main/control/hands');
const { clean } = require('../src/main/config');

function fakeProc() {
  const p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new PassThrough(); p.killed = false;
  p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit', 0)); };
  p.say = (o) => p.stdout.write(JSON.stringify(o) + '\n');
  return p;
}
const tick = () => new Promise((r) => setTimeout(r, 15));

test('ear lines are checked; junk is dropped', () => {
  assert.deepEqual(parseLine('{"type":"final","text":"  hey   jarvis  "}'), { type: 'final', text: 'hey jarvis' });
  assert.equal(parseLine('{"type":"partial","text":""}'), null);
  assert.equal(parseLine('not json'), null);
  assert.equal(parseLine('{"type":"exec","cmd":"ls"}'), null);
  assert.equal(parseLine('{"type":"state","state":"pwned"}'), null);
});
test('ears start with on-device-only, forward words, restart after a crash, and stay off when blocked', async () => {
  const procs = [], args = [];
  const ears = makeEars('/bin/JarvisEars', { onDeviceOnly: () => true, spawn: (b, a) => { args.push(a); const p = fakeProc(); procs.push(p); return p; } });
  const got = []; ears.on((e) => got.push(e));
  ears.start();
  assert.deepEqual(args[0], ['--locale', 'en-US', '--on-device-only']);
  procs[0].say({ type: 'state', state: 'listening', onDevice: true }); procs[0].say({ type: 'final', text: 'wake up daddys home' });
  await tick();
  assert.ok(got.some((e) => e.type === 'final' && e.text === 'wake up daddys home'));
  procs[0].emit('exit', 1);
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(procs.length, 2, 'restarted after a crash');
  procs[1].say({ type: 'state', state: 'blocked', reason: 'mic-denied' }); await tick();
  procs[1].emit('exit', 4); await new Promise((r) => setTimeout(r, 1200));
  assert.equal(procs.length, 2, 'a "no" from the owner is not retried');
  ears.hold(true); ears.start(); assert.equal(procs.length, 3);
  let written = ''; procs[2].stdin.on('data', (d) => written += d); ears.hold(false); await tick();
  assert.match(written, /resume/);
  ears.stop();
});
test('hands: one answer per request, user-input events, and stop fails what is waiting', async () => {
  const p = fakeProc(); const sent = [];
  p.stdin.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => { const m = JSON.parse(l); sent.push(m); if (m.op === 'click') p.say({ id: m.id, ok: true }); if (m.op === 'type') p.say({ id: m.id, ok: false, error: 'Jarvis needs Accessibility permission' }); }));
  const h = makeHands('/bin/JarvisHands', { spawn: () => p });
  const evs = []; h.on((e) => evs.push(e));
  assert.deepEqual(await h.send('click', { x: 1, y: 2 }), { id: 1, ok: true });
  await assert.rejects(() => h.send('type', { text: 'x' }), /Accessibility/);
  p.say({ event: 'user-input' }); await tick();
  assert.deepEqual(evs, [{ event: 'user-input' }]);
  const pending = h.send('hold', { code: 1, seconds: 100 });
  h.stop();
  await assert.rejects(pending, /Stopped/);
  assert.ok(sent.some((m) => m.op === 'release'), 'anything held is released on stop');
});
test('settings from disk are checked and cannot widen access', () => {
  const c = clean({ hotkey: 'Alt+Space; rm -rf', apps: [{ name: 'Sh', path: '/bin/sh' }, { name: 'Notes', path: '/System/Applications/Notes.app' }], folders: ['/', 'relative', '/Users/f/Documents'],
    caps: { steps: 9999, dollars: -1, minutes: 5 }, relayUrl: 'http://insecure.example', searchEngine: 'evil' });
  assert.equal(c.hotkey, 'Alt+Space');
  assert.deepEqual(c.apps, [{ name: 'Notes', path: '/System/Applications/Notes.app' }]);
  assert.deepEqual(c.folders, ['/Users/f/Documents']);
  assert.deepEqual(c.caps, { steps: 40, dollars: 2, minutes: 5 });
  assert.equal(c.relayUrl, ''); assert.equal(c.searchEngine, 'google');
});
