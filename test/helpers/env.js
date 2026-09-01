/*
 * Test environment for the shared core.
 *
 * core.js is written for a real browser, so each test gets a fresh jsdom page
 * with the core evaluated inside it, plus:
 *   - a memory storage adapter (the same contract the extension and the
 *     userscript adapters implement),
 *   - a fake layout, because jsdom does no layout and core.js filters
 *     candidates by getClientRects(),
 *   - small input helpers that dispatch real events, so the core's capture-phase
 *     listeners are exercised the way a browser would.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'core.js'), 'utf8');

export const ORIGIN = 'https://example.com';
export const PAGE_PATH = '/signup';
export const PAGE_URL = ORIGIN + PAGE_PATH;
export const ORIGIN_KEY = 'tie:' + ORIGIN;

/** A page with a deliberately hostile tab order, mirroring demo/harness.html. */
export const FORM_PAGE = `
  <nav id="nav">
    <a href="#a" id="nav-home">Home</a>
    <a href="#b" id="nav-pricing">Pricing</a>
  </nav>
  <div id="form-card">
    <button tabindex="1" id="cookie-btn">Accept cookies</button>
    <input type="email" id="email" name="email" placeholder="you@example.com">
    <button tabindex="2" id="submit-btn">Subscribe</button>
    <input type="text" id="name-field" name="fullname">
    <select id="country"><option>Portugal</option><option>Brazil</option></select>
    <input type="checkbox" id="tos">
  </div>
  <footer id="footer"><a href="#x" id="f-twitter">Twitter</a></footer>
`;

/** Storage adapter backed by a Map, with call counts and a dump() for assertions. */
export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(structuredClone(initial)));
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    async get(key) { calls.get++; const v = data.get(key); return v === undefined ? null : structuredClone(v); },
    async set(key, value) { calls.set++; data.set(key, structuredClone(value)); },
    async remove(key) { calls.remove++; data.delete(key); },
    calls,
    has: (key) => data.has(key),
    dump: () => Object.fromEntries([...data].map(([k, v]) => [k, structuredClone(v)])),
  };
}

/** A stored rule. `alt` is optional: without it, only the selector is tried. */
export function entry(sel, action = 'order', alt = null) {
  return alt ? { sel, idx: 0, action, alt } : { sel, idx: 0, action };
}

/** A full origin record, as the core writes it. */
export function originData({ pages = {}, site = null, ts = 1 } = {}) {
  return { v: 1, ts, site, pages };
}

// jsdom has no layout: every rect is 0x0 and getClientRects() is empty, which
// would make the core treat every element as invisible. Fake a vertical stack
// in document order so rects are distinct and stable.
function stubLayout(window) {
  const rectOf = (el) => {
    const order = [...el.ownerDocument.querySelectorAll('*')].indexOf(el);
    const top = Math.max(0, order) * 24;
    const r = { x: 8, y: top, left: 8, top, width: 120, height: 20, right: 128, bottom: top + 20 };
    r.toJSON = () => r;
    return r;
  };
  const hidden = (el) => {
    if (!el.isConnected || el.hidden) return true;
    const st = el.ownerDocument.defaultView.getComputedStyle(el);
    return st.display === 'none';
  };
  window.Element.prototype.getBoundingClientRect = function () {
    return hidden(this) ? { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, toJSON: () => ({}) } : rectOf(this);
  };
  window.Element.prototype.getClientRects = function () {
    return hidden(this) ? [] : [rectOf(this)];
  };
  // Not implemented by jsdom; the core calls it when moving the cursor.
  window.Element.prototype.scrollIntoView = function () {};
}

export function createPage({ html = FORM_PAGE, url = PAGE_URL, storage = memoryStorage() } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>test</title></head><body>${html}</body></html>`, {
    url, pretendToBeVisual: true, runScripts: 'outside-only',
  });
  const { window } = dom;
  stubLayout(window);
  window.eval(CORE_SRC);

  const env = {
    dom,
    window,
    document: window.document,
    storage,
    editor: window.__TabIndexEditorCore(storage),

    $: (sel) => window.document.querySelector(sel),
    tabindex(sel) {
      const el = env.$(sel);
      return el ? el.getAttribute('tabindex') : undefined;
    },
    /** { '#email': '1', ... } for the given selectors — the shape most assertions want. */
    tabindexMap(...sels) {
      const out = {};
      for (const s of sels) out[s] = env.tabindex(s);
      return out;
    },

    press(key, mods = {}) {
      const target = window.document.activeElement || window.document.body;
      const ev = new window.KeyboardEvent('keydown', {
        key, bubbles: true, cancelable: true, composed: true, ...mods,
      });
      target.dispatchEvent(ev);
      return ev;
    },
    /** Full press sequence, so the core's suppression of site clicks is exercised. */
    click(elOrSel, mods = {}) {
      const el = typeof elOrSel === 'string' ? env.$(elOrSel) : elOrSel;
      let click = null;
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        const ev = new window.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...mods });
        el.dispatchEvent(ev);
        if (type === 'click') click = ev;
      }
      return click;
    },

    /** Wait for the core's async work; 400ms clears its 300ms reapply debounce. */
    settle: (ms = 20) => new Promise((r) => setTimeout(r, ms)),
    navigate(pathname) { dom.reconfigure({ url: ORIGIN + pathname }); },
    saved: () => storage.dump()[ORIGIN_KEY] ?? null,
    close: () => window.close(),
  };
  return env;
}
