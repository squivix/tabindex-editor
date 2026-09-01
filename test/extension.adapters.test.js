/*
 * The extension's thin adapters: the storage bridge + message handlers in
 * content.js, and the command relay in background.js. Both are loaded into a
 * vm context with a fake `chrome` API, and the core is stubbed so the adapter's
 * storage object can be captured (it is the argument the core is created with).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers/env.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
/** Objects built inside the vm have a different prototype, so compare by value. */
const plain = (v) => JSON.parse(JSON.stringify(v));

/** A fake chrome.storage area, optionally broken (unavailable / over quota). */
function area(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    fail: false,
    async get(key) {
      if (this.fail) throw new Error('storage unavailable');
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(obj) {
      if (this.fail) throw new Error('QUOTA_BYTES quota exceeded');
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
    },
    async remove(key) {
      if (this.fail) throw new Error('storage unavailable');
      data.delete(key);
    },
  };
}

function loadContentScript({ sync = area(), local = area() } = {}) {
  const captured = { storage: null, onMessage: null, listeners: [], editing: false, cleared: [] };
  const editorStub = {
    init() { captured.inited = true; },
    async toggleEditMode() { await Promise.resolve(); captured.editing = !captured.editing; },
    isEditing: () => captured.editing,
    async getStatus() { return { origin: 'https://example.com', path: '/p', editing: captured.editing, pageCount: 2, siteCount: 0 }; },
    async clearRules(which) { captured.cleared.push(which); return true; },
  };
  const sandbox = {
    chrome: {
      storage: { sync, local },
      runtime: { onMessage: { addListener: (fn) => { captured.onMessage = fn; } } },
    },
    window: { addEventListener: (type, fn, capture) => captured.listeners.push({ type, fn, capture }) },
    __TabIndexEditorCore: (storage) => { captured.storage = storage; return editorStub; },
    console,
  };
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'extension', 'content.js'), 'utf8'),
    vm.createContext(sandbox),
    { filename: 'content.js' },
  );
  return { ...captured, get onMessageFn() { return captured.onMessage; }, captured, sync, local };
}

test('reads from sync storage', async () => {
  const sync = area({ 'tie:https://a.test': { ts: 5, site: null, pages: {} } });
  const { captured } = loadContentScript({ sync });
  assert.deepEqual(await captured.storage.get('tie:https://a.test'), { ts: 5, site: null, pages: {} });
  assert.equal(await captured.storage.get('tie:https://missing.test'), null);
});

test('when both copies exist the newer timestamp wins', async () => {
  const key = 'tie:https://a.test';
  const older = { ts: 100, site: null, pages: {} };
  const newer = { ts: 200, site: null, pages: {} };

  let ctx = loadContentScript({ sync: area({ [key]: older }), local: area({ [key]: newer }) });
  assert.equal((await ctx.captured.storage.get(key)).ts, 200, 'local is newer');

  ctx = loadContentScript({ sync: area({ [key]: newer }), local: area({ [key]: older }) });
  assert.equal((await ctx.captured.storage.get(key)).ts, 200, 'sync is newer');
});

test('falls back to local storage when sync is unavailable', async () => {
  const key = 'tie:https://a.test';
  const sync = area();
  sync.fail = true;
  const local = area({ [key]: { ts: 1, site: null, pages: {} } });
  const { captured } = loadContentScript({ sync, local });
  assert.equal((await captured.storage.get(key)).ts, 1);
});

test('writes go to sync, and the local copy is dropped', async () => {
  const key = 'tie:https://a.test';
  const sync = area();
  const local = area({ [key]: { ts: 1 } });
  const { captured } = loadContentScript({ sync, local });

  await captured.storage.set(key, { ts: 2 });
  assert.deepEqual(sync.data.get(key), { ts: 2 });
  assert.equal(local.data.has(key), false, 'no stale local copy left to win a later merge');
});

