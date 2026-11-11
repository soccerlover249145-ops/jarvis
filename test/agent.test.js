'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeAgent, costOf } = require('../src/main/control/agent');

const GEO = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, shot: { width: 1440, height: 900 } };
const U = { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function tu(id, name, input) { return { type: 'tool_use', id: id, name: name, toolset_name: 'computer', input: input || {} }; }
function reply(content, stop) { return { model: 'claude-opus-5-5', stop_reason: stop || (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'), content: content, usage: U }; }
function client(script) {
  const calls = [];
  return { calls, messages: { stream(params, opts) { calls.push(JSON.parse(JSON.stringify(params))); const r = script.shift(); return { finalMessage: async () => { if (r instanceof Error) throw r; return r; } }; } } };
}
function rig(script, over) {
  const c = client(script), ran = [], ups = [], asked = [];
  const executor = { setGeo() {}, run: async (n, i) => { ran.push([n, i]); if (n === 'type' && i.text === 'FAIL') throw new Error('Blocked by the owner\'s safety rules: test'); return n === 'screenshot' ? { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'S' } }] } : { content: [{ type: 'text', text: 'OK' }] }; } };
  const screen = { capture: async () => ({ data: 'FIRST', media_type: 'image/jpeg', geo: GEO }) };
  const a = makeAgent(Object.assign({ client: c, executor, screen, confirm: async (q) => { asked.push(q); return true; }, ui: { update: (o) => ups.push(o) }, caps: { steps: 10, dollars: 5, minutes: 10 } }, over || {}));
  return { a, c, ran, ups, asked };
}

test('the request uses the computer toolset the way Opus 5.5 requires', async () => {
  const { a, c } = rig([reply([{ type: 'text', text: 'Done: opened YouTube.' }])]);
  const r = await a.start({ text: 'open youtube' });
  const p = c.calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.deepEqual(p.tools[0], { type: 'computer_toolset_20260801' }, 'no name, no display size, no beta');
  assert.equal(p.tools[1].name, 'ask_owner');
  assert.equal(p.betas, undefined); assert.equal(p.tool_choice, undefined);
  assert.deepEqual(p.thinking, { type: 'adaptive' });
  assert.ok(p.output_config.effort);
  assert.deepEqual(p.cache_control, { type: 'ephemeral' });
  assert.equal(p.messages[0].content[1].type, 'image', 'the first picture goes with the task');
  assert.match(p.system, /1440x900/);
  assert.equal(r.ok, true); assert.equal(r.summary, 'Done: opened YouTube.');
});
test('a batch runs in order; every tool_use gets one result echoing toolset_name; a picture is attached', async () => {
  const { a, c, ran } = rig([
    reply([{ type: 'thinking', thinking: '', signature: 'sig' }, tu('t1', 'left_click', { coordinate: [10, 10] }), tu('t2', 'type', { text: 'hello' }), tu('t3', 'key', { text: 'Return' })]),
    reply([{ type: 'text', text: 'Searched.' }])
  ]);
  await a.start({ text: 'search hello' });
  assert.deepEqual(ran.map((r) => r[0]), ['left_click', 'type', 'key']);
  const second = c.calls[1];
  const asst = second.messages[1];
  assert.equal(asst.role, 'assistant'); assert.equal(asst.content[0].type, 'thinking', 'thinking blocks go back unchanged');
  const res = second.messages[2].content;
  assert.deepEqual(res.map((b) => b.tool_use_id), ['t1', 't2', 't3']);
  assert.ok(res.every((b) => b.toolset_name === 'computer' && b.type === 'tool_result'));
  assert.equal(res[2].content[res[2].content.length - 1].type, 'image', 'the batch did not end with a screenshot, so one is attached');
});
test('the batch stops at the first failure and the rest are reported as not run', async () => {
  const { a, c, ran } = rig([reply([tu('a', 'type', { text: 'FAIL' }), tu('b', 'key', { text: 'Return' })]), reply([{ type: 'text', text: 'Stopped.' }])]);
  await a.start({ text: 'x' });
  assert.deepEqual(ran.map((r) => r[0]), ['type']);
  const res = c.calls[1].messages[2].content;
  assert.equal(res[0].is_error, true); assert.match(res[0].content, /Blocked/);
  assert.equal(res[1].is_error, true); assert.match(res[1].content, /Not executed/);
  assert.ok(res.every((b) => b.toolset_name === 'computer'));
});
test('ask_owner asks the owner and has no toolset_name', async () => {
  const { a, c, asked } = rig([reply([{ type: 'tool_use', id: 'q1', name: 'ask_owner', input: { question: 'Click Send to email the draft to Anna?', kind: 'send' } }]), reply([{ type: 'text', text: 'Sent.' }])]);
  await a.start({ text: 'send it' });
  assert.deepEqual(asked, ['Click Send to email the draft to Anna?']);
  const res = c.calls[1].messages[2].content[0];
  assert.equal(res.toolset_name, undefined); assert.equal(JSON.parse(res.content).approved, true);
});
test('step, spend and time caps stop the task', async () => {
  const loop = () => Array.from({ length: 20 }, (_, i) => reply([tu('s' + i, 'screenshot')]));
  let r = await rig(loop(), { caps: { steps: 3, dollars: 50, minutes: 10 } }).a.start({ text: 'x' });
  assert.equal(r.ok, false); assert.match(r.stopped, /step limit/); assert.equal(r.steps, 3);
  r = await rig(loop(), { caps: { steps: 50, dollars: 0.05, minutes: 10 } }).a.start({ text: 'x' });
  assert.match(r.stopped, /spend limit/); assert.ok(r.spent <= 0.05 + costOf(U));
  let t = 0; r = await rig(loop(), { now: () => (t += 70000), caps: { steps: 50, dollars: 50, minutes: 1 } }).a.start({ text: 'x' });
  assert.match(r.stopped, /time limit/);
});
test('a refusal ends the task; stop() ends it at once', async () => {
  let r = await rig([reply([{ type: 'text', text: '' }], 'refusal')]).a.start({ text: 'x' });
  assert.match(r.stopped, /declined/);
  const g = rig([reply([tu('a', 'screenshot'), tu('b', 'left_click', { coordinate: [1, 1] })]), reply([{ type: 'text', text: 'never' }])]);
  const orig = g.a; const ex0 = g.ran;
  const p = orig.start({ text: 'x' });
  orig.stop('You pressed Escape.');
  r = await p;
  assert.equal(r.stopped, 'You pressed Escape.');
  assert.equal(ex0.length, 0);
});
test('cost uses Opus 5.5 prices', () => {
  assert.equal(costOf({ input_tokens: 1e6 }), 4);
  assert.equal(costOf({ output_tokens: 1e6 }), 20);
  assert.equal(costOf({ cache_read_input_tokens: 1e6 }), 0.2);
  assert.equal(costOf({ cache_creation_input_tokens: 1e6 }), 5);
});
