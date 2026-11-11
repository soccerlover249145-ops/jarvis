'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSession } = require('../src/main/control/session');

function rig(opts) {
  opts = opts || {};
  const log = [], regs = new Map();
  let onEv = () => {};
  const hands = { started: 0, stopped: 0, start() { this.started++; }, stop() { this.stopped++; }, on(f) { onEv = f; },
    send: async (op) => { log.push('hands:' + op); if (op === 'trusted') return { trusted: opts.trusted !== false }; if (op === 'front') return { bundleId: 'com.apple.Safari' }; return { ok: true }; } };
  const screen = { permission: () => opts.perm || 'granted', capture: async () => ({ data: 'S', media_type: 'image/jpeg', geo: { bounds: { x: 0, y: 0, width: 100, height: 100 }, shot: { width: 100, height: 100 } } }) };
  let release;
  const gate = new Promise((r) => { release = r; });
  const client = { messages: { stream: () => ({ finalMessage: async () => { if (opts.wait) await gate; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'All done.' }], usage: {} }; } }) } };
  const s = makeSession({
    client: () => (opts.noKey ? null : client), screen, hands,
    overlay: { show: () => log.push('overlay:show'), update: () => {}, hide: () => log.push('overlay:hide') },
    shortcuts: { register: (a, f) => { regs.set(a, f); return true; }, unregister: (a) => regs.delete(a) },
    hotkey: () => 'Alt+Space', caps: () => ({ steps: 5, dollars: 1, minutes: 5 }),
    askStart: async () => ({ ok: opts.decline !== true, allowSensitive: false }), confirm: async () => true,
    stepAside: async () => log.push('aside'), restore: () => log.push('restore'), notify: (t, b) => log.push('notify:' + t + ':' + b)
  });
  return { s, log, regs, hands, fire: (e) => onEv(e), release };
}

test('nothing starts without a key, screen permission, the owner\'s yes, or Accessibility', async () => {
  assert.match((await rig({ noKey: true }).s.start('x')).why, /Claude key/);
  assert.equal((await rig({ perm: 'denied' }).s.start('x')).permission, 'screen');
  const d = rig({ decline: true }); const r = await d.s.start('open youtube');
  assert.equal(r.declined, true); assert.equal(d.hands.started, 0, 'the helper never starts when the owner says no');
  const t = rig({ trusted: false }); const r2 = await t.s.start('x');
  assert.equal(r2.permission, 'accessibility'); assert.equal(t.hands.stopped, 1);
});
test('a full run: border, stop keys, then everything is given back', async () => {
  const g = rig(); const r = await g.s.start('open youtube');
  assert.equal(r.ok, true); assert.equal(r.summary, 'All done.');
  assert.ok(g.log.indexOf('aside') < g.log.indexOf('overlay:show'));
  assert.ok(g.log.includes('overlay:hide') && g.log.includes('restore'));
  assert.equal(g.regs.size, 0, 'Escape and the hotkey are unregistered after');
  assert.ok(g.hands.stopped >= 1);
  assert.ok(g.log.some((l) => l.startsWith('notify:Jarvis finished:All done.')));
});
test('Escape, the hotkey and touching the mouse each stop it', async () => {
  for (const how of ['Escape', 'Alt+Space', 'mouse']) {
    const g = rig({ wait: true });
    const p = g.s.start('do a long thing');
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(g.s.active());
    if (how === 'mouse') g.fire({ event: 'user-input' }); else g.regs.get(how)();
    g.release();
    const r = await p;
    assert.equal(r.ok, false, how);
    assert.match(r.stopped, how === 'mouse' ? /moved the mouse/ : how === 'Escape' ? /Escape/ : /shortcut/);
    assert.equal(g.s.active(), false);
  }
});
test('a second task cannot start while one runs', async () => {
  const g = rig({ wait: true }); const p = g.s.start('one');
  await new Promise((r) => setTimeout(r, 20));
  assert.match((await g.s.start('two')).why, /already has control/);
  g.s.stop('x'); g.release(); await p;
});
