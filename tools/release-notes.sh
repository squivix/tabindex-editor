#!/usr/bin/env bash
# Print the release notes for a version: its CHANGELOG section, then how to
# install it. Fails if the changelog has nothing to say about that version,
# which is the usual thing to forget when tagging.
set -euo pipefail
version="${1:?usage: release-notes.sh <version>}"
cd "$(dirname "$0")/.."

section="$(awk -v ver="$version" '
  $0 ~ "^## " ver "( |$)" { grab = 1; next }
  grab && /^## / { exit }
  grab { print }
' CHANGELOG.md | sed -e '/./,$!d')"

if [ -z "${section// }" ]; then
  echo "no CHANGELOG.md section found for $version" >&2
  exit 1
fi

repo="https://github.com/squivix/tabindex-editor"
cat <<EOF
$section

## Install

**Userscript** — with Tampermonkey, Violentmonkey or Greasemonkey installed, click
[\`tabindex-editor.user.js\`]($repo/releases/download/v$version/tabindex-editor.user.js)
below and your manager will offer to install it. Existing installs update themselves from this release.

**Extension** — unpack \`tabindex-editor-extension.zip\`, then:
- Chrome / Edge: \`chrome://extensions\` → enable *Developer mode* → *Load unpacked* → pick the unpacked folder
- Firefox: \`about:debugging#/runtime/this-firefox\` → *Load Temporary Add-on…* → pick \`manifest.json\`

Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> on any page to start picking. Full keymap and docs in the [README]($repo#usage).
EOF
