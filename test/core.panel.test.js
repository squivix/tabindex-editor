/* The edit-mode panel can be moved out of the way of the elements you want. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, memoryStorage } from './helpers/env.js';

const UI_KEY = 'tie:ui';
const savedPos = (storage) => storage.dump()[UI_KEY]?.panel ?? null;

async function editing(storage = memoryStorage()) {
  const env = createPage({ storage });
  env.editor.init();
  await env.settle();
  await env.editor.toggleEditMode();
  return env;
}

test('the panel starts pinned to the top right', async () => {
  const env = await editing();
  assert.deepEqual(env.panelEdges(), { top: '12px', right: '12px', bottom: 'auto', left: 'auto' });
  env.close();
});

test('M walks the panel around the four corners', async () => {
  const storage = memoryStorage();
  const env = await editing(storage);

  env.press('m');
  assert.deepEqual(env.panelEdges(), { top: 'auto', right: '12px', bottom: '12px', left: 'auto' });
  env.press('m');
  assert.deepEqual(env.panelEdges(), { top: 'auto', right: 'auto', bottom: '12px', left: '12px' });
  env.press('m');
  assert.deepEqual(env.panelEdges(), { top: '12px', right: 'auto', bottom: 'auto', left: '12px' });
  env.press('m');
  assert.deepEqual(env.panelEdges(), { top: '12px', right: '12px', bottom: 'auto', left: 'auto' },
    'four presses brings it home');

  assert.deepEqual(savedPos(storage), { v: 'top', h: 'right', x: 12, y: 12 });
  env.close();
});

test('M is swallowed like the rest of the keymap', async () => {
  const env = await editing();
  let pageSaw = 0;
  env.window.addEventListener('keydown', () => { pageSaw++; });
  assert.equal(env.press('m').defaultPrevented, true);
  assert.equal(pageSaw, 0);
  env.close();
});

test('the panel comes back where you left it', async () => {
  const storage = memoryStorage();
  const first = await editing(storage);
  first.press('m');
  first.press('m');           // bottom left
  first.press('Escape');
  await first.settle();
  first.close();

  const second = await editing(storage);
  assert.deepEqual(second.panelEdges(), { top: 'auto', right: 'auto', bottom: '12px', left: '12px' });
  second.close();
});

test('dragging the title bar moves it and re-anchors to the nearest corner', async () => {
  const storage = memoryStorage();
  const env = await editing(storage);

  // Grab the title bar 28px in from the panel's left edge, drop it bottom-left.
  env.drag([800, 20], [100, 700]);

  assert.deepEqual(env.panelEdges(), { top: 'auto', right: 'auto', bottom: '0px', left: '72px' });
  assert.deepEqual(savedPos(storage), { v: 'bottom', h: 'left', x: 72, y: 0 },
    'stored as offsets from the edges it ended up nearest, so a resize keeps it there');
  env.close();
});

test('a drag cannot push the panel off the screen', async () => {
  const env = await editing();
  env.drag([800, 20], [5000, 5000]);
  const { left, top } = env.panel().getBoundingClientRect();
  assert.ok(left + 240 <= env.window.innerWidth, `left ${left} keeps the panel on screen`);
  assert.ok(top + 160 <= env.window.innerHeight, `top ${top} keeps the panel on screen`);
  env.close();
});

test('a window reporting no viewport cannot poison the saved position', async () => {
  const storage = memoryStorage();
  const env = await editing(storage);
  for (const dim of ['innerWidth', 'innerHeight']) {
    Object.defineProperty(env.window, dim, { value: 0, configurable: true });
  }
  env.drag([800, 20], [640, 120]);

  const pos = savedPos(storage);
  assert.ok(pos.x >= 0 && pos.y >= 0, `offsets stay positive, got ${JSON.stringify(pos)}`);
  env.close();
});

test('a position saved on a wider screen is clamped back into view', async () => {
  const storage = memoryStorage({ [UI_KEY]: { v: 1, panel: { v: 'top', h: 'left', x: 5000, y: 5000 } } });
  const env = await editing(storage);
  assert.deepEqual(env.panelEdges(), {
    top: `${env.window.innerHeight - 60}px`, left: `${env.window.innerWidth - 140}px`,
    right: 'auto', bottom: 'auto',
  });
  env.close();
});

test('panel placement is kept apart from the site rules', async () => {
  const storage = memoryStorage();
  const env = await editing(storage);
  env.press('m');
  env.click('#email');
  env.press('Enter', { ctrlKey: true });
  await env.settle();

  const origin = storage.dump()['tie:https://example.com'];
  assert.equal(origin.panel, undefined, 'not mixed into the origin record');
  assert.ok(savedPos(storage), 'stored under its own key');

  await env.editor.clearRules('all');
  await env.settle();
  assert.equal(storage.has('tie:https://example.com'), false);
  assert.deepEqual(savedPos(storage), { v: 'bottom', h: 'right', x: 12, y: 12 },
    'clearing a site’s rules does not reset where you put the panel');
  env.close();
});
