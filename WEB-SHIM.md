# window.jarvisDesk: the web page's door to the Mac (versions 1 to 3)

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

| `keys.get()` | `{ ok, placeholder: true, keys: { claude, elevenlabs } }`: for each key this Mac's Keychain holds, a **stand-in** (placeholder) in the shape the page already accepts; `null` if none is kept. Never a real key | no (reads only which keys exist) |
| `keys.saveFromPage(kind, value)` | `kind` is `'claude'` or `'elevenlabs'`. Checks the shape (`sk-ant-…`; ElevenLabs hex, optionally `sk_`), stores the key in the Keychain and answers `{ ok, placeholder }`. Same key or the placeholder again: `{ ok, unchanged: true }`, nothing asked. A bad shape: `{ ok: false, why }`, nothing stored, the value never echoed | yes, whenever it would add or replace a Keychain item |

The dialogs are drawn by macOS, not the page, so a page cannot click or fake them. The page never sees the
owner's file paths beyond what it passed in, never gets a screen picture, and never sees a real key.

### Keys: paste once per Mac

`keys.*` answer only the top frame of the main window, and only when its exact origin is
`https://jarvis.unwebbed.app` (or the copy inside the app). Other sites, iframes and other windows are refused.

How the stand-ins work: the page stores a placeholder where it would store a key and sends it in its usual header
(`x-api-key` to api.anthropic.com, `xi-api-key` to api.elevenlabs.io). As the request leaves the app, the main
process swaps the placeholder for the real key from the Keychain, only on https to that key's own host. A
placeholder sent anywhere else stays a placeholder.

What the web app does:

```js
/* on load, inside the Mac app: fill empty key stores with the Keychain's stand-ins */
if (window.jarvisDesk && jarvisDesk.keys && !Kin.shared) {
  jarvisDesk.keys.get().then(function (r) {
    if (!r || !r.ok) return;
    if (r.keys.claude && !Kin.brain.hasKey()) Kin.brain.setKey(r.keys.claude);          /* placeholder, not the key */
    if (r.keys.elevenlabs && !Kin.voice.tts.hasKey()) Kin.voice.tts.setKey(r.keys.elevenlabs);
  }).catch(function () {});
}
/* when the owner pastes a key in Settings, hand it to the Keychain and keep only the stand-in */
function saveKey(kind, value) {            /* kind: 'claude' | 'elevenlabs' */
  if (!(window.jarvisDesk && jarvisDesk.keys) || Kin.shared) return Promise.resolve({ ok: false, local: true });
  return jarvisDesk.keys.saveFromPage(kind, value).then(function (r) {
    if (r && r.ok) return { ok: true, store: r.placeholder };   /* store this instead of the real key */
    return r;                                                  /* declined or bad shape: show r.why */
  });
}
```

Show the owner "Kept in your Mac's Keychain" next to a key that came from `keys.get()`. Removing a key in the
page removes only the stand-in; the Keychain copy is removed from the Mac settings (menu bar orb, Settings…).

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

## Version 2: macOS automation ("oomph")

`jarvisDesk.version >= 2` adds reliable control of the Mac's own apps through macOS Automation, far steadier
than driving the screen with the mouse. Two classes, enforced in the main process:

- **READ / LOOK** — ask once in a native dialog, then the owner can tick "Always allow" for that kind:
  `readMail({limit})`, `readCalendar({days})`, `readReminders({limit})`, `readNotes({name?,limit})`,
  `listFolder({query,limit})`, `readClipboard()`, `readSelection()`, `screenLook()`.
- **WRITE** — a native dialog **every time** unless the owner always-allows that kind:
  `addEvent({title,start,end,notes?,location?,calendar?})`, `addReminder({name,due?,list?,notes?})`,
  `appendNote({name,text})`, `setClipboard({text})`.
