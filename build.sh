#!/usr/bin/env bash
# Build the Greasyfork userscript and a zip of the extension into dist/.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p dist

# Userscript = header + shared core + GM storage adapter
cat userscript/header.txt extension/core.js userscript/adapter.js \
  > dist/tabindex-editor.user.js
echo "built dist/tabindex-editor.user.js"

# Extension zip, for both stores. Nothing is generated, rewritten or combined:
# every file in it is the file in extension/, byte for byte. That keeps the
# answer to AMO's source-code questions a simple "no".
if command -v zip >/dev/null 2>&1; then
  rm -f dist/tabindex-editor-extension.zip
  (cd extension && zip -qr ../dist/tabindex-editor-extension.zip .)
  echo "built dist/tabindex-editor-extension.zip"
else
  echo "zip not found — skipped extension zip (load extension/ unpacked instead)"
fi
