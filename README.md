# TabIndex Editor

[![CI](https://github.com/squivix/tabindex-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/squivix/tabindex-editor/actions/workflows/ci.yml)

Edit and override the keyboard tab order of any web page — pick elements, number
them in the order **you** want, skip the ones you never use, and the override is
saved per page (or per site) and reapplied automatically on every visit.
Browse the web mouse-free the way you like, not the way the site shipped it.

Ships in two forms from one shared core:

- **Browser extension** (Manifest V3, works in Chrome/Edge/Firefox) — [`extension/`](extension/)
- **Userscript** (Tampermonkey/Violentmonkey/Greasemonkey, Greasyfork-ready) — built to `dist/tabindex-editor.user.js`

Docs: [architecture](docs/ARCHITECTURE.md) · [testing](docs/TESTING.md) ·
[privacy](docs/PRIVACY.md) · [changelog](CHANGELOG.md)

## Install

### Extension (unpacked, for development)

- **Chrome / Edge**: open `chrome://extensions`, enable *Developer mode*, click
  *Load unpacked*, select the `extension/` folder.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, click
  *Load Temporary Add-on…*, pick `extension/manifest.json`.

For store submission, `./build.sh` produces `dist/tabindex-editor-extension.zip`.

> Note: the manifest declares both `background.service_worker` (Chrome) and
> `background.scripts` (Firefox); each browser uses its key and ignores the
> other. Requires roughly Chrome 121+ / Firefox 109+.

### Userscript

Run `./build.sh`, then open `dist/tabindex-editor.user.js` in a browser with
Tampermonkey/Violentmonkey installed (or paste it into a new script). This is
also the file to publish on Greasyfork.

## Usage

1. Press **Alt+Shift+K** on any page (or use the toolbar popup / userscript menu)
   to enter edit mode.
2. Mark elements, with the keyboard or the mouse:
   | Key | Action |
   |---|---|
   | `Tab` / arrows | move the cursor between focusable elements |
   | `Enter` / `Space` | give the cursor element the next number (again to unmark) |
   | `S` | skip the element entirely (removed from tab order) |
   | `P` | toggle save scope: this page ⟷ whole site |
   | `C` | clear all marks |
   | `M` | move the panel to the next corner (it also drags by its title bar) |
   | `Ctrl+Enter` / `Ctrl+S` | save and exit |
   | `Esc` | cancel without saving |

   With the mouse: **click** to number, **Shift+click** to skip.
3. Save. From then on, `Tab` on that page follows your order: numbered elements
   first (1, 2, 3…), skipped elements never, everything else in the page's
   natural order afterwards.

If the panel covers something you want to pick, press `M` to send it to the next
corner or drag it by its title bar; where you leave it is remembered.

Saving with zero marks clears the rules for that scope. The extension popup can
also clear page or site rules directly.

## How it works

- Marked elements get `tabindex="1..n"` (skipped ones `tabindex="-1"`). Positive
  tabindex values come first in browser focus order by spec, so your picks
  always win; unmarked elements follow in natural order.
- Each pick is stored as a CSS selector (preferring stable ids,
  `data-testid`, `name`, `aria-label` over brittle class chains) plus a
  tag + accessible-label fingerprint used as a fuzzy fallback when the site
  changes and the selector stops matching. Only element *identity* is saved —
  never what you typed into a field. Nothing leaves your browser; see
  [docs/PRIVACY.md](docs/PRIVACY.md).
- A debounced `MutationObserver` reapplies your overrides when the page
  re-renders (SPAs, roving-tabindex widgets) and detects soft navigations.
- Rules are keyed by origin; page rules (exact pathname) take precedence over
  site rules. The extension stores them in `storage.sync` (synced across your
  browsers) with `storage.local` as a quota fallback; the userscript uses
  `GM.setValue`.
- The editor UI lives in a closed shadow root with constructed stylesheets, so
  site CSS and CSP can't break it, and its own controls stay out of the page's
  tab order.

## Repo layout

```
extension/        the MV3 extension (loadable unpacked as-is)
  core.js         shared logic: picker UI, selectors, apply/observe (used by both builds)
  content.js      extension adapter (storage.sync + messaging)
  background.js   keyboard-command relay
  popup.*         toolbar popup
userscript/       header + GM-storage adapter for the Greasyfork build
test/             jsdom test suite (npm test)
docs/             architecture, testing, privacy
tools/            icon generator (pure-python PNG writer)
demo/harness.html test page: deliberately bad tab order + core loaded standalone
build.sh          builds dist/ (userscript + extension zip)
```

To try the demo without installing anything: serve the repo root
(`python3 -m http.server 8123`) and open `http://localhost:8123/demo/harness.html`.

## Development

```bash
npm install    # jsdom, used only by the tests
npm test       # 72 tests, ~2s, no browser needed
./build.sh     # dist/tabindex-editor.user.js + dist/tabindex-editor-extension.zip
```

The tests drive the real `core.js` inside a jsdom page — clicking, pressing
keys, re-rendering the DOM underneath it — and also check the manifest, the
popup, both storage adapters and the build output.
[docs/TESTING.md](docs/TESTING.md) explains what they cover, what they cannot
(real focus order, `storage.sync`, a browser's own key handling) and the short
manual pass that covers the rest.

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing
`core.js`; the interesting parts are element identity and the restore map.

### Cutting a release

1. Bump the version in `package.json`, `extension/manifest.json` and
   `userscript/header.txt` — the packaging test fails if they disagree.
2. Turn the `Unreleased` heading in [CHANGELOG.md](CHANGELOG.md) into the new
   version and date.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`.

The [release workflow](.github/workflows/release.yml) checks the tag matches the
version, runs the tests, builds, and publishes the release with both artifacts
attached and notes taken from the changelog entry. Every push and pull request
runs the suite on Node 22 and 24 via the [CI workflow](.github/workflows/ci.yml).

## Known limitations / roadmap

- Top frame only for now — elements inside iframes can't be picked.
- Only naturally-focusable elements are offered in the picker; adding
  arbitrary elements (e.g. a `div` you want focusable) is a planned option.
- Page rules match on exact pathname; pattern/prefix matching is a possible
  extension.
- Sites that aggressively rewrite `tabindex` every frame will fight the
  observer (it reapplies at most ~4×/second).
- A global on/off switch and an options page listing all saved sites would be
  nice to have.

## License

[MIT](LICENSE)
