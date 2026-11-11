#!/bin/bash
# install-mac.sh: build Jarvis for this Mac and put it in /Applications, in one go (about 5 minutes).
# It checks what it needs first and stops with a plain message if something is missing; it never uses sudo,
# never asks for a key, and asks before replacing a Jarvis already in /Applications.
set -euo pipefail
cd "$(dirname "$0")"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*"; exit 1; }

say "1/6  Checking this Mac"
[ "$(uname)" = "Darwin" ] || die "This builds the Mac app, so run it on a Mac."
MAJOR="$(sw_vers -productVersion | cut -d. -f1)"; [ "$MAJOR" -ge 13 ] || die "Jarvis needs macOS 13 (Ventura) or later."
xcode-select -p >/dev/null 2>&1 || die "Apple's command line tools are missing. Run: xcode-select --install   then run this again."
command -v swiftc >/dev/null || die "swiftc is missing. Run: xcode-select --install   then run this again."
command -v node >/dev/null || die "Node.js is missing. Install it from https://nodejs.org (the LTS button), then run this again."
NODEV="$(node -p 'process.versions.node.split(".")[0]')"; [ "$NODEV" -ge 20 ] || die "Node.js 20 or later is needed (you have $(node -v)). Install the LTS from https://nodejs.org."
echo "macOS $(sw_vers -productVersion), $(uname -m), Node $(node -v)"

say "2/6  Installing the app's packages"
rm -rf node_modules
npm ci --no-audit --no-fund

say "3/6  Running the unit tests"
npm test --silent >/tmp/jarvis-tests.txt 2>&1 || { tail -40 /tmp/jarvis-tests.txt; die "Some tests failed (above). Nothing was installed."; }
grep -E "^# (pass|fail)" /tmp/jarvis-tests.txt || true

say "4/6  Building the two Swift helpers (hearing and hands)"
bash native/build.sh

say "5/6  Building Jarvis.app"
npx --no-install electron-builder --mac --dir
APP="$(ls -d dist/mac*/Jarvis.app | head -1)"; [ -d "$APP" ] || die "The build did not produce Jarvis.app."
ls "$APP/Contents/Resources/bin" | grep -q JarvisEars || die "The helpers are missing from the app."
codesign --verify --deep --strict "$APP" 2>/dev/null || codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" || die "Signing Jarvis.app locally failed."

say "6/6  Installing to /Applications"
if [ -d /Applications/Jarvis.app ]; then
  read -r -p "Jarvis is already in Applications. Replace it? [y/N] " yn
  [ "${yn:-n}" = "y" ] || [ "${yn:-n}" = "Y" ] || die "Left the old Jarvis in place. The new one is at $APP."
  osascript -e 'tell application "Jarvis" to quit' >/dev/null 2>&1 || true; sleep 1
  rm -rf /Applications/Jarvis.app
fi
ditto "$APP" /Applications/Jarvis.app
open -a Jarvis || true

cat <<'DONE'

Jarvis is installed. If macOS says it "can't be opened" or "can't be checked": open the Applications folder,
right-click Jarvis, choose Open, then Open again (or System Settings > Privacy & Security > Open Anyway).

Now finish in Jarvis itself (see LOCAL-SETUP.md, "Permissions", for each step):
  1. Allow Microphone and Speech Recognition when asked.
  2. Settings > Brain: paste your Claude key (it goes to the Keychain, never to a file).
  3. Settings > Mac: switch on Screen Recording and Accessibility, add apps Jarvis may open, share folders.
DONE
