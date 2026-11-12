'use strict';
/* mac.js: "computer oomph" — reliable control of the Mac's own apps through macOS Automation
   (osascript / JavaScript-for-Automation), far steadier than hunting the screen with the mouse.

   Everything here is split into two kinds:
   - READ / LOOK  — read the inbox, calendar, reminders, notes, a folder listing, the clipboard, the
                    selection, or a picture of the screen. Reading your data and handing it to the
                    cloud model is sensitive, so each read still asks once in a native dialog and can
                    then be set to "Always allow" for that kind.
   - WRITE        — create a draft, add an event or a reminder, append to a note, move a file, set the
                    clipboard. These show a native dialog EVERY time unless the owner ticks "Always
                    allow" for that kind. Moving a file and putting a file in the Trash are never
                    "always allowed": they ask every time.

   Nothing here sends an email, posts, buys, books, calls or empties the Trash. A draft is only ever a
   draft; "trash" moves a file to the Finder Trash (recoverable), never deletes it outright.

   All macOS access goes through an injected `osa(jxa)` runner (JavaScript for Automation). The first
   time each app is touched, macOS shows its own Automation / Calendars / Reminders / Contacts prompt;
   until the owner allows it, the call returns a plain "allow it in System Settings" answer.

   This module holds no Electron and no real osascript, so it is unit-tested with a fake `osa`,
   clipboard and confirm. main.js injects the real ones. */

const path = require('path');

/* ---- small helpers, all pure so they can be tested without a Mac ---- */

function clamp(n, lo, hi, dflt) {
  n = Math.floor(Number(n));
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
function oneLine(s, max) { return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max || 200); }
function text(s, max) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').slice(0, max || 20000); }

/* a JavaScript string -> a single-quoted JXA string literal, safe to drop into a script */
function jsStr(s) {
  return "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' ') + "'";
}

/* An Automation call to an app that the owner has not allowed yet fails with "Not authorized" /
   errAEEventNotPermitted (-1743). Turn that into a clear, non-scary answer rather than a raw error. */
function notAllowed(err, appLabel) {
  const m = String(err && err.message || err || '');
  if (/-1743|not authoriz|not permitted|osascript is not allowed|Application isn.t running|-600|-609/i.test(m)) {
    return { ok: false, permission: 'automation', app: appLabel,
      why: 'Jarvis needs permission to use ' + appLabel + '. Allow it in System Settings, Privacy & Security, Automation (and open ' + appLabel + ' once), then try again.' };
  }
  return null;
}

/* parse the JSON a read script prints; tolerate an empty result */
function parseList(out) {
  const s = String(out == null ? '' : out).trim();
  if (!s) return [];
  let v; try { v = JSON.parse(s); } catch (e) { return []; }
  return Array.isArray(v) ? v : (v == null ? [] : [v]);
}

/* ---- JXA script builders (pure; the tests assert on these) ---- */

