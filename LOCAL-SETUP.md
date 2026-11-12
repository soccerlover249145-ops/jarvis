# Setting up Jarvis on your Mac

## Quick install (about 5 minutes)

You need macOS 13 or later, Apple's command line tools (`xcode-select --install`, a click-through Apple dialog) and Node.js 20 or later (the LTS installer from https://nodejs.org). Then open Terminal and paste these two lines:

```bash
git clone -b desktop-app https://github.com/soccerlover249145-ops/jarvis.git ~/jarvis-mac && cd ~/jarvis-mac
```

```bash
bash install-mac.sh
```

It checks your Mac, installs the app's packages, runs the tests, builds the two Swift helpers and Jarvis.app, signs it for this Mac only (no Apple account needed), copies it to Applications, offers to add it to your Dock, and opens it. It never uses `sudo`, never asks for a key, and asks before replacing an older Jarvis.

**If macOS says Jarvis "can't be opened" or "can't be checked"** (the app is not signed with an Apple developer certificate): open Applications, right-click Jarvis, choose Open, then Open again. Or System Settings > Privacy & Security, scroll down, Open Anyway. You only do this once.

**Opening by itself:** Jarvis opens as a normal window each time you log in to your Mac (it says so once, the first time). Switch it off in Settings > Mac, "Open Jarvis when I log in", or from the menu bar orb, "Open at login".

**Updating later:** `cd ~/jarvis-mac && git pull && bash install-mac.sh`, then answer `y` to replace the old Jarvis.

### Permissions (once)

Open Jarvis's settings from the menu bar orb > Settings…, Mac section:

1. **Microphone** and **Speech Recognition**: macOS asks when Jarvis first listens. Click Allow on both.
2. **Screen Recording**: click Open System Settings next to it and switch Jarvis on. Let macOS quit and reopen Jarvis.
3. **Accessibility** (only for "do it on my computer" tasks): Open System Settings next to it, switch Jarvis on.
4. **Automation** (for reading Mail and writing drafts, and for Calendar/Reminders/Notes): the first time Jarvis reads your inbox, calendar, reminders or notes, macOS asks "Jarvis wants to control Mail / Calendar / Reminders / Notes". Click OK. You can see and change these later in System Settings > Privacy & Security > Automation.
5. **Calendars**, **Reminders**, **Contacts**: the first time Jarvis reads or adds one, macOS asks. Click Allow. (Also under Privacy & Security.)
6. **Full Disk Access** (optional): only if you want Jarvis to open or move files outside the folders you shared. System Settings > Privacy & Security > Full Disk Access > add Jarvis. Leave it off and Jarvis stays inside your shared folders.
7. **Claude key**: Brain > Claude key > Save key. It goes to the macOS Keychain, never to a file.
8. **Apps Jarvis may open** and **folders shared with Jarvis**: add them with Add an app… and Share a folder….
9. **When Jarvis does things**: every action asks you first in a macOS dialog you cannot fake or auto-click.
   - *Reads* (your inbox, calendar, reminders, notes, clipboard, selected text, a screen picture) ask once; tick "Always allow" to stop asking for that kind.
   - *Writes* (a draft, a calendar event, a reminder, a note, the clipboard) ask every time unless you always-allow that kind.
   - *Moving a file* or *putting a file in the Trash* always asks, every time. Trash means the Finder Trash — recoverable, never a hard delete.
   - *Tasks that use your mouse and keyboard* ("take control") always ask, keep the red Stop bar, and stop on Escape or a mouse move. Jarvis never sends, buys, books, calls or deletes without asking.

### What the app adds to Jarvis

