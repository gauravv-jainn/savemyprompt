'use strict';
// Standalone visual preview fallback (browser without the Electron bridge).
if (!window.smp) {
  window.smp = {
    on() {}, setPanelState() {}, listFolders: async () => DEMO.folders,
    listPrompts: async () => DEMO.prompts, search: async () => DEMO.prompts,
    copyPrompt: async () => ({ ok: true }), authStatus: async () => ({ signedIn: true }),
    signIn: async () => ({ signedIn: true }), save: async () => ({ promptId: 'x' }),
  };
}
const I = window.SMPIcons;
const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---- static chrome ----
el('tabico').innerHTML = I.bookmark(22);
el('logo').innerHTML = I.bookmark(20);
el('wordmark').innerHTML = I.wordmark();
el('searchico').innerHTML = I.search();
el('dropico').innerHTML = I.tray(20);

const S = {
  state: 'collapsed',
  view: 'root',            // root | folder | search | compose
  folder: null,            // { id, name }
  folderMode: 'grid',      // grid | list
  foldersLimit: 5,
  signedIn: false,
  query: '',
};

// ---------------- panel state (collapsed / hint / expanded) ----------------
window.smp.on('panel:state', (state) => {
  S.state = state;
  document.body.className = state;
  if (state === 'expanded') { S.view = 'root'; S.query = ''; el('search').value = ''; boot(); }
});
window.smp.on('panel:refresh', () => { if (S.state === 'expanded') refresh(); });

const tab = el('tab');
tab.addEventListener('mouseenter', () => { if (S.state === 'collapsed') window.smp.setPanelState('hint'); });
tab.addEventListener('mouseleave', () => { if (S.state === 'hint') window.smp.setPanelState('collapsed'); });
tab.addEventListener('click', () => window.smp.setPanelState('expanded'));

// ---------------- header nav ----------------
function updateHeader() {
  const nav = el('navLeft');
  const toggle = el('viewToggle');
  if (S.view === 'root') {
    nav.innerHTML = I.close();
    nav.title = 'Close';
    toggle.hidden = true;
  } else {
    nav.innerHTML = I.back();
    nav.title = 'Back';
    if (S.view === 'folder') {
      toggle.hidden = false;
      toggle.innerHTML = S.folderMode === 'grid' ? I.list() : I.grid();
      toggle.title = S.folderMode === 'grid' ? 'List view' : 'Grid view';
    } else {
      toggle.hidden = true;
    }
  }
}
el('navLeft').onclick = () => {
  if (S.view === 'root') window.smp.setPanelState('collapsed');
  else { S.view = 'root'; S.folder = null; S.query = ''; el('search').value = ''; render(); }
};
el('viewToggle').onclick = () => {
  S.folderMode = S.folderMode === 'grid' ? 'list' : 'grid';
  render();
};

// ---------------- search ----------------
let searchTimer;
el('search').addEventListener('input', (e) => {
  S.query = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (S.query) { S.view = 'search'; render(); }
    else { S.view = S.folder ? 'folder' : 'root'; render(); }
  }, 220);
});

// ---------------- drop zone -> manual compose ----------------
el('drop').onclick = () => { S.view = 'compose'; render(); };
['dragover', 'dragenter'].forEach((ev) =>
  el('drop').addEventListener(ev, (e) => { e.preventDefault(); el('drop').classList.add('dragover'); }));
['dragleave', 'drop'].forEach((ev) =>
  el('drop').addEventListener(ev, (e) => { e.preventDefault(); el('drop').classList.remove('dragover'); }));
el('drop').addEventListener('drop', () => { S.view = 'compose'; render(); });

// ---------------- boot / refresh ----------------
async function boot() {
  const auth = await window.smp.authStatus();
  S.signedIn = auth.signedIn;
  render();
}
async function refresh() { render(); }

// ---------------- render dispatch ----------------
async function render() {
  updateHeader();
  const c = el('content');
  el('crumbs').innerHTML = '';
  el('viewall').hidden = true;

  if (!S.signedIn && S.view !== 'compose') return renderSignIn();

  if (S.view === 'root') return renderRoot();
  if (S.view === 'folder') return renderFolder();
  if (S.view === 'search') return renderSearch();
  if (S.view === 'compose') return renderCompose();
}

function skeletons(n = 4) {
  el('content').innerHTML = Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
}

function renderSignIn() {
  el('content').innerHTML = `<div class="signin">
    Connect Google Drive to browse and save your team's prompt library.
    <br /><button class="btn-signin" id="do-signin">Sign in to Google Drive</button>
  </div>`;
  el('do-signin').onclick = async () => {
    const r = await window.smp.signIn();
    S.signedIn = r.signedIn;
    render();
  };
}

