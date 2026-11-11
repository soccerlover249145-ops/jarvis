'use strict';
/* session.js: one "take control" session from start to finish.

   1. The owner confirms the task in a native dialog (never started by the model alone), and can
      tick "Allow sensitive apps and sites for this task".
   2. Jarvis's own windows step aside, the red border and status pill appear, Escape and the
      Jarvis hotkey become Stop, and the input helper starts (it stops the task if the owner moves
      the mouse).
   3. The agent runs with the step, spend and time caps.
   4. Whatever happens (done, stopped, error), the helper is killed, the shortcuts are given back,
      the border goes away and Jarvis says what happened. */

const { makeAgent } = require('./agent');
const { makeExecutor } = require('./executor');

/**
 * deps: { client() -> Anthropic client or null, screen, hands, overlay: { show(), update(o), hide() },
 *   shortcuts: { register(acc, fn) -> bool, unregister(acc) }, hotkey() -> accelerator,
 *   askStart(task) -> Promise<{ ok, allowSensitive }>, confirm(text) -> Promise<bool>,
 *   stepAside() -> Promise, restore(), caps() -> { steps, dollars, minutes }, notify(title, body), log }
 */
function makeSession(deps) {
  let active = null;          /* { agent, task, started } */
  let muteEscUntil = 0;
  let last = '';

  function stop(why) {
    if (!active) return false;
    active.agent.stop(why || 'You stopped it.');
    deps.hands.stop();
    return true;
  }
  function onEscape() {
    if (Date.now() < muteEscUntil) return;   /* Jarvis itself just pressed Escape */
    stop('You pressed Escape.');
  }

  async function start(text, opts) {
    opts = opts || {};
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!text) return { ok: false, why: 'No task given.' };
    if (active) return { ok: false, why: 'Jarvis already has control. Press Escape to stop it first.' };
    const client = deps.client();
    if (!client) return { ok: false, why: 'Add your Claude key in Settings first.' };
    const perm = deps.screen.permission();
    if (perm !== 'granted' && perm !== 'unknown') return { ok: false, why: 'Allow Screen Recording for Jarvis first (System Settings, Privacy & Security, Screen Recording).', permission: 'screen' };

    const caps = deps.caps();
    const go = await deps.askStart({ text: text, caps: caps, from: opts.from || 'you' });
    if (!go || !go.ok) return { ok: false, why: 'You did not allow it.', declined: true };
    const task = { text: text, allowSensitive: !!go.allowSensitive };

    deps.hands.start();
    let trusted = true;
    try { const t = await deps.hands.send('trusted', { prompt: true }, 5000); trusted = !!t.trusted; } catch (e) { trusted = false; }
    if (!trusted) { deps.hands.stop(); return { ok: false, why: 'Allow Accessibility for Jarvis first (System Settings, Privacy & Security, Accessibility), then try again.', permission: 'accessibility' }; }

    const executor = makeExecutor({
      hands: deps.hands, screen: deps.screen, task: task,
      confirm: async function (why) { const yes = await deps.confirm(why); await refocus(); return yes; },
      beforeKey: function (combo) { if (combo && combo.key === 'escape') muteEscUntil = Date.now() + 600; },
      stopped: function () { return !!(active && active.agent.stoppedWhy()); },
      onAction: function (t) { last = t; }
    });
    const agent = makeAgent({
      client: client, executor: executor, screen: deps.screen, caps: caps,
      confirm: async function (q) { const yes = await deps.confirm(q); await refocus(); return yes; },
      ui: { update: function (o) { deps.overlay.update(o); } },
      lastAction: function () { return last; }
    });
    async function refocus() { try { await deps.hands.send('activate-under', { excludePid: process.pid }, 3000); } catch (e) {} }

    active = { agent: agent, task: task, started: Date.now() };
    deps.hands.on(function (ev) { if (ev && ev.event === 'user-input') stop('You moved the mouse, so I handed control back.'); });
    const hk = deps.hotkey();
    deps.shortcuts.register('Escape', onEscape);
    if (hk) deps.shortcuts.register(hk, function () { stop('You pressed the Jarvis shortcut.'); });

    let result;
    try {
      await deps.stepAside();
      deps.overlay.show({ task: text, caps: caps });
      await refocus();
      result = await agent.start(task);
    } catch (e) {
      result = { ok: false, summary: '', stopped: 'Something went wrong: ' + (e && e.message ? String(e.message).slice(0, 200) : 'unknown error'), spent: 0, steps: 0, actions: 0 };
    } finally {
      deps.hands.stop();
      deps.shortcuts.unregister('Escape');
      if (hk) deps.shortcuts.unregister(hk);
      deps.overlay.hide();
      active = null;
      deps.restore();
    }
    const said = result.stopped ? result.stopped + (result.summary ? ' ' + result.summary : '') : (result.summary || 'Done.');
    deps.notify(result.stopped ? 'Jarvis stopped' : 'Jarvis finished', said + ' ($' + (result.spent || 0).toFixed(2) + ', ' + (result.steps || 0) + ' steps)');
    return Object.assign({ ok: !result.stopped }, result);
  }

  return { start, stop, active: function () { return !!active; } };
}

module.exports = { makeSession };
