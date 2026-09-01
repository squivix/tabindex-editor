# Architecture

One piece of logic, two ways to install it.

```
            extension/core.js          ← everything that actually does the work
                    │
      ┌─────────────┴─────────────┐
      │                           │
extension/content.js      userscript/adapter.js
  (chrome.storage)             (GM.setValue)
      │                           │
  MV3 extension            Greasyfork userscript
  (popup, command,          (menu command,
   background relay)         Alt+Shift+K)
```

`core.js` never touches an extension or userscript API. It is handed a storage
adapter and returns an editor object:

```js
const editor = __TabIndexEditorCore(storage);
editor.init();
```

### The storage contract

```js
{
  get(key)        // → Promise<value | null>
  set(key, value) // → Promise<void>   (value is a plain JSON-able object)
  remove(key)     // → Promise<void>
}
```

Three implementations exist: `chrome.storage.sync` with a `storage.local`
fallback (extension), `GM.getValue`/`setValue` with JSON strings (userscript),
and an in-memory map (tests). Anything that satisfies the contract works — a
`localStorage` version is what [`demo/harness.html`](../demo/harness.html) uses.

## Data model

One record per origin, under the key `tie:<origin>`:

```jsonc
{
  "v": 1,
  "ts": 1756713600000,          // last write; used to merge sync vs. local
  "site": null,                 // entries that apply to every path, or null
  "pages": {                    // entries per exact pathname
    "/signup": [
      {
        "sel": "#email",        // CSS selector, tried first
        "idx": 0,               // which match to take, if the selector is not unique
        "action": "order",      // "order" (number it) | "skip" (take it out)
        "alt": { "tag": "input", "label": "you@example.com" }  // fuzzy fallback
      }
    ]
  }
}
```

Panel placement is deliberately *not* part of this record. It is a preference
about the editor, not about any site, so it lives alone under `tie:ui` as
`{ v: 1, panel: { v, h, x, y } }` — the corner it is anchored to plus the offset
from those two edges, which keeps it in place across window resizes. Clearing a
site's rules leaves it untouched.

Page rules win over site rules; there is no merging between the two scopes.
Order in the array *is* the tab order. Deleting the last rule deletes the whole
record rather than leaving an empty husk behind.

## Applying rules

`reapply(entries)` walks the entries in order, resolves each to a live element,
and assigns `tabindex="1"`, `"2"`, … to `order` entries and `tabindex="-1"` to
`skip` entries. Entries that no longer resolve are simply skipped — numbering
stays contiguous.

Positive `tabindex` values are focused *before* every `tabindex="0"` and
naturally focusable element on the page, which is exactly the "my picks first,
then everything else in the page's own order" behaviour the tool promises. It is
terrible advice for building a website and perfect for overriding one.

Before writing, the element's original `tabindex` attribute (often `null`) is
recorded in `appliedOriginal`. That map is what makes *Clear rules*, cancelling
edit mode, and navigating away non-destructive: the page gets its own attributes
back byte for byte, including the traps it shipped with.

## Element identity

A stored selector has to survive a site's next deploy, so `buildSelector()`
prefers, in order:

1. `#id` — but only if the id looks human-written (`/^[A-Za-z][\w-]{0,63}$/` and
   no run of 3+ digits, which rejects `ember-4821`-style generated ids),
2. `tag[data-testid=…]`, `tag[name=…]`, `tag[aria-label=…]` — if unique,
3. a structural path (`#nearest-stable-id > div > li:nth-of-type(2) > a`), at
   most 8 segments, anchored at the closest ancestor with a stable id.

A selector is never trusted on its own. `resolveEntry()` checks each match
against the entry's fingerprint — same tag, same accessible label (`aria-label` / `placeholder` /
`title` / `alt` / text) — and prefers a match that is currently visible, since a
hidden element is skipped by the browser's focus order and would drop that step
out of your sequence. Only if nothing fingerprints does it search the page for
the tag and label anywhere. A text field's *value* is deliberately not part of
the label — only push-button inputs use their value — so nothing a user typed can
end up in storage.

## The first Tab press

Positive `tabindex` decides the *order* of the sequence, not where in it you
start: `Tab` always moves on from whatever currently has focus. Sites that
autofocus a field on load therefore drop you into the middle of your own order.

So while rules are applied, the first `Tab` on the page is intercepted once and
focus is moved to the element numbered 1. The site's autofocus is deliberately
left alone — it is usually what the user wants — and any other interaction
(typing, a pointer press, `Shift+Tab`, a modified `Tab`) disarms the
interception, on the principle that the moment a user directs focus themselves
the editor should stop steering. It re-arms whenever rules are applied afresh:
a load, a soft navigation, or leaving edit mode.

## Staying applied

A `MutationObserver` on `documentElement` (childList + `tabindex` attribute)
re-applies the rules 300 ms after the page settles, which covers SPA re-renders,
lazily inserted content, and widgets that manage their own roving tabindex. The
editor's own attribute writes are tracked in `selfWrites` so it never reacts to
itself. A pathname change (spotted by the observer, `popstate`, or `hashchange`)
re-reads storage, so page-scoped rules follow soft navigations.

## Edit mode

Entering edit mode first calls `restoreAll()`: you pick against the page's
natural order, not against your own previous override. Existing rules come back
as pre-loaded marks, so re-editing is additive.

The UI lives in a **closed shadow root** on a `<div data-tabindex-editor>` with
constructed stylesheets, so site CSS cannot restyle it, a site's CSP cannot
block it, and the page's own scripts cannot query it. Its controls are
`tabindex="-1"` and, being in a closed root, are invisible to the picker's own
candidate scan.

The panel would otherwise sit on top of whatever the site put in its top-right
corner, so it moves: `M` cycles it through the four corners, and its title bar
drags it anywhere, re-anchoring on release to whichever corner it landed nearest.
Offsets are clamped on both write and read, so neither a smaller screen nor a
window reporting a zero-sized viewport can strand it off-screen.

Badges and rings are positioned from a `requestAnimationFrame` loop against
`getBoundingClientRect()` rather than by wrapping elements, so nothing about the
page's layout changes while you edit.

All of `keydown`, `mousemove`, `pointerdown`, `mousedown`, `mouseup`, `click`,
`auxclick` and `dblclick` are taken in the **capture phase** and stopped with
`stopImmediatePropagation()`, so clicking a "Delete account" button to number it
cannot also press it. Keys the editor does not use (`x`, typing, etc.) pass
through untouched.

## Cross-browser notes

- The manifest carries both `background.service_worker` (Chrome) and
  `background.scripts` (Firefox); each browser reads its own key.
- Adapters resolve the API namespace as `globalThis.browser ?? globalThis.chrome`.
- `chrome.storage.sync` has a small per-item quota; writes that overflow fall
  back to `storage.local`, and reads take whichever copy has the newer `ts`.
- The userscript is `@noframes`, matching the core's top-frame-only support.

## Where to extend

- **Iframes**: the core assumes one document. Supporting frames means running it
  in every frame and keying rules by frame URL.
- **Non-focusable elements**: `computeCandidates()` only offers natively
  focusable elements; making a `div` focusable would mean storing an extra
  "force focusable" flag alongside the tabindex.
- **Path patterns**: `pages` is keyed by exact pathname. Prefix or glob matching
  would slot into `effectiveEntries()`.
