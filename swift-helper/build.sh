#!/bin/bash
# Build the hoverhelper binary and copy it where the Electron app expects it.
set -euo pipefail
cd "$(dirname "$0")"

echo "▸ building hoverhelper (release)…"
swift build -c release

BIN=".build/release/hoverhelper"
DEST="../electron/resources"
mkdir -p "$DEST"
cp "$BIN" "$DEST/hoverhelper"
chmod +x "$DEST/hoverhelper"

echo "✓ built and copied to electron/resources/hoverhelper"
echo ""
echo "Phase 1 verification (run this yourself, needs the desktop apps):"
echo "  1. $BIN --check-permissions"
echo "  2. Grant Accessibility to your terminal in System Settings if NOT GRANTED"
echo "  3. $BIN            # then focus ChatGPT/Claude and hover over messages"
