# Publishing to addons.mozilla.org

`./build.sh` produces **`dist/tabindex-editor-extension.zip`** — that is the
file to upload, and it goes to Chrome too. Every file inside it is the file in
`extension/`, byte for byte.

Check it before every submission:

```bash
./build.sh
npx web-ext lint --source-dir extension
```

Zero errors is the bar. Three warnings are expected and harmless:

- `BACKGROUND_SERVICE_WORKER_IGNORED` — the manifest carries both
  `background.service_worker` (Chrome) and `background.scripts` (Firefox). Each
  browser reads its own key and ignores the other. Stripping it for Firefox
  would make the submitted files differ from the source and trigger Mozilla's
  source-code submission requirement, which is a far worse trade.
- Two `KEY_FIREFOX_*_UNSUPPORTED_BY_MIN_VERSION` — `data_collection_permissions`
  needs Firefox 140 while we declare support back to 109. Older Firefox ignores
  keys it does not know, and the lower floor keeps people on older builds able
  to install. Raise `strict_min_version` to `"140.0"` if you would rather have a
  spotless report than that reach.

### The source-code questions

AMO asks whether you use code generators, minifiers, bundlers, template engines,
or anything else that processes files into what ships. The answer is **no** to
all of them, so no source upload is required. `build.sh` only zips a directory
and concatenates the (separate) userscript build; nothing that goes into the
extension is generated or rewritten. A packaging test enforces this by comparing
the manifest inside the zip against the one in the repository.

## What only you can do

Creating the account and holding the credentials is yours — I can prepare
everything else, but not sign in as you.

1. Sign in at <https://addons.mozilla.org/developers/> with a Mozilla account.
2. *Submit a New Add-on* → **On this site** (listed) → upload
   `dist/tabindex-editor-firefox.zip`.
3. Fill the listing with the copy below.
4. Submit for review. First reviews typically take a few days; there is nothing
   in this extension that usually triggers a long manual review — no minified or
   bundled code, no remote code, no data collection.

**Source code**: not required. Every file shipped is the file in this repo,
readable as-is. If asked, point reviewers at
<https://github.com/squivix/tabindex-editor> and `./build.sh`.

## Listing copy

**Name**: TabIndex Editor

**Summary** (250 char limit)

> Edit the keyboard tab order of any web page. Pick the elements you actually
> use, number them in the order you want, skip the ones you never touch — saved
> per page or per site and applied on every visit. Browse mouse-free your way.

**Category**: Tabs. AMO's Firefox extension categories have no Accessibility
entry, and nothing else in the list is closer — "Tabs" is about browser tabs
rather than the Tab key, but it is where people searching "tab" land. The honest
alternative is *My add-on doesn't fit into any of the categories*, which costs
all category browsing.

**Experimental**: no. It is tested and functional; the flag suppresses the
listing in search and recommendations.

**Support email**: leave blank — AMO publishes it. The support website below
satisfies the requirement on its own.

**Support website**: https://github.com/squivix/tabindex-editor/issues

**Description**

> Websites decide the order your Tab key moves through them, and they often get
> it wrong: cookie banners first, the submit button before the fields you have
> to fill, twenty footer links between you and the thing you came for.
>
> TabIndex Editor lets you decide instead. Press Alt+Shift+K on any page to
> enter edit mode, then pick the elements you actually use and number them in
> the order you want them. Skip the ones you never touch and they leave the tab
> order entirely. Save, and from then on Tab follows your order on that page —
> your picks first, then everything else in the page's own order.
>
> Everything is keyboard-driven, because that is the point:
>
> • Tab or the arrow keys move between elements
> • Enter numbers the one you are on, S skips it
> • P switches between saving for this page or the whole site
> • M moves the editor panel out of your way
> • Ctrl+Enter saves, Escape cancels
>
> A mouse works too: click to number, Shift+click to skip.
>
> Your order survives page reloads, single-page-app re-renders and soft
> navigations. Pages that focus their own search box on load no longer swallow
> your first Tab press — it goes to your first pick. Clearing your rules puts
> the site's original tab order back exactly as it was.
>
> No accounts, no servers, no telemetry. Your rules are stored in your browser
> and sync with your Firefox profile. Nothing you type on a page is ever
> recorded.
>
> Open source (MIT): https://github.com/squivix/tabindex-editor

**Support site**: https://github.com/squivix/tabindex-editor
**Support email**: your address — AMO requires one of the two
**Homepage**: https://github.com/squivix/tabindex-editor
**License**: MIT
**Privacy policy**: paste [docs/PRIVACY.md](PRIVACY.md); the short version is
that the extension collects nothing.

**Screenshots**: AMO shows these prominently and I cannot produce them. Two are
worth taking: edit mode on a page with badges visible over the numbered
elements, and the toolbar popup showing a page's rule counts.

## Later versions, automatically

Once the add-on exists on AMO, new versions can upload themselves. Generate API
credentials at *Developer Hub → Manage API Keys* and add them to the repository
as secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`
(`gh secret set AMO_JWT_ISSUER`). The [release
workflow](../.github/workflows/release.yml) picks them up and submits each
tagged version; without them that step is skipped and releases behave as before.

Note what that means: with those secrets set, pushing a tag publishes to AMO for
review. The first submission still has to go through the Developer Hub by hand,
because that is where the listing metadata lives.
