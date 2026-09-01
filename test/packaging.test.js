/* What ships: the manifest, the icons, and the file build.sh produces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers/env.js';

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));

const manifest = JSON.parse(read('extension', 'manifest.json'));
const pkg = JSON.parse(read('package.json'));
const header = read('userscript', 'header.txt');

test('the manifest declares an MV3 extension that both browsers can load', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background.js', 'Chrome');
  assert.deepEqual(manifest.background.scripts, ['background.js'], 'Firefox');
  assert.ok(manifest.browser_specific_settings?.gecko?.id, 'AMO requires an add-on id');
});

test('the content script loads the core before the adapter that uses it', () => {
  const [cs, ...rest] = manifest.content_scripts;
  assert.equal(rest.length, 0);
  assert.deepEqual(cs.js, ['core.js', 'content.js']);
  assert.deepEqual(cs.matches, ['<all_urls>']);
  assert.equal(cs.run_at, 'document_idle');
});

test('it asks for no more permissions than it needs', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'storage']);
  assert.equal(manifest.host_permissions, undefined, 'the content script match is enough');
});

test('it declares to Firefox that it collects nothing', () => {
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions,
    { required: ['none'] }, 'AMO requires this key on new extensions');
});

test('the shipped zip is the repo files, unmodified', () => {
  // AMO asks whether anything generates or rewrites files that go into the
  // extension. Keeping the answer "no" is worth a test.
  execFileSync(path.join(ROOT, 'build.sh'), { cwd: ROOT, stdio: 'pipe' });
  const listing = execFileSync('unzip', ['-p', path.join(ROOT, 'dist', 'tabindex-editor-extension.zip'), 'manifest.json']);
  assert.equal(listing.toString(), read('extension', 'manifest.json'),
    'the manifest in the zip must be the manifest in the repo');
});

test('the keyboard shortcut is registered', () => {
  const cmd = manifest.commands['toggle-edit-mode'];
  assert.equal(cmd.suggested_key.default, 'Alt+Shift+K');
  assert.ok(cmd.description);
});

test('every file the manifest points at exists', () => {
  const referenced = [
    ...manifest.content_scripts.flatMap((cs) => cs.js),
    manifest.background.service_worker,
    ...manifest.background.scripts,
    manifest.action.default_popup,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
  ];
  for (const file of referenced) {
    assert.ok(exists('extension', file), `missing extension/${file}`);
  }
});

test('the icons are PNGs of the size they claim', () => {
  for (const [size, file] of Object.entries(manifest.icons)) {
    const buf = fs.readFileSync(path.join(ROOT, 'extension', file));
    assert.ok(buf.subarray(1, 4).toString() === 'PNG', `${file} is not a PNG`);
    assert.equal(buf.readUInt32BE(16), Number(size), `${file} width`);
    assert.equal(buf.readUInt32BE(20), Number(size), `${file} height`);
  }
});

test('the popup markup and its script agree on the element ids', () => {
  const html = read('extension', 'popup.html');
  const js = read('extension', 'popup.js');
  for (const id of ['site', 'status', 'toggle', 'clear-page', 'clear-site']) {
    assert.ok(html.includes(`id="${id}"`), `popup.html is missing #${id}`);
  }
  for (const id of [...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1])) {
    assert.ok(html.includes(`id="${id}"`), `popup.js reads #${id}, which popup.html does not have`);
  }
});

test('the userscript header matches what the adapter actually uses', () => {
  const adapter = read('userscript', 'adapter.js');
  const granted = new Set(
    [...header.matchAll(/@grant\s+(\S+)/g)].map((m) => m[1].replace(/^GM[._]/, '')),
  );
  const used = new Set(
    [...adapter.matchAll(/\bGM[._](\w+)/g)].map((m) => m[1]),
  );
  for (const fn of used) {
    assert.ok(granted.has(fn), `adapter.js uses GM.${fn} but the header does not @grant it`);
  }
  assert.match(header, /@match\s+\*:\/\/\*\/\*/);
  assert.match(header, /@noframes/, 'the core only supports the top frame today');
  assert.match(header, /@run-at\s+document-idle/);
});

test('the version is the same everywhere', () => {
  const headerVersion = header.match(/@version\s+(\S+)/)[1];
  assert.equal(manifest.version, pkg.version);
  assert.equal(headerVersion, pkg.version);
});

test('build.sh produces a userscript that parses and carries the whole core', () => {
  execFileSync(path.join(ROOT, 'build.sh'), { cwd: ROOT, stdio: 'pipe' });
  const out = path.join(ROOT, 'dist', 'tabindex-editor.user.js');
  assert.ok(fs.existsSync(out));

  const built = fs.readFileSync(out, 'utf8');
  assert.ok(built.startsWith('// ==UserScript=='), 'the metadata block must come first');
  assert.equal(built, header + read('extension', 'core.js') + read('userscript', 'adapter.js'));
  execFileSync(process.execPath, ['--check', out]);   // throws if it does not parse
});

test('every shipped script parses', () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'extension')).filter((f) => f.endsWith('.js')).map((f) => `extension/${f}`),
    'userscript/adapter.js',
  ];
  for (const file of files) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, file)]);
  }
});
