/* Keeping the override alive across re-renders, soft navigations and site meddling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, memoryStorage, entry, originData, ORIGIN_KEY, PAGE_PATH } from './helpers/env.js';

const EMAIL = entry('#email', 'order', { tag: 'input', label: 'you@example.com' });
const SUBMIT = entry('#submit-btn', 'order', { tag: 'button', label: 'Subscribe' });
const DEBOUNCE = 400; // the core reapplies at most ~4x/second

async function started(storage, url) {
  const env = createPage(url ? { storage, url } : { storage });
  env.editor.init();
  await env.settle();
  return env;
}

test('re-applies the order after a framework re-render replaces the elements', async () => {
  const storage = memoryStorage({ [ORIGIN_KEY]: originData({ pages: { [PAGE_PATH]: [EMAIL, SUBMIT] } }) });
  const env = createPage({ storage });
  // Snapshot the markup *before* any rules are applied: a real re-render rebuilds
  // from the framework's own template, without the attributes we wrote to the DOM.
  const card = env.$('#form-card');
  const pristine = card.innerHTML;

  env.editor.init();
  await env.settle();
  assert.equal(env.tabindex('#email'), '1');

  card.innerHTML = pristine;
  assert.equal(env.tabindex('#email'), null, 'the fresh nodes start out unstyled');

  await env.settle(DEBOUNCE);
  assert.deepEqual(env.tabindexMap('#email', '#submit-btn'), { '#email': '1', '#submit-btn': '2' });
  env.close();
});

test('wins back a tabindex the site overwrites', async () => {
  const storage = memoryStorage({ [ORIGIN_KEY]: originData({ pages: { [PAGE_PATH]: [EMAIL] } }) });
  const env = await started(storage);

  env.$('#email').setAttribute('tabindex', '9');   // e.g. a roving-tabindex widget
  await env.settle(DEBOUNCE);
  assert.equal(env.tabindex('#email'), '1');
  env.close();
});

test('a soft navigation swaps in the rules for the new path', async () => {
  const storage = memoryStorage({
    [ORIGIN_KEY]: originData({ pages: { [PAGE_PATH]: [EMAIL], '/checkout': [SUBMIT] } }),
  });
  const env = await started(storage);
  assert.equal(env.tabindex('#email'), '1');

  env.navigate('/checkout');
  env.window.dispatchEvent(new env.window.Event('popstate'));
  await env.settle();

  assert.deepEqual(env.tabindexMap('#email', '#submit-btn'), { '#email': null, '#submit-btn': '1' });
  env.close();
});

test('a path change is also noticed through the observer, without a popstate', async () => {
  const storage = memoryStorage({ [ORIGIN_KEY]: originData({ pages: { [PAGE_PATH]: [EMAIL] } }) });
  const env = await started(storage);

  env.navigate('/some/other/page');
  env.$('#form-card').appendChild(env.document.createElement('div')); // the SPA renders the new view
  await env.settle(DEBOUNCE);

  assert.equal(env.tabindex('#email'), null, 'rules for the old path are lifted');
  env.close();
});

test('site rules survive navigation within the origin', async () => {
  const storage = memoryStorage({ [ORIGIN_KEY]: originData({ site: [EMAIL] }) });
  const env = await started(storage);

  env.navigate('/anything');
  env.window.dispatchEvent(new env.window.Event('popstate'));
  await env.settle();
  assert.equal(env.tabindex('#email'), '1');
  env.close();
});

test('the observer stays out of the way while you are editing', async () => {
  const storage = memoryStorage({ [ORIGIN_KEY]: originData({ pages: { [PAGE_PATH]: [EMAIL] } }) });
  const env = await started(storage);
  await env.editor.toggleEditMode();
  assert.equal(env.tabindex('#email'), null, 'edit mode shows the page as the site wrote it');

  env.$('#form-card').appendChild(env.document.createElement('div'));
  await env.settle(DEBOUNCE);
  assert.equal(env.tabindex('#email'), null, 'no reapply behind the editor’s back');

  env.press('Escape');
  await env.settle();
  assert.equal(env.tabindex('#email'), '1');
  env.close();
});
