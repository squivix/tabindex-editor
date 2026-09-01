/*
 * TabIndex Editor — shared core.
 * Runs as an extension content script or wrapped as a userscript.
 * The host environment supplies an async storage adapter:
 *   { get(key) -> Promise<value|null>, set(key, value) -> Promise, remove(key) -> Promise }
 * and calls: const editor = __TabIndexEditorCore(storage); editor.init();
 */
(() => {
  'use strict';

  const KEY_PREFIX = 'tie:';
  const FOCUSABLE_SELECTOR = [
    'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea',
    'summary', 'iframe', 'audio[controls]', 'video[controls]', '[tabindex]',
    '[contenteditable=""]', '[contenteditable="true"]', '[contenteditable="plaintext-only"]',
  ].join(', ');

  function createTabIndexEditor(storage) {
    // ---- persistent state -------------------------------------------------
    let dataCache = null;        // { v, ts, site: entries|null, pages: { [path]: entries } }
    let currentEntries = null;   // entries applied right now
    let lastPath = location.pathname;
    const appliedOriginal = new Map(); // el -> original tabindex attr (string|null)
    const selfWrites = new Set();
    let observer = null;
    let reapplyTimer = null;

    // ---- edit-mode state --------------------------------------------------
    let editing = false;
    let scope = 'page';          // 'page' | 'site'
    let marks = [];              // [{ el, action: 'order'|'skip' }] in pick order
    let candidates = [];
    let candidateSet = new Set();
    let cursorIndex = 0;
    let hoveredEl = null;
    let rafId = 0;

    // ---- UI handles -------------------------------------------------------
    let host = null, shadow = null, panel = null, badgeLayer = null;
    let cursorRing = null, hoverRing = null;
    let badgeEls = [];           // parallel to marks
    let countsEl = null, scopeInputs = null;

    // ======================================================================
    // Storage
    // ======================================================================
    const originKey = () => KEY_PREFIX + location.origin;
    const pageKey = () => location.pathname;

    async function loadOriginData() {
      const data = await storage.get(originKey());
      dataCache = (data && typeof data === 'object')
        ? { v: 1, ts: data.ts || 0, site: data.site || null, pages: data.pages || {} }
        : { v: 1, ts: 0, site: null, pages: {} };
      return dataCache;
    }

    async function saveOriginData() {
      dataCache.ts = Date.now();
      const empty = !dataCache.site && Object.keys(dataCache.pages).length === 0;
      if (empty) await storage.remove(originKey());
      else await storage.set(originKey(), dataCache);
    }

    function effectiveEntries(data) {
      return data.pages[pageKey()] || data.site || null;
    }

    // ======================================================================
    // Selector generation & resolution
    // ======================================================================
    const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1');
    const escAttr = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    function stableId(id) {
      return /^[A-Za-z][\w-]{0,63}$/.test(id) && !/\d{3,}/.test(id);
    }

    // A short human-readable label, used as the fuzzy fallback fingerprint.
    // An input's value only counts for push-button inputs — never for text or
    // password fields, whose contents must not end up in storage.
    const VALUE_AS_LABEL = new Set(['button', 'submit', 'reset']);

    function labelOf(el) {
      const t = el.getAttribute('aria-label') || el.getAttribute('placeholder')
        || el.getAttribute('title') || el.getAttribute('alt')
        || (el.localName === 'input' && VALUE_AS_LABEL.has(el.type) && el.value)
        || el.textContent || '';
      return String(t).trim().replace(/\s+/g, ' ').slice(0, 60);
    }

    function uniqueSel(sel) {
      try { return document.querySelectorAll(sel).length === 1 ? sel : null; }
      catch { return null; }
    }

    function buildSelector(el) {
      const tag = el.localName;
      if (el.id && stableId(el.id)) {
        const s = uniqueSel('#' + esc(el.id));
        if (s) return { sel: s, idx: 0 };
      }
      for (const attr of ['data-testid', 'name', 'aria-label']) {
        const v = el.getAttribute(attr);
        if (v && v.length <= 64) {
          const s = uniqueSel(`${tag}[${attr}="${escAttr(v)}"]`);
          if (s) return { sel: s, idx: 0 };
        }
      }
      // Structural path up to the nearest stable-id ancestor or <body>.
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.body && parts.length < 8) {
        if (node !== el && node.id && stableId(node.id)) {
          parts.unshift('#' + esc(node.id));
          break;
        }
        let seg = node.localName;
        const parent = node.parentElement;
        if (parent) {
          const sibs = Array.from(parent.children).filter(c => c.localName === seg);
          if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(node) + 1})`;
        }
        parts.unshift(seg);
        node = node.parentElement;
      }
      const sel = parts.join(' > ');
      let idx = 0;
      try { idx = Math.max(0, Array.from(document.querySelectorAll(sel)).indexOf(el)); } catch {}
      return { sel, idx };
    }

    function makeEntry(el, action) {
      const { sel, idx } = buildSelector(el);
      return { sel, idx, action, alt: { tag: el.localName, label: labelOf(el) } };
    }

    function resolveEntry(entry) {
      try {
        const list = document.querySelectorAll(entry.sel);
        const el = list[entry.idx] || list[0];
        if (el && (!entry.alt || el.localName === entry.alt.tag)) return el;
      } catch {}
      // Fuzzy fallback: same tag + same accessible label.
      if (entry.alt && entry.alt.label) {
        for (const el of document.querySelectorAll(entry.alt.tag || '*')) {
          if (labelOf(el) === entry.alt.label && isVisible(el)) return el;
        }
      }
      return null;
    }

    // ======================================================================
    // Applying rules
    // ======================================================================
    function setTabindexAttr(el, val) {
      selfWrites.add(el);
      if (val === null) el.removeAttribute('tabindex');
      else el.setAttribute('tabindex', val);
    }

    function reapply(entries) {
      currentEntries = entries;
      const desired = new Map();
      if (entries) {
        let n = 1;
        for (const en of entries) {
          const el = resolveEntry(en);
          if (!el || desired.has(el)) continue;
          desired.set(el, en.action === 'skip' ? '-1' : String(n++));
        }
      }
      for (const [el, orig] of Array.from(appliedOriginal)) {
        if (!desired.has(el)) {
          if (el.isConnected) setTabindexAttr(el, orig);
          appliedOriginal.delete(el);
        }
      }
      for (const [el, val] of desired) {
        if (el.getAttribute('tabindex') !== val) {
          if (!appliedOriginal.has(el)) appliedOriginal.set(el, el.getAttribute('tabindex'));
          setTabindexAttr(el, val);
        }
      }
    }

    function restoreAll() {
      for (const [el, orig] of appliedOriginal) {
        if (el.isConnected) setTabindexAttr(el, orig);
      }
      appliedOriginal.clear();
      currentEntries = null;
    }

    async function applySaved() {
      const data = await loadOriginData();
      reapply(effectiveEntries(data));
    }

    function startObserver() {
      observer = new MutationObserver((records) => {
        if (editing) return;
        const meaningful = records.some(r =>
          r.type === 'childList' ||
          (r.type === 'attributes' && !(selfWrites.has(r.target))));
        selfWrites.clear();
        if (!meaningful) return;
        clearTimeout(reapplyTimer);
        reapplyTimer = setTimeout(() => {
          if (editing) return;
          if (location.pathname !== lastPath) {
            lastPath = location.pathname;
            applySaved();
          } else if (currentEntries) {
            reapply(currentEntries);
          }
        }, 300);
      });
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex'],
      });
    }

    // ======================================================================
    // Edit-mode UI
    // ======================================================================
    const PANEL_CSS = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
      .panel {
        position: fixed; top: 12px; right: 12px; z-index: 2147483647;
        width: 240px; background: #1f2937; color: #f9fafb; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,.45); padding: 12px 14px; font-size: 13px;
        line-height: 1.45;
      }
      .panel h1 { font-size: 13px; font-weight: 700; margin: 0 0 8px; display: flex; align-items: center; gap: 6px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; display: inline-block; }
      .scope { margin: 6px 0; }
      .scope label { display: inline-flex; align-items: center; gap: 4px; margin-right: 10px; cursor: pointer; }
      .counts { color: #9ca3af; margin: 4px 0 8px; }
      .btns { display: flex; gap: 6px; margin-bottom: 8px; }
      button {
        flex: 1; border: 0; border-radius: 6px; padding: 5px 0; font-size: 12px;
        cursor: pointer; background: #374151; color: #f9fafb;
      }
      button.primary { background: #2563eb; }
      button:hover { filter: brightness(1.15); }
      .hints { border-top: 1px solid #374151; padding-top: 8px; color: #9ca3af; font-size: 11px; }
      .hints b { color: #e5e7eb; font-weight: 600; }
      .badge {
        position: fixed; top: 0; left: 0; z-index: 2147483646; min-width: 18px; height: 18px;
        border-radius: 9px; background: #2563eb; color: #fff; font: 700 11px/18px system-ui, sans-serif;
        text-align: center; padding: 0 4px; pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,.4);
      }
      .badge.skip { background: #dc2626; }
      .ring {
        position: fixed; top: 0; left: 0; z-index: 2147483645; pointer-events: none;
        border: 2px solid #2563eb; border-radius: 4px; box-shadow: 0 0 0 2px rgba(37,99,235,.25);
      }
      .ring.hover { border-style: dashed; border-color: #60a5fa; box-shadow: none; }
      .toast {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; background: #1f2937; color: #f9fafb; padding: 8px 16px;
        border-radius: 8px; font: 13px system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.4);
      }
      .hidden { display: none !important; }
    `;

    function ensureHost() {
      if (host && host.isConnected) return;
      host = document.createElement('div');
      host.setAttribute('data-tabindex-editor', '');
      shadow = host.attachShadow({ mode: 'closed' });
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(PANEL_CSS);
        shadow.adoptedStyleSheets = [sheet];
      } catch {
        const style = document.createElement('style');
        style.textContent = PANEL_CSS;
        shadow.appendChild(style);
      }
      badgeLayer = document.createElement('div');
      shadow.appendChild(badgeLayer);
      document.documentElement.appendChild(host);
    }

    function toast(msg) {
      ensureHost();
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = msg;
      shadow.appendChild(t);
      setTimeout(() => t.remove(), 1800);
    }

    function buildPanel() {
      panel = document.createElement('div');
      panel.className = 'panel';
      panel.innerHTML = `
        <h1><span class="dot"></span>TabIndex Editor</h1>
        <div class="scope">Save to:
          <label><input type="radio" name="scope" value="page" tabindex="-1"> this page</label>
          <label><input type="radio" name="scope" value="site" tabindex="-1"> whole site</label>
        </div>
        <div class="counts"></div>
        <div class="btns">
          <button class="primary" data-act="save" tabindex="-1">Save</button>
          <button data-act="clear" tabindex="-1">Clear</button>
          <button data-act="cancel" tabindex="-1">Cancel</button>
        </div>
        <div class="hints">
          <b>Tab/&#8593;&#8595;</b> move &#183; <b>Enter</b> number &#183; <b>S</b> skip<br>
          <b>P</b> scope &#183; <b>C</b> clear &#183; <b>Ctrl+Enter</b> save &#183; <b>Esc</b> cancel<br>
          <b>Click</b> number &#183; <b>Shift+click</b> skip
        </div>`;
      countsEl = panel.querySelector('.counts');
      scopeInputs = panel.querySelectorAll('input[name="scope"]');
      for (const input of scopeInputs) {
        input.addEventListener('change', () => { scope = input.value; updatePanel(); });
      }
      panel.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.act === 'save') save();
        else if (btn.dataset.act === 'clear') clearMarks();
        else if (btn.dataset.act === 'cancel') exitEdit();
      });
      shadow.appendChild(panel);

      cursorRing = document.createElement('div');
      cursorRing.className = 'ring';
      hoverRing = document.createElement('div');
      hoverRing.className = 'ring hover';
      shadow.appendChild(cursorRing);
      shadow.appendChild(hoverRing);
    }

    function updatePanel() {
      if (!panel) return;
      const ordered = marks.filter(m => m.action === 'order').length;
      const skipped = marks.length - ordered;
      countsEl.textContent = `${ordered} numbered · ${skipped} skipped · scope: ${scope === 'page' ? 'this page' : 'whole site'}`;
      for (const input of scopeInputs) input.checked = (input.value === scope);
    }

    function isVisible(el) {
      if (!el.isConnected || !el.getClientRects().length) return false;
      const st = getComputedStyle(el);
      return st.visibility !== 'hidden';
    }

    function computeCandidates() {
      const set = new Set();
      for (const el of document.querySelectorAll(FOCUSABLE_SELECTOR)) {
        if (host && host.contains(el)) continue;
        if (el.disabled || (el.localName === 'input' && el.type === 'hidden')) continue;
        if (!isVisible(el)) continue;
        set.add(el);
      }
      for (const m of marks) if (m.el.isConnected) set.add(m.el);
      candidates = Array.from(set);
      candidates.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
      candidateSet = new Set(candidates);
    }

    function candidateFrom(target) {
      let node = target instanceof Element ? target : target?.parentElement;
      while (node && node !== document.documentElement) {
        if (candidateSet.has(node)) return node;
        node = node.parentElement;
      }
      return null;
    }

    // ---- marks ------------------------------------------------------------
    function markIndex(el) { return marks.findIndex(m => m.el === el); }

    function toggleMark(el, action) {
      const i = markIndex(el);
      if (i >= 0 && marks[i].action === action) marks.splice(i, 1);
      else if (i >= 0) marks[i].action = action;
      else marks.push({ el, action });
      rebuildBadges();
      updatePanel();
    }

    function clearMarks() {
      marks = [];
      rebuildBadges();
      updatePanel();
    }

    function rebuildBadges() {
      for (const b of badgeEls) b.remove();
      badgeEls = [];
      let n = 0;
      for (const m of marks) {
        const b = document.createElement('div');
        if (m.action === 'order') { n++; b.className = 'badge'; b.textContent = String(n); }
        else { b.className = 'badge skip'; b.textContent = '✕'; }
        badgeLayer.appendChild(b);
        badgeEls.push(b);
      }
    }

    // ---- per-frame positioning -------------------------------------------
    function positionRing(ring, el) {
      if (!el || !el.isConnected) { ring.classList.add('hidden'); return; }
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) { ring.classList.add('hidden'); return; }
      ring.classList.remove('hidden');
      ring.style.transform = `translate(${r.left - 2}px, ${r.top - 2}px)`;
      ring.style.width = r.width + 'px';
      ring.style.height = r.height + 'px';
    }

    function frame() {
      if (!editing) return;
      for (let i = 0; i < marks.length; i++) {
        const el = marks[i].el, b = badgeEls[i];
        if (!b) continue;
        if (!el.isConnected) { b.classList.add('hidden'); continue; }
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) { b.classList.add('hidden'); continue; }
        b.classList.remove('hidden');
        b.style.transform = `translate(${Math.max(2, r.left - 8)}px, ${Math.max(2, r.top - 8)}px)`;
      }
      positionRing(cursorRing, candidates[cursorIndex]);
      positionRing(hoverRing, hoveredEl !== candidates[cursorIndex] ? hoveredEl : null);
      rafId = requestAnimationFrame(frame);
    }

    // ---- input handling ---------------------------------------------------
    function inOwnUI(e) {
      return e.composedPath().includes(host);
    }

    function moveCursor(delta) {
      if (!candidates.length) return;
      let i = cursorIndex;
      for (let step = 0; step < candidates.length; step++) {
        i = (i + delta + candidates.length) % candidates.length;
        if (candidates[i].isConnected && isVisible(candidates[i])) break;
      }
      cursorIndex = i;
      try { candidates[i].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
    }

    function onKeyDown(e) {
      if (!editing || inOwnUI(e)) return;
      const k = e.key;
      let handled = true;
      if ((e.ctrlKey || e.metaKey) && (k === 'Enter' || k === 's' || k === 'S')) save();
      else if (k === 'Tab') moveCursor(e.shiftKey ? -1 : 1);
      else if (k === 'ArrowDown' || k === 'ArrowRight') moveCursor(1);
      else if (k === 'ArrowUp' || k === 'ArrowLeft') moveCursor(-1);
      else if (k === 'Home') { cursorIndex = 0; moveCursor(0); }
      else if (k === 'End') { cursorIndex = candidates.length - 1; moveCursor(0); }
      else if (k === 'Enter' || k === ' ') toggleMark(candidates[cursorIndex], 'order');
      else if (k === 's' || k === 'S') toggleMark(candidates[cursorIndex], 'skip');
      else if (k === 'p' || k === 'P') { scope = scope === 'page' ? 'site' : 'page'; updatePanel(); }
      else if (k === 'c' || k === 'C') clearMarks();
      else if (k === 'Escape') exitEdit();
      else handled = false;
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    }

    function onMouseMove(e) {
      if (!editing || inOwnUI(e)) { hoveredEl = null; return; }
      hoveredEl = candidateFrom(e.target);
    }

    function onClickCapture(e) {
      if (!editing || inOwnUI(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'click') return;
      const el = candidateFrom(e.target);
      if (!el) return;
      toggleMark(el, e.shiftKey ? 'skip' : 'order');
      const ci = candidates.indexOf(el);
      if (ci >= 0) cursorIndex = ci;
    }

    const CAPTURED_MOUSE = ['pointerdown', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'];

    function addEditListeners() {
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('mousemove', onMouseMove, true);
      for (const t of CAPTURED_MOUSE) window.addEventListener(t, onClickCapture, true);
    }

    function removeEditListeners() {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      for (const t of CAPTURED_MOUSE) window.removeEventListener(t, onClickCapture, true);
    }

    // ---- enter / exit / save ---------------------------------------------
    async function enterEdit() {
      if (editing) return;
      const data = await loadOriginData();
      editing = true;
      restoreAll(); // edit against the page's natural state
      ensureHost();
      buildPanel();

      const pageEntries = data.pages[pageKey()];
      const entries = pageEntries || data.site;
      scope = pageEntries ? 'page' : (data.site ? 'site' : 'page');
      marks = [];
      if (entries) {
        for (const en of entries) {
          const el = resolveEntry(en);
          if (el && markIndex(el) < 0) marks.push({ el, action: en.action });
        }
      }
      computeCandidates();
      cursorIndex = marks.length && candidates.includes(marks[0].el)
        ? candidates.indexOf(marks[0].el) : 0;
      rebuildBadges();
      updatePanel();
      addEditListeners();
      rafId = requestAnimationFrame(frame);
    }

    async function exitEdit() {
      if (!editing) return;
      editing = false;
      removeEditListeners();
      cancelAnimationFrame(rafId);
      for (const b of badgeEls) b.remove();
      badgeEls = [];
      panel?.remove(); panel = null;
      cursorRing?.remove(); cursorRing = null;
      hoverRing?.remove(); hoverRing = null;
      marks = [];
      candidates = [];
      candidateSet = new Set();
      hoveredEl = null;
      return applySaved();
    }

    async function save() {
      const entries = marks
        .filter(m => m.el.isConnected)
        .map(m => makeEntry(m.el, m.action));
      if (scope === 'page') {
        if (entries.length) dataCache.pages[pageKey()] = entries;
        else delete dataCache.pages[pageKey()];
      } else {
        dataCache.site = entries.length ? entries : null;
      }
      await saveOriginData();
      const where = scope === 'page' ? 'this page' : 'whole site';
      await exitEdit();
      toast(entries.length ? `Tab order saved for ${where}` : `Rules cleared for ${where}`);
    }

    // ======================================================================
    // Public API
    // ======================================================================
    return {
      /** Apply the saved rules for this page and start watching for re-renders. */
      init() {
        applySaved();
        startObserver();
        window.addEventListener('popstate', () => { if (!editing) applySaved(); });
        window.addEventListener('hashchange', () => { if (!editing) applySaved(); });
      },
      /**
       * Enter edit mode, or leave it (discarding unsaved marks).
       * @returns {Promise<void>} resolves once the mode change has settled —
       *   isEditing() is accurate and any rules have been (re)applied.
       */
      toggleEditMode() {
        return editing ? exitEdit() : enterEdit();
      },
      isEditing: () => editing,
      /** @returns {Promise<{origin,path,editing,pageCount,siteCount}>} */
      async getStatus() {
        const data = await loadOriginData();
        const page = data.pages[pageKey()] || null;
        return {
          origin: location.origin,
          path: pageKey(),
          editing,
          pageCount: page ? page.length : 0,
          siteCount: data.site ? data.site.length : 0,
        };
      },
      /**
       * Forget saved rules and put the page's own tabindex attributes back.
       * @param {'page'|'site'|'all'} which
       */
      async clearRules(which) {
        const data = await loadOriginData();
        if (which === 'page') delete data.pages[pageKey()];
        else if (which === 'site') data.site = null;
        else { data.site = null; data.pages = {}; }
        await saveOriginData();
        if (!editing) { restoreAll(); await applySaved(); }
        return true;
      },
    };
  }

  (typeof globalThis !== 'undefined' ? globalThis : window).__TabIndexEditorCore = createTabIndexEditor;
})();
