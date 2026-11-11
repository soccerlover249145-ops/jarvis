'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/main/desk');
const { PLACEHOLDER } = require('../src/main/secrets');

const CLAUDE = 'sk-ant-api03-' + 'A'.repeat(40);
const ELEVEN = 'sk_' + 'ab12'.repeat(12);

function rig(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store || {}), asked = [], saved = [];
  const keychain = { get: async function (n) { return store[n] || null; }, set: async function (n, v) { store[n] = v; return { ok: opts.setFails ? false : true }; } };
  const keys = D.makeDeskKeys({ keychain: keychain, placeholders: PLACEHOLDER, onSaved: function (n, v) { saved.push([n, v]); },
    confirm: async function (q) { asked.push(q); return { ok: opts.answer !== false }; } });
  return { keys, store, asked, saved };
}
const base = { origin: 'app://jarvis', liveOrigin: 'https://jarvis.unwebbed.app', live: true, isMainWindow: true, isTopFrame: true };

test('keys: only the exact live origin or the app copy, top frame of the main window', () => {
  assert.equal(D.keysSenderAllowed(Object.assign({}, base, { url: 'https://jarvis.unwebbed.app/' })), true);
  assert.equal(D.keysSenderAllowed(Object.assign({}, base, { url: 'https://jarvis.unwebbed.app/index.html?x=1' })), true);
  assert.equal(D.keysSenderAllowed(Object.assign({}, base, { url: 'app://jarvis/index.html' })), true);
  for (const url of ['https://jarvis.unwebbed.app.evil.com/', 'https://evil.com/?https://jarvis.unwebbed.app/', 'http://jarvis.unwebbed.app/',
    'https://jarvis.unwebbed.app:8443/', 'https://x.jarvis.unwebbed.app/', 'https://user@jarvis.unwebbed.app.evil.com/', 'about:blank', '', 'not a url', 'file:///etc/passwd'])
    assert.equal(D.keysSenderAllowed(Object.assign({}, base, { url })), false, url);
  assert.equal(D.keysSenderAllowed(Object.assign({}, base, { url: 'https://jarvis.unwebbed.app/', isTopFrame: false })), false, 'iframe');
  assert.equal(D.keysSenderAllowed(Object.assign({}, base, { url: 'https://jarvis.unwebbed.app/', isMainWindow: false })), false, 'other window');
  assert.equal(D.keysSenderAllowed(Object.assign({}, base, { url: 'https://jarvis.unwebbed.app/', live: false })), false, 'live site not shown');
});

test('keys.get answers with placeholders only, never a real key', async () => {
  const r = rig({ store: { anthropic: CLAUDE } });
  const g = await r.keys.get();
  assert.equal(g.ok, true); assert.equal(g.placeholder, true);
  assert.equal(g.keys.claude, PLACEHOLDER.anthropic);
  assert.equal(g.keys.elevenlabs, null);
  assert.ok(!JSON.stringify(g).includes(CLAUDE));
});

test('saveFromPage checks the shape and refuses everything else', async () => {
  const r = rig();
  for (const [kind, v] of [['claude', 'hello'], ['claude', 'sk-ant-short'], ['claude', ELEVEN], ['elevenlabs', CLAUDE], ['elevenlabs', 'zz' + 'q'.repeat(40)],
    ['claude', CLAUDE + ' extra'], ['claude', 'sk-ant-api03-JARVIS-KEYCHAIN-PLACEHOLDER-x' + 'a'.repeat(10)], ['relay', 'x'.repeat(40)], ['anthropic', CLAUDE], ['claude', '']]) {
    const s = await r.keys.saveFromPage({ kind, value: v });
    assert.equal(s.ok, false, kind + ' ' + v);
    assert.ok(!JSON.stringify(s).includes(v) || !v, 'never echoes the value');
  }
  assert.equal(r.asked.length, 0); assert.deepEqual(r.store, {});
  assert.equal(D.keyShapeOk('elevenlabs', 'ab12'.repeat(8)), true);
  assert.equal(D.keyShapeOk('elevenlabs', ELEVEN), true);
  assert.equal(D.keyShapeOk('claude', CLAUDE), true);
});

test('saveFromPage asks first, stores, and hands back the placeholder', async () => {
  const r = rig();
  const s = await r.keys.saveFromPage({ kind: 'claude', value: CLAUDE });
  assert.equal(s.ok, true); assert.equal(s.placeholder, PLACEHOLDER.anthropic);
  assert.equal(r.asked.length, 1); assert.equal(r.store.anthropic, CLAUDE); assert.deepEqual(r.saved, [['anthropic', CLAUDE]]);
  assert.ok(!JSON.stringify(s).includes(CLAUDE));
  assert.ok(!JSON.stringify(r.asked).includes(CLAUDE), 'the dialog never shows the key');
  /* the same key again: nothing asked, nothing changed */
  assert.equal((await r.keys.saveFromPage({ kind: 'claude', value: CLAUDE })).unchanged, true);
  /* the placeholder written back: nothing asked */
  assert.equal((await r.keys.saveFromPage({ kind: 'claude', value: PLACEHOLDER.anthropic })).unchanged, true);
  assert.equal(r.asked.length, 1);
  /* a different key replaces only after asking again */
  const other = 'sk-ant-api03-' + 'B'.repeat(40);
  await r.keys.saveFromPage({ kind: 'claude', value: other });
  assert.equal(r.asked.length, 2); assert.match(r.asked[1].title, /Replace/);
});

test('saveFromPage: No stores nothing; a Keychain failure is reported without the key', async () => {
  const no = rig({ answer: false });
  const s = await no.keys.saveFromPage({ kind: 'elevenlabs', value: ELEVEN });
  assert.equal(s.ok, false); assert.equal(s.declined, true); assert.deepEqual(no.store, {}); assert.deepEqual(no.saved, []);
  const bad = rig({ setFails: true });
  const f = await bad.keys.saveFromPage({ kind: 'elevenlabs', value: ELEVEN });
  assert.equal(f.ok, false); assert.ok(!JSON.stringify(f).includes(ELEVEN)); assert.deepEqual(bad.saved, []);
});

test('keys are never logged', async () => {
  const lines = [], orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = function () { lines.push([].slice.call(arguments).join(' ')); };
  try {
    const r = rig({ store: { elevenlabs: ELEVEN } });
    await r.keys.get(); await r.keys.saveFromPage({ kind: 'claude', value: CLAUDE }); await r.keys.saveFromPage({ kind: 'claude', value: 'bad' });
  } finally { Object.assign(console, orig); }
  assert.ok(!lines.join('\n').includes(CLAUDE) && !lines.join('\n').includes(ELEVEN));
  /* and the source has no console call in the keys code */
  const src = require('fs').readFileSync(require.resolve('../src/main/desk.js'), 'utf8');
  assert.ok(!/console\./.test(src.slice(src.indexOf('KEY_KINDS'))));
});

test('preload exposes keys.get and keys.saveFromPage over the two fixed channels only', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'preload', 'desk-preload.js'), 'utf8');
  assert.match(src, /'desk:keys:get'/); assert.match(src, /'desk:keys:save'/);
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /keysHandle\('desk:keys:get'/); assert.match(main, /keysHandle\('desk:keys:save'/);
  assert.ok(!/deskHandle\('desk:keys/.test(main), 'keys use the stricter sender check');
});
