# window.jarvisDesk: the web page's door to the Mac (version 1)

When the Jarvis page runs inside the Jarvis Mac app (the live site at https://jarvis.unwebbed.app in the full
window, or the copy bundled in the app), it gets `window.jarvisDesk`. In any normal browser it is `undefined`,
so every use must feature-detect. Source: `src/main/desk.js` (rules), `src/preload/desk-preload.js` (the door).

## Detect

```js
var desk = window.jarvisDesk && window.jarvisDesk.version >= 1 ? window.jarvisDesk : null;
```

## Calls

Every call returns a Promise of a plain object. `ok: true` means it happened. `ok: false` comes with `why` (a
sentence to show the owner) and, when the owner clicked No, `declined: true`. Never retry a declined call.

| Call | Does | Asks first |
|---|---|---|
| `capabilities()` | `{ ok, version, platform, can: [...], apps: [names], folders: count, alwaysAllow: [kinds], busy }` | no (reads only) |
| `openUrl(url)` | opens an http(s) address in the default browser; no other schemes, no passwords in the address | yes, unless `openUrl` is always allowed |
| `openApp(name)` | opens an app by name from the owner's list; an app not on the list is refused (`why` says how to add it) and nothing is asked | yes, unless `openApp` is always allowed |
| `revealFile(path)` | shows a file in Finder; the path (relative to a shared folder, or absolute) must resolve inside a folder the owner shared, links followed | yes, unless `revealFile` is always allowed |
| `openFile(path)` | opens that file; a file that could run code is only ever revealed | yes, unless `openFile` (or `revealFile` for runnable files) is always allowed |
| `newEmailDraft({ to, cc, subject, body })` | opens the default mail app with a new draft. **Never sends.** `to`/`cc`: an address, a comma list or an array, 20 at most, checked; subject 200 chars, body 20,000 chars. Returns `{ ok, drafted: true, sent: false }` | yes, unless `emailDraft` is always allowed |
| `runTask(text)` | hands a task (2,000 chars) to take control, the computer-use agent. The red border and the bar "Jarvis is using your computer" show; Esc, the Jarvis shortcut or moving the mouse stops it. Inside the task it still asks before passwords, sending, buying, booking, posting, deleting or installing | **always**: a native dialog with the task, the caps and the stop keys; it can never be always-allowed |
| `stop()` | stops a running task at once; `{ ok: false }` if none was running | no |
| `onTaskDone(cb)` | `cb({ title, body })` when a task ends (done, stopped, capped or failed); returns an unsubscribe function | |
| `onHeard(cb)` | `cb({ text })` for each finished phrase the Mac's own hearing (JarvisEars, on device) picked up. Only with the live page. Treat it exactly like speech: run it through the wake-phrase check before acting | |

The dialogs are drawn by macOS, not the page, so a page cannot click or fake them. The page never sees the
owner's file paths beyond what it passed in, never gets a screen picture, and never touches the Keychain.

## Rules for the page

1. Only call these from something the owner asked for (a typed or spoken request, or a tap). Never on load,
   never from a model's reply alone without the owner's request in that turn.
2. Show the result in the conversation: "Opened Notes", "Draft is open in Mail, sir. Press Send when it reads
   right", or the `why`.
3. Email: Jarvis drafts, the owner sends. Say so every time. Do not claim an email was sent.
4. `runTask` is for "do it on my computer" jobs ("open my calendar and find a free hour on Friday", "fill in
   this form, don't submit"). Prefer the specific calls when one fits; they are faster and cheaper.
5. On a shared or plain-http address (`Kin.shared`), do not use `jarvisDesk` at all.

## Suggested shim (`desk.js` in the web app)

```js
(function () {
  'use strict';
  var Kin = window.Kin = window.Kin || {};
  var D = window.jarvisDesk && window.jarvisDesk.version >= 1 ? window.jarvisDesk : null;
  Kin.desk = {
    available: function () { return !!D && !Kin.shared; },
    caps: function () { return D ? D.capabilities() : Promise.resolve({ ok: false, why: 'Open Jarvis in the Mac app to do this.' }); },
    openUrl: function (u) { return D ? D.openUrl(u) : Promise.resolve({ ok: false, why: 'Mac app only.' }); },
    openApp: function (n) { return D ? D.openApp(n) : Promise.resolve({ ok: false, why: 'Mac app only.' }); },
    openFile: function (p) { return D ? D.openFile(p) : Promise.resolve({ ok: false, why: 'Mac app only.' }); },
    revealFile: function (p) { return D ? D.revealFile(p) : Promise.resolve({ ok: false, why: 'Mac app only.' }); },
    emailDraft: function (d) { return D ? D.newEmailDraft(d) : Promise.resolve({ ok: false, why: 'Mac app only.' }); },
    runTask: function (t) { return D ? D.runTask(t) : Promise.resolve({ ok: false, why: 'Mac app only.' }); },
    stop: function () { return D ? D.stop() : Promise.resolve({ ok: false }); }
  };
  if (D) { D.onHeard(function (d) { if (d && d.text && Kin.heard) Kin.heard(d.text); }); D.onTaskDone(function (d) { if (Kin.toast) Kin.toast(d); }); }
})();
```

In the brain, offer the matching tools (`open_url`, `open_app`, `open_file`, `email_draft`, `run_task`) only
when `Kin.desk.available()`; in a normal browser keep the current behaviour (open a tab, or a compose link the
owner clicks).