const SCRIPTS = {
  readMail(limit) {
    limit = clamp(limit, 1, 40, 15);
    return "(() => { const M = Application('Mail'); const box = M.inbox; const ms = box.messages; " +
      "const n = Math.min(" + limit + ", ms.length); const out = []; " +
      "for (let i = 0; i < n; i++) { const m = ms[i]; try { out.push({ from: String(m.sender()), subject: String(m.subject()), " +
      "date: String(m.dateReceived()), unread: (m.readStatus() === false), preview: String(m.content()).replace(/\\s+/g,' ').slice(0,200) }); } catch (e) {} } " +
      "return JSON.stringify(out); })()";
  },
  readCalendar(days) {
    days = clamp(days, 1, 60, 7);
    return "(() => { const C = Application('Calendar'); const now = new Date(); const end = new Date(now.getTime() + " + days + " * 86400000); " +
      "const out = []; const cals = C.calendars(); for (let c = 0; c < cals.length; c++) { let evs; " +
      "try { evs = cals[c].events.whose({ _and: [ { startDate: { _greaterThan: now } }, { startDate: { _lessThan: end } } ] })(); } catch (e) { evs = []; } " +
      "for (let i = 0; i < evs.length && out.length < 100; i++) { const e = evs[i]; try { out.push({ title: String(e.summary()), " +
      "start: String(e.startDate()), end: String(e.endDate()), calendar: String(cals[c].name()), location: String(e.location() || '') }); } catch (x) {} } } " +
      "out.sort((a,b) => new Date(a.start) - new Date(b.start)); return JSON.stringify(out.slice(0, 50)); })()";
  },
  readReminders(limit) {
    limit = clamp(limit, 1, 100, 25);
    return "(() => { const R = Application('Reminders'); const rs = R.defaultList.reminders.whose({ completed: false })(); " +
      "const out = []; for (let i = 0; i < rs.length && out.length < " + limit + "; i++) { const r = rs[i]; " +
      "try { out.push({ name: String(r.name()), due: (r.dueDate() ? String(r.dueDate()) : null), list: String(R.defaultList.name()) }); } catch (e) {} } " +
      "return JSON.stringify(out); })()";
  },
  listNotes(limit) {
    limit = clamp(limit, 1, 60, 20);
    return "(() => { const N = Application('Notes'); const ns = N.notes(); const out = []; " +
      "for (let i = 0; i < ns.length && out.length < " + limit + "; i++) { const n = ns[i]; " +
      "try { out.push({ name: String(n.name()), modified: String(n.modificationDate()) }); } catch (e) {} } " +
      "return JSON.stringify(out); })()";
  },
  readNote(name) {
    return "(() => { const N = Application('Notes'); const ns = N.notes.whose({ name: " + jsStr(name) + " })(); " +
      "if (!ns.length) return JSON.stringify(null); const n = ns[0]; " +
      "return JSON.stringify({ name: String(n.name()), body: String(n.plaintext ? n.plaintext() : n.body()).slice(0, 20000) }); })()";
  },
  addEvent(ev) {
    return "(() => { const C = Application('Calendar'); const cals = C.calendars.whose({ name: " + jsStr(ev.calendar || '') + " })(); " +
      "const cal = (" + (ev.calendar ? 'cals.length ? cals[0] : ' : '') + "C.defaultCalendar ? C.defaultCalendar() : C.calendars()[0]); " +
      "const e = C.Event({ summary: " + jsStr(ev.title) + ", startDate: new Date(" + jsStr(ev.start) + "), endDate: new Date(" + jsStr(ev.end) + ")" +
      (ev.notes ? ", description: " + jsStr(ev.notes) : '') + (ev.location ? ", location: " + jsStr(ev.location) : '') + " }); " +
      "cal.events.push(e); return JSON.stringify({ ok: true, title: " + jsStr(ev.title) + ", calendar: String(cal.name()) }); })()";
  },
  addReminder(r) {
    return "(() => { const R = Application('Reminders'); const lists = R.lists.whose({ name: " + jsStr(r.list || '') + " })(); " +
      "const list = (" + (r.list ? 'lists.length ? lists[0] : ' : '') + "R.defaultList); " +
      "const props = { name: " + jsStr(r.name) + (r.due ? ", dueDate: new Date(" + jsStr(r.due) + ")" : '') + (r.notes ? ", body: " + jsStr(r.notes) : '') + " }; " +
      "const rem = R.Reminder(props); list.reminders.push(rem); return JSON.stringify({ ok: true, name: " + jsStr(r.name) + ", list: String(list.name()) }); })()";
  },
  appendNote(name, body) {
    return "(() => { const N = Application('Notes'); let ns = N.notes.whose({ name: " + jsStr(name) + " })(); let n; " +
      "if (ns.length) { n = ns[0]; n.body = String(n.body()) + '<br>' + " + jsStr(body) + "; } " +
      "else { n = N.Note({ name: " + jsStr(name) + ", body: " + jsStr(body) + " }); N.defaultAccount.notes.push(n); } " +
      "return JSON.stringify({ ok: true, name: " + jsStr(name) + " }); })()";
  },
  readSelection() {
    /* best-effort: the value of the focused UI element in the front app. Many apps expose it; some do
       not, and then this returns null rather than touching the clipboard or pressing any key. */
    return "(() => { try { const S = Application('System Events'); const p = S.applicationProcesses.whose({ frontmost: true })()[0]; " +
      "const el = p.windows[0].uiElements.whose({ focused: true })(); if (!el.length) return JSON.stringify(null); " +
      "const v = el[0].value(); return JSON.stringify(v == null ? null : String(v).slice(0, 10000)); } catch (e) { return JSON.stringify(null); } })()";
  }
};

