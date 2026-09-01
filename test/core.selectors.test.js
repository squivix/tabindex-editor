/* How picked elements are turned into stored selectors, and found again later. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, memoryStorage, PAGE_PATH } from './helpers/env.js';

const PAGE = `
  <div id="wrap">
    <button id="save-btn">Save</button>
    <input id="field-928374" data-testid="password" type="password" value="hunter2">
    <input type="search" name="q">
    <button aria-label="Search now"></button>
    <button aria-label='He said "hi"'>quote</button>
    <ul id="menu">
      <li><a href="#1">One</a></li>
      <li><a href="#2">Two</a></li>
    </ul>
    <div><button>Plain</button></div>
  </div>
`;

/** Picks the given elements in edit mode and returns the stored entries. */
async function pick(storage, selectors) {
  const env = createPage({ html: PAGE, storage });
  env.editor.init();
  await env.settle();
  await env.editor.toggleEditMode();
  for (const sel of selectors) env.click(sel);
  env.press('Enter', { ctrlKey: true });
  await env.settle();
  env.close();
  return storage.dump()['tie:https://example.com'].pages[PAGE_PATH];
}

test('prefers a stable id, then data-testid / name / aria-label, then a structural path', async () => {
  const entries = await pick(memoryStorage(), [
    '#save-btn',
    '#field-928374',
    'input[type="search"]',
    'button[aria-label="Search now"]',
    '#menu li:nth-of-type(2) a',
    '#wrap > div > button',
  ]);

  assert.deepEqual(entries.map((e) => e.sel), [
    '#save-btn',                      // stable id wins
    'input[data-testid="password"]',  // id has a generated-looking number in it
    'input[name="q"]',
    'button[aria-label="Search now"]',
    '#menu > li:nth-of-type(2) > a',  // structural path, anchored at the nearest stable id
    '#wrap > div > button',
  ]);
});

test('a stored selector still resolves to the same element on the next visit', async () => {
  const storage = memoryStorage();
  const picked = ['#menu li:nth-of-type(2) a', 'button[aria-label="Search now"]', '#wrap > div > button'];
  await pick(storage, picked);

  const env = createPage({ html: PAGE, storage });
  env.editor.init();
  await env.settle();
  assert.deepEqual(picked.map((s) => env.tabindex(s)), ['1', '2', '3']);
  env.close();
});

test('quotes in an attribute value do not break the selector', async () => {
  const storage = memoryStorage();
  const entries = await pick(storage, ['button[aria-label=\'He said "hi"\']']);
  assert.equal(entries.length, 1);

  const env = createPage({ html: PAGE, storage });
  env.editor.init();
  await env.settle();
  assert.equal(env.tabindex('button[aria-label=\'He said "hi"\']'), '1');
  env.close();
});

test('field contents are never written to storage', async () => {
  const storage = memoryStorage();
  await pick(storage, ['#field-928374']);
  assert.doesNotMatch(JSON.stringify(storage.dump()), /hunter2/,
    'a password (or any typed value) must not be stored as a label');
});

test('a picked element records tag and label for the fuzzy fallback', async () => {
  const [saveBtn] = await pick(memoryStorage(), ['#save-btn']);
  assert.deepEqual({ ...saveBtn.alt }, { tag: 'button', label: 'Save' });
});