// ---- root: folder list ----
async function renderRoot() {
  skeletons();
  let folders;
  try { folders = await window.smp.listFolders(); }
  catch (e) { return errorState(e.message); }
  if (!folders.length) {
    el('content').innerHTML = `<div class="empty">No folders yet.<br />Hover a message in ChatGPT or Claude and hit save, or use “Drop your prompt..” below.</div>`;
    return;
  }
  const shown = folders.slice(0, S.foldersLimit);
  el('content').innerHTML = shown.map(folderRow).join('');
  shown.forEach((f) => {
    el(`fld-${f.id}`).onclick = () => { S.folder = { id: f.id, name: f.name }; S.view = 'folder'; S.folderMode = 'grid'; render(); };
  });
  if (folders.length > S.foldersLimit) {
    el('viewall').hidden = false;
    el('viewall').textContent = 'View all';
    el('viewall').onclick = () => { S.foldersLimit = Infinity; render(); };
  } else {
    S.foldersLimit = 5;
  }
}

function folderRow(f) {
  return `<div class="row" id="fld-${f.id}">
    <span class="folder-ico">${I.folder(30)}</span>
    <span class="row-text">
      <span class="row-title">${esc(f.name)}</span>
      ${f.subtitle ? `<span class="row-sub">${esc(f.subtitle)}</span>` : ''}
    </span>
  </div>`;
}

// ---- folder: grid or list of prompts ----
async function renderFolder() {
  el('crumbs').innerHTML = `<b>${esc(S.folder.name)}</b>`;
  skeletons(S.folderMode === 'grid' ? 6 : 3);
  let prompts;
  try { prompts = await window.smp.listPrompts(S.folder.id); }
  catch (e) { return errorState(e.message); }
  if (!prompts.length) {
    el('content').innerHTML = `<div class="empty">This folder is empty.</div>`;
    return;
  }
  if (S.folderMode === 'grid') renderGrid(prompts);
  else renderPromptList(prompts);
}

function renderGrid(prompts) {
  const c = el('content');
  c.innerHTML = `<div class="grid">${prompts.map((p) => `
    <div class="gcard" id="g-${p.id}" title="${esc(p.title)}">
      ${I.folder(30)}
      <div class="glabel">${esc(p.title)}</div>
    </div>`).join('')}</div>`;
  prompts.forEach((p) => { el(`g-${p.id}`).onclick = () => copyPrompt(p.id, p.title); });
}

// ---- search results ----
async function renderSearch() {
  el('crumbs').innerHTML = `Results for <b>${esc(S.query)}</b>`;
  skeletons(3);
  let prompts;
  try { prompts = await window.smp.search(S.query); }
  catch (e) { return errorState(e.message); }
  if (!prompts.length) { el('content').innerHTML = `<div class="empty">No prompts match “${esc(S.query)}”.</div>`; return; }
  renderPromptList(prompts);
}

function renderPromptList(prompts) {
  const c = el('content');
  c.innerHTML = prompts.map(promptCard).join('');
  prompts.forEach((p) => {
    const card = el(`p-${p.id}`);
    const text = card.querySelector('.ptext');
    const more = card.querySelector('.more');
    if (more) {
      more.onclick = () => {
        const clamped = text.classList.toggle('clamp');
        more.textContent = clamped ? 'more' : 'less';
      };
    }
    card.querySelector('.copy-btn').onclick = () => copyPrompt(p.id, p.title);
  });
}

