# Test results

Run on 2026-11-11 in a Linux container (Node v22.23.4). The container has no macOS, Swift or Keychain, so the parts that need them are listed under "Not tested here".

## Unit tests: `npm test`

46 of 46 passed.

```
PASS only http and https addresses open, without passwords
PASS search opens the chosen engine with the words encoded
PASS apps open only from the owner list, matched by name
PASS files resolve only inside shared folders; links cannot escape
PASS actions call only the shell functions, and toast each one
PASS the request uses the computer toolset the way Opus 5.5 requires
PASS a batch runs in order; every tool_use gets one result echoing toolset_name; a picture is attached
PASS the batch stops at the first failure and the rest are reported as not run
PASS ask_owner asks the owner and has no toolset_name
PASS step, spend and time caps stop the task
PASS a refusal ends the task; stop() ends it at once
PASS cost uses Opus 5.5 prices
PASS a screenshot comes back as an image and sets the coordinate space
PASS clicks need a screenshot first, then map to screen points
PASS every member runs; unknown members fail
PASS the guard blocks actions in Terminal and asks before typing a card number
PASS ear lines are checked; junk is dropped
PASS ears start with on-device-only, forward words, restart after a crash, and stay off when blocked
PASS hands: one answer per request, user-input events, and stop fails what is waiting
PASS settings from disk are checked and cannot widen access
PASS a key is written over stdin as hex, never in argv, and read back
PASS unknown names are refused; empty, multi-line and huge values are refused
PASS a write the Keychain did not keep is reported as failed
PASS delete, missing items and which()
PASS xdotool key names become macOS key codes and flags
PASS terminals and script runners are always off limits, even when allowed
PASS banking, password managers and settings need the owner's say-so for the task
PASS shortcuts that lock, log out or empty the Trash are denied; deleting asks first
PASS typing cards, ID numbers, secrets, passwords and shell commands asks first
PASS wake phrases: the built-in ones, a custom one, and what was said after
PASS guard: the app address counts as its own secure address only inside the app
PASS the shim never stores a key in the window and hands new keys to the Keychain
PASS desktop ears: same shape as the browser ears, fed by the Swift helper
PASS pictures fit the image limits and keep the aspect
PASS clicks map from picture pixels to screen points and back
PASS zoom regions map to the full-resolution capture
PASS capture asks macOS for a picture of the display at picture size
PASS placeholders still fit the shapes the web UI checks
PASS the placeholder becomes the real key only on its own host over https
PASS no key ever goes to another host, over http, or in another header
PASS a real key typed in by the owner passes untouched; no key stored means no change
PASS input headers are not mutated; urls watched follow the relay
PASS nothing starts without a key, screen permission, the owner's yes, or Accessibility
PASS a full run: border, stop keys, then everything is given back
PASS Escape, the hotkey and touching the mouse each stop it
PASS a second task cannot start while one runs
```

## Electron smoke test: `xvfb-run -a node test/ui/run.js`

This launches the real app (Electron 45.1.0, the version pinned in package.json) under a virtual display and drives its windows with Playwright. A local https server stands in for api.anthropic.com and api.elevenlabs.io, so the test sees the exact headers that leave the app. The test uses an in-memory stand-in for the Keychain, which only a development run allows. 23 of 23 passed.

```
PASS full window loads from app://jarvis  (app://jarvis/index.html)
PASS the page knows it is the Mac app, at its own secure address  ({"desktop":true,"shared":false,"insecure":false,"earsDesktop":true,"bridge":"object","require":"undefined","process":"undefined"})
PASS ears come from the Swift helper bridge
PASS no Node in the page (only the bridge)
PASS a typed key is not kept in the page storage  ([])
PASS the page reads a placeholder, not the key  (sk-ant-api03-JARVIS-KEYCHAIN-PLACEHOLDER-not-a-key-0000000000)
PASS the key is nowhere in the app's files on disk
PASS the request to api.anthropic.com left with the Keychain key swapped in  (HTTP 401, server saw sk-ant-api03-TESTKEY-not-real-0123456789abcdef)
PASS the Claude key is not sent to another host (it gets the placeholder)  (sk-ant-api03-JARVIS-KEYCHAIN-PLACEHOLDER-not-a-key-0000000000)
PASS no request anywhere carried the key except to Anthropic
PASS Jarvis's brain gets the Mac tools  (open_website, search_in_browser, open_app, look_at_screen, take_control)
PASS opening a file:// address is refused over IPC  ({"ok":false,"why":"Only http and https addresses can be opened."})
PASS an app not on the list is refused  (That app is not on your list. Add it in Settings, Mac, Apps Jarvis may open.)
PASS look at the screen returns one JPEG picture  (1440x900)
PASS the look_at_screen tool hands Claude text plus an image block  (["text","image"])
PASS take control asks the owner first, and a no stops it  ({"ok":false,"why":"You did not allow it.","declined":true})
PASS with a yes but no input helper or Accessibility, it stops before touching anything  ({"ok":false,"why":"Allow Accessibility for Jarvis first (System Settings, Privacy & Security, Accessibility), then try again.","permission":"accessibility"})
PASS Settings has a Mac section with permissions, apps, folders and limits
PASS the key line says the key is in the Keychain  (A key is saved on this device: kept in the macOS Keychain. Small talk uses claude-haiku-5-5, real questions use claude-opus-5-5.)
PASS the compact pill window exists
PASS a question typed in the pill reaches Jarvis in the full window
PASS the overlay shows step, spend and the last action
PASS no script errors in the full window
```

Screenshots from that run are in `test/ui/shots/`: the pill, the pill in take-control mode, Settings > Mac, the full window and the take-control overlay.

## Not tested here (needs your Mac)

- **The Swift helpers.** I wrote them against Apple's Speech, AVFoundation, CoreGraphics and AppKit APIs and reviewed them by hand, but nobody has compiled them. LOCAL-SETUP step 4 compiles them, and any compile error shows up there.
- **Listening.** Apple's speech recognizer, on-device mode, the moment of silence that ends a phrase, and the microphone and speech permission prompts.
- **Input on a real Mac.** Clicks, typing (including non-English characters), shortcut flags, scroll direction (with natural scrolling on or off), and stopping when you move the mouse.
- **The global shortcuts.** Option+Space, and plain Escape registered as a stop key while Jarvis has control.
- **The overlay in screenshots.** It's marked to stay out of screen captures, but newer macOS may still show it in Claude's screenshots. The model is told to ignore it either way.
- **The real Keychain.** Writing through `security -i` with `-X` hex, reading back, the Jarvis.app signature, and permissions surviving a rebuild.
- **The API.** No request has gone to the Claude API, because no real keys were used. The request shape follows Anthropic's computer use docs for Opus 5.5. The unit tests check it, but a live call is the real test.
- **The build.** `electron-builder` packaging, ad-hoc signing with `identity: "-"`, and Gatekeeper's first-launch prompt.
