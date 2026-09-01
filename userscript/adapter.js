/* TabIndex Editor — userscript adapter around the shared core. */
(() => {
  'use strict';
  const storage = {
    async get(key) {
      const raw = await GM.getValue(key, null);
      try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    async set(key, value) { await GM.setValue(key, JSON.stringify(value)); },
    async remove(key) { await GM.deleteValue(key); },
  };

  const editor = globalThis.__TabIndexEditorCore(storage);
  editor.init();

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyK') {
      e.preventDefault();
      editor.toggleEditMode();
    }
  }, true);

  const registerMenu = (typeof GM_registerMenuCommand === 'function')
    ? GM_registerMenuCommand
    : (typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function')
      ? GM.registerMenuCommand : null;
  if (registerMenu) registerMenu('Toggle tab order edit mode', () => editor.toggleEditMode());
})();
