'use strict';
/* desk.js: window.jarvisDesk, the door the Jarvis web page (live at https://jarvis.unwebbed.app, or the copy
   bundled in the app) uses to do things on this Mac.

   Version 1. The page feature-detects it: `if (window.jarvisDesk && jarvisDesk.version >= 1)`.

   What it can do, and nothing else:
   - openUrl(url)                 open an http(s) address in the default browser
   - openApp(name)                open an app from the owner's list (Settings, Mac, Apps Jarvis may open)
   - revealFile(path) / openFile  show or open a file inside a folder the owner shared (files that could run code
                                  are only ever shown in Finder)
   - newEmailDraft({to, cc, subject, body})   open the default mail app with a new draft. It is never sent:
                                  the owner reads it and presses Send in their mail app
   - runTask(text)                hand a task to "take control" (the computer-use agent) with the red border and
                                  the "Jarvis is using your computer" bar; the native dialog always asks first
   - stop()                       stop a running task at once
   - capabilities()               what is available, the owner's lists and which kinds are always allowed

   Every action that changes anything shows a native confirm dialog first (drawn by macOS, so the page cannot
   fake or click it), unless the owner ticked "Always allow" for that kind. runTask is never always-allowed.
   Inside a task, the agent still asks before passwords, sending, buying, booking, posting, deleting or
   installing (see control/guard.js). Nothing in this file sends, buys, posts, books or deletes anything. */

const KINDS = {
  openUrl: 'Open web pages',
  openApp: 'Open apps on my list',
  revealFile: 'Show files in Finder',
  openFile: 'Open files from my shared folders',
  emailDraft: 'Start email drafts in my mail app'
};
/* kinds the owner may set to "always allow"; a task (take control) is not one of them */
const ALWAYABLE = Object.keys(KINDS);

