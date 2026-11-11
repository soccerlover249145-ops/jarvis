'use strict';
/* ears.js (main process): runs JarvisEars, the Swift helper that turns speech into text with
   Apple's speech recognizer, on the Mac itself when the Mac supports that.
   The helper prints one JSON object per line:
     {"type":"state","state":"listening"}   starting | listening | off | blocked (+ reason)
     {"type":"partial","text":"hey jar"}
     {"type":"final","text":"hey jarvis what's on today"}
   and reads one word per line: pause, resume, quit.
   Wake, sleep and stop phrases are decided in the window by the web UI's own wakeIn logic. */

const { spawn } = require('child_process');
const readline = require('readline');

function parseLine(line) {
  let m; try { m = JSON.parse(line); } catch (e) { return null; }
  if (!m || typeof m !== 'object') return null;
  if (m.type === 'partial' || m.type === 'final') {
    const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    return text ? { type: m.type, text: text } : null;
  }
  if (m.type === 'state' && ['starting', 'listening', 'off', 'blocked', 'paused'].indexOf(m.state) >= 0) {
    return { type: 'state', state: m.state, reason: String(m.reason || '').slice(0, 80), onDevice: !!m.onDevice };
  }
  return null;
}

function makeEars(binPath, opts) {
  opts = opts || {};
  const spawnFn = opts.spawn || spawn;
  let proc = null, want = false, paused = false, fails = 0, timer = null, emit = function () {}, lastStart = 0;

  function begin() {
    clearTimeout(timer); timer = null;
    if (!want || proc) return;
    lastStart = Date.now();
    const args = ['--locale', opts.locale || 'en-US'];
    if (opts.onDeviceOnly()) args.push('--on-device-only');
    try { proc = spawnFn(binPath, args, { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { emit({ type: 'state', state: 'off', reason: 'helper-missing' }); return; }
    emit({ type: 'state', state: 'starting' });
    readline.createInterface({ input: proc.stdout }).on('line', function (line) {
      const ev = parseLine(line);
      if (!ev) return;
      if (ev.type === 'state' && ev.state === 'listening') fails = 0;
      if (ev.type === 'state' && ev.state === 'blocked') want = false;   /* the owner said no: do not nag */
      emit(ev);
    });
    proc.stderr.on('data', function () {});
    const p = proc;
    p.on('error', function () { if (proc === p) proc = null; emit({ type: 'state', state: 'off', reason: 'helper-missing' }); want = false; });
    p.on('exit', function () {
      if (proc !== p) return;
      proc = null;
      if (!want) { emit({ type: 'state', state: 'off', reason: 'stopped' }); return; }
      /* it died: start again, waiting longer each time it dies quickly, and give up after a while */
      fails = Date.now() - lastStart < 5000 ? fails + 1 : 0;
      if (fails > 6) { want = false; emit({ type: 'state', state: 'off', reason: 'stalled' }); return; }
      emit({ type: 'state', state: 'starting', reason: 'restart' });
      timer = setTimeout(begin, Math.min(30000, 500 * Math.pow(2, fails)));
    });
    if (paused) tell('pause');
  }
  function tell(word) { if (proc) { try { proc.stdin.write(word + '\n'); } catch (e) {} } }
  return {
    on(f) { emit = f; },
    start() { want = true; fails = 0; begin(); return true; },
    stop() { want = false; clearTimeout(timer); if (proc) { tell('quit'); const p = proc; setTimeout(function () { try { p.kill(); } catch (e) {} }, 300); proc = null; } emit({ type: 'state', state: 'off', reason: 'stopped' }); },
    hold(on) { paused = !!on; tell(on ? 'pause' : 'resume'); },
    wanted() { return want; },
    running() { return !!proc; }
  };
}

module.exports = { makeEars, parseLine };
