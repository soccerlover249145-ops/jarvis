'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/main/mac');
const D = require('../src/main/desk');
const { clean, ALWAYABLE } = require('../src/main/config');

/* a rig with fake osascript, clipboard, confirm, files, trash and screen */
function rig(opts) {
  opts = opts || {};
  let conf = clean({ folders: ['/Shared'], alwaysAllow: opts.alwaysAllow || [] });
  const asked = [], osaCalls = [], trashed = [], moved = [];
  const osa = async function (jxa) {
    osaCalls.push(jxa);
    if (opts.osaThrow) { const e = new Error(opts.osaThrow); throw e; }
    if (typeof opts.osa === 'function') return opts.osa(jxa);
    return opts.osaOut != null ? opts.osaOut : '[]';
  };
  const clip = { _t: opts.clip || '', readText: function () { return this._t; }, writeText: function (s) { this._t = s; } };
  const files = {
    resolveFile: async function (p) { return p && !/outside/.test(p) ? { ok: true, path: '/Shared/' + p } : { ok: false, why: 'outside' }; },
    resolveDir: async function (p) { return p && !/outside/.test(p) ? { ok: true, path: '/Shared/' + p } : { ok: false, why: 'outside' }; },
    listFiles: async function (a) { return { ok: true, files: [{ path: '/Shared/Plan.pdf', dir: false }] }; },
    move: async function (from, to) { moved.push([from, to]); return { ok: true }; }
  };
  const mac = M.makeMac({
    osa: osa, clipboard: clip, files: files,
    trashItem: async function (p) { trashed.push(p); },
    screenLook: async function () { return opts.screen || { ok: true, data: 'IMG', media_type: 'image/jpeg', width: 10, height: 10 }; },
    getConfig: function () { return conf; },
    setConfig: function (p) { conf = clean(Object.assign({}, conf, p)); },
    confirm: async function (q) { asked.push(q); return typeof opts.answer === 'function' ? opts.answer(q) : (opts.answer || { ok: false }); },
    toast: function () {}
  });
  return { mac: mac, asked: asked, osaCalls: osaCalls, trashed: trashed, moved: moved, conf: function () { return conf; }, clip: clip };
}

/* ---------- reads ---------- */

test('a read asks first, and a No reads nothing', async () => {
  const r = rig({ answer: { ok: false } });
  const m = await r.mac.readMail({});
  assert.equal(m.declined, true);
  assert.equal(r.osaCalls.length, 0, 'nothing was run on the Mac');
  assert.equal(r.asked.length, 1);
  assert.equal(r.asked[0].canAlways, true, 'a read can be set to always-allow');
});

test('reads parse and shape Mail/Calendar/Reminders/Notes', async () => {
  const data = {
    Mail: JSON.stringify([{ from: 'A <a@x.com>', subject: 'Hi', date: 'now', unread: true, preview: 'hello\nthere' }]),
    Calendar: JSON.stringify([{ title: 'Sync', start: 's', end: 'e', calendar: 'Work', location: 'Zoom' }]),
    Reminders: JSON.stringify([{ name: 'Buy filament', due: 'tue', list: 'Home' }]),
    Notes: JSON.stringify([{ name: 'Ideas', modified: 'y' }])
  };
  const r = rig({ answer: { ok: true }, osa: function (jxa) {
    if (/Application\('Mail'\)/.test(jxa)) return data.Mail;
    if (/Application\('Calendar'\)/.test(jxa)) return data.Calendar;
    if (/Application\('Reminders'\)/.test(jxa)) return data.Reminders;
    if (/Application\('Notes'\)/.test(jxa)) return data.Notes;
    return '[]';
  } });
  assert.equal((await r.mac.readMail({})).messages[0].subject, 'Hi');
  assert.equal((await r.mac.readMail({})).messages[0].preview, 'hello there', 'preview is one line');
  assert.equal((await r.mac.readCalendar({})).events[0].title, 'Sync');
  assert.equal((await r.mac.readReminders({})).reminders[0].name, 'Buy filament');
  assert.equal((await r.mac.readNotes({})).notes[0].name, 'Ideas');
});

