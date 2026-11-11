# Jarvis for Mac: security

Jarvis can hear you, see your screen and, when you allow it, use your mouse and keyboard. This file covers what protects you, how each protection works, and what it doesn't cover.

## The rules

1. **The model never gets a shell.** Claude can't run commands, scripts or AppleScript on the Mac. It can ask for a fixed list of actions, each one a function in `src/main/actions.js` that checks its input.
2. **Nothing is deleted or sent by the open actions.** They open web addresses (http and https only), open a web search, open apps on your list, and open or reveal files inside folders you picked. Every action shows a notice.
3. **Take control starts only after you say yes in a macOS dialog**, for one task. A red border shows the whole time. Esc, your Jarvis shortcut, or moving the mouse stops it immediately.
4. **It asks before consequential steps**: typing a password, sending, buying, booking, deleting, installing, agreeing to terms, changing settings.
5. **Some places are off limits.** Terminals and script runners are always blocked. Banking, payment, brokerage and crypto sites, password managers and System Settings are blocked unless you tick "Allow ... for this task only" when you approve the task.
6. **Keys live in the macOS Keychain**, never in a file, and each one is sent only to its own service.

## Keys

- **Where they are.** Generic password items in your login Keychain, service `com.jarvis.desktop`, accounts `anthropic`, `elevenlabs` and `relay`. To check one is there without showing it: `security find-generic-password -s com.jarvis.desktop -a anthropic`.
- **How they're written.** Jarvis runs Apple's `/usr/bin/security` tool and passes the key on stdin in hex (`-X`). The key never appears in the process list, and there's no quoting to get wrong (`src/main/keychain.js`).
- **The window never holds a stored key.** The Jarvis web UI reads its keys from browser storage. In the app, `desktop-shim.js` intercepts those reads and returns a placeholder. Writes go to the Keychain through the main process, and nothing is written to disk. When a request leaves the app, the main process replaces the placeholder with the real key, but only when all of these hold (`src/main/secrets.js`):
  - the request uses https,
  - the host is that key's own host (`api.anthropic.com`, `api.elevenlabs.io`, or the relay address you set),
  - the header is the one that key belongs in.

  Anywhere else, the placeholder stays a placeholder. The smoke test checks this against a local stand-in server.
- **One exception.** A key you type in during the current session stays in that window's memory until Jarvis quits, because the web UI keeps it in a variable after you save it. It's still not written to disk.
- **Old keys are migrated.** If an earlier build left a key in browser storage, the shim moves it into the Keychain and deletes it from storage on first launch.
- **Limit.** Items that `/usr/bin/security` creates can be read back by `security` without a prompt. Another program running as you could read them the same way. The Keychain protects against keys leaking through files, backups, sync and other user accounts. It doesn't protect against malware already running as you, and no app storage does.

## Listening

- JarvisEars uses Apple's `SFSpeechRecognizer` with `requiresOnDeviceRecognition` when the Mac supports it. **Keep speech on this Mac** is on by default: if the Mac can't recognize your language on device, listening stays off instead of falling back to Apple's servers.
- Only text leaves the helper. Wake, sleep and stop phrases are decided in the window. Nothing goes to Claude until you've woken Jarvis.
- The helper exits when Jarvis quits, because it reads its own stdin and stops when the pipe closes.

## Screen pictures

- A picture is taken only when you ask (the `look_at_screen` tool) or during take control. Each "look" shows a notice. Jarvis's own pill is hidden for the picture.
- Pictures go to Anthropic with the request and aren't saved on the Mac. Anything visible on screen, including private messages or account numbers, goes with the picture. Close what you don't want sent before you ask.

## Take control

