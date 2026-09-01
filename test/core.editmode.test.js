/* Edit mode: picking elements with the keyboard and the mouse, saving, cancelling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, memoryStorage, entry, originData, ORIGIN_KEY, PAGE_PATH } from './helpers/env.js';

async function editing(storage = memoryStorage()) {
  const env = createPage({ storage });
  env.editor.init();
  await env.settle();
  await env.editor.toggleEditMode();
  return env;
}

test('toggleEditMode resolves once the mode has actually changed', async () => {
  const env = createPage();
  env.editor.init();
  const p = env.editor.toggleEditMode();
  assert.equal(env.editor.isEditing(), false, 'entering needs a storage read first');
  await p;
  assert.equal(env.editor.isEditing(), true);
  await env.editor.toggleEditMode();
  assert.equal(env.editor.isEditing(), false);
  env.close();
});

test('clicking elements numbers them in pick order, not document order', async () => {
  const storage = memoryStorage();
  const env = await editing(storage);

  env.click('#email');
  env.click('#name-field');
  env.click('#country');
  env.click('#tos');
  env.click('#submit-btn');
  env.click('#cookie-btn', { shiftKey: true }); // shift-click = skip
  env.press('Enter', { ctrlKey: true });
  await env.settle();

  assert.equal(env.editor.isEditing(), false, 'saving leaves edit mode');
  assert.deepEqual(
    env.tabindexMap('#email', '#name-field', '#country', '#tos', '#submit-btn', '#cookie-btn'),
    { '#email': '1', '#name-field': '2', '#country': '3', '#tos': '4', '#submit-btn': '5', '#cookie-btn': '-1' },
  );

  const saved = env.saved();
  assert.equal(saved.pages[PAGE_PATH].length, 6);
  assert.deepEqual(saved.pages[PAGE_PATH].map((e) => e.sel), [
    '#email', '#name-field', '#country', '#tos', '#submit-btn', '#cookie-btn',
  ]);
  assert.equal(saved.site, null);
  env.close();
});

test('the page never sees the clicks used to pick elements', async () => {
  const env = await editing();
  let siteClicks = 0;
  env.$('#submit-btn').addEventListener('click', () => { siteClicks++; });

  const ev = env.click('#submit-btn');
  assert.equal(siteClicks, 0);
  assert.equal(ev.defaultPrevented, true);

  env.press('Enter', { ctrlKey: true });
  await env.settle();
  assert.equal(env.tabindex('#submit-btn'), '1');
  env.close();
});

test('clicking a marked element again unmarks it', async () => {
  const storage = memoryStorage();
  const env = await editing(storage);
  env.click('#email');
  env.click('#email');
  env.press('Enter', { ctrlKey: true });
  await env.settle();
  assert.equal(env.tabindex('#email'), null);
  assert.equal(storage.has(ORIGIN_KEY), false, 'saving nothing stores nothing');
  env.close();
});

test('shift-clicking a numbered element turns it into a skip', async () => {
  const env = await editing();
  env.click('#email');
  env.click('#email', { shiftKey: true });
  env.press('Enter', { ctrlKey: true });
  await env.settle();
  assert.equal(env.tabindex('#email'), '-1');
  env.close();
});

test('keyboard picking: Tab moves the cursor, Enter numbers, S skips', async () => {
  const env = await editing();
  env.press('Enter');            // cursor starts on the first focusable element
  env.press('Tab');
  env.press('Enter');
  env.press('Tab');
  env.press('s');
  env.press('Enter', { ctrlKey: true });
  await env.settle();

  assert.deepEqual(env.tabindexMap('#nav-home', '#nav-pricing', '#cookie-btn'), {
    '#nav-home': '1', '#nav-pricing': '2', '#cookie-btn': '-1',
  });
  env.close();
});

test('Shift+Tab, arrows, Home and End all move the cursor', async () => {
  const env = await editing();
  env.press('End');
  env.press('Enter');            // last focusable: the footer link
  env.press('Home');
  env.press('Enter');            // first focusable: the first nav link
  env.press('ArrowDown');
  env.press('Enter');
  env.press('ArrowUp');
  env.press('ArrowUp');          // wraps around to the end of the list
  env.press('s');                // ...where S turns the existing number into a skip
  env.press('Enter', { ctrlKey: true });
  await env.settle();

  assert.deepEqual(env.tabindexMap('#f-twitter', '#nav-home', '#nav-pricing'), {
    '#f-twitter': '-1', '#nav-home': '1', '#nav-pricing': '2',
  });
  env.close();
});

test('handled keys never reach the page', async () => {
  const env = await editing();
  let seen = 0;
  env.window.addEventListener('keydown', () => { seen++; });   // bubble phase, like a site would
  assert.equal(env.press('Tab').defaultPrevented, true);
  assert.equal(env.press('s').defaultPrevented, true);
  assert.equal(seen, 0);
  // Keys the editor does not use are left alone.
  assert.equal(env.press('x').defaultPrevented, false);
  assert.equal(seen, 1);
  env.close();
});

test('P switches the save scope to the whole site', async () => {
  const env = await editing();
  env.click('#email');
  env.press('p');
  env.press('Enter', { ctrlKey: true });
  await env.settle();

  const saved = env.saved();
  assert.equal(saved.site.length, 1);
  assert.deepEqual(saved.pages, {});
  env.close();
});

test('Escape discards the marks and writes nothing', async () => {
  const storage = memoryStorage();
  const env = await editing(storage);
  env.click('#email');
  env.click('#submit-btn');
  env.press('Escape');
  await env.settle();

  assert.equal(env.editor.isEditing(), false);
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.has(ORIGIN_KEY), false);
  assert.equal(env.tabindex('#email'), null);
  env.close();
});

test('editing starts from the page’s natural order, then re-applies on exit', async () => {
  const storage = memoryStorage({
    [ORIGIN_KEY]: originData({ pages: { [PAGE_PATH]: [entry('#email', 'order', { tag: 'input', label: 'you@example.com' })] } }),
  });
  const env = createPage({ storage });
  env.editor.init();
  await env.settle();
  assert.equal(env.tabindex('#email'), '1');

  await env.editor.toggleEditMode();
  assert.deepEqual(env.tabindexMap('#email', '#submit-btn'), { '#email': null, '#submit-btn': '2' },
    'while editing, the page shows its own tab order again');

  env.press('Escape');
  await env.settle();
  assert.equal(env.tabindex('#email'), '1', 'cancelling puts the saved order back');
  env.close();
});

test('existing rules are pre-loaded as marks and can be cleared with C', async () => {
  const storage = memoryStorage({
    [ORIGIN_KEY]: originData({
      pages: {
        [PAGE_PATH]: [
          entry('#email', 'order', { tag: 'input', label: 'you@example.com' }),
          entry('#cookie-btn', 'skip', { tag: 'button', label: 'Accept cookies' }),
        ],
      },
    }),
  });
  const env = await editing(storage);
  env.press('c');
  env.press('Enter', { ctrlKey: true });
  await env.settle();

  assert.equal(storage.has(ORIGIN_KEY), false);
  assert.deepEqual(env.tabindexMap('#email', '#cookie-btn'), { '#email': null, '#cookie-btn': '1' });
  env.close();
});

test('re-editing keeps the saved order and lets you extend it', async () => {
  const storage = memoryStorage();
  const env = await editing(storage);
  env.click('#submit-btn');
  env.click('#email');
  env.press('Enter', { ctrlKey: true });
  await env.settle();

  await env.editor.toggleEditMode();
  env.click('#country');
  env.press('Enter', { ctrlKey: true });
  await env.settle();

  assert.deepEqual(env.tabindexMap('#submit-btn', '#email', '#country'), {
    '#submit-btn': '1', '#email': '2', '#country': '3',
  });
  env.close();
});

test('the editor UI is hidden from the page and from its own picker', async () => {
  const env = await editing();
  const host = env.$('[data-tabindex-editor]');
  assert.ok(host, 'the overlay host is attached');
  assert.equal(env.$('[data-tabindex-editor] button'), null, 'closed shadow root: invisible to the page');

  // Its own controls must not be pickable as candidates either.
  env.press('End');
  env.press('Enter');
  env.press('Enter', { ctrlKey: true });
  await env.settle();
  assert.equal(env.tabindex('#f-twitter'), '1', 'End lands on the last page element, not on the panel');
  env.close();
});

test('leaving edit mode removes the overlay', async () => {
  const env = await editing();
  assert.ok(env.$('[data-tabindex-editor]'));
  env.press('Escape');
  await env.settle();
  const host = env.$('[data-tabindex-editor]');
  assert.equal(host.textContent, '', 'panel, rings and badges are gone');
  env.close();
});