test('"always allow" silences one read kind only', async () => {
  const r = rig({ answer: function (q) { return { ok: true, always: q.kind === 'readMail' }; } });
  await r.mac.readMail({});
  assert.deepEqual(r.conf().alwaysAllow, ['readMail']);
  await r.mac.readMail({});
  assert.equal(r.asked.length, 1, 'the second mail read does not ask');
  await r.mac.readCalendar({});
  assert.equal(r.asked.length, 2, 'the calendar still asks');
});

test('readClipboard returns the copied text, after asking', async () => {
  const r = rig({ answer: { ok: true }, clip: 'copied words' });
  const c = await r.mac.readClipboard();
  assert.equal(c.ok, true); assert.equal(c.text, 'copied words');
  assert.equal(r.asked.length, 1);
});

test('readSelection returns null safely when the app gives nothing (no key pressed, clipboard untouched)', async () => {
  const r = rig({ answer: { ok: true }, osaOut: 'null', clip: 'KEEP' });
  const s = await r.mac.readSelection();
  assert.equal(s.ok, true); assert.equal(s.text, '');
  assert.equal(r.clip.readText(), 'KEEP', 'the clipboard was not touched');
});

test('screenLook asks then hands back the picture', async () => {
  const r = rig({ answer: { ok: true } });
  const s = await r.mac.screenLook();
  assert.equal(s.ok, true); assert.equal(s.data, 'IMG');
  assert.equal(r.asked.length, 1);
});

/* ---------- writes ---------- */

test('writes ask every time and a No writes nothing', async () => {
  const r = rig({ answer: { ok: false } });
  assert.equal((await r.mac.addEvent({ title: 'X', start: '2026-01-01T10:00', end: '2026-01-01T11:00' })).declined, true);
  assert.equal((await r.mac.addReminder({ name: 'X' })).declined, true);
  assert.equal((await r.mac.appendNote({ name: 'N', text: 'hi' })).declined, true);
  assert.equal((await r.mac.setClipboard({ text: 'hi' })).declined, true);
  assert.equal(r.osaCalls.length, 0);
});

test('Allow runs the write', async () => {
  const r = rig({ answer: { ok: true }, osaOut: '{"ok":true,"calendar":"Work"}' });
  const e = await r.mac.addEvent({ title: 'Ride', start: '2026-01-01T10:00', end: '2026-01-01T11:00' });
  assert.equal(e.ok, true); assert.equal(e.added, true);
  assert.match(r.osaCalls[0], /Application\('Calendar'\)/);
});

test('addEvent refuses a bad date before asking anything', async () => {
  const r = rig({ answer: { ok: true } });
  const e = await r.mac.addEvent({ title: 'X', start: 'not-a-date', end: 'nope' });
  assert.equal(e.ok, false); assert.match(e.why, /valid start and end/);
  assert.equal(r.asked.length, 0); assert.equal(r.osaCalls.length, 0);
});

test('setClipboard writes only after Allow', async () => {
  const r = rig({ answer: { ok: true }, clip: 'old' });
  await r.mac.setClipboard({ text: 'new' });
  assert.equal(r.clip.readText(), 'new');
});

/* ---------- files always ask (never always-allowed) ---------- */

test('moveFile and trashFile ask even when other kinds are always-allowed', async () => {
  const r = rig({ answer: function (q) { return { ok: true, always: true }; }, alwaysAllow: ['addEvent'] });
  await r.mac.moveFile({ from: 'a.txt', to: 'Done' });
  assert.equal(r.asked.length, 1, 'move asked');
  assert.equal(r.asked[0].canAlways, false, 'move cannot be always-allowed');
  assert.deepEqual(r.moved, [['/Shared/a.txt', require('path').join('/Shared/Done', 'a.txt')]]);
  await r.mac.trashFile({ path: 'b.txt' });
  assert.equal(r.asked.length, 2); assert.equal(r.asked[1].canAlways, false);
  assert.deepEqual(r.trashed, ['/Shared/b.txt']);
});

