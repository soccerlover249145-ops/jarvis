'use strict';
/* the live Jarvis page hears through the Mac's own listener (window.jarvisDesk version 3) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { forLivePage, blockedHelp } = require('../src/main/ears');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('every event goes to the live page on desk:ears; finished phrases also on desk:heard for older pages', () => {
  assert.deepEqual(forLivePage({ type: 'state', state: 'listening', onDevice: true }), [['desk:ears', { type: 'state', state: 'listening', onDevice: true }]]);
  assert.deepEqual(forLivePage({ type: 'partial', text: 'hey jar' }), [['desk:ears', { type: 'partial', text: 'hey jar' }]]);
  assert.deepEqual(forLivePage({ type: 'final', text: 'hey jarvis' }), [['desk:ears', { type: 'final', text: 'hey jarvis' }], ['desk:heard', { text: 'hey jarvis' }]]);
  assert.deepEqual(forLivePage({ type: 'final', text: '' }), [['desk:ears', { type: 'final', text: '' }]]);
  assert.deepEqual(forLivePage(null), []);
  assert.deepEqual(forLivePage('final'), []);
});

test('a refusal is explained in plain words, with the System Settings pane that fixes it', () => {
  assert.equal(blockedHelp('mic-denied').pane, 'microphone');
  assert.match(blockedHelp('mic-denied').body, /Privacy & Security, Microphone/);
  assert.equal(blockedHelp('speech-denied').pane, 'speech');
  assert.match(blockedHelp('speech-denied').body, /Speech Recognition/);
  assert.equal(blockedHelp('no-on-device').pane, null);
  assert.match(blockedHelp('no-on-device').body, /Apple's servers/);
  const odd = blockedHelp('something-new');
  assert.equal(odd.title, 'Jarvis cannot hear you'); assert.match(odd.body, /Microphone and Speech Recognition/);
  assert.equal(blockedHelp('__proto__').pane, 'microphone', 'no prototype lookups');
  assert.equal(blockedHelp('toString').pane, 'microphone');
});

test('preload version 3: ears, the pill and ui.state over fixed channels; main answers them with the page sender check', () => {
  const pre = read('src/preload/desk-preload.js'), main = read('src/main/main.js');
  assert.match(pre, /version: 3,/);
  ['desk:ears:start', 'desk:ears:stop', 'desk:ears:hold', 'desk:ears:state', 'desk:ui:state'].forEach((ch) => {
    assert.ok(pre.includes("'" + ch + "'"), 'preload uses ' + ch);
    assert.ok(main.includes("deskHandle('" + ch + "'"), 'main answers ' + ch + ' with deskHandle (sender checked)');
    assert.ok(!main.includes("handle('" + ch + "'") || main.includes("deskHandle('" + ch + "'"), ch);
  });
  ["sub('desk:ears')", "sub('desktop:ask')", "sub('desktop:mic')", "sub('desktop:summon')", "sub('desk:heard')"].forEach((x) => assert.ok(pre.includes(x), x));
  /* the live page gets the helper's events only while it is the live page */
  assert.match(main, /if \(!mainLive\) send\(mainWin, 'ears:event', ev\);\s*else forLivePage\(ev\)/);
  /* ui.state from the page is checked before it reaches the pill */
  assert.match(main, /UI_STATES\.indexOf\(a\.state\) >= 0/);
  assert.match(main, /String\(a\.caption \|\| ''\)\.slice\(0, 400\)/);
});

test('the preload exposes nothing new beyond the listener, the pill and ui.state', () => {
  const pre = read('src/preload/desk-preload.js');
  const chans = Array.from(pre.matchAll(/'(desk:[a-z:]+|desktop:[a-z]+|control:[a-z]+)'/g)).map((m) => m[1]);
  const allowed = new Set(['desk:capabilities', 'desk:openUrl', 'desk:openApp', 'desk:revealFile', 'desk:openFile', 'desk:emailDraft', 'desk:runTask', 'desk:stop',
    'desk:readMail', 'desk:readCalendar', 'desk:readReminders', 'desk:readNotes', 'desk:listFolder', 'desk:readClipboard', 'desk:readSelection', 'desk:screenLook',
    'desk:addEvent', 'desk:addReminder', 'desk:appendNote', 'desk:setClipboard', 'desk:moveFile', 'desk:trashFile', 'desk:keys:get', 'desk:keys:save',
    'control:done', 'desk:heard', 'desk:ears:start', 'desk:ears:stop', 'desk:ears:hold', 'desk:ears:state', 'desk:ears', 'desktop:ask', 'desktop:mic', 'desktop:summon', 'desk:ui:state']);
  chans.forEach((c) => assert.ok(allowed.has(c), 'unexpected channel ' + c));
});

test('a refusal stays the last word: no "off, stopped" when the helper exits after it', async () => {
  const { makeEars } = require('../src/main/ears');
  const { EventEmitter } = require('events');
  const { PassThrough } = require('stream');
  let child;
  const ears = makeEars('/bin/fake', { onDeviceOnly: () => true, spawn: () => { child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {}; return child; } });
  const seen = []; ears.on(ev => seen.push(ev.state + ':' + (ev.reason || '')));
  ears.start();
  child.stdout.write(JSON.stringify({ type: 'state', state: 'blocked', reason: 'mic-denied' }) + '\n');
  await new Promise(r => setTimeout(r, 20));
  child.emit('exit', 1);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(seen[seen.length - 1], 'blocked:mic-denied', seen.join(' '));
  assert.ok(!seen.includes('off:stopped'), seen.join(' '));
  ears.stop(); assert.equal(seen[seen.length - 1], 'off:stopped');
});

test('a state line without onDevice does not claim speech leaves the Mac', () => {
  const { parseLine } = require('../src/main/ears');
  assert.equal(parseLine(JSON.stringify({ type: 'state', state: 'paused' })).onDevice, undefined);
  assert.equal(parseLine(JSON.stringify({ type: 'state', state: 'listening', onDevice: true })).onDevice, true);
});

test('only Google sign-in may open a window inside the app, and only from the live page', () => {
  const { googleSignInPopup } = require('../src/main/desk');
  assert.equal(googleSignInPopup('https://accounts.google.com/o/oauth2/auth?client_id=x', true), true);
  assert.equal(googleSignInPopup('https://accounts.google.com/o/oauth2/auth', false), false);
  assert.equal(googleSignInPopup('http://accounts.google.com/x', true), false);
  assert.equal(googleSignInPopup('https://accounts.google.com.evil.example/x', true), false);
  assert.equal(googleSignInPopup('https://user:pw@accounts.google.com/x', true), false);
  assert.equal(googleSignInPopup('https://mail.google.com/', true), false);
  assert.equal(googleSignInPopup('not a url', true), false);
});