test('a sync write that is over quota falls back to local', async () => {
  const key = 'tie:https://a.test';
  const sync = area();
  sync.fail = true;
  const local = area();
  const { captured } = loadContentScript({ sync, local });

  await captured.storage.set(key, { ts: 3 });
  assert.deepEqual(local.data.get(key), { ts: 3 });
});

test('remove clears both areas even if one of them throws', async () => {
  const key = 'tie:https://a.test';
  const sync = area({ [key]: { ts: 1 } });
  const local = area({ [key]: { ts: 1 } });
  sync.fail = true;
  const { captured } = loadContentScript({ sync, local });

  await captured.storage.remove(key);
  assert.equal(local.data.has(key), false);
});

test('the status message is answered asynchronously', async () => {
  const { captured } = loadContentScript();
  let answer = null;
  const keepChannelOpen = captured.onMessage({ type: 'status' }, {}, (r) => { answer = r; });
  assert.equal(keepChannelOpen, true, 'must return true or the channel closes early');
  await tick();
  assert.equal(answer.pageCount, 2);
});

test('the toggle message answers with the mode it ended up in', async () => {
  const { captured } = loadContentScript();
  let answer = null;
  const keepChannelOpen = captured.onMessage({ type: 'toggle-edit' }, {}, (r) => { answer = r; });
  assert.equal(keepChannelOpen, true);
  await tick();
  assert.deepEqual(plain(answer), { editing: true }, 'entering edit mode is async — answer after it settled');
});

test('the clear message forwards the scope and confirms', async () => {
  const { captured } = loadContentScript();
  let answer = null;
  captured.onMessage({ type: 'clear', scope: 'site' }, {}, (r) => { answer = r; });
  await tick();
  assert.deepEqual(captured.cleared, ['site']);
  assert.deepEqual(plain(answer), { ok: true });
});

test('Alt+Shift+K is registered as a capturing in-page fallback', async () => {
  const { captured } = loadContentScript();
  const entry = captured.listeners.find((l) => l.type === 'keydown');
  assert.ok(entry, 'a keydown listener is installed');
  assert.equal(entry.capture, true, 'capture, so the page cannot swallow it first');

  let prevented = false;
  entry.fn({ altKey: true, shiftKey: true, code: 'KeyK', preventDefault: () => { prevented = true; } });
  await tick();
  assert.equal(prevented, true);
  assert.equal(captured.editing, true);

  entry.fn({ altKey: false, shiftKey: false, code: 'KeyA', preventDefault: () => {} });
  await tick();
  assert.equal(captured.editing, true, 'other keys are ignored');
});

// ---------------------------------------------------------------- background

function loadBackground({ tabs = [{ id: 7 }], sendFails = false } = {}) {
  const sent = [];
  let handler = null;
  const sandbox = {
    chrome: {
      commands: { onCommand: { addListener: (fn) => { handler = fn; } } },
      tabs: {
        async query() { return tabs; },
        async sendMessage(id, msg) {
          if (sendFails) throw new Error('Could not establish connection.');
          sent.push({ id, msg });
        },
      },
    },
    console,
  };
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'extension', 'background.js'), 'utf8'),
    vm.createContext(sandbox),
    { filename: 'background.js' },
  );
  return { sent, run: (cmd) => handler(cmd) };
}

test('the keyboard command is relayed to the active tab', async () => {
  const bg = loadBackground();
  await bg.run('toggle-edit-mode');
  assert.deepEqual(plain(bg.sent), [{ id: 7, msg: { type: 'toggle-edit' } }]);
});

test('other commands are ignored', async () => {
  const bg = loadBackground();
  await bg.run('something-else');
  assert.deepEqual(bg.sent, []);
});

test('a page without a content script does not blow up the service worker', async () => {
  await loadBackground({ sendFails: true }).run('toggle-edit-mode');   // must not reject
  await loadBackground({ tabs: [] }).run('toggle-edit-mode');
});
