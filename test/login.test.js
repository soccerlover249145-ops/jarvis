'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const fs = require('fs'); const path = require('path');
const { makeConfig, clean, DEFAULTS } = require('../src/main/config');
const { loginOptions, needsNote, applyLogin, NOTE } = require('../src/main/login');

test('opening at login is on from the first run, as a window (not hidden)', function () {
  const c = clean(null);
  assert.strictEqual(DEFAULTS.launchAtLogin, true);
  assert.deepStrictEqual(loginOptions(c), { openAtLogin: true, openAsHidden: false });
});

test('the Settings toggle switches it off and on, and survives a restart', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-login-'));
  const cfg = makeConfig(dir);
  cfg.set({ launchAtLogin: false });
  assert.deepStrictEqual(loginOptions(makeConfig(dir).get()), { openAtLogin: false, openAsHidden: false });
  cfg.set({ launchAtLogin: true });
  assert.strictEqual(loginOptions(makeConfig(dir).get()).openAtLogin, true);
});

test('a damaged settings file cannot turn it into something else', function () {
  assert.strictEqual(clean({ launchAtLogin: 'yes', seenLoginNote: 1 }).launchAtLogin, true);
  assert.strictEqual(clean({ launchAtLogin: 'yes', seenLoginNote: 1 }).seenLoginNote, false);
});

test('the one-time note shows once, and never when opening at login is off', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-note-'));
  const cfg = makeConfig(dir);
  assert.strictEqual(needsNote(cfg.get()), true);
  cfg.set({ seenLoginNote: true });
  assert.strictEqual(needsNote(makeConfig(dir).get()), false);
  assert.strictEqual(needsNote(clean({ launchAtLogin: false })), false);
  assert.match(NOTE.title, /open when you log in/);
  assert.match(NOTE.detail, /Settings > Mac/);
});

test('applying the choice hands macOS exactly these settings and never throws', function () {
  let got = null;
  assert.strictEqual(applyLogin({ setLoginItemSettings: function (o) { got = o; } }, clean(null)), true);
  assert.deepStrictEqual(got, { openAtLogin: true, openAsHidden: false });
  assert.strictEqual(applyLogin({ setLoginItemSettings: function () { throw new Error('unsigned'); } }, clean(null)), false);
});
