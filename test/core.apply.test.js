/* Applying stored rules to a page, and putting the page back the way it was. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, memoryStorage, entry, originData, ORIGIN_KEY, PAGE_PATH } from './helpers/env.js';

const EMAIL = entry('#email', 'order', { tag: 'input', label: 'you@example.com' });
const NAME = entry('#name-field', 'order', { tag: 'input', label: '' });
const SUBMIT = entry('#submit-btn', 'order', { tag: 'button', label: 'Subscribe' });
const COOKIE = entry('#cookie-btn', 'skip', { tag: 'button', label: 'Accept cookies' });

const withPageRules = (entries, path = PAGE_PATH) =>
  memoryStorage({ [ORIGIN_KEY]: originData({ pages: { [path]: entries } }) });

async function started(storage) {
  const env = createPage({ storage });
  env.editor.init();
  await env.settle();
  return env;
}

test('numbers marked elements 1..n and takes skipped ones out of the tab order', async () => {
  const env = await started(withPageRules([EMAIL, NAME, SUBMIT, COOKIE]));
  assert.deepEqual(env.tabindexMap('#email', '#name-field', '#submit-btn', '#cookie-btn'), {
    '#email': '1', '#name-field': '2', '#submit-btn': '3', '#cookie-btn': '-1',
  });
  // Untouched elements keep whatever the page gave them.
  assert.equal(env.tabindex('#nav-home'), null);
  env.close();
});

test('numbering stays contiguous when an entry no longer resolves', async () => {
  const gone = entry('#removed-by-the-site', 'order', { tag: 'input', label: 'no such thing' });
  const env = await started(withPageRules([EMAIL, gone, SUBMIT]));
  assert.deepEqual(env.tabindexMap('#email', '#submit-btn'), { '#email': '1', '#submit-btn': '2' });
  env.close();
});

test('an entry whose selector broke is still found by tag + label', async () => {
  const renamed = entry('#submit-btn-v2', 'order', { tag: 'button', label: 'Subscribe' });
  const env = await started(withPageRules([renamed]));
  assert.equal(env.tabindex('#submit-btn'), '1');
  env.close();
});

test('a broken selector resolves to nothing when the label does not match either', async () => {
  const stale = entry('#submit-btn-v2', 'order', { tag: 'button', label: 'Buy now' });
  const env = await started(withPageRules([stale]));
  assert.equal(env.tabindex('#submit-btn'), '2', 'page keeps its own tabindex');
  env.close();
});

test('page rules take precedence over site rules', async () => {
  const storage = memoryStorage({
    [ORIGIN_KEY]: originData({ site: [SUBMIT], pages: { [PAGE_PATH]: [EMAIL] } }),
  });
  const env = await started(storage);
  assert.deepEqual(env.tabindexMap('#email', '#submit-btn'), { '#email': '1', '#submit-btn': '2' });
  env.close();
});

test('site rules apply on every path of the origin', async () => {
  const storage = memoryStorage({ [ORIGIN_KEY]: originData({ site: [EMAIL, SUBMIT] }) });
  const env = createPage({ storage, url: 'https://example.com/somewhere/else' });
  env.editor.init();
  await env.settle();
  assert.deepEqual(env.tabindexMap('#email', '#submit-btn'), { '#email': '1', '#submit-btn': '2' });
  env.close();
});

test('rules stored for another origin are ignored', async () => {
  const storage = memoryStorage({ 'tie:https://other.test': originData({ site: [EMAIL] }) });
  const env = await started(storage);
  assert.equal(env.tabindex('#email'), null);
  env.close();
});

test('clearing rules restores the page’s own tabindex attributes exactly', async () => {
  const storage = withPageRules([EMAIL, NAME, SUBMIT, COOKIE]);
  const env = await started(storage);

  await env.editor.clearRules('page');
  await env.settle();

  assert.deepEqual(env.tabindexMap('#email', '#name-field', '#submit-btn', '#cookie-btn'), {
    '#email': null, '#name-field': null,
    '#submit-btn': '2',   // the page's own trap, back in place
    '#cookie-btn': '1',
  });
  assert.equal(storage.has(ORIGIN_KEY), false, 'the empty record is deleted, not left behind');
  env.close();
});

test('clearing site rules leaves page rules applied', async () => {
  const storage = memoryStorage({
    [ORIGIN_KEY]: originData({ site: [SUBMIT], pages: { '/elsewhere': [NAME] } }),
  });
  const env = createPage({ storage, url: 'https://example.com/elsewhere' });
  env.editor.init();
  await env.settle();
  await env.editor.clearRules('site');
  await env.settle();

  assert.equal(env.tabindex('#name-field'), '1');
  assert.equal(env.saved().site, null);
  assert.ok(env.saved().pages['/elsewhere']);
  env.close();
});

test('clearRules("all") wipes both scopes', async () => {
  const storage = memoryStorage({
    [ORIGIN_KEY]: originData({ site: [SUBMIT], pages: { [PAGE_PATH]: [EMAIL] } }),
  });
  const env = await started(storage);
  await env.editor.clearRules('all');
  await env.settle();
  assert.deepEqual(env.tabindexMap('#email', '#submit-btn'), { '#email': null, '#submit-btn': '2' });
  assert.equal(storage.has(ORIGIN_KEY), false);
  env.close();
});

test('a page with no rules is left completely alone', async () => {
  const storage = memoryStorage();
  const env = await started(storage);
  assert.deepEqual(env.tabindexMap('#cookie-btn', '#submit-btn', '#email'), {
    '#cookie-btn': '1', '#submit-btn': '2', '#email': null,
  });
  assert.equal(storage.calls.set, 0, 'reading rules must never write');
  env.close();
});

test('getStatus reports the scope counts for the current page', async () => {
  const storage = memoryStorage({
    [ORIGIN_KEY]: originData({ site: [SUBMIT], pages: { [PAGE_PATH]: [EMAIL, NAME] } }),
  });
  const env = await started(storage);
  // spread: the object comes from the jsdom realm, so its prototype differs
  assert.deepEqual({ ...(await env.editor.getStatus()) }, {
    origin: 'https://example.com', path: PAGE_PATH, editing: false, pageCount: 2, siteCount: 1,
  });
  env.close();
});
