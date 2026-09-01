/* TabIndex Editor — background: relay the keyboard command to the page. */
const api = globalThis.browser ?? globalThis.chrome;

api.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-edit-mode') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await api.tabs.sendMessage(tab.id, { type: 'toggle-edit' });
  } catch {
    // Restricted page (chrome://, store, etc.) — nothing to do.
  }
});
