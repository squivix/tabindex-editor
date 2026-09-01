#!/usr/bin/env bash
# Build the Greasyfork userscript and a zip of the extension into dist/.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p dist

# Userscript = header + shared core + GM storage adapter
cat userscript/header.txt extension/core.js userscript/adapter.js \
  > dist/tabindex-editor.user.js
echo "built dist/tabindex-editor.user.js"

# Extension zips. The Firefox build drops background.service_worker, which
# Firefox ignores anyway and the AMO linter flags; everything else is identical.
if command -v zip >/dev/null 2>&1; then
  rm -f dist/tabindex-editor-extension.zip dist/tabindex-editor-firefox.zip
  (cd extension && zip -qr ../dist/tabindex-editor-extension.zip .)
  echo "built dist/tabindex-editor-extension.zip"

  rm -rf dist/firefox
  cp -r extension dist/firefox
  node -e '
    const fs = require("fs"), p = "dist/firefox/manifest.json";
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    delete m.background.service_worker;
    fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  '
  (cd dist/firefox && zip -qr ../tabindex-editor-firefox.zip .)
  echo "built dist/tabindex-editor-firefox.zip (unpacked copy left in dist/firefox for web-ext)"
else
  echo "zip not found — skipped extension zips (load extension/ unpacked instead)"
fi
