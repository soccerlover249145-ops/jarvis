'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { makeActions } = require('../src/main/actions');
const D = require('../src/main/desk');
const { clean } = require('../src/main/config');

function rig(opts) {
  opts = opts || {};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jvd-')), shared = path.join(root, 'Shared'), outside = path.join(root, 'Private');
  fs.mkdirSync(shared); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(shared, 'Plan.pdf'), 'x'); fs.writeFileSync(path.join(shared, 'go.command'), 'x'); fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  let conf = clean({ apps: [{ name: 'Notes', path: '/System/Applications/Notes.app' }], folders: [shared], alwaysAllow: opts.alwaysAllow || [] });
  const opened = [], external = [], asked = [];
  const shell = {
    openExternal: async function (u) { external.push(u); },
    openPath: async function (p) { opened.push(['open', p]); return ''; },
    showItemInFolder: function (p) { opened.push(['reveal', p]); }
  };
  const getConfig = function () { return conf; };
  const actions = makeActions({ shell: shell, getConfig: getConfig });
  const control = { running: false, started: [], start: async function (t, o) { this.started.push([t, o]); return { ok: true }; }, stop: function () { const was = this.running; this.running = false; return was; }, active: function () { return this.running; } };
  const desk = D.makeDesk({
    actions: actions, openExternal: shell.openExternal, control: control, getConfig: getConfig,
    setConfig: function (p) { conf = clean(Object.assign({}, conf, p)); },
    confirm: async function (q) { asked.push(q); return typeof opts.answer === 'function' ? opts.answer(q) : (opts.answer || { ok: false }); }
  });
  return { desk, opened, external, asked, control, shared, outside, conf: function () { return conf; } };
}

test('every action asks first, and a No opens nothing', async () => {
  const r = rig({ answer: { ok: false } });
  assert.equal((await r.desk.openUrl({ url: 'https://example.com' })).declined, true);
  assert.equal((await r.desk.openApp({ name: 'Notes' })).declined, true);
  assert.equal((await r.desk.openFile({ path: 'Plan.pdf' })).declined, true);
  assert.equal((await r.desk.revealFile({ path: 'Plan.pdf' })).declined, true);
  assert.equal((await r.desk.newEmailDraft({ to: 'someone@example.com', subject: 'Hi' })).declined, true);
  assert.equal(r.asked.length, 5);
  assert.deepEqual(r.opened, []); assert.deepEqual(r.external, []);
});

test('Allow opens it; "always allow" is remembered for that kind only', async () => {
  const r = rig({ answer: function (q) { return { ok: true, always: q.kind === 'openUrl' }; } });
  assert.equal((await r.desk.openUrl({ url: 'https://example.com/a' })).ok, true);
  assert.deepEqual(r.conf().alwaysAllow, ['openUrl']);
  await r.desk.openUrl({ url: 'https://example.com/b' });
  assert.equal(r.asked.length, 1, 'the second page opens without asking');
  await r.desk.openApp({ name: 'Notes' });
  assert.equal(r.asked.length, 2, 'apps still ask');
  assert.deepEqual(r.external, ['https://example.com/a', 'https://example.com/b']);
});

test('apps open only from the owner list; an unlisted app is refused without asking', async () => {
  const r = rig({ answer: { ok: true } });
  const t = await r.desk.openApp({ name: 'Terminal' });
  assert.equal(t.ok, false); assert.match(t.why, /not on your list/);
  assert.equal(r.asked.length, 0);
  assert.equal((await r.desk.openApp({ name: 'notes' })).ok, true);
  assert.deepEqual(r.opened, [['open', '/System/Applications/Notes.app']]);
});

test('files stay inside shared folders; runnable files are only revealed', async () => {
  const r = rig({ answer: { ok: true } });
  assert.equal((await r.desk.openFile({ path: '../Private/secret.txt' })).ok, false);
  assert.equal((await r.desk.openFile({ path: path.join(r.outside, 'secret.txt') })).ok, false);
  assert.equal((await r.desk.revealFile({ path: path.join(r.outside, 'secret.txt') })).ok, false);
  assert.equal(r.asked.length, 0, 'nothing outside is even offered');
  assert.equal((await r.desk.openFile({ path: 'Plan.pdf' })).ok, true);
  const g = await r.desk.openFile({ path: 'go.command' });
  assert.equal(g.revealed, true);
  assert.equal(r.asked[1].kind, 'revealFile');
  assert.equal(r.opened[0][0], 'open'); assert.equal(r.opened[1][0], 'reveal');
});

