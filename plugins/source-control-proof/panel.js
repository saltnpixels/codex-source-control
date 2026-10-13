const el = id => document.getElementById(id);
const groups = [['staged', 'Staged Changes'], ['unstaged', 'Unstaged Changes'], ['untracked', 'Untracked Files'], ['conflicts', 'Conflicts']];
const state = { checkout: null, status: null, selection: null, mode: 'diff', projects: [], homeDirectory: '', epoch: 0, viewRequest: 0, statusRequest: 0, staging: null, refreshEpoch: null, hostContext: {} };
const pending = new Map();
let requestId = 0, pickerSignature = '';
const expandedProjects = new Set();
let imageSignature = '', catalogRequest = null;

function shortPath(path) {
  const home = state.homeDirectory.replace(/[\\/]+$/, '');
  return home && (path.startsWith(home + '/') || path.startsWith(home + '\\')) ? '~' + path.slice(home.length) : path;
}
async function refreshProjects() {
  if (catalogRequest) return catalogRequest;
  catalogRequest = (async () => {
    const catalog = await callTool('git_projects');
    state.projects = catalog.projects; state.homeDirectory = catalog.homeDirectory || '';
    renderPicker();
    if (state.checkout) el('checkout').textContent = shortPath(state.checkout);
    if (catalog.discovery?.warning) showError(catalog.discovery.warning);
  })();
  try { await catalogRequest; } finally { catalogRequest = null; }
}