function promptCard(p) {
  const body = p.preview || '';
  const long = body.length > 130;
  return `<div class="pcard" id="p-${p.id}">
    <span class="ham">${I.hamburger(16)}</span>
    <div class="pbody">
      <div class="ptitle">${esc(p.title)}</div>
      <div class="ptext ${long ? 'clamp' : ''}">${esc(body)}</div>
      <div class="prow2">
        ${long ? `<span class="more">more</span>` : ''}
        <span class="ptags">${(p.tags || []).slice(0, 4).map((t) => `<span class="ptag">#${esc(t)}</span>`).join('')}</span>
        <button class="copy-btn">${I.copy(14)} Copy</button>
      </div>
    </div>
  </div>`;
}

// ---- compose (manual add) ----
function renderCompose() {
  el('crumbs').innerHTML = `<b>New prompt</b>`;
  el('content').innerHTML = `<div class="compose">
    <div class="clabel">Title</div>
    <input id="c-title" placeholder="Short name" />
    <div class="clabel">Prompt</div>
    <textarea id="c-prompt" rows="5" placeholder="Paste or type the prompt…"></textarea>
    <div class="clabel">Reusable template (optional)</div>
    <textarea id="c-template" rows="3" placeholder="Version with [PLACEHOLDERS]…"></textarea>
    <div class="clabel">Folder</div>
    <input id="c-folder" list="c-folders" placeholder="Category / client" />
    <datalist id="c-folders"></datalist>
    <div class="clabel">Tags (comma separated)</div>
    <input id="c-tags" placeholder="e.g. image, campaign" />
    <div class="crow">
      <button class="btn ghost" id="c-cancel">Cancel</button>
      <button class="btn primary" id="c-save">Save</button>
    </div>
  </div>`;
  // Populate folder suggestions.
  window.smp.listFolders().then((fs) => {
    el('c-folders').innerHTML = fs.map((f) => `<option value="${esc(f.name)}">`).join('');
  }).catch(() => {});
  el('c-cancel').onclick = () => { S.view = 'root'; render(); };
  el('c-save').onclick = async () => {
    const payload = {
      title: el('c-title').value.trim(),
      extracted: el('c-prompt').value.trim(),
      template: el('c-template').value.trim(),
      folder: el('c-folder').value.trim(),
      tags: el('c-tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      confidence: 'high',
      source: 'manual',
    };
    if (!payload.title || !payload.extracted || !payload.folder) { toast('Title, prompt and folder are required'); return; }
    el('c-save').disabled = true; el('c-save').textContent = 'Saving…';
    try {
      await window.smp.save(payload);
      toast('Saved to Drive');
      S.view = 'root'; render();
    } catch (e) {
      toast('Save failed'); el('c-save').disabled = false; el('c-save').textContent = 'Save';
    }
  };
}

// ---- shared actions ----
async function copyPrompt(id, title) {
  try { await window.smp.copyPrompt(id); toast(`Copied “${title}”`); }
  catch (e) { toast('Copy failed'); }
}
function errorState(msg) {
  el('content').innerHTML = `<div class="empty">Couldn't reach Drive.<br />${esc(msg)}</div>`;
}
let toastTimer;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

// ---- demo data for standalone visual preview ----
function _demo() {
  return {
    folders: [
      { id: 'f1', name: 'Nike — Spring Campaign', subtitle: 'Air Max launch' },
      { id: 'f2', name: 'Image Generation', subtitle: 'Product & lifestyle' },
      { id: 'f3', name: 'Email Copy', subtitle: 'Newsletters & drips' },
      { id: 'f4', name: 'Ad Headlines', subtitle: 'Meta / Google' },
      { id: 'f5', name: 'Brand Voice', subtitle: null },
      { id: 'f6', name: 'SEO Briefs', subtitle: 'Blog' },
    ],
    prompts: [
      { id: 'p1', title: 'Hero product shot', preview: 'Studio photograph of [PRODUCT] on a seamless [COLOR] backdrop, soft key light from the left, subtle rim light, shot on 85mm, shallow depth of field, ultra sharp, commercial product photography, no text.', tags: ['image', 'product', 'studio'] },
      { id: 'p2', title: 'Launch email', preview: 'Write a launch announcement email for [PRODUCT] targeted at [AUDIENCE]. Warm, energetic brand voice. One clear CTA to [LINK]. Under 120 words.', tags: ['email', 'launch'] },
      { id: 'p3', title: 'Lifestyle campaign scene', preview: 'Cinematic lifestyle image of a runner wearing [PRODUCT] at golden hour on an empty city street, motion blur, film grain, 35mm.', tags: ['image', 'campaign'] },
    ],
  };
}
const DEMO = _demo();

// In standalone preview mode, jump straight to expanded root.
if (location.search.includes('preview')) {
  // QA backdrop so the transparent-window floating card reads.
  document.documentElement.style.background =
    'repeating-linear-gradient(135deg,#3a3f4a 0 22px,#343945 22px 44px)';
  S.signedIn = true;
  let start = 'expanded';
  if (location.search.includes('collapsed')) start = 'collapsed';
  else if (location.search.includes('hint')) start = 'hint';
  document.body.className = start;
  S.state = start;
  if (location.search.includes('grid')) { S.view = 'folder'; S.folder = { id: 'f2', name: 'Image Generation' }; S.folderMode = 'grid'; }
  if (location.search.includes('list')) { S.view = 'folder'; S.folder = { id: 'f2', name: 'Image Generation' }; S.folderMode = 'list'; }
  if (start === 'expanded') boot();
}
