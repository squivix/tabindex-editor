# Privacy

TabIndex Editor collects nothing, sends nothing, and has no server.

**What is stored.** Only the rules you create: for each site you edit, a list of
CSS selectors, whether each element is numbered or skipped, and a short label
(an element's `aria-label`, `placeholder`, `title`, `alt` or visible text) used
to find the element again if the site changes. Nothing you type into a page is
recorded — the contents of text, search and password fields are explicitly
excluded from those labels.

**Where it is stored.** In the browser's extension storage
(`chrome.storage.sync`, so your rules follow your browser profile across your own
devices; `storage.local` if sync is unavailable or full), or in your userscript
manager's storage for the Greasyfork build. There is no analytics, no telemetry,
no remote code, and no network request of any kind.

**Permissions.**

| Permission | Why |
|---|---|
| `storage` | to save your rules |
| `activeTab` | so the popup can talk to the tab you are looking at |
| content script on `<all_urls>` | the point of the extension is to work on any site you choose to edit; it only reads rules for the site you are on and does nothing until you press the shortcut |

**Deleting your data.** *Clear rules for this page* / *for this site* in the
popup removes them and restores the site's original tab order. Removing the
extension removes everything it stored.
