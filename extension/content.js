/* TabIndex Editor — extension content-script adapter around core.js. */
(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;

  // storage.sync when possible (synced across devices); fall back to
  // storage.local when sync is unavailable or over quota. On read, the
  // newer of the two copies wins.
  const storage = {
    async get(key) {
      let sync = null, local = null;
      try { sync = (await api.storage.sync.get(key))[key] ?? null; } catch {}
      try { local = (await api.storage.local.get(key))[key] ?? null; } catch {}
      if (sync && local) return (local.ts || 0) > (sync.ts || 0) ? local : sync;
      return sync || local;
    },
    async set(key, value) {
      try {
        await api.storage.sync.set({ [key]: value });
        try { await api.storage.local.remove(key); } catch {}
      } catch {
        await api.storage.local.set({ [key]: value });
      }
    },
    async remove(key) {
      try { await api.storage.sync.remove(key); } catch {}
      try { await api.storage.local.remove(key); } catch {}
    },
  };

  const editor = globalThis.__TabIndexEditorCore(storage);
  editor.init();

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'toggle-edit') {
      // toggleEditMode() is async (it reads storage first), so answer after it settles.
      editor.toggleEditMode().then(() => sendResponse({ editing: editor.isEditing() }));
      return true;
    } else if (msg.type === 'status') {
      editor.getStatus().then(sendResponse);
      return true;
    } else if (msg.type === 'clear') {
      editor.clearRules(msg.scope).then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  // In-page fallback shortcut, in case the extension command is unset.
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyK') {
      e.preventDefault();
      editor.toggleEditMode();
    }
  }, true);
})();