test('email: only a mailto draft, never sent; bad addresses and oversize refused', async () => {
  const r = rig({ answer: { ok: true } });
  const d = await r.desk.newEmailDraft({ to: 'a@example.com, b@example.org', cc: 'c@example.net', subject: 'Quote\nfollow-up', body: 'Hi there,\nThanks.' });
  assert.equal(d.ok, true); assert.equal(d.sent, false);
  assert.equal(r.external[0], 'mailto:a%40example.com,b%40example.org?cc=c%40example.net&subject=Quote%20follow-up&body=Hi%20there%2C%0AThanks.');
  assert.match(r.asked[0].detail, /Nothing is sent until you press Send/);
  for (const bad of ['not an address', 'x@y', 'a@example.com?bcc=evil@example.com', 'a@example.com\r\nbcc: x@example.com'])
    assert.equal(D.draftUrl({ to: bad, subject: 's' }).ok, false, bad);
  assert.equal(D.draftUrl({ to: 'a@example.com', body: 'x'.repeat(20001) }).ok, false);
  assert.equal(D.draftUrl({}).ok, false);
});

test('a task always goes through take control (its own dialog), never always-allowed', async () => {
  const r = rig({ alwaysAllow: ['openUrl', 'openApp', 'revealFile', 'openFile', 'emailDraft', 'runTask', 'everything'] });
  assert.deepEqual(r.conf().alwaysAllow, ['openUrl', 'openApp', 'revealFile', 'openFile', 'emailDraft'], 'unknown kinds and runTask are dropped');
  assert.equal((await r.desk.runTask({ text: '' })).ok, false);
  await r.desk.runTask({ text: 'Open my calendar and find a free hour on Friday' });
  assert.deepEqual(r.control.started[0], ['Open my calendar and find a free hour on Friday', { from: 'jarvis' }]);
});

test('Stop stops a running task', async () => {
  const r = rig();
  r.control.running = true;
  assert.equal(r.desk.capabilities().busy, true);
  assert.deepEqual(await r.desk.stop(), { ok: true });
  assert.equal(r.control.active(), false);
  assert.deepEqual(await r.desk.stop(), { ok: false }, 'nothing left to stop');
});

test('only the app and the live Jarvis page (top frame of the full window) may call jarvisDesk', () => {
  const base = { origin: 'app://jarvis', liveOrigin: 'https://jarvis.unwebbed.app' };
  const ok = function (o) { return D.senderAllowed(Object.assign({}, base, o)); };
  assert.equal(ok({ url: 'app://jarvis/index.html' }), true);
  assert.equal(ok({ url: 'https://jarvis.unwebbed.app/', live: true, isMainWindow: true, isTopFrame: true }), true);
  assert.equal(ok({ url: 'https://jarvis.unwebbed.app/', live: false, isMainWindow: true, isTopFrame: true }), false, 'not when showing the bundled copy');
  assert.equal(ok({ url: 'https://jarvis.unwebbed.app/', live: true, isMainWindow: true, isTopFrame: false }), false, 'not from an iframe');
  assert.equal(ok({ url: 'https://jarvis.unwebbed.app/', live: true, isMainWindow: false, isTopFrame: true }), false, 'not from another window');
  assert.equal(ok({ url: 'https://jarvis.unwebbed.app.evil.example/', live: true, isMainWindow: true, isTopFrame: true }), false);
  assert.equal(ok({ url: 'https://evil.example/', live: true, isMainWindow: true, isTopFrame: true }), false);
  assert.equal(ok({ url: '' }), false);
});

test('settings: source and always-allow are checked on the way in', () => {
  assert.equal(clean({}).source, 'live');
  assert.equal(clean({ source: 'bundled' }).source, 'bundled');
  assert.equal(clean({ source: 'https://evil.example' }).source, 'live');
  assert.deepEqual(clean({}).alwaysAllow, []);
  assert.deepEqual(clean({ alwaysAllow: 'openUrl' }).alwaysAllow, []);
});
