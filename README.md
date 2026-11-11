# Jarvis for Mac

Jarvis as a real Mac app. It's the same Jarvis you use on the web (same look, same brain, same wake phrases), plus things only an app can do:

- **Lives in the menu bar.** The orb icon sits at the top of the screen. Press **Option+Space** from anywhere to bring up a small floating pill, type or talk, and press Esc to hide it. The full window is one click away.
- **Always listening for "hey Jarvis".** Also "wake up, daddy's home", "Jarvis", and your own phrase. Apple's speech recognizer runs on the Mac itself, so your voice doesn't leave the Mac to become text. Typing always works too.
- **Opens things for you.** It can open websites, a Google search in a new tab, apps on your list, and files in folders you shared with it. Each action shows a small notice. It never deletes or sends anything.
- **Looks at your screen** when you ask ("look at my screen, what's wrong with this?"). It takes one picture and sends it to Claude with your question.
- **Takes control for one task** when you say yes. Jarvis uses your mouse and keyboard to do the task while a red border shows. Press **Esc**, press **Option+Space**, or move the mouse, and it stops at once. It asks you before passwords, sending, buying, booking, deleting or installing. It stays out of banking, password managers, System Settings and Terminal unless you allow that for the task. Every task has a step limit, a dollar limit and a time limit.
- **Keys go in the macOS Keychain.** They're never stored in a file, and each key goes only to its own service.

Questions and take-control use **Claude Opus 5.5**. Small talk uses Claude Haiku 5.5.

## Installing it

You don't need to do this by hand. Open **LOCAL-SETUP.md**, copy the prompt in it, and paste it into Claude Code on your Mac. It checks what's missing, asks before installing anything, builds the app, puts it in Applications, and walks you through each permission.

To do it yourself, you need macOS 13 or later, Apple's command line tools (`xcode-select --install`) and Node.js 20 or later. Then, in this folder:

```bash
npm ci
```

```bash
npm test
```

```bash
npm run build
```

The app is in `dist/mac-arm64/Jarvis.app` (or `dist/mac/` on an Intel Mac). Drag it to Applications.

### "Jarvis can't be opened"

This build is made on your Mac and isn't signed by an Apple developer account, so the first time macOS may say it can't check it. **Right-click Jarvis in Applications, choose Open, then Open again.** If there's no Open button, go to System Settings, Privacy & Security, scroll down and click **Open Anyway**. You only do this once per build.

## Permissions it asks for, and why

| Permission | Why | When |
|---|---|---|
| Microphone and Speech Recognition | To hear "hey Jarvis" and what you say next | When listening starts |
| Screen Recording | To look at your screen when you ask, and to see what it's doing while it has control | When you first ask it to look, or turn it on in Settings, Mac |
| Accessibility | Only for take control, to move the mouse and press keys | The first time you let it take control |

You can see and change all of these in Jarvis's **Settings, Mac** section, which also has your shortcut, the apps and folders Jarvis may open, and the take-control limits.

**After you rebuild Jarvis,** macOS may treat it as a new app. If take control or screen pictures stop working, open System Settings, Privacy & Security, select Jarvis in Accessibility (or Screen Recording), remove it with the minus button, and add it again.

## How it's built

- **Electron** runs the Jarvis web UI unchanged, served from inside the app (`app://jarvis/`). The main process handles the Mac: menu bar, shortcut, windows, Keychain, actions and take control.
- **JarvisEars** is a small Swift program that uses Apple's `SFSpeechRecognizer`, set to on-device recognition, and sends text over a pipe. The browser's own speech recognition doesn't work inside Electron, so this replaces it.
- **JarvisHands** is a small Swift program that moves the mouse and presses keys with Apple's `CGEvent` API. It runs only while Jarvis has control. Swift was chosen over an npm input library because both helpers then build with the same Apple tools, it needs no native Node modules that break on Electron updates, and it has no third-party code.
- **Take control** uses Claude's computer use toolset (`computer_toolset_20260801`) on Opus 5.5. Every action is checked against the app and window in front before it runs.
- **Keys:** the web UI asks for keys as it always has, but in the app it gets a stand-in. The real key is added to the request on its way out, and only to that key's own website. Details are in SECURITY.md.

```
src/main/        the Mac side: main.js, keychain, secrets, actions, screen, ears, config
src/main/control take control: agent loop, executor, guard, keys, the Swift helper client
src/preload/     the only bridge between the windows and the Mac
src/renderer/    the Jarvis web UI, plus desktop-shim.js, desktop-ears.js, desktop.js, desktop.css
src/compact/     the floating pill
src/overlay/     the red border and status pill during take control
native/          the two Swift helpers and build.sh
test/            unit tests (npm test) and the Electron smoke test (test/ui/run.js)
```

## What's not in this version

- Higgsfield picture sign-in (use Jarvis on the web for pictures for now).
- Take control works on the main display only.
- No auto-update. Rebuild to update.

## Signing (optional)

You only need this to give Jarvis to someone else without the right-click step. It needs a paid Apple Developer account.

1. In `package.json`, under `build.mac`, set `"identity"` to your "Developer ID Application" certificate name, set `"hardenedRuntime": true`, and add `"entitlements": "build/entitlements.mac.plist"`, `"entitlementsInherit": "build/entitlements.mac.plist"` and `"binaries": ["Contents/Resources/bin/JarvisEars", "Contents/Resources/bin/JarvisHands"]`.
2. Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` in your shell (never in a file in this folder), and add `"notarize": true` under `build.mac`.
3. Run `npm run dist`. electron-builder signs the app and both helpers, sends the build to Apple to notarize, and makes a DMG.
