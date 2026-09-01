/* The toolbar popup: what it renders for a page, and what it sends back. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from './helpers/env.js';

const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'extension', 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'extension', 'popup.js'), 'utf8');

/** Opens the popup against a fake active tab whose content script replies with `status`. */
function openPopup({ status = null, tab = { id: 3, url: 'https://example.com/signup' } } = {}) {
  const dom = new JSDOM(POPUP_HTML, { url: 'chrome-extension://tie/popup.html', runScripts: 'outside-only' });
  const sent = [];
  dom.window.chrome = {
    tabs: {
      async query() { return tab ? [tab] : []; },
      async sendMessage(id, msg) {
        sent.push({ id, msg });
        if (msg.type === 'status') {
          if (!status) throw new Error('Could not establish connection.');
          return status;
        }
        return { ok: true };
      },
    },
  };
  dom.window.close = () => {};   // the popup closes itself after toggling
  dom.window.eval(POPUP_JS);
  const $ = (id) => dom.window.document.getElementById(id);
  return {
    dom, sent, $,
    text: (id) => $(id).textContent,
    click: (id) => $(id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    settle: (ms = 5) => new Promise((r) => setTimeout(r, ms)),
  };
}

const STATUS = { origin: 'https://example.com', path: '/signup', editing: false, pageCount: 3, siteCount: 0 };

test('shows the current page and its rule counts', async () => {
  const popup = openPopup({ status: STATUS });
  await popup.settle();

  assert.equal(popup.text('site'), 'https://example.com/signup');
  assert.equal(popup.text('status'), 'Page rules: 3 elements · no site rules');
  assert.equal(popup.text('toggle'), 'Edit tab order');
  assert.equal(popup.$('clear-page').disabled, false);
  assert.equal(popup.$('clear-site').disabled, true, 'nothing to clear at site scope');
});

test('reflects that edit mode is already running', async () => {
  const popup = openPopup({ status: { ...STATUS, editing: true, pageCount: 0, siteCount: 2 } });
  await popup.settle();

  assert.equal(popup.text('toggle'), 'Stop editing');
  assert.equal(popup.text('status'), 'No page rules · Site rules: 2 elements');
  assert.equal(popup.$('clear-page').disabled, true);
  assert.equal(popup.$('clear-site').disabled, false);
});

test('says so on pages where the content script cannot run', async () => {
  const popup = openPopup({ status: null, tab: { id: 3, url: 'chrome://extensions' } });
  await popup.settle();

  assert.equal(popup.text('site'), 'chrome://extensions', 'not the opaque "null" origin');
  assert.match(popup.text('status'), /Cannot run on this page/);
  assert.equal(popup.$('toggle').disabled, true);

  const firefox = openPopup({ status: null, tab: { id: 4, url: 'about:debugging#/runtime/this-firefox' } });
  await firefox.settle();
  assert.equal(firefox.text('site'), 'about:debugging');
});

test('the button asks the page to toggle edit mode', async () => {
  const popup = openPopup({ status: STATUS });
  await popup.settle();
  popup.click('toggle');
  await popup.settle();

  assert.deepEqual(popup.sent.map((s) => s.msg.type), ['status', 'toggle-edit']);
  assert.equal(popup.sent.at(-1).id, 3);
});

test('the clear buttons pass their scope and then refresh', async () => {
  const popup = openPopup({ status: STATUS });
  await popup.settle();
  popup.click('clear-page');
  await popup.settle();
  popup.click('clear-site');
  await popup.settle();

  const clears = popup.sent.filter((s) => s.msg.type === 'clear').map((s) => s.msg.scope);
  assert.deepEqual(clears, ['page', 'site']);
  assert.ok(popup.sent.filter((s) => s.msg.type === 'status').length > 1, 'the popup re-reads the status');
});
