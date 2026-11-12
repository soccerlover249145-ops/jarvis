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

/* after giving up (too many quick deaths in a row) try again on its own after this long. Most
   runs of bad luck here are the Swift helper or the system speech service having a rough patch,
   not something that needs a person to notice and reopen Jarvis -- so this keeps trying quietly
   instead of staying off for good. */
const STALL_RETRY = 20000;

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
      if (fails > 6) {
        want = false; emit({ type: 'state', state: 'off', reason: 'stalled' });
        timer = setTimeout(function () { if (!want) { fails = 0; want = true; begin(); } }, STALL_RETRY);
        return;
      }
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

/* what the live Jarvis page in the full window is sent for one event from the helper: every event on 'desk:ears'
   (pages that know jarvisDesk version 3 read the state and the words from it), and each finished phrase also on
   'desk:heard' (pages written for versions 1 and 2). The page itself decides what is a wake phrase or a question. */
function forLivePage(ev) {
  if (!ev || typeof ev !== 'object') return [];
  const out = [['desk:ears', ev]];
  if (ev.type === 'final' && ev.text) out.push(['desk:heard', { text: ev.text }]);
  return out;
}

/* why the helper cannot listen, in plain words, and which System Settings pane fixes it (null: none does) */
const BLOCKED = {
  'mic-denied': { pane: 'microphone', body: 'macOS is not letting Jarvis use the microphone. Switch Jarvis on in System Settings, Privacy & Security, Microphone, then quit and reopen Jarvis.' },
  'speech-denied': { pane: 'speech', body: 'Speech recognition is off for Jarvis. Switch Jarvis on in System Settings, Privacy & Security, Speech Recognition, then quit and reopen Jarvis.' },
  'speech-not-allowed': { pane: 'speech', body: 'Speech recognition is not allowed for Jarvis yet. Switch Jarvis on in System Settings, Privacy & Security, Speech Recognition, then quit and reopen Jarvis.' },
  'speech-restricted': { pane: null, body: 'Speech recognition is restricted on this Mac (Screen Time or a management profile), so Jarvis cannot listen. You can still type.' },
  'no-on-device': { pane: null, body: 'This Mac cannot turn speech into text on the Mac itself for this language. In Jarvis Settings, Mac, you can let Apple\'s servers do it instead. You can still type.' },
  'no-microphone': { pane: 'microphone', body: 'Jarvis found no microphone. Plug one in, or pick an input in System Settings, Sound.' },
  'helper-missing': { pane: null, body: 'The listening helper is missing from this install. Run install-mac.sh again, then reopen Jarvis.' },
  'no-recognizer': { pane: null, body: 'This Mac has no speech recognizer for this language, so Jarvis cannot listen. You can still type.' }
};
function blockedHelp(reason) {
  const b = Object.prototype.hasOwnProperty.call(BLOCKED, String(reason)) ? BLOCKED[reason] : null;
  return { title: 'Jarvis cannot hear you', body: b ? b.body : 'Jarvis cannot listen right now. Check System Settings, Privacy & Security, Microphone and Speech Recognition.', pane: b ? b.pane : 'microphone' };
}

module.exports = { makeEars, parseLine, forLivePage, blockedHelp };
