'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const A = require('../src/main/actions');

test('only http and https addresses open, without passwords', () => {
  assert.equal(A.cleanUrl('https://youtube.com').ok, true);
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'x-apple.systempreferences:com.apple.preference.security', 'ssh://host', 'https://u:p@bank.com', 'not a url', 'vnc://mac.local', 'smb://share'])
    assert.equal(A.cleanUrl(bad).ok, false, bad);
});
test('search opens the chosen engine with the words encoded', () => {
  const s = A.searchUrl('e-moto battery & 72v', 'duckduckgo');
  assert.equal(s.url, 'https://duckduckgo.com/?q=e-moto%20battery%20%26%2072v');
  assert.match(A.searchUrl('x', 'nope').url, /^https:\/\/www\.google\.com\/search\?q=x$/);
  assert.equal(A.searchUrl('   ').ok, false);
});
test('apps open only from the owner list, matched by name', () => {
  const apps = [{ name: 'Safari', path: '/Applications/Safari.app' }, { name: 'Google Chrome', path: '/Applications/Google Chrome.app' }, { name: 'Evil', path: '/tmp/evil.sh' }];
  assert.equal(A.findApp('safari', apps).path, '/Applications/Safari.app');
  assert.equal(A.findApp('Chrome', apps), null, 'a partial name shorter than the listed name does not count unless it starts it');
  assert.equal(A.findApp('google chrome.app', apps).name, 'Google Chrome');
  assert.equal(A.findApp('Terminal', apps), null);
  assert.equal(A.findApp('evil', apps), null, 'entries that are not .app bundles are ignored');
});
test('files resolve only inside shared folders; links cannot escape', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-')), shared = path.join(root, 'Shared'), outside = path.join(root, 'Private');
  fs.mkdirSync(shared); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(shared, 'Supplier quote.pdf'), 'x'); fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  fs.writeFileSync(path.join(shared, 'run.command'), 'x');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(shared, 'link.txt'));
  fs.mkdirSync(path.join(shared, 'Tool.app'));
  let r = await A.resolveFile('Supplier quote.pdf', [shared]);
  assert.equal(r.ok, true); assert.equal(r.runnable, false);
  assert.equal((await A.resolveFile('../Private/secret.txt', [shared])).ok, false);
  assert.equal((await A.resolveFile(path.join(outside, 'secret.txt'), [shared])).ok, false);
  assert.equal((await A.resolveFile('link.txt', [shared])).ok, false, 'a link pointing outside is refused');
  assert.equal((await A.resolveFile('run.command', [shared])).runnable, true);
  assert.equal((await A.resolveFile('Tool.app', [shared])).runnable, true);
  assert.equal((await A.resolveFile('x', [])).ok, false);
  const shell = { opened: [], revealed: [], openPath: async (p) => { shell.opened.push(p); return ''; }, showItemInFolder: (p) => shell.revealed.push(p), openExternal: async () => {} };
  const acts = A.makeActions({ shell, getConfig: () => ({ folders: [shared], apps: [] }) });
  r = await acts.openFile({ path: 'run.command' });
  assert.equal(r.revealed, true); assert.equal(shell.opened.length, 0, 'code is never opened, only revealed');
  r = await acts.openFile({ path: 'Supplier quote.pdf' });
  assert.equal(shell.opened.length, 1);
  const list = await acts.listFiles({ query: 'supplier' });
  assert.equal(list.files.length, 1); assert.match(list.files[0].path, /Supplier quote\.pdf$/);
});
test('actions call only the shell functions, and toast each one', async () => {
  const seen = [], toasts = [];
  const shell = { openExternal: async (u) => seen.push(['ext', u]), openPath: async (p) => { seen.push(['path', p]); return ''; }, showItemInFolder: () => {} };
  const acts = A.makeActions({ shell, toast: (t, b) => toasts.push(t), getConfig: () => ({ apps: [{ name: 'Notes', path: '/System/Applications/Notes.app' }], folders: [], searchEngine: 'google' }) });
  assert.equal((await acts.openUrl({ url: 'https://shopify.com/admin' })).ok, true);
  assert.equal((await acts.openUrl({ url: 'file:///Applications/Calculator.app' })).ok, false);
  assert.equal((await acts.openApp({ name: 'notes' })).ok, true);
  const no = await acts.openApp({ name: 'Terminal' });
  assert.equal(no.ok, false); assert.deepEqual(no.allowed, ['Notes']);
  assert.equal((await acts.searchWeb({ query: 'e-bike controller' })).ok, true);
  assert.deepEqual(seen.map((s) => s[0]), ['ext', 'path', 'ext']);
  assert.equal(toasts.length, 3);
});
