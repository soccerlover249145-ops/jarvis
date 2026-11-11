'use strict';
/* executor.js: runs one member of Claude's computer toolset on the Mac.

   Input is Claude's tool_use input for that member (see the computer use docs). Coordinates are in
   the screenshot's pixel space and are mapped to screen points here. Every action that touches
   the Mac is judged by guard.js first, against the app and window in front at that moment. */

const { toScreen, toShot } = require('../screen');
const { parseCombo, parseMods } = require('./keys');
const { judge } = require('./guard');

const MEMBERS = ['screenshot', 'zoom', 'left_click', 'right_click', 'middle_click', 'double_click', 'triple_click', 'left_click_drag',
  'mouse_move', 'left_mouse_down', 'left_mouse_up', 'cursor_position', 'scroll', 'type', 'key', 'hold_key', 'wait'];
const CLICKS = { left_click: ['left', 1], right_click: ['right', 1], middle_click: ['middle', 1], double_click: ['left', 2], triple_click: ['left', 3] };

function num(v, lo, hi, def) { const n = Number(v); if (!isFinite(n)) return def; return Math.max(lo, Math.min(hi, n)); }

/**
 * deps: { hands, screen, confirm(why) -> Promise<bool>, task: { allowSensitive },
 *         beforeKey(combo), sleep(ms), stopped() -> bool, onAction(text) }
 * run(name, input) resolves { content: [...blocks] } or throws Error (reported to Claude with is_error).
 */
function makeExecutor(deps) {
  const hands = deps.hands, screen = deps.screen;
  const sleep = deps.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const say = deps.onAction || function () {};
  function ok(text) { return { content: [{ type: 'text', text: text || 'OK' }] }; }
  let curGeo = null;
  function geoNow() { const g = deps.geo ? deps.geo() : curGeo; if (!g) throw new Error('Take a screenshot first.'); return g; }
  function setGeo(g) { curGeo = g; }
  function pt(c) { return toScreen(c, geoNow()); }

  async function gate(name, input, combo) {
    let front = {};
    try { front = await hands.send('front', {}, 4000); } catch (e) { front = {}; }
    const v = judge(name, input, front, deps.task, combo);
    if (v.verdict === 'deny') throw new Error('Blocked by the owner\'s safety rules: ' + v.why);
    if (v.verdict === 'confirm') {
      const yes = await deps.confirm(v.why);
      if (!yes) throw new Error('The owner said no: ' + v.why + ' Do not try another way to do the same thing; ask the owner what they want instead.');
    }
  }

  async function run(name, input) {
    input = input && typeof input === 'object' ? input : {};
    if (deps.stopped && deps.stopped()) throw new Error('Not executed: the owner stopped the task.');
    if (MEMBERS.indexOf(name) < 0) throw new Error('This computer does not support "' + name + '".');
    switch (name) {
      case 'screenshot': {
        say('Looking at the screen');
        const s = await screen.capture();
        setGeo(s.geo);
        return { content: [{ type: 'image', source: { type: 'base64', media_type: s.media_type, data: s.data } }] };
      }
      case 'zoom': {
        say('Looking closer');
        const z = await screen.zoom(input.region, geoNow());
        return { content: [{ type: 'image', source: { type: 'base64', media_type: z.media_type, data: z.data } }] };
      }
      case 'cursor_position': {
        const c = await hands.send('cursor');
        const p = toShot({ x: c.x, y: c.y }, geoNow());
        return ok('X=' + p.x + ', Y=' + p.y);
      }
      case 'wait': {
        const s = num(input.duration, 0, 300, 1);
        say('Waiting ' + s + ' s');
        const end = Date.now() + s * 1000;
        while (Date.now() < end) { if (deps.stopped && deps.stopped()) throw new Error('Not executed: the owner stopped the task.'); await sleep(Math.min(250, end - Date.now())); }
        return ok();
      }
      case 'mouse_move': {
        const p = pt(input.coordinate);
        await hands.send('move', p);
        return ok();
      }
      case 'left_click': case 'right_click': case 'middle_click': case 'double_click': case 'triple_click': {
        const flags = parseMods(input.text);
        const p = input.coordinate ? pt(input.coordinate) : null;
        await gate(name, input, null);
        const [button, count] = CLICKS[name];
        say((count === 2 ? 'Double-clicking' : count === 3 ? 'Triple-clicking' : button === 'right' ? 'Right-clicking' : 'Clicking') + (p ? '' : ' here'));
        await hands.send('click', Object.assign({ button: button, count: count, flags: flags }, p || {}));
        return ok();
      }
      case 'left_click_drag': {
        const a = pt(input.start_coordinate), b = pt(input.coordinate), flags = parseMods(input.text);
        await gate(name, input, null);
        say('Dragging');
        await hands.send('drag', { x0: a.x, y0: a.y, x1: b.x, y1: b.y, flags: flags });
        return ok();
      }
      case 'left_mouse_down': case 'left_mouse_up': {
        await gate(name, input, null);
        await hands.send(name === 'left_mouse_down' ? 'down' : 'up', { button: 'left' });
        return ok();
      }
      case 'scroll': {
        const dir = String(input.scroll_direction || '');
        if (['up', 'down', 'left', 'right'].indexOf(dir) < 0) throw new Error('scroll_direction must be up, down, left or right');
        const n = Math.round(num(input.scroll_amount, 1, 50, 3));
        const flags = parseMods(input.text);
        const p = input.coordinate ? pt(input.coordinate) : null;
        await gate(name, input, null);
        say('Scrolling ' + dir);
        await hands.send('scroll', Object.assign({ dx: dir === 'left' ? n : dir === 'right' ? -n : 0, dy: dir === 'up' ? n : dir === 'down' ? -n : 0, flags: flags }, p || {}));
        return ok();
      }
      case 'type': {
        const text = String(input.text == null ? '' : input.text);
        if (!text) return ok();
        if (text.length > 5000) throw new Error('That is too much text to type at once (5000 characters at most).');
        await gate(name, input, null);
        say('Typing');
        await hands.send('type', { text: text }, 60000);
        return ok();
      }
      case 'key': case 'hold_key': {
        const combo = parseCombo(input.text);
        await gate(name, input, combo);
        if (deps.beforeKey) deps.beforeKey(combo);
        if (name === 'key') {
          const repeat = Math.round(num(input.repeat, 1, 100, 1));
          say('Pressing ' + String(input.text) + (repeat > 1 ? ' x' + repeat : ''));
          await hands.send('key', { code: combo.code, flags: combo.flags, repeat: repeat });
        } else {
          const secs = num(input.duration, 0.05, 300, 1);
          say('Holding ' + String(input.text));
          await hands.send('hold', { code: combo.code, flags: combo.flags, seconds: secs }, (secs + 5) * 1000);
        }
        return ok();
      }
    }
    throw new Error('unsupported');
  }
  return { run, setGeo, MEMBERS };
}

module.exports = { makeExecutor, MEMBERS };
