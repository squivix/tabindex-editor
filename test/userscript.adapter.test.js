/* The Greasyfork build's adapter: GM storage, the shortcut and the menu command. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers/env.js';

/** Objects built inside the vm have a different prototype, so compare by value. */
const plain = (v) => JSON.parse(JSON.stringify(v));

const ADAPTER = fs.readFileSync(path.join(ROOT, 'userscript', 'adapter.js'), 'utf8');

function loadAdapter({ values = {}, legacyMenuApi = true } = {}) {
  const store = new Map(Object.entries(values));
  const captured = { storage: null, listeners: [], menu: [], toggles: 0 };
  const GM = {
    async getValue(key, fallback = null) { return store.has(key) ? store.get(key) : fallback; },
    async setValue(key, value) { store.set(key, value); },
    async deleteValue(key) { store.delete(key); },
  };
  const sandbox = {
    GM,
    window: { addEventListener: (type, fn, capture) => captured.listeners.push({ type, fn, capture }) },
    __TabIndexEditorCore: (storage) => {
      captured.storage = storage;
      return { init() {}, toggleEditMode() { captured.toggles++; }, isEditing: () => false };
    },
    console,
  };
  const register = (label, fn) => captured.menu.push({ label, fn });
  if (legacyMenuApi) sandbox.GM_registerMenuCommand = register;
  else GM.registerMenuCommand = register;

  vm.runInContext(ADAPTER, vm.createContext(sandbox), { filename: 'adapter.js' });
  return { ...captured, store, captured };
}

test('values round-trip through GM storage as JSON', async () => {
  const { captured, store } = loadAdapter();
  const record = { v: 1, ts: 42, site: null, pages: { '/p': [{ sel: '#a', idx: 0, action: 'order' }] } };

  await captured.storage.set('tie:https://a.test', record);
  assert.equal(typeof store.get('tie:https://a.test'), 'string', 'GM storage holds strings');
  assert.deepEqual(plain(await captured.storage.get('tie:https://a.test')), record);

  await captured.storage.remove('tie:https://a.test');
  assert.equal(await captured.storage.get('tie:https://a.test'), null);
});

test('an unknown key reads as null rather than throwing', async () => {
  const { captured } = loadAdapter();
  assert.equal(await captured.storage.get('tie:https://nothing.test'), null);
});

test('corrupted stored data is treated as no data', async () => {
  const { captured } = loadAdapter({ values: { 'tie:https://a.test': '{ not json' } });
  assert.equal(await captured.storage.get('tie:https://a.test'), null);
});

test('registers the menu command with either menu API', () => {
  const legacy = loadAdapter({ legacyMenuApi: true });
  assert.equal(legacy.menu.length, 1);
  assert.match(legacy.menu[0].label, /tab order/i);
  legacy.menu[0].fn();
  assert.equal(legacy.captured.toggles, 1);

  const modern = loadAdapter({ legacyMenuApi: false });
  assert.equal(modern.menu.length, 1);
});

test('Alt+Shift+K toggles edit mode from the page', () => {
  const { captured } = loadAdapter();
  const entry = captured.listeners.find((l) => l.type === 'keydown');
  assert.ok(entry);
  assert.equal(entry.capture, true);

  let prevented = false;
  entry.fn({ altKey: true, shiftKey: true, code: 'KeyK', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(captured.toggles, 1);
});