/* validate a date-ish string the model supplies for an event/reminder */
function okDate(s) {
  if (!s) return false;
  const d = new Date(String(s));
  return !isNaN(d.getTime());
}

/* ---- the capability object ----
 * deps: {
 *   osa(jxa) -> Promise<string>            run a JXA script, resolve its stdout (throws on error)
 *   confirm({ kind, title, detail, canAlways, alwaysLabel }) -> Promise<{ ok, always }>
 *   getConfig() -> { folders, alwaysAllow, ... }, setConfig(patch)
 *   clipboard: { readText() -> string, writeText(s) }
 *   files: { resolveFile(p), listFiles(q), realpaths() }   folder-scoped file helpers (from actions.js)
 *   trashItem(path) -> Promise                              move a real path to the Finder Trash
 *   screenLook() -> Promise<{ ok, data, media_type, width, height }>   a picture of the screen
 *   toast(title, body)
 * }
 */
function makeMac(deps) {
  const toast = deps.toast || function () {};

  function always(kind) { return (deps.getConfig().alwaysAllow || []).indexOf(kind) >= 0; }
  async function ask(kind, canAlways, title, detail) {
    if (canAlways && always(kind)) return true;
    const r = await deps.confirm({ kind: kind, title: title, detail: detail, canAlways: canAlways, alwaysLabel: 'Always allow: ' + (KINDS[kind] || kind) });
    if (!r || !r.ok) return false;
    if (r.always && canAlways) {
      const cur = deps.getConfig().alwaysAllow || [];
      if (cur.indexOf(kind) < 0) deps.setConfig({ alwaysAllow: cur.concat([kind]) });
    }
    return true;
  }
  const NO = { ok: false, declined: true, why: 'You did not allow it.' };

  async function read(kind, title, detail, build, appLabel, shape) {
    if (!(await ask(kind, true, title, detail))) return NO;
    let out;
    try { out = await deps.osa(build); }
    catch (e) { return notAllowed(e, appLabel) || { ok: false, why: String(e && e.message || e).slice(0, 200) }; }
    return shape(out);
  }

  return {
    /* -------- READ / LOOK -------- */

    async readMail(input) {
      input = input || {};
      return read('readMail', 'Let Jarvis read your inbox?', 'It reads the newest messages (sender, subject, a short preview) and sends them to Claude to answer you.',
        SCRIPTS.readMail(input.limit), 'Mail', function (out) {
          return { ok: true, messages: parseList(out).map(function (m) { return { from: oneLine(m.from, 120), subject: oneLine(m.subject, 160), preview: oneLine(m.preview, 200), date: oneLine(m.date, 40), unread: !!m.unread }; }) };
        });
    },

    async readCalendar(input) {
      input = input || {};
      return read('readCalendar', 'Let Jarvis read your calendar?', 'It reads your events for the next ' + clamp(input.days, 1, 60, 7) + ' days.',
        SCRIPTS.readCalendar(input.days), 'Calendar', function (out) {
          return { ok: true, events: parseList(out).map(function (e) { return { title: oneLine(e.title, 160), start: oneLine(e.start, 40), end: oneLine(e.end, 40), calendar: oneLine(e.calendar, 60), location: oneLine(e.location, 120) }; }) };
        });
    },

    async readReminders(input) {
      input = input || {};
      return read('readReminders', 'Let Jarvis read your reminders?', 'It reads your open reminders.',
        SCRIPTS.readReminders(input.limit), 'Reminders', function (out) {
          return { ok: true, reminders: parseList(out).map(function (r) { return { name: oneLine(r.name, 200), due: r.due ? oneLine(r.due, 40) : null, list: oneLine(r.list, 60) }; }) };
        });
    },

    async readNotes(input) {
      input = input || {};
      const name = oneLine(input.name, 200);
      if (name) {
        return read('readNotes', 'Let Jarvis read this note?', 'It reads the note "' + name + '".',
          SCRIPTS.readNote(name), 'Notes', function (out) {
            const s = String(out || '').trim(); let v = null; try { v = JSON.parse(s); } catch (e) {}
            if (!v) return { ok: true, note: null, why: 'No note named "' + name + '".' };
            return { ok: true, note: { name: oneLine(v.name, 200), body: text(v.body, 20000) } };
          });
      }
      return read('readNotes', 'Let Jarvis list your notes?', 'It reads the names of your notes (not their contents).',
        SCRIPTS.listNotes(input.limit), 'Notes', function (out) {
          return { ok: true, notes: parseList(out).map(function (n) { return { name: oneLine(n.name, 200), modified: oneLine(n.modified, 40) }; }) };
        });
    },

    async listFolder(input) {
      input = input || {};
      if (!(await ask('listFolder', true, 'Let Jarvis list your shared folders?', 'It reads file and folder names (not contents) in the folders you shared.'))) return NO;
      const files = await deps.files.listFiles({ query: oneLine(input.query, 200), limit: clamp(input.limit, 1, 200, 60) });
      return { ok: true, files: (files && files.files) || [] };
    },

    async readClipboard() {
      if (!(await ask('readClipboard', true, 'Let Jarvis read the clipboard?', 'It reads whatever text you last copied.'))) return NO;
      let t = ''; try { t = deps.clipboard.readText() || ''; } catch (e) {}
      return { ok: true, text: text(t, 20000) };
    },

    async readSelection() {
      return read('readSelection', 'Let Jarvis read your selected text?', 'It reads the text highlighted in the app in front, if the app allows it.',
        SCRIPTS.readSelection(), 'the app in front', function (out) {
          const s = String(out || '').trim(); let v = null; try { v = JSON.parse(s); } catch (e) {}
          if (v == null) return { ok: true, text: '', why: 'The app in front did not give its selected text. Copy it and ask Jarvis to read the clipboard instead.' };
          return { ok: true, text: text(v, 10000) };
        });
    },

    async screenLook() {
      if (!(await ask('screenLook', true, 'Let Jarvis look at your screen?', 'It takes one picture of your screen and sends it to Claude with your question.'))) return NO;
      if (!deps.screenLook) return { ok: false, why: 'Looking at the screen is not available here.' };
      const s = await deps.screenLook();
      return s && s.ok ? s : (s || { ok: false, why: 'Could not take the picture.' });
    },

    /* -------- WRITE (ask every time unless always-allowed; files always ask) -------- */

    async draftMail(input) {
      /* a draft via the owner's mail app, never sent — handled by desk.newEmailDraft (mailto) */
      if (!deps.draftMail) return { ok: false, why: 'Email drafts are not available here.' };
      return deps.draftMail(input);
    },

    async addEvent(input) {
      input = input || {};
      const title = oneLine(input.title, 200);
      if (!title) return { ok: false, why: 'The event needs a title.' };
      if (!okDate(input.start) || !okDate(input.end)) return { ok: false, why: 'The event needs a valid start and end time.' };
      const detail = title + '\n' + oneLine(input.start, 40) + ' to ' + oneLine(input.end, 40) + (input.calendar ? '\nCalendar: ' + oneLine(input.calendar, 60) : '');
      if (!(await ask('addEvent', true, 'Add this event to your calendar?', detail))) return NO;
      try { const out = await deps.osa(SCRIPTS.addEvent({ title: title, start: input.start, end: input.end, notes: oneLine(input.notes, 2000), location: oneLine(input.location, 200), calendar: oneLine(input.calendar, 60) }));
        let v = {}; try { v = JSON.parse(String(out || '{}')); } catch (e) {} toast('Added to Calendar', title); return { ok: true, added: true, title: title, calendar: v.calendar }; }
      catch (e) { return notAllowed(e, 'Calendar') || { ok: false, why: String(e && e.message || e).slice(0, 200) }; }
    },

    async addReminder(input) {
      input = input || {};
      const name = oneLine(input.name, 200);
      if (!name) return { ok: false, why: 'The reminder needs a name.' };
      if (input.due && !okDate(input.due)) return { ok: false, why: 'That due date is not a valid time.' };
      const detail = name + (input.due ? '\nDue ' + oneLine(input.due, 40) : '') + (input.list ? '\nList: ' + oneLine(input.list, 60) : '');
      if (!(await ask('addReminder', true, 'Add this reminder?', detail))) return NO;
      try { const out = await deps.osa(SCRIPTS.addReminder({ name: name, due: input.due, list: oneLine(input.list, 60), notes: oneLine(input.notes, 2000) }));
        let v = {}; try { v = JSON.parse(String(out || '{}')); } catch (e) {} toast('Added a reminder', name); return { ok: true, added: true, name: name, list: v.list }; }
      catch (e) { return notAllowed(e, 'Reminders') || { ok: false, why: String(e && e.message || e).slice(0, 200) }; }
    },

    async appendNote(input) {
      input = input || {};
      const name = oneLine(input.name, 200), body = text(input.text, 20000);
      if (!name || !body) return { ok: false, why: 'A note needs a name and some text.' };
      if (!(await ask('appendNote', true, 'Write to your note?', 'Add to "' + name + '":\n\n' + oneLine(body, 300)))) return NO;
      try { await deps.osa(SCRIPTS.appendNote(name, body)); toast('Wrote to a note', name); return { ok: true, wrote: true, name: name }; }
      catch (e) { return notAllowed(e, 'Notes') || { ok: false, why: String(e && e.message || e).slice(0, 200) }; }
    },

    async setClipboard(input) {
      input = input || {};
      const t = text(input.text, 50000);
      if (!t) return { ok: false, why: 'Nothing to copy.' };
      if (!(await ask('setClipboard', true, 'Put this on your clipboard?', oneLine(t, 300)))) return NO;
      try { deps.clipboard.writeText(t); } catch (e) { return { ok: false, why: 'Could not set the clipboard.' }; }
      return { ok: true, copied: true, chars: t.length };
    },

    async moveFile(input) {
      input = input || {};
      /* both ends must land inside the owner's shared folders; file moves always ask (never always-allowed) */
      const from = await deps.files.resolveFile(oneLine(input.from, 2048));
      if (!from.ok) return from;
      const toRaw = oneLine(input.to, 2048);
      if (!toRaw) return { ok: false, why: 'No destination folder given.' };
      const dest = await deps.files.resolveDir(toRaw);
      if (!dest.ok) return dest;
      const target = path.join(dest.path, path.basename(from.path));
      if (!(await ask('moveFile', false, 'Move this file?', from.path + '\n→ ' + target))) return NO;
      try { await deps.files.move(from.path, target); toast('Moved', path.basename(from.path)); return { ok: true, moved: true, to: target }; }
      catch (e) { return { ok: false, why: 'Could not move it: ' + String(e && e.message || e).slice(0, 120) }; }
    },

    async trashFile(input) {
      input = input || {};
      const f = await deps.files.resolveFile(oneLine(input.path, 2048));
      if (!f.ok) return f;
      if (!(await ask('trashFile', false, 'Put this file in the Trash?', f.path + '\n\nIt goes to the Finder Trash, so you can get it back.'))) return NO;
      try { await deps.trashItem(f.path); toast('Moved to Trash', path.basename(f.path)); return { ok: true, trashed: true, path: f.path }; }
      catch (e) { return { ok: false, why: 'Could not move it to the Trash: ' + String(e && e.message || e).slice(0, 120) }; }
    }
  };
}

/* labels for the native dialog + the "Always allow" toggle; also the set config.clean accepts */
const KINDS = {
  readMail: 'Read my inbox', readCalendar: 'Read my calendar', readReminders: 'Read my reminders',
  readNotes: 'Read my notes', listFolder: 'List my shared folders', readClipboard: 'Read my clipboard',
  readSelection: 'Read my selected text', screenLook: 'Look at my screen',
  addEvent: 'Add calendar events', addReminder: 'Add reminders', appendNote: 'Write to my notes',
  setClipboard: 'Set my clipboard'
  /* moveFile and trashFile are deliberately NOT here: file moves and Trash always ask */
};
/* every kind above may be set to "Always allow"; moveFile/trashFile/runTask may not */
const MAC_ALWAYABLE = Object.keys(KINDS);

module.exports = { makeMac, SCRIPTS, KINDS, MAC_ALWAYABLE, jsStr, parseList, okDate, clamp, oneLine, notAllowed };
