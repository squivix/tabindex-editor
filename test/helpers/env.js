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

// The editor's UI lives in a *closed* shadow root, which is the point — the page
// cannot reach it. Tests can, by remembering the roots as they are created.
const shadowRoots = new WeakMap();

function captureShadowRoots(window) {
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function (init) {
    const root = attach.call(this, init);
    shadowRoots.set(this, root);
    return root;
  };
}

// jsdom has no layout: every rect is 0x0 and getClientRects() is empty, which
// would make the core treat every element as invisible. Fake a vertical stack
// in document order so rects are distinct and stable.
function stubLayout(window) {
  const box = (left, top, width, height) => {
    const r = { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
    r.toJSON = () => r;
    return r;
  };
  // The panel is `position: fixed` and sized by a stylesheet jsdom will not
  // apply, so give it a fixed box placed by whichever edges the core anchored
  // it to. That is what makes the drag arithmetic testable.
  const panelBox = (el) => {
    const num = (v) => (v && v !== 'auto' ? parseFloat(v) : null);
    const w = 240, h = 160;
    const right = num(el.style.right), bottom = num(el.style.bottom);
    const left = num(el.style.left) ?? (right === null ? 0 : window.innerWidth - right - w);
    const top = num(el.style.top) ?? (bottom === null ? 0 : window.innerHeight - bottom - h);
    return box(left, top, w, h);
  };
  const rectOf = (el) => {
    if (el.classList && el.classList.contains('panel')) return panelBox(el);
    const order = [...el.ownerDocument.querySelectorAll('*')].indexOf(el);
    return box(8, Math.max(0, order) * 24, 120, 20);
  };
  const hidden = (el) => {
    if (!el.isConnected || el.hidden) return true;
    const st = el.ownerDocument.defaultView.getComputedStyle(el);
    return st.display === 'none';
  };
  window.Element.prototype.getBoundingClientRect = function () {
    return hidden(this) ? box(0, 0, 0, 0) : rectOf(this);
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
  captureShadowRoots(window);
  stubLayout(window);
  window.eval(CORE_SRC);

  const env = {
    dom,
    window,
    document: window.document,
    storage,
    editor: window.__TabIndexEditorCore(storage),

    $: (sel) => window.document.querySelector(sel),
    /** The editor's own UI, reachable only through the test-side capture above. */
    shadow: () => shadowRoots.get(env.$('[data-tabindex-editor]')) ?? null,
    panel: () => env.shadow()?.querySelector('.panel') ?? null,
    /** Where the panel is pinned right now, as four CSS edge values. */
    panelEdges() {
      const { top, right, bottom, left } = env.panel().style;
      return { top, right, bottom, left };
    },
    drag(from, to) {
      const grip = env.panel().querySelector('h1');
      const at = (type, x, y) => grip.dispatchEvent(new window.MouseEvent(type, {
        bubbles: true, cancelable: true, composed: true, button: 0, clientX: x, clientY: y,
      }));
      at('pointerdown', from[0], from[1]);
      at('pointermove', to[0], to[1]);
      at('pointerup', to[0], to[1]);
    },
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