- **FILES — always ask** (never always-allowed), inside the owner's shared folders only:
  `moveFile({from,to})`, `trashFile({path})` (moves to the Finder Trash, never a hard delete).

Nothing here sends an email, posts, buys, books, calls or empties the Trash. `screenLook()` returns
`{ ok, data (base64 jpeg), media_type, width, height }` for the page's own Claude call; `readMail` etc. return
shaped, length-capped objects. An app the owner has not authorized yet returns `{ ok:false, permission:'automation', app, why }`.

### Matching Claude tools to offer when `Kin.desk.available()` and `caps().version >= 2`

| Tool | jarvisDesk call | Class |
|------|-----------------|-------|
| `read_mail` | `readMail` | read |
| `draft_mail` | `newEmailDraft` (v1) | write (never sends) |
| `read_calendar` | `readCalendar` | read |
| `add_event` | `addEvent` | write |
| `read_reminders` | `readReminders` | read |
| `add_reminder` | `addReminder` | write |
| `read_note` | `readNotes` | read |
| `append_note` | `appendNote` | write |
| `list_folder` | `listFolder` | read |
| `move_file` | `moveFile` | file (always asks) |
| `screen_look` | `screenLook` | look |
| `read_clipboard` | `readClipboard` | read |
| `read_selection` | `readSelection` | read |
| `set_clipboard` | `setClipboard` | write |

Add them to the brain only when `jarvisDesk` is present and `version >= 2`; in a normal browser keep the current
behaviour. The web app never needs to draw a confirm — macOS draws every dialog itself, and the page cannot
click it. `runTask` is unchanged (its own step/spend/time caps, Stop bar, and the `ask_owner` gate still apply).

## Version 3: hearing through the Mac, with its state, and the pill

Inside an Electron window the browser's own speech recognition (Web Speech) does not work: every session dies at once.
The live page must hear through the Mac's listener (JarvisEars, Apple's speech recognizer) instead. Version 1 and 2
pages get finished phrases on `onHeard`; `jarvisDesk.version >= 3` adds the listener's state and the words as they
come, and the floating pill:

| Call | Answer | Notes |
| --- | --- | --- |
| `ears.state()` | `{ state, reason, wanted, auto, onDevice }` | `state`: starting, listening, off, blocked; `reason` says why it is off or blocked (mic-denied, speech-denied, speech-not-allowed, speech-restricted, no-on-device, no-microphone, helper-missing, stalled, stopped); `auto`: the app listens from launch |
| `ears.start()` / `ears.stop()` | `{ ok, ... }` | only from something the owner did on the page (the mic button, "start listening") |
| `ears.hold(on)` | `{ ok }` | pauses the helper (not used by the page today) |
| `ears.onEvent(cb)` | `cb({ type: 'state', state, reason, onDevice })`, `cb({ type: 'partial', text })`, `cb({ type: 'final', text })` | every event of the helper; each final also arrives on `onHeard`, so a page reads one or the other, never both |
| `onAsk(cb)` | `cb({ text })` | what the owner typed in the floating pill, or a menu-bar item such as "Look at my screen…": ask it as if typed |
| `onMic(cb)` / `onSummon(cb)` | `cb({})` | the pill's mic button; the shortcut (wake Jarvis if asleep) |
| `ui.state({ state, caption, small, answered })` | `{ ok }` | the page tells the pill what Jarvis is doing; `state` is one of off, asleep, idle, listening, thinking, speaking; text is cut to 400 and 160 characters |

The main process answers every `desk:ears:*` and `desk:ui:state` call only from the full window's top frame on the
live address or the app's own pages (`deskHandle`). The page (mac.js in the web app) replaces `Kin.ears` with this
listener before app.js reads it, keeps the wake, sleep and stop phrases and every echo check of the browser path, and
never opens a microphone of its own. When macOS refuses (microphone or speech recognition not allowed, no on-device
recognizer), the menu bar says so, offers "Fix in System Settings…", and a notification gives the reason once.
