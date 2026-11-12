'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { PassThrough } = require('node:stream');
const { makeEars } = require('../src/main/ears');

/** a fake JarvisEars process: exits almost at once every time, like a helper or the system
    speech service having a bad run, until told to behave */
function fakeSpawn() {
  const made = [];
  let healthy = false;
  const spawn = function () {
    const p = new EventEmitter();
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    made.push(p);
    if (healthy) setTimeout(function () { p.stdout.write('{"type":"state","state":"listening"}\n'); }, 1);
    else setTimeout(function () { p.emit('exit'); }, 1);
    return p;
  };
  spawn.made = made;
  spawn.setHealthy = function (v) { healthy = v; };
  return spawn;
}

/* mock timers' tick() only fires what is already due; a callback that schedules a further-out
   timer needs its own later tick to fire, so advance in small steps until the condition holds
   (or give up after a generous budget, so a real regression hangs the test instead of hiding it) */
function tickUntil(t, pred, step, budget) {
  for (let spent = 0; spent < budget; spent += step) { if (pred()) return true; t.mock.timers.tick(step); }
  return pred();
}

test('gives up after enough quick deaths in a row, with a clear reason', { concurrency: false }, (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawn = fakeSpawn();
  const events = [];
  const ears = makeEars('/bin/true', { spawn, onDeviceOnly: () => false });
  ears.on((e) => events.push(e));
  ears.start();
  const stalled = tickUntil(t, () => events.some((e) => e.reason === 'stalled'), 1000, 120000);
  assert.ok(stalled, 'never stalled; last event ' + JSON.stringify(events[events.length - 1]));
  assert.ok(spawn.made.length >= 6 && spawn.made.length <= 8, 'tries ' + spawn.made.length);
});

test('tries again on its own after a cooldown, with nobody touching anything', { concurrency: false }, (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawn = fakeSpawn();
  const events = [];
  const ears = makeEars('/bin/true', { spawn, onDeviceOnly: () => false });
  ears.on((e) => events.push(e));
  ears.start();
  assert.ok(tickUntil(t, () => events.some((e) => e.reason === 'stalled'), 1000, 120000), 'never stalled');
  const before = spawn.made.length;
  spawn.setHealthy(true);
  assert.ok(tickUntil(t, () => events[events.length - 1].state === 'listening', 1000, 30000),
    'no retry heard from; last event ' + JSON.stringify(events[events.length - 1]));
  assert.ok(spawn.made.length > before, 'no retry was made');
});

test('stop() during the cooldown is final: no surprise restart', { concurrency: false }, (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawn = fakeSpawn();
  const events = [];
  const ears = makeEars('/bin/true', { spawn, onDeviceOnly: () => false });
  ears.on((e) => events.push(e));
  ears.start();
  assert.ok(tickUntil(t, () => events.some((e) => e.reason === 'stalled'), 1000, 120000), 'never stalled');
  ears.stop();
  const before = spawn.made.length;
  spawn.setHealthy(true);
  t.mock.timers.tick(25000);
  assert.equal(spawn.made.length, before, 'stop() should have cancelled the pending retry');
  assert.equal(ears.wanted(), false);
});