const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function list(v) {
  if (Array.isArray(v)) v = v.join(',');
  return String(v || '').split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

/** check and build a mailto: draft. Never sends; at most 20 recipients, 200-char subject, 20,000-char body */
function draftUrl(input) {
  input = input || {};
  const to = list(input.to), cc = list(input.cc);
  if (to.length + cc.length > 20) return { ok: false, why: 'Too many recipients for one draft.' };
  const bad = to.concat(cc).filter(function (a) { return !EMAIL.test(a); });
  if (bad.length) return { ok: false, why: 'That does not look like an email address: ' + bad[0].slice(0, 80) };
  const subject = String(input.subject || '').replace(/[\r\n]+/g, ' ').trim();
  const body = String(input.body || '').replace(/\r\n?/g, '\n');
  if (subject.length > 200) return { ok: false, why: 'The subject is too long.' };
  if (body.length > 20000) return { ok: false, why: 'The email is too long for a draft link. Copy it in instead.' };
  if (!to.length && !subject && !body) return { ok: false, why: 'Nothing to put in the draft.' };
  const q = [];
  if (cc.length) q.push('cc=' + cc.map(encodeURIComponent).join(','));
  if (subject) q.push('subject=' + encodeURIComponent(subject));
  if (body) q.push('body=' + encodeURIComponent(body));
  return { ok: true, url: 'mailto:' + to.map(encodeURIComponent).join(',') + (q.length ? '?' + q.join('&') : ''), to: to, cc: cc, subject: subject, chars: body.length };
}

/**
 * Who may call window.jarvisDesk: the app's own pages (app://jarvis/...), or the live Jarvis page, but only as
 * the top frame of the full window while it is showing the live site. Never an iframe, never another site.
 */
function senderAllowed(s) {
  s = s || {};
  const url = String(s.url || '');
  if (url.startsWith(s.origin + '/')) return true;
  return !!(s.live && s.isMainWindow && s.isTopFrame && url.startsWith(s.liveOrigin + '/'));
}

/**
 * deps: {
 *   actions: makeActions(...) result,
 *   openExternal(url): opens a mailto: link in the default mail app,
 *   control: { start(text, opts), stop(why), active() },
 *   confirm({ kind, title, detail, canAlways }) -> Promise<{ ok, always }>   native dialog, owner's click only,
 *   getConfig() -> { apps, folders, alwaysAllow }, setConfig(patch),
 *   toast(title, body)
 * }
 */
function makeDesk(deps) {
  const toast = deps.toast || function () {};
  function always(kind) { return (deps.getConfig().alwaysAllow || []).indexOf(kind) >= 0; }
  async function ask(kind, title, detail) {
    if (always(kind)) return true;
    const r = await deps.confirm({ kind: kind, title: title, detail: detail, canAlways: ALWAYABLE.indexOf(kind) >= 0, alwaysLabel: 'Always allow: ' + (KINDS[kind] || kind) });
    if (!r || !r.ok) return false;
    if (r.always && ALWAYABLE.indexOf(kind) >= 0) {
      const cur = deps.getConfig().alwaysAllow || [];
      if (cur.indexOf(kind) < 0) deps.setConfig({ alwaysAllow: cur.concat([kind]) });
    }
    return true;
  }
  const NO = { ok: false, declined: true, why: 'You did not allow it.' };

  return {
    version: 1,
    kinds: KINDS,

    capabilities() {
      const c = deps.getConfig();
      return {
        ok: true, version: 1, platform: 'darwin',
        can: ['openUrl', 'openApp', 'revealFile', 'openFile', 'newEmailDraft', 'runTask', 'stop'],
        apps: (c.apps || []).map(function (a) { return a.name; }),
        folders: (c.folders || []).length,
        alwaysAllow: (c.alwaysAllow || []).slice(),
        busy: !!(deps.control && deps.control.active())
      };
    },

    async openUrl(input) {
      const { cleanUrl } = require('./actions');
      const c = cleanUrl(input && input.url);
      if (!c.ok) return c;
      if (!(await ask('openUrl', 'Open this page?', c.url))) return NO;
      return deps.actions.openUrl({ url: c.url });
    },

    async openApp(input) {
      const { findApp } = require('./actions');
      const a = findApp(input && input.name, deps.getConfig().apps);
      if (!a) return deps.actions.openApp(input);       /* returns the "not on your list" answer, opens nothing */
      if (!(await ask('openApp', 'Open ' + a.name + '?', a.path))) return NO;
      return deps.actions.openApp({ name: a.name });
    },

    async revealFile(input) {
      const { resolveFile } = require('./actions');
      const r = await resolveFile(input && input.path, deps.getConfig().folders, deps.fs);
      if (!r.ok) return r;
      if (!(await ask('revealFile', 'Show this file in Finder?', r.path))) return NO;
      return deps.actions.openFile({ path: r.path, reveal: true });
    },

    async openFile(input) {
      const { resolveFile } = require('./actions');
      const r = await resolveFile(input && input.path, deps.getConfig().folders, deps.fs);
      if (!r.ok) return r;
      const kind = r.runnable ? 'revealFile' : 'openFile';
      if (!(await ask(kind, r.runnable ? 'This file could run code. Show it in Finder instead?' : 'Open this file?', r.path))) return NO;
      return deps.actions.openFile({ path: r.path, reveal: r.runnable });
    },

    async newEmailDraft(input) {
      const d = draftUrl(input);
      if (!d.ok) return d;
      const detail = 'To: ' + (d.to.join(', ') || '(nobody yet)') + (d.cc.length ? '\nCc: ' + d.cc.join(', ') : '') +
        '\nSubject: ' + (d.subject || '(none)') + '\n\nIt opens as a draft in your mail app. Nothing is sent until you press Send there.';
      if (!(await ask('emailDraft', 'Start this email draft?', detail))) return NO;
      await deps.openExternal(d.url);
      toast('Email draft opened', d.subject || (d.to[0] || ''));
      return { ok: true, drafted: true, sent: false };
    },

    async runTask(input) {
      const text = String(input && input.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
      if (!text) return { ok: false, why: 'No task given.' };
      /* take control always asks in its own native dialog (session.askStart); never "always allowed" */
      return deps.control.start(text, { from: 'jarvis' });
    },

    async stop() { return { ok: deps.control.stop('You chose Stop.') }; }
  };
}

module.exports = { makeDesk, draftUrl, senderAllowed, KINDS, ALWAYABLE, EMAIL };
