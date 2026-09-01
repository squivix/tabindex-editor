/* Sites focus things on load; the first Tab should still start at your pick #1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, memoryStorage, entry, originData, ORIGIN_KEY, PAGE_PATH } from './helpers/env.js';

const EMAIL = entry('#email', 'order', { tag: 'input', label: 'you@example.com' });
const SUBMIT = entry('#submit-btn', 'order', { tag: 'button', label: 'Subscribe' });

async function started(entries = [EMAIL, SUBMIT], storage) {
  storage ??= memoryStorage(entries.length
    ? { [ORIGIN_KEY]: originData({ pages: { [PAGE_PATH]: entries } }) }
    : {});
  const env = createPage({ storage });
  env.editor.init();
  await env.settle();
  return env;
}

test('the first Tab jumps to pick #1, even though the site focused its own box', async () => {
  const env = await started();
  env.$('#name-field').focus();               // the site autofocuses something
  assert.equal(env.document.activeElement.id, 'name-field');

  const ev = env.press('Tab');
  assert.equal(ev.defaultPrevented, true, 'the browser’s own move is replaced');
  assert.equal(env.document.activeElement.id, 'email', 'lands on the element numbered 1');
  env.close();
});

test('every later Tab is left alone', async () => {
  const env = await started();
  env.press('Tab');                            // the intercepted one
  const second = env.press('Tab');
  assert.equal(second.defaultPrevented, false, 'normal browser tabbing from here on');
  env.close();
});

test('typing first means you have taken charge, so Tab behaves normally', async () => {
  const env = await started();
  env.$('#name-field').focus();
  env.press('a');                              // typing into the box the site focused
  const tab = env.press('Tab');
  assert.equal(tab.defaultPrevented, false);
  assert.equal(env.document.activeElement.id, 'name-field', 'focus left where you put it');
  env.close();
});

test('clicking first also hands control back', async () => {
  const env = await started();
  env.click('#name-field');
  const tab = env.press('Tab');
  assert.equal(tab.defaultPrevented, false);
  env.close();
});

test('Shift+Tab is never hijacked', async () => {
  const env = await started();
  env.$('#name-field').focus();
  const ev = env.press('Tab', { shiftKey: true });
  assert.equal(ev.defaultPrevented, false);
  assert.equal(env.document.activeElement.id, 'name-field');
  env.close();
});

test('a page with no rules is never touched', async () => {
  const env = await started([]);
  env.$('#name-field').focus();
  const ev = env.press('Tab');
  assert.equal(ev.defaultPrevented, false);
  env.close();
});

test('a skipped element is never the target — only a numbered one', async () => {
  const env = await started([entry('#cookie-btn', 'skip', { tag: 'button', label: 'Accept cookies' }), EMAIL]);
  env.$('#name-field').focus();
  env.press('Tab');
  assert.equal(env.document.activeElement.id, 'email');
  env.close();
});

test('it re-arms after a soft navigation', async () => {
  const storage = memoryStorage({
    [ORIGIN_KEY]: originData({ pages: { [PAGE_PATH]: [EMAIL], '/checkout': [SUBMIT] } }),
  });
  const env = await started(null, storage);
  env.press('Tab');                            // spends the first-Tab jump here

  env.navigate('/checkout');
  env.window.dispatchEvent(new env.window.Event('popstate'));
  await env.settle();

  env.$('#name-field').focus();
  const ev = env.press('Tab');
  assert.equal(ev.defaultPrevented, true);
  assert.equal(env.document.activeElement.id, 'submit-btn', 'pick #1 of the new page');
  env.close();
});

test('edit mode keeps its own use of Tab', async () => {
  const env = await started([]);   // no rules, so the picker cursor starts at the top
  await env.editor.toggleEditMode();
  env.press('Tab');                            // moves the picker cursor
  env.press('Enter');
  env.press('Enter', { ctrlKey: true });
  await env.settle();
  assert.equal(env.tabindex('#nav-pricing'), '1', 'Tab moved the cursor, it did not jump focus');
  env.close();
});