What runs: Claude Opus 5.5 with the computer toolset, `src/main/control/agent.js`. The model asks for actions (click at x,y, type text, press keys, scroll, take a screenshot). `executor.js` maps them to screen points and sends them to **JarvisHands** (Swift, Apple's `CGEvent`). JarvisHands can only move the mouse, press keys, report the cursor and front window, and switch back to the app that was in front. It can't run commands or read files.

Protections, all in code and tested (`test/agent.test.js`, `test/executor.test.js`, `test/keys-guard.test.js`, `test/session.test.js`):

| Protection | Where |
|---|---|
| You approve each task in a native dialog. The model can't approve its own tasks. | `session.js` `askStart` |
| Red border and status pill (time, step, spend, last action) | `overlay/` |
| Esc, the Jarvis shortcut, or moving the mouse stops it. Jarvis mutes the Esc stop briefly when the model itself presses Esc. | `session.js`, JarvisHands mouse watch |
| Step cap (40), spend cap ($2), time cap (15 min), all changeable in Settings, Mac. Before each step it checks whether the next one could go over the spend cap. | `agent.js` |
| Before every action that touches the Mac, the app and window in front are checked. | `guard.js` `judge` |
| Terminals, iTerm, Warp, Script Editor, Automator and Shortcuts are always denied | `guard.js` `SHELLS` |
| Banking, payments, crypto, password managers, System Settings, Installer, Disk Utility and Activity Monitor are denied unless you allow them for the task | `guard.js` |
| Lock, log out and empty-the-Trash shortcuts are always denied. Delete and force-quit shortcuts ask first. | `guard.js` |
| Typing a card number (Luhn check), SSN, API key, password-like string or shell command asks first | `guard.js` `typingConcern` |
| The model is told to call `ask_owner` before passwords, send, buy, book, delete, install, agree or settings changes | `agent.js` system prompt and tool |
| Text on screen is information, not instructions (prompt injection warning in the prompt). Anthropic also scans screenshots for injections. | `agent.js` |
| The batch stops at the first failed or refused action. The rest are reported as not run. | `agent.js` |
| JarvisHands is killed when the task ends, whether done, stopped or failed, and anything held is released | `session.js`, `hands.js` |

**What these protections don't do.** Anthropic recommends running computer use in a separate virtual machine with no access to sensitive data. On your own Mac that can't hold. The protections above reduce the risk but don't remove it:

- **Detection is partial.** The guard recognizes banking and password pages by window title and app. A bank page with an unusual title, or a sensitive page in an app it doesn't know, can get past. Asking before consequential steps relies partly on the model calling `ask_owner`. The guard catches only the shortcut and typing patterns listed above.
- **Clicks aren't judged by what they do.** A click on a "Buy" button is judged only by which app and window are in front, not by the button. The model is told to ask first. Watch it, and keep tasks short.
- **Hidden instructions.** A web page or email can contain instructions meant for the model. The prompt and Anthropic's classifiers push back, but don't let it take control on pages you don't trust.
- **Stopping isn't instant.** It takes effect between actions. One action already sent to macOS, such as a keystroke, still happens.

Good habits: watch the first few tasks, give specific tasks ("in Safari, open shopify.com/admin/orders"), and keep the spend cap low.

## The windows

- The full window shows either the copy inside the app (`app://jarvis/`) or the live site `https://jarvis.unwebbed.app`. It can't navigate anywhere else; other links open in your browser through the open-URL check.
- The live site gets only `window.jarvisDesk` (desk-preload.js): no Keychain, no settings, no screen picture, no take-control internals. Its calls are accepted only from the top frame of the full window while it shows the live site. Every action asks first in a native macOS dialog (the page cannot click or fake it) unless you ticked "Always allow" for that kind; take control always asks. Email only opens a draft in your mail app; Jarvis never sends it. The live site may ask for the microphone (sound only); every other permission stays refused.
- Context isolation, sandbox and no Node in the page. The page can reach the Mac only through `preload.js`, a fixed list of messages, and the main process checks every argument again.
- Every IPC message is refused unless it comes from an `app://jarvis/` page.
- Permission requests from pages (camera, location and so on) are refused. The helpers do the hearing.
- The page's Content Security Policy is unchanged from the web version: its own scripts only, and connections only to the services it names.

## Settings file

`~/Library/Application Support/Jarvis/settings.json` holds the shortcut, apps, folders and limits. It holds no keys. It's checked on load, so a hand-edited file can't add a non-.app "app", share `/`, or raise a limit past its maximum.

## Reporting a problem

If Jarvis does something on the Mac you didn't approve, press Esc and quit it from the menu bar. The notice it showed at the end says how many steps it took and what it spent. To see more, start it from Terminal with `/Applications/Jarvis.app/Contents/MacOS/Jarvis` and repeat the task. Don't let it take control again until you know why.

## Keys for the live page (jarvisDesk.keys)

- The live page can ask which keys this Mac keeps (`keys.get()`) and hand over a key the owner pasted
  (`keys.saveFromPage()`). It never receives a real key: both answer with placeholders, swapped for the real key
  only on https requests to api.anthropic.com or api.elevenlabs.io (secrets.js).
- Only the top frame of the main window, at exactly `https://jarvis.unwebbed.app` or `app://jarvis/`, may call them.
- Adding or replacing a Keychain item always shows a native macOS dialog first. Shapes are checked
  (`sk-ant-…`, ElevenLabs hex with optional `sk_`); a refused value is never echoed or logged.
