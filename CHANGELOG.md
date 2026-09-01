# Changelog

## 0.1.0 — unreleased

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
