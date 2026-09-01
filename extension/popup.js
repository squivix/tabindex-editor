/* TabIndex Editor — popup logic. */
const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// chrome://, about: and file: URLs have an opaque origin ("null"), so fall back
// to something a person can recognise.
function siteLabel(url) {
  try {
    const u = new URL(url);
    if (u.origin !== 'null') return u.origin;
    return u.host ? `${u.protocol}//${u.host}` : url.split(/[?#]/)[0];
  } catch {
    return url;
  }
}

async function refresh() {
  const tab = await activeTab();
  let status = null;
  try {
    status = await api.tabs.sendMessage(tab.id, { type: 'status' });
  } catch {}
  if (!status) {
    $('site').textContent = tab?.url ? siteLabel(tab.url) : '';
    $('status').innerHTML = '<span class="error">Cannot run on this page.</span>';
    $('toggle').disabled = true;
    return;
  }
  $('site').textContent = status.origin + status.path;
  const parts = [];
  parts.push(status.pageCount ? `Page rules: ${status.pageCount} elements` : 'No page rules');
  parts.push(status.siteCount ? `Site rules: ${status.siteCount} elements` : 'no site rules');
  $('status').textContent = parts.join(' · ');
  $('toggle').textContent = status.editing ? 'Stop editing' : 'Edit tab order';
  $('clear-page').disabled = !status.pageCount;
  $('clear-site').disabled = !status.siteCount;
}

$('toggle').addEventListener('click', async () => {
  const tab = await activeTab();
  try { await api.tabs.sendMessage(tab.id, { type: 'toggle-edit' }); } catch {}
  window.close();
});

for (const scope of ['page', 'site']) {
  $(`clear-${scope}`).addEventListener('click', async () => {
    const tab = await activeTab();
    try { await api.tabs.sendMessage(tab.id, { type: 'clear', scope }); } catch {}
    refresh();
  });
}

refresh();