- The main window shows the live Jarvis site (or the copy inside the app when you're offline; menu bar > "Show the live Jarvis site" switches).
- Jarvis can open web pages, your listed apps and files in your shared folders, and start **email drafts in your mail app**. You read the draft and press Send yourself; Jarvis never sends.
- "Do it on my computer" tasks: after you say yes, a red border and the bar **"Jarvis is using your computer"** show. Press **Esc** or **⌥Space**, or just move the mouse, to stop it at once. It asks before passwords, sending, buying, booking, posting, deleting or installing.
- "Hey Jarvis" works whenever the app is open, heard on this Mac.

## Step by step with Claude Code (alternative)

Open Terminal, go to this folder (the one this file is in), start Claude Code with `claude`, and paste everything in the box below. It builds Jarvis, installs it, and walks you through each permission. It asks before installing anything, and it never asks for your keys in the chat. You paste keys into Jarvis's own Settings.

---

```text
You're setting up "Jarvis for Mac" from the folder you're in (it has package.json, native/, src/, README.md and SECURITY.md). Read README.md and SECURITY.md first. Then do the steps below in order. Tell me in one short line what each step does before you run it, and stop and tell me plainly if a step fails.

Rules for this whole session:
- Ask me before installing anything (Xcode command line tools, Node.js, Homebrew or anything else), and before replacing anything already in /Applications. Don't use sudo unless I say yes to that exact command.
- Never ask me to paste an API key, token or password into this chat, and never write one to a file. I'll paste keys into Jarvis's own Settings window myself.
- Don't change Jarvis's source code to get past a failure. Show me the error and suggest the fix first.
- Don't turn off macOS security features (Gatekeeper, SIP, quarantine) with commands. I'll click Open myself.

1. Check what this Mac has. Run these and report the results in a short table: sw_vers -productVersion (needs 13 or later), uname -m, xcode-select -p, swiftc --version, node -v (needs 20 or later), npm -v. If something is missing or too old, tell me what's needed and ask before installing it. For the command line tools that's `xcode-select --install`, which opens an Apple dialog I click through. For Node.js, offer the installer from nodejs.org or Homebrew, whichever I prefer.

2. Install the app's packages: remove any node_modules folder that came with this folder (it may hold Linux files), then run `npm ci`.

3. Run the unit tests with `npm test`. All 55 should pass. If any fail, stop and show me which ones.

4. Build the two Swift helpers with `bash native/build.sh`. Then show that both exist and are signed: `ls -l native/bin` and `codesign -dv native/bin/JarvisEars native/bin/JarvisHands`. Also run this, which only asks whether input control is allowed and changes nothing: `echo '{"id":1,"op":"trusted"}' | native/bin/JarvisHands` (it should print a line with "trusted"). Don't run JarvisEars directly: macOS would ask for Terminal's microphone permission instead of Jarvis's.

5. Build the app with `npx electron-builder --mac --dir`. Find Jarvis.app in dist/ (dist/mac-arm64 on Apple silicon, dist/mac on Intel). Check that the helpers are inside it: `ls -l <path>/Jarvis.app/Contents/Resources/bin`. Then run `codesign --verify --deep --strict <path>/Jarvis.app`. If that fails, sign it locally with `codesign --force --deep --sign - <path>/Jarvis.app` and verify again.

6. Install it. If /Applications/Jarvis.app already exists, ask me first and quit any running Jarvis. Then run `ditto <path>/Jarvis.app /Applications/Jarvis.app` and open it with `open -a Jarvis`. If macOS says Jarvis can't be opened or checked, tell me to right-click Jarvis in Applications, choose Open, then Open again, or use System Settings > Privacy & Security > Open Anyway. Wait for me to say it's open. You should then see the orb icon in the menu bar.

7. Walk me through permissions one at a time, waiting for me after each:
   a. Microphone and Speech Recognition: macOS asks when Jarvis starts listening. I click Allow on both. If no prompt appears, have me open Jarvis's Settings (the slider icon), go to the Mac section, and click Open System Settings next to Microphone and speech.
   b. My Claude key: I paste it into Jarvis's Settings > Brain > Claude key and click Save key. To check it reached the Keychain, run `security find-generic-password -s com.jarvis.desktop -a anthropic`, which prints the item's details without the key. Never add -w. Then check no key is in Jarvis's files: `grep -rl "sk-ant-" ~/Library/Application\ Support/Jarvis 2>/dev/null` should print nothing. If I have an ElevenLabs voice key, I paste it under Voice the same way.
   c. Screen Recording: in Jarvis's Settings > Mac, I click Open System Settings next to Screen Recording and switch on Jarvis. macOS may say Jarvis must quit and reopen. I let it.
   d. Accessibility (only needed for take control): Settings > Mac > Open System Settings next to Accessibility, then switch on Jarvis.
   e. Have me pick the apps Jarvis may open and the folders it may see (Settings > Mac > Add an app…, Share a folder…).

8. First tests. I do each one and tell you what happened. You write down pass or fail:
   - Press Option+Space. The floating pill appears. Press Esc. It hides.
   - Say "hey Jarvis". The orb lights up and Jarvis answers. Say "go to sleep".
   - Type in the pill: "open youtube". The browser opens YouTube and a small notice appears.
   - Ask: "look at my screen and tell me which apps are open". Jarvis describes the screen.
   - Take control: click the cursor button in the pill and type "Open a new Safari window and go to apple.com". A dialog asks me first. I say yes, a red border shows, and it finishes and reports what it spent.
   - Stop test: start another take-control task ("In Safari, search for e-moto batteries and open the first three results in tabs") and press Esc partway. It stops at once and the border goes away.
   - Run `grep -rl "sk-ant-" ~/Library/Application\ Support/Jarvis 2>/dev/null` again. It should print nothing.

9. Finish with a short report: what passed, what failed with the exact error, and anything I still need to do. If listening, screen pictures or take control stopped working after a rebuild, the fix is in README.md under "After you rebuild Jarvis": remove Jarvis from that permission list and add it again.
```
