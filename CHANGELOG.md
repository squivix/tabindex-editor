# Changelog

## 0.3.1 — 2026-09-01

- Declare `data_collection_permissions: none` for Firefox, which
  addons.mozilla.org requires of new extensions — the extension collects
  nothing, and now says so in the manifest.
- `build.sh` also produces `dist/tabindex-editor-firefox.zip`, the same build
  without `background.service_worker`: Firefox ignores that key and the AMO
  linter flags it. See [docs/PUBLISHING.md](docs/PUBLISHING.md).

## 0.3.0 — 2026-09-01

- The first `Tab` press on a page with rules now goes to your first pick,
  instead of continuing from wherever the site put focus. Pages that focus
  their own search box on load (Google, among many) meant your order only
  started applying from whatever came after that box. The site's autofocus is
  left alone, so you can still just type. Typing, clicking or pressing
  `Shift+Tab` first hands control straight back, and every later `Tab` behaves
  normally.

## 0.2.1 — 2026-09-01

Fixes for rules landing on the wrong element after a page re-renders, found
while investigating a report of the order breaking on google.com.

- A stored selector is now checked against the picked element's fingerprint
  (tag and accessible label) before it is trusted. A tag match alone would
  accept a completely different link on a re-rendered page.
- When several elements match, a visible one that fingerprints wins. Numbering
  a hidden element used to silently drop that step from the sequence, because
  the browser skips it.
- Structural selectors are anchored at `body`. Without that, a path like
  `div:nth-of-type(2) > a:nth-of-type(1)` matched that shape anywhere in the
  document.
- Ids that look generated per page load (`ti6dpd`) are no longer treated as
  stable. Google's home page hands out exactly these and changes them on every
  visit.

## 0.2.0 — 2026-09-01

- The edit-mode panel can be moved: `M` cycles it through the four corners and
  its title bar drags it anywhere. It used to sit fixed in the top-right corner,
  hiding elements you might want to pick. Its position is remembered across
  sessions, separately from any site's rules.

## 0.1.0 — 2026-09-01

First working version.

- Per-page and per-site tab order overrides: number the elements you want first,
  skip the ones you never use, saved by origin and re-applied on every visit.
- Keyboard-first picker (`Alt+Shift+K`): `Tab`/arrows to move, `Enter` to
  number, `S` to skip, `P` for scope, `C` to clear, `Ctrl+Enter` to save, `Esc`
  to cancel. Mouse: click to number, `Shift+click` to skip.
- Overrides survive SPA re-renders and soft navigations, and are restored to the
  site's own attributes when cleared.
- Ships as an MV3 extension (Chrome/Edge/Firefox, with popup and toolbar icon)
  and as a Greasyfork userscript built from the same core.
- Test suite (`npm test`) and docs: [architecture](docs/ARCHITECTURE.md),
  [testing](docs/TESTING.md), [privacy](docs/PRIVACY.md).
