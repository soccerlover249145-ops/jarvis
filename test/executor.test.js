'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeExecutor } = require('../src/main/control/executor');

const GEO = { bounds: { x: 0, y: 0, width: 1728, height: 1117 }, shot: { width: 1568, height: 1014 } };
function rig(front, confirmAnswer) {
  const sent = [], asked = [];
  const hands = { send: async (op, a) => { sent.push([op, a]); if (op === 'front') return front || { bundleId: 'com.apple.Safari', name: 'Safari', title: 'Shopify' }; if (op === 'cursor') return { x: 864, y: 558.5 }; return { ok: true }; } };
  const screen = { capture: async () => ({ data: 'AAA', media_type: 'image/jpeg', geo: GEO }), zoom: async () => ({ data: 'ZZZ', media_type: 'image/jpeg' }) };
  let escapes = 0;
  const ex = makeExecutor({ hands, screen, task: {}, confirm: async (w) => { asked.push(w); return confirmAnswer; }, beforeKey: (c) => { if (c.key === 'escape') escapes++; }, sleep: async () => {} });
  return { ex, sent, asked, escapes: () => escapes };
}

test('a screenshot comes back as an image and sets the coordinate space', async () => {
  const { ex } = rig();
  const r = await ex.run('screenshot', {});
  assert.deepEqual(r.content, [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } }]);
});
test('clicks need a screenshot first, then map to screen points', async () => {
  const { ex, sent } = rig();
  await assert.rejects(() => ex.run('left_click', { coordinate: [10, 10] }), /screenshot first/);
  await ex.run('screenshot', {});
  await ex.run('double_click', { coordinate: [784, 507], text: 'shift' });
  const click = sent.find((s) => s[0] === 'click')[1];
  assert.equal(click.count, 2); assert.equal(click.button, 'left'); assert.equal(click.flags, 0x20000);
  assert.ok(Math.abs(click.x - 864) < 1);
  assert.ok(sent.some((s) => s[0] === 'front'), 'the front window is checked before acting');
});
test('every member runs; unknown members fail', async () => {
  const { ex, sent, escapes } = rig();
  await ex.run('screenshot', {});
  for (const [n, i] of [['right_click', { coordinate: [5, 5] }], ['middle_click', {}], ['triple_click', { coordinate: [5, 5] }], ['left_click_drag', { start_coordinate: [1, 1], coordinate: [100, 100] }],
    ['mouse_move', { coordinate: [3, 3] }], ['left_mouse_down', {}], ['left_mouse_up', {}], ['scroll', { scroll_direction: 'down', scroll_amount: 5, coordinate: [50, 50] }],
    ['type', { text: 'hello\nworld' }], ['key', { text: 'Escape', repeat: 2 }], ['hold_key', { text: 'shift', duration: 0.1 }], ['wait', { duration: 0 }], ['zoom', { region: [0, 0, 100, 100] }]]) {
    const r = await ex.run(n, i); assert.ok(r.content, n);
  }
  const c = await ex.run('cursor_position', {});
  assert.equal(c.content[0].text, 'X=784, Y=507');
  const sc = sent.find((s) => s[0] === 'scroll')[1]; assert.equal(sc.dy, -5); assert.equal(sc.dx, 0);
  assert.equal(sent.find((s) => s[0] === 'key')[1].repeat, 2);
  assert.equal(escapes(), 1, 'Jarvis pressing Escape mutes the Escape stop key first');
  await assert.rejects(() => ex.run('bash', { command: 'ls' }), /does not support/);
  await assert.rejects(() => ex.run('scroll', { scroll_direction: 'sideways' }), /scroll_direction/);
});
test('the guard blocks actions in Terminal and asks before typing a card number', async () => {
  const t = rig({ bundleId: 'com.apple.Terminal', name: 'Terminal' });
  await t.ex.run('screenshot', {});
  await assert.rejects(() => t.ex.run('type', { text: 'ls' }), /Blocked/);
  assert.ok(!t.sent.some((s) => s[0] === 'type'));
  const no = rig(null, false);
  await no.ex.run('screenshot', {});
  await assert.rejects(() => no.ex.run('type', { text: '4111 1111 1111 1111' }), /said no/);
  assert.equal(no.asked.length, 1); assert.ok(!no.sent.some((s) => s[0] === 'type'));
  const yes = rig(null, true);
  await yes.ex.run('screenshot', {});
  await yes.ex.run('type', { text: '4111 1111 1111 1111' });
  assert.ok(yes.sent.some((s) => s[0] === 'type'));
});
