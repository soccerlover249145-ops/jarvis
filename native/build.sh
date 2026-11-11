#!/bin/bash
# Builds the two Swift helpers into native/bin. Needs Apple's command line tools (xcode-select --install).
# Each helper is one Swift file; its Info.plist is embedded in the binary, so macOS can show the
# permission prompts with the reasons written there. The result is ad-hoc signed (no Apple account needed).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p bin
ARCH="$(uname -m)"                      # arm64 on Apple silicon, x86_64 on Intel
MIN="13.0"                              # macOS Ventura or later
for NAME in ears hands; do
  OUT="bin/Jarvis$(tr '[:lower:]' '[:upper:]' <<< ${NAME:0:1})${NAME:1}"
  echo "Building $OUT for $ARCH"
  swiftc -O -swift-version 5 -target "$ARCH-apple-macos$MIN" \
    -o "$OUT" "$NAME/main.swift" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$NAME/Info.plist"
  codesign --force --sign - --identifier "com.jarvis.desktop.$NAME" "$OUT"
done
echo "Built: $(ls bin)"
