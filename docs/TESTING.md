# Testing

```bash
npm install   # jsdom, the only dependency, and only for tests
npm test
```

72 tests, about two seconds, no browser required. The suite runs on Node's
built-in test runner (`node --test`); there is no test framework to learn.

## How the core is tested

`core.js` is written for a browser, so [`test/helpers/env.js`](../test/helpers/env.js)
gives each test a fresh jsdom page with the real `core.js` evaluated inside it,
a memory storage adapter, and helpers that dispatch genuine events. Tests drive
the editor the way a person does — click, `Tab`, `Enter`, `Ctrl+Enter` — and
assert on the resulting DOM and on what was written to storage.

Two things are faked, and it is worth knowing which:

- **Layout.** jsdom does none, so every rect would be `0×0` and the core would
  treat every element as invisible. The helper installs a fake vertical stack
  in document order. Elements with `display: none` or `hidden` still report no
  rects, so visibility filtering is exercised.
  The panel gets a fixed 240×160 box placed by whichever edges the core
  anchored it to, which is what makes the drag arithmetic checkable.
- **Nothing else.** Shadow DOM, `MutationObserver`, event capture and
  `composedPath()` are jsdom's real implementations. The helper does keep a
  reference to the editor's closed shadow root as it is created — the page
  still cannot reach it, but assertions can.

| File | Covers |
|---|---|
| [`test/core.apply.test.js`](../test/core.apply.test.js) | applying stored rules, numbering, page-vs-site precedence, the fuzzy fallback, restoring the page's own attributes, `getStatus` |
| [`test/core.editmode.test.js`](../test/core.editmode.test.js) | picking with mouse and keyboard, every key in the keymap, save/cancel/clear, scope switching, click and key suppression, the overlay's isolation |
| [`test/core.panel.test.js`](../test/core.panel.test.js) | moving the panel by key and by drag, clamping, persistence, and that it stays out of the site records |
| [`test/core.selectors.test.js`](../test/core.selectors.test.js) | selector strategy and its priority order, quoting, re-resolution on a later visit, and that typed values never reach storage |
| [`test/core.firsttab.test.js`](../test/core.firsttab.test.js) | the first `Tab` landing on pick #1 despite a site's autofocus, and every way that interception is meant to stand down |
| [`test/core.observer.test.js`](../test/core.observer.test.js) | re-render survival, winning back a tabindex the site overwrites, soft navigation, staying idle during edit mode |
| [`test/extension.adapters.test.js`](../test/extension.adapters.test.js) | `storage.sync`/`local` merge and quota fallback, the message protocol, the background command relay |
| [`test/extension.popup.test.js`](../test/extension.popup.test.js) | what the popup renders for a page and what it sends back |
| [`test/userscript.adapter.test.js`](../test/userscript.adapter.test.js) | GM storage round-trip, corrupt data, both menu-command APIs |
| [`test/packaging.test.js`](../test/packaging.test.js) | manifest correctness, icon sizes, referenced files, version sync, `@grant` coverage, and that `build.sh` output parses |

Extension and userscript adapters are loaded into a `vm` context with a fake
`chrome`/`GM` API; the core is stubbed there, which conveniently captures the
storage adapter (it is the argument the core is constructed with).

## What the suite cannot tell you

jsdom implements no focus model and no browser chrome, so these still need a
human at a keyboard:

- that pressing `Tab` in a real browser actually visits the elements in the
  numbered order (the suite asserts the attributes, the browser owns the order),
- the extension loaded unpacked: popup rendering, the `Alt+Shift+K` command
  registration, `storage.sync` really syncing between profiles,
- behaviour on sites with a strict CSP, heavy SPAs, or their own global key
  handlers,
- the userscript under Tampermonkey/Violentmonkey/Greasemonkey.

### Manual check, ~5 minutes

1. `python3 -m http.server 8123` in the repo root and open
   <http://localhost:8123/demo/harness.html>. The page ships a deliberately bad
   tab order (cookie banner first, submit before the inputs).
2. `Alt+Shift+K`, number the fields in a sensible order, skip the cookie button,
   `Ctrl+Enter`.
3. Press `Tab` from the address bar: your order, then everything else.
4. *Simulate SPA re-render* → press `Tab` again; the order must survive.
5. Reload → still there. *Wipe saved rules* → the page's original bad order,
   including its own `tabindex="1"` and `"2"`, is back.
6. Repeat with the extension loaded unpacked on a real site, using the popup
   instead of the harness buttons.

> If you script the harness from a hidden or background tab, give the reapply
> step seconds rather than milliseconds: browsers throttle timers in pages that
> are not visible, so the core's 300 ms debounce can take a second or more (much
> longer once the tab has been hidden for a few minutes). A failed re-render
> check there usually means the timer never ran, not that the rules were lost.