test('moveFile refuses a source or dest outside the shared folders', async () => {
  const r = rig({ answer: { ok: true } });
  assert.equal((await r.mac.moveFile({ from: 'outside.txt', to: 'Done' })).ok, false);
  assert.equal((await r.mac.moveFile({ from: 'a.txt', to: 'outside' })).ok, false);
  assert.equal(r.moved.length, 0);
});

test('trashFile declined leaves the file; it moves to Trash (recoverable), never deletes', async () => {
  const r = rig({ answer: { ok: false } });
  assert.equal((await r.mac.trashFile({ path: 'b.txt' })).declined, true);
  assert.equal(r.trashed.length, 0);
});

/* ---------- permission + classification ---------- */

test('an unauthorized app gives a plain "allow it in System Settings" answer', async () => {
  const r = rig({ answer: { ok: true }, osaThrow: 'execution error: Not authorized to send Apple events (-1743)' });
  const m = await r.mac.readMail({});
  assert.equal(m.ok, false); assert.equal(m.permission, 'automation');
  assert.match(m.why, /System Settings/);
});

test('every read + non-destructive write kind is always-allowable; moveFile/trashFile are not', () => {
  ['readMail', 'readCalendar', 'readReminders', 'readNotes', 'listFolder', 'readClipboard', 'readSelection',
   'screenLook', 'addEvent', 'addReminder', 'appendNote', 'setClipboard'].forEach(function (k) {
    assert.ok(M.MAC_ALWAYABLE.indexOf(k) >= 0, k + ' should be always-allowable');
    assert.ok(ALWAYABLE.indexOf(k) >= 0, k + ' should survive config.clean');
  });
  assert.equal(M.MAC_ALWAYABLE.indexOf('moveFile'), -1);
  assert.equal(M.MAC_ALWAYABLE.indexOf('trashFile'), -1);
  assert.equal(ALWAYABLE.indexOf('trashFile'), -1, 'config.clean drops trashFile from always-allow');
});

test('script builders name the right app and escape quotes', () => {
  assert.match(M.SCRIPTS.readMail(5), /Application\('Mail'\)/);
  assert.match(M.SCRIPTS.addEvent({ title: "O'Brien", start: 's', end: 'e' }), /O\\'Brien/);
  assert.match(M.SCRIPTS.readNote("a'b"), /a\\'b/);
  assert.equal(M.jsStr("x'y\nz"), "'x\\'y z'");
});

/* ---------- desk v2 delegation ---------- */

function deskRig(withMac) {
  let conf = clean({ apps: [], folders: ['/Shared'], alwaysAllow: [] });
  const calls = [];
  const fakeMac = {}; ['readMail', 'readCalendar', 'readReminders', 'readNotes', 'listFolder', 'readClipboard',
    'readSelection', 'screenLook', 'addEvent', 'addReminder', 'appendNote', 'setClipboard', 'moveFile', 'trashFile']
    .forEach(function (n) { fakeMac[n] = async function (a) { calls.push([n, a]); return { ok: true, from: n }; }; });
  const desk = D.makeDesk({
    actions: { openUrl: async () => ({ ok: true }) }, mac: withMac ? fakeMac : undefined,
    control: { active: () => false, stop: () => true, start: async () => ({ ok: true }) },
    getConfig: () => conf, setConfig: (p) => { conf = Object.assign(conf, p); }, confirm: async () => ({ ok: false })
  });
  return { desk, calls };
}

test('desk v2 exposes the mac methods and delegates to deps.mac', async () => {
  const r = deskRig(true);
  assert.equal(r.desk.version, 2);
  assert.equal((await r.desk.readMail({ limit: 3 })).from, 'readMail');
  assert.deepEqual(r.calls[0], ['readMail', { limit: 3 }]);
  const cap = r.desk.capabilities();
  assert.equal(cap.version, 2);
  assert.ok(cap.can.indexOf('readMail') >= 0 && cap.can.indexOf('trashFile') >= 0);
});

test('without the mac module, the methods answer plainly and capabilities omits them', async () => {
  const r = deskRig(false);
  const m = await r.desk.readMail({});
  assert.equal(m.ok, false); assert.match(m.why, /newer Jarvis|Update/i);
  assert.equal(r.desk.capabilities().can.indexOf('readMail'), -1);
});