function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: className })) svg.setAttribute(key, value);
  const paths = { repo: 'M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4Zm0 13h15M8 8h7M8 11h5', file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8M8 17h5', image: 'M4 4h16v16H4ZM4 16l5-5 4 4 3-3 4 4M14 8h.01', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', check: 'm5 12 4 4L19 6', chevron: 'm7 10 5 5 5-5', branch: 'M6 3v12M18 9a9 9 0 0 1-9 9' };
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.file); svg.append(path);
  if (name === 'branch') for (const [cx, cy] of [[18,6],[6,18]]) { const circle = document.createElementNS(svg.namespaceURI, 'circle'); circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', 3); svg.append(circle); }
  return svg;
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Host request timed out: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
  });
}
async function callTool(name, args = {}) {
  const result = await request('tools/call', { name, arguments: args });
  if (result.isError) throw new Error(result.content?.[0]?.text || 'Request failed.');
  return result.structuredContent;
}
function showError(message = '') { el('error').textContent = message; el('error').hidden = !message; el('status-dot').dataset.error = String(!!message); }
function savePreference() { window.openai?.setWidgetState?.({ checkout: state.checkout, mode: state.mode }); }
function renderPicker() {
  const currentProject = state.projects.find(project => project.checkouts.some(checkout => checkout.path === state.checkout));
  const isWorktree = currentProject && state.checkout !== currentProject.path;
  el('project-label').textContent = currentProject ? currentProject.label + (isWorktree ? ' · Worktree' : '') : state.checkout ? state.checkout.split(/[\\/]/).filter(Boolean).at(-1) : 'Choose a repository';
  el('project').title = state.checkout || 'Choose repository';
  const query = el('project-search').value.trim().toLowerCase();
  const signature = JSON.stringify([state.projects, state.checkout, state.homeDirectory, query, [...expandedProjects]]);
  if (signature === pickerSignature) return;
  pickerSignature = signature;
  const list = el('project-list'); list.replaceChildren(); const known = new Set();
  const projects = [...state.projects].sort((a,b) => Number(b === currentProject) - Number(a === currentProject) || a.label.localeCompare(b.label));
  function option(project, checkout, worktree = false) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'sc-picker-option';
    button.dataset.checkout = checkout.path; button.title = checkout.path;
    button.setAttribute('aria-current', String(checkout.path === state.checkout));
    button.append(icon(worktree ? 'branch' : 'repo', 'sc-picker-symbol'));
    const copy = document.createElement('span'); copy.className = 'sc-picker-copy';
    const name = document.createElement('span'); name.className = 'sc-picker-name'; name.textContent = worktree ? checkout.branch : project.label;
    const branch = document.createElement('span'); branch.className = 'sc-picker-branch'; branch.textContent = worktree ? shortPath(checkout.path) : checkout.branch;
    copy.append(name, branch); button.append(copy);
    if (checkout.path === state.checkout) button.append(icon('check', 'sc-picker-check'));
    button.onclick = () => { closePicker(); switchCheckout(checkout.path); };
    return button;
  }
  for (const project of projects) {
    if (!project.checkouts.length) continue;
    const checkouts = [];
    for (const checkout of project.checkouts) {
      if (!known.has(checkout.path)) { known.add(checkout.path); checkouts.push(checkout); }
    }
    if (!checkouts.length) continue;
    const matches = checkout => [project.label, checkout.branch, checkout.path].some(text => text.toLowerCase().includes(query));
    if (query && !checkouts.some(matches)) continue;
    const root = checkouts.find(checkout => checkout.path === project.path) || checkouts[0];
    const worktrees = checkouts.filter(checkout => checkout !== root);
    const entry = document.createElement('div'); entry.className = 'sc-picker-entry'; entry.append(option(project, root)); list.append(entry);
    const expanded = expandedProjects.has(project.path) || !!query;
    if (worktrees.length) {
      if (!query) { const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'sc-worktree-toggle';
      toggle.textContent = worktrees.length; toggle.append(icon('chevron')); toggle.setAttribute('aria-label', 'Worktrees for ' + project.label); toggle.setAttribute('aria-expanded', String(expanded));
      toggle.onclick = () => { if (expandedProjects.has(project.path)) expandedProjects.delete(project.path); else expandedProjects.add(project.path); renderPicker(); el('project-list').querySelector('[data-worktrees="' + CSS.escape(project.path) + '"]')?.focus(); };
      toggle.dataset.worktrees = project.path; entry.append(toggle); }
      if (expanded) { const children = document.createElement('div'); children.className = 'sc-picker-worktrees'; for (const checkout of worktrees.filter(matches)) children.append(option(project, checkout, true)); list.append(children); }
    }
  }
  if (state.checkout && !known.has(state.checkout)) {
    const checkout = { path: state.checkout, branch: state.status?.branch || 'Custom checkout' };
    if (!query || state.checkout.toLowerCase().includes(query)) list.prepend(option({ label: el('project-label').textContent }, checkout));
  }
  if (!list.childElementCount) { const empty = document.createElement('div'); empty.className = 'sc-picker-no-results'; empty.textContent = query ? 'No repositories match your search.' : 'No saved repositories.'; list.append(empty); }
}
function openPicker() {
  el('project-popover').hidden = false; el('project').setAttribute('aria-expanded', 'true');
  el('project-search').value = ''; el('custom-form').hidden = true; renderPicker(); el('project-search').focus();
  refreshProjects().catch(error => showError(error.message));
}
function closePicker(restoreFocus = true) {
  el('project-popover').hidden = true; el('project').setAttribute('aria-expanded', 'false');
  if (restoreFocus) el('project').focus();
}
function emptyViewer(message) {
  el('file-title').textContent = 'File preview'; el('file-context').textContent = 'Select a file to inspect';
  el('code').replaceChildren(); el('code').hidden = true;
  el('images').replaceChildren(); el('images').hidden = true;
  imageSignature = '';
  const mark = document.createElement('span'); mark.className = 'sc-empty-mark'; mark.setAttribute('aria-hidden','true'); mark.textContent = '±';
  const title = document.createElement('strong'); title.textContent = 'Select a file to review';
  const detail = document.createElement('span'); detail.textContent = message || 'Compare changes or read the source.';
  el('view-message').replaceChildren(mark,title,detail); el('view-message').dataset.notice = 'false'; el('view-message').hidden = false;
}
function renderFiles() {
  const scrollContainer = el('files').parentElement, scrollTop = scrollContainer.scrollTop;
  const focused = el('files').contains(document.activeElement) ? document.activeElement.dataset : null;
  let focusTarget;
  el('files').replaceChildren();
  for (const [key, title] of groups) {
    const rows = state.status?.[key] || []; if (key === 'conflicts' && !rows.length) continue;
    const section = document.createElement('section'); section.className = 'sc-group';
    const heading = document.createElement('h2'); heading.textContent = title;
    const count = document.createElement('span'); count.textContent = rows.length; heading.append(count); section.append(heading);
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'sc-empty'; empty.textContent = 'No files'; section.append(empty);
    } else {
      const list = document.createElement('ul');
      for (const file of rows) {
        const row = document.createElement('li'), button = document.createElement('button'); row.className = 'sc-file-row'; button.type = 'button'; button.className = 'sc-file-button';
        button.dataset.path = file.path; button.dataset.group = key;
        if (focused?.path === file.path && focused?.group === key) focusTarget = button;
        button.setAttribute('aria-pressed', String(state.selection?.path === file.path && state.selection?.group === key));
        const badge = document.createElement('span'); badge.className = 'sc-file-status'; const status = file.change || file.status;
        badge.textContent = key === 'untracked' || status === 'A' ? 'New' : status; badge.dataset.status = status;
        badge.title = key === 'untracked' ? 'New file · not tracked yet' : ({ A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', UU: 'Conflict' }[status] || status);
        const path = document.createElement('span'); path.className = 'sc-file-path';
        const name = document.createElement('span'); name.className = 'sc-file-name'; name.textContent = file.path.split('/').at(-1);
        path.append(name);
        const directory = file.path.includes('/') ? file.path.slice(0,file.path.lastIndexOf('/')) : '';
        if (directory || file.originalPath) { const detail = document.createElement('span'); detail.className = 'sc-file-directory'; detail.textContent = file.originalPath ? file.originalPath + ' → ' + file.path : directory; path.append(detail); }
        button.title = file.originalPath ? file.originalPath + ' → ' + file.path : file.path;
        const imageFile = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(file.path);
        button.append(icon(imageFile ? 'image' : 'file','sc-file-icon'), path, badge); row.append(button);
        const staging = document.createElement('button'); staging.type = 'button'; staging.className = 'sc-file-stage';
        const action = key === 'staged' ? 'Unstage' : 'Stage'; staging.title = action + ' ' + file.path; staging.setAttribute('aria-label', staging.title);
        staging.dataset.path = file.path; staging.dataset.group = key;
        staging.append(icon(key === 'staged' ? 'minus' : 'plus')); staging.disabled = !!state.staging;
        staging.onclick = () => changeStaging(file.path, key); row.append(staging); list.append(row);
        button.onclick = () => { state.selection = { path: file.path, group: key }; renderFiles(); clearCode('Loading file…'); el('code').scrollTop = 0; loadFile(); };
      }
      section.append(list);
    }
    el('files').append(section);
  }
  focusTarget?.focus({ preventScroll: true }); scrollContainer.scrollTop = scrollTop;
}
function renderStatus(data) {
  state.checkout = data.checkout; state.status = data;
  for (const project of state.projects) for (const checkout of project.checkouts) if (checkout.path === data.checkout) checkout.branch = data.branch;
  el('branch').textContent = data.branch; el('checkout').textContent = shortPath(data.checkout); el('checkout').title = data.checkout;
  const count = new Set(groups.flatMap(([group]) => data[group].map(file => file.path))).size;
  el('total-count').textContent = count; el('change-summary').textContent = count ? count + (count === 1 ? ' changed file' : ' changed files') : 'Working tree clean';
  el('context').textContent = 'Checkout source: ' + data.contextSource; el('time').textContent = 'Checked ' + new Date(data.checkedAt).toLocaleTimeString();
  el('diagnostics').textContent = JSON.stringify({ launchDirectory: data.launchDirectory, contextSource: data.contextSource, hostContextKeys: Object.keys(state.hostContext) }, null, 2);
  if (state.selection && !data[state.selection.group].some(f => f.path === state.selection.path)) { state.selection = null; state.viewRequest++; emptyViewer('The selected file is no longer in this change group.'); }
  renderPicker(); renderFiles(); showError(); savePreference();
}
async function refresh() {
  if (!state.checkout) return;
  if (state.staging?.checkout === state.checkout) return;
  const epoch = state.epoch, requestedCheckout = state.checkout; if (state.refreshEpoch === epoch) return;
  const requestToken = ++state.statusRequest;
  state.refreshEpoch = epoch; el('refresh').disabled = true;
  try {
    const data = await callTool('git_status', requestedCheckout ? { repoPath: requestedCheckout } : {});
    if (epoch !== state.epoch || requestToken !== state.statusRequest || (state.checkout !== requestedCheckout && state.checkout !== data.checkout)) return;
    renderStatus(data); if (state.selection) await loadFile();
  } catch (error) { if (epoch === state.epoch && requestToken === state.statusRequest && state.checkout === requestedCheckout) { if (!state.status) el('branch').textContent = 'Checkout unavailable'; showError(error.message); } }
  finally { if (epoch === state.epoch) { state.refreshEpoch = null; el('refresh').disabled = !!state.staging; } }
}
async function changeStaging(path, group) {
  if (state.staging) return;
  const epoch = state.epoch, checkout = state.checkout, action = group === 'staged' ? 'unstage' : 'stage';
  const restoreFocus = document.activeElement?.classList.contains('sc-file-stage'); let failed = false;
  state.staging = { epoch, checkout, path, action }; state.statusRequest++; state.viewRequest++;
  el('refresh').disabled = true; el('staging-message').textContent = (action === 'stage' ? 'Staging ' : 'Unstaging ') + path.split('/').at(-1) + '…'; renderFiles();
  try {
    const data = await callTool('git_staging', { repoPath: checkout, path, group, action });
    if (epoch !== state.epoch) return;
    if (state.selection?.path === path && state.selection.group === group) {
      const nextGroup = (action === 'stage' ? ['staged'] : ['unstaged', 'untracked', 'conflicts']).find(key => data[key].some(file => file.path === path));
      state.selection = nextGroup ? { path, group: nextGroup } : null;
      if (!state.selection) emptyViewer('The file has no remaining changes.');
    }
    renderStatus(data);
    el('staging-message').textContent = (action === 'stage' ? 'Staged ' : 'Unstaged ') + path.split('/').at(-1);
    if (state.selection) await loadFile();
  } catch (error) { failed = true; if (epoch === state.epoch) { showError(error.message); el('staging-message').textContent = 'Unable to confirm the staging result.'; } }
  finally {
    state.staging = null; renderFiles(); el('refresh').disabled = state.refreshEpoch !== null;
    if (epoch !== state.epoch || failed) await refresh();
    if (epoch === state.epoch && restoreFocus && document.activeElement === document.body) {
      const target = [...el('files').querySelectorAll('.sc-file-stage')].find(button => button.dataset.path === path);
      (target || el('refresh')).focus({ preventScroll: true });
    }
  }
}
async function switchCheckout(checkout) {
  state.epoch++; state.viewRequest++; state.checkout = checkout; state.selection = null; state.status = null;
  el('staging-message').textContent = '';
  el('branch').textContent = 'Loading checkout…'; el('checkout').textContent = checkout; el('context').textContent = ''; el('time').textContent = '';
  el('checkout').title = checkout; el('total-count').textContent = '0'; el('change-summary').textContent = 'Reading Git status…';
  el('custom-form').hidden = true; renderPicker(); renderFiles(); emptyViewer(); showError(); await refresh();
}
function clearCode(message) { el('code').hidden = true; el('images').hidden = true; el('view-message').hidden = false; el('view-message').dataset.notice = 'false'; el('view-message').textContent = message; }
function formatBytes(size) { if (size < 1024) return size + ' B'; if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'; return (size / (1024 * 1024)).toFixed(2) + ' MB'; }
function renderImages(view) {
  el('code').hidden = true; el('view-message').hidden = true; el('images').hidden = false;
  const signature = JSON.stringify([view.checkout, view.path, view.group, view.mode, view.images.map(image => [image.label, image.revision, image.message, image.byteSize])]);
  if (signature === imageSignature) return;
  imageSignature = signature; el('images').replaceChildren();
  for (const image of view.images) {
    const figure = document.createElement('figure'); figure.className = 'sc-image-card';
    const label = document.createElement('figcaption'); label.textContent = image.label; figure.append(label);
    const canvas = document.createElement('div'); canvas.className = 'sc-image-canvas'; figure.append(canvas);
    const dimensions = document.createElement('div'); dimensions.className = 'sc-image-info'; dimensions.textContent = image.byteSize === undefined ? '' : formatBytes(image.byteSize); figure.append(dimensions);
    if (image.dataUrl) {
      const img = document.createElement('img'); img.alt = view.path + ' · ' + image.label;
      img.onload = () => { dimensions.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px · ' + formatBytes(image.byteSize); };
      img.onerror = () => { canvas.textContent = 'This image could not be decoded.'; };
      img.src = image.dataUrl;
      canvas.append(img);
    } else canvas.textContent = image.message || 'No image in this snapshot.';
    el('images').append(figure);
  }
}
function appendCodeLine(fragment, text, oldLine, newLine, style) {
  const row = document.createElement('div'); row.className = 'sc-line ' + style;
  for (const number of state.mode === 'diff' ? [oldLine, newLine] : [newLine]) { const gutter = document.createElement('span'); gutter.className = 'sc-number'; gutter.textContent = number ?? ''; row.append(gutter); }
  const content = document.createElement('span'); content.className = 'sc-line-text'; content.textContent = text; row.append(content); fragment.append(row);
}
function renderCode(view) {
  el('file-context').textContent = view.sourceLabel || (view.group === 'staged' ? 'Staged snapshot' : 'Working copy');
  if (view.kind === 'image') { renderImages(view); return; }
  el('images').hidden = true;
  if (view.message || !view.text) { clearCode(view.message || (state.mode === 'diff' ? 'No text changes.' : 'Empty file.')); return; }
  const oldScroll = { top: el('code').scrollTop, left: el('code').scrollLeft };
  const lines = view.text.split('\n'); if (lines.at(-1) === '') lines.pop();
  const fragment = document.createDocumentFragment(); let oldLine = 0, newLine = 0, inHunk = false;
  for (const [index, line] of lines.slice(0, 10000).entries()) {
    if (state.mode === 'source') { appendCodeLine(fragment, line, null, index + 1, ''); continue; }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; appendCodeLine(fragment, line, null, null, 'hunk'); }
    else if (line.startsWith('diff --git') || line.startsWith('@@@')) { inHunk = false; appendCodeLine(fragment, line, null, null, 'meta'); }
    else if (inHunk && line.startsWith('+')) appendCodeLine(fragment, line, null, newLine++, 'added');
    else if (inHunk && line.startsWith('-')) appendCodeLine(fragment, line, oldLine++, null, 'removed');
    else if (inHunk && line.startsWith(' ')) appendCodeLine(fragment, line, oldLine++, newLine++, '');
    else appendCodeLine(fragment, line, null, null, 'meta');
  }
  el('code').replaceChildren(fragment); el('code').hidden = false; el('code').scrollTop = oldScroll.top; el('code').scrollLeft = oldScroll.left;
  el('view-message').hidden = lines.length <= 10000; el('view-message').dataset.notice = 'true'; el('view-message').textContent = 'Showing the first 10,000 lines.';
}
async function loadFile() {
  if (!state.selection) return; const token = ++state.viewRequest;
  const args = { repoPath: state.checkout, ...state.selection, mode: state.mode };
  el('file-title').textContent = args.path; el('file-context').textContent = args.group === 'staged' ? 'Staged changes' : args.group === 'untracked' ? 'Untracked file' : 'Working copy';
  try { const view = await callTool('git_file', args); if (token === state.viewRequest) renderCode(view); }
  catch (error) { if (token === state.viewRequest) clearCode(error.message); }
}
function setMode(mode) {
  state.mode = mode; state.viewRequest++; el('diff-mode').setAttribute('aria-pressed', String(mode === 'diff')); el('source-mode').setAttribute('aria-pressed', String(mode === 'source'));
  el('code').scrollTop = 0; el('code').scrollLeft = 0; savePreference(); if (state.selection) { clearCode('Loading file…'); loadFile(); }
}
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
  const message = event.data, waiting = pending.get(message.id);
  if (waiting) { clearTimeout(waiting.timeout); pending.delete(message.id); message.error ? waiting.reject(new Error(message.error.message)) : waiting.resolve(message.result); return; }
  if (message.method === 'ui/notifications/tool-result' && state.epoch === 0 && message.params?.structuredContent?.branch) renderStatus(message.params.structuredContent);
  if (message.method === 'ui/notifications/host-context-changed') state.hostContext = { ...state.hostContext, ...message.params };
});
el('refresh').onclick = async () => {
  try { await refreshProjects(); } catch (error) { showError(error.message); }
  await refresh();
};
el('project').onclick = () => { if (el('project-popover').hidden) openPicker(); else closePicker(); };
el('project-search').oninput = renderPicker;
el('open-custom').onclick = () => { el('custom-form').hidden = false; el('custom-path').focus(); };
el('custom-form').onsubmit = event => { event.preventDefault(); const path = el('custom-path').value.trim(); if (path) { closePicker(); switchCheckout(path); } };
document.addEventListener('pointerdown', event => { if (!el('project-popover').hidden && !event.target.closest('.sc-repository')) closePicker(false); });
document.addEventListener('focusin', event => { if (!el('project-popover').hidden && !event.target.closest('.sc-repository')) closePicker(false); });
document.addEventListener('keydown', event => {
  if (el('project-popover').hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); closePicker(); return; }
  if (event.target === el('custom-path')) return;
  const options = [...el('project-list').querySelectorAll('[data-checkout]')];
  const index = options.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); const next = event.key === 'ArrowDown' ? index + 1 : index <= 0 ? options.length - 1 : index - 1; options[next % options.length]?.focus();
  } else if (event.key === 'Enter' && event.target === el('project-search')) { event.preventDefault(); options[0]?.click(); }
});
el('diff-mode').onclick = () => setMode('diff'); el('source-mode').onclick = () => setMode('source');
(async () => {
  try {
    const host = await request('ui/initialize', { appInfo: { name: 'Source Control', version: '0.5.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' });
    state.hostContext = host.hostContext || {}; if (state.hostContext.theme) document.documentElement.style.colorScheme = state.hostContext.theme;
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*');
    const preferences = window.openai?.widgetState; if (preferences?.mode === 'source') setMode('source');
    await refreshProjects();
    if (typeof preferences?.checkout === 'string') await switchCheckout(preferences.checkout);
    else if (!state.checkout) {
      el('branch').textContent = 'Choose a repository'; el('time').textContent = 'Ready'; renderFiles();
      openPicker();
    }
    setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    setInterval(() => { if (!document.hidden) refreshProjects().catch(error => showError(error.message)); }, 30000);
  } catch (error) { showError(error.message); }
})();
