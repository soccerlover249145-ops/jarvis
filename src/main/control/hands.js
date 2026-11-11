'use strict';
/* hands.js: talks to JarvisHands, the small Swift helper that moves the mouse and presses keys
   with Apple's own CGEvent API. One JSON object per line each way:
     -> {"id":7,"op":"click","x":512,"y":300,"button":"left","count":1,"flags":0}
     <- {"id":7,"ok":true}
     <- {"event":"user-input"}      (the owner touched the mouse or keyboard: take back control)
   The helper only runs while "take control" is on, and is killed the moment it stops. */

const { spawn } = require('child_process');
const readline = require('readline');

function makeHands(binPath, opts) {
  opts = opts || {};
  const spawnFn = opts.spawn || spawn;
  let proc = null, rl = null, seq = 0, waiting = new Map(), onEvent = function () {}, dead = '';

  function failAll(why) {
    for (const [, w] of waiting) { clearTimeout(w.t); w.reject(new Error(why)); }
    waiting = new Map();
  }
  function start() {
    if (proc) return;
    dead = '';
    proc = spawnFn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', function (line) {
      let m; try { m = JSON.parse(line); } catch (e) { return; }
      if (m && m.event) { onEvent(m); return; }
      const w = m && waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id); clearTimeout(w.t);
      if (m.ok) w.resolve(m); else w.reject(new Error(m.error || 'the helper could not do that'));
    });
    proc.stderr && proc.stderr.on('data', function () {});
    proc.on('exit', function (code) { dead = 'The input helper stopped (' + code + ').'; proc = null; failAll(dead); });
    proc.on('error', function (e) { dead = 'The input helper could not start: ' + e.message; proc = null; failAll(dead); });
  }
  function send(op, args, timeoutMs) {
    if (!proc) start();
    if (!proc) return Promise.reject(new Error(dead || 'The input helper is not running.'));
    const id = ++seq;
    return new Promise(function (resolve, reject) {
      const t = setTimeout(function () { waiting.delete(id); reject(new Error('The input helper did not answer.')); }, timeoutMs || 15000);
      waiting.set(id, { resolve, reject, t });
      try { proc.stdin.write(JSON.stringify(Object.assign({ id: id, op: op }, args || {})) + '\n'); }
      catch (e) { clearTimeout(t); waiting.delete(id); reject(e); }
    });
  }
  return {
    start, send,
    on(f) { onEvent = f; },
    running() { return !!proc; },
    /** stop at once: release anything held, then kill */
    stop() {
      if (!proc) return;
      const p = proc;
      try { p.stdin.write(JSON.stringify({ id: ++seq, op: 'release' }) + '\n'); } catch (e) {}
      setTimeout(function () { try { p.kill('SIGTERM'); } catch (e) {} }, 60);
      proc = null; failAll('Stopped.');
    }
  };
}

module.exports = { makeHands };
