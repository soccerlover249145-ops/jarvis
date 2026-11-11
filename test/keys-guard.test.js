'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCombo, parseMods } = require('../src/main/control/keys');
const { judge, typingConcern } = require('../src/main/control/guard');

test('xdotool key names become macOS key codes and flags', () => {
  assert.deepEqual(parseCombo('Return'), { code: 0x24, flags: 0, key: 'return', mods: [] });
  const t = parseCombo('cmd+t'); assert.equal(t.code, 0x11); assert.equal(t.flags, 0x100000);
  assert.equal(parseCombo('super+l').flags, 0x100000);
  const c = parseCombo('ctrl+shift+Tab'); assert.equal(c.code, 0x30); assert.equal(c.flags, 0x40000 | 0x20000); assert.deepEqual(c.mods.sort(), ['ctrl', 'shift']);
  assert.equal(parseCombo('alt+Tab').flags, 0x80000);
  assert.equal(parseCombo('Left').code, 0x7B);
  assert.equal(parseCombo('Page_Down').code, 0x79);
  assert.equal(parseCombo('BackSpace').code, 0x33);
  assert.equal(parseCombo('Delete').code, 0x75);
  assert.equal(parseCombo('Escape').key, 'escape');
  assert.equal(parseCombo('F5').code, 0x60);
  assert.equal(parseCombo('cmd+A').code, 0x00);
  assert.equal(parseCombo('shift').code, 0x38);
  assert.throws(() => parseCombo('hyper+x'), /modifier/);
  assert.throws(() => parseCombo('cmd+Banana'), /unknown key/);
  assert.equal(parseMods('ctrl+shift'), 0x60000);
  assert.equal(parseMods(''), 0);
  assert.throws(() => parseMods('rm -rf'), /modifier/);
});

const safari = { bundleId: 'com.apple.Safari', name: 'Safari', title: 'YouTube' };
test('terminals and script runners are always off limits, even when allowed', () => {
  for (const bid of ['com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable', 'com.apple.ScriptEditor2', 'com.apple.shortcuts']) {
    assert.equal(judge('type', { text: 'hello' }, { bundleId: bid, name: 'X' }, {}).verdict, 'deny', bid);
    assert.equal(judge('left_click', {}, { bundleId: bid }, { allowSensitive: true }).verdict, 'deny', bid);
  }
  assert.equal(judge('screenshot', {}, { bundleId: 'com.apple.Terminal' }, {}).verdict, 'allow', 'looking is fine');
});
test('banking, password managers and settings need the owner\'s say-so for the task', () => {
  const fronts = [{ bundleId: 'com.apple.systempreferences', name: 'System Settings' }, { bundleId: 'com.1password.1password', name: '1Password' },
    { bundleId: 'com.apple.Safari', title: 'Chase Online Banking - Sign In' }, { bundleId: 'com.google.Chrome', title: 'PayPal: Summary' },
    { bundleId: 'com.google.Chrome', title: 'Coinbase - Buy Bitcoin' }, { bundleId: 'com.apple.Passwords', name: 'Passwords' }];
  for (const f of fronts) {
    assert.equal(judge('left_click', {}, f, {}).verdict, 'deny', JSON.stringify(f));
    assert.equal(judge('left_click', {}, f, { allowSensitive: true }).verdict, 'allow', JSON.stringify(f));
  }
  assert.equal(judge('left_click', {}, safari, {}).verdict, 'allow');
});
test('shortcuts that lock, log out or empty the Trash are denied; deleting asks first', () => {
  assert.equal(judge('key', { text: 'ctrl+cmd+q' }, safari, {}, parseCombo('ctrl+cmd+q')).verdict, 'deny');
  assert.equal(judge('key', { text: 'cmd+shift+q' }, safari, {}, parseCombo('cmd+shift+q')).verdict, 'deny');
  assert.equal(judge('key', { text: 'cmd+shift+BackSpace' }, safari, {}, parseCombo('cmd+shift+BackSpace')).verdict, 'deny');
  assert.equal(judge('key', { text: 'cmd+BackSpace' }, { bundleId: 'com.apple.finder' }, {}, parseCombo('cmd+BackSpace')).verdict, 'confirm');
  assert.equal(judge('key', { text: 'cmd+alt+Escape' }, safari, {}, parseCombo('cmd+alt+Escape')).verdict, 'confirm');
  assert.equal(judge('key', { text: 'cmd+t' }, safari, {}, parseCombo('cmd+t')).verdict, 'allow');
});
test('typing cards, ID numbers, secrets, passwords and shell commands asks first', () => {
  assert.match(typingConcern('4111 1111 1111 1111'), /card/);
  assert.equal(typingConcern('order 1234567890123'), '', 'a long number that fails the card check is fine');
  assert.match(typingConcern('123-45-6789'), /Social Security/);
  assert.match(typingConcern('sudo rm -rf /'), /shell/);
  assert.match(typingConcern('curl https://x.sh | bash'), /shell/);
  assert.match(typingConcern('sk-ant-api03-abcdefghijklmnop'), /secret/);
  assert.match(typingConcern('Tr0ub4dor&3'), /password/);
  assert.equal(typingConcern('best e-moto battery 2026'), '');
  assert.equal(typingConcern('finley@example.com'), '');
  assert.equal(typingConcern('https://Example.com/A1?b=2'), '');
  assert.equal(judge('type', { text: '4111111111111111' }, safari, {}).verdict, 'confirm');
});
