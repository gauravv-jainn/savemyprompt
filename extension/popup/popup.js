'use strict';
const I = window.SMPIcons, S = window.SMPStore;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

$('logo').innerHTML = I.bookmark(20);
$('sico').innerHTML = I.search();
$('back').innerHTML = I.back();

const st = { view: 'root', folder: null, query: '' };

$('back').addEventListener('click', () => { st.view = 'root'; st.folder = null; render(); });
let timer;
$('search').addEventListener('input', (e) => {
  st.query = e.target.value.trim();
  clearTimeout(timer);
  timer = setTimeout(() => { st.view = st.query ? 'search' : (st.folder ? 'folder' : 'root'); render(); }, 160);
});

async function render() {
  $('back').style.display = st.view === 'root' ? 'none' : '';
  $('crumbs').innerHTML = '';
  if (st.view === 'root') return renderRoot();
  if (st.view === 'folder') return renderFolder();
  if (st.view === 'search') return renderSearch();
}

async function renderRoot() {
  const folders = await S.folders();
  const c = $('content');
  if (!folders.length) {
    c.innerHTML = `<div class="empty">No prompts saved yet.<br>Open ChatGPT or Claude, hover a message, and hit <b>Collect prompt</b>.</div>`;
    return;
  }
  c.innerHTML = folders.map((f) => `
    <div class="row" data-folder="${esc(f.name)}">
      <span style="display:flex">${I.folder(28)}</span>
      <span class="rtitle">${esc(f.name)} <span class="pill">${f.count}</span></span>
    </div>`).join('');
  c.querySelectorAll('.row').forEach((r) => r.addEventListener('click', () => { st.folder = r.getAttribute('data-folder'); st.view = 'folder'; render(); }));
}

async function renderFolder() {
  $('crumbs').innerHTML = `<b>${esc(st.folder)}</b>`;
  renderList(await S.promptsIn(st.folder));
}
async function renderSearch() {
  $('crumbs').innerHTML = `Results for <b>${esc(st.query)}</b>`;
  const r = await S.search(st.query);
  if (!r.length) { $('content').innerHTML = `<div class="empty">No matches.</div>`; return; }
  renderList(r);
}

function renderList(prompts) {
  const c = $('content');
  if (!prompts.length) { c.innerHTML = `<div class="empty">Empty.</div>`; return; }
  c.innerHTML = prompts.map((p) => `
    <div class="pcard">
      <div class="ptitle">${esc(p.title)}</div>
      <div class="ptext">${esc(p.prompt || '')}</div>
      <div class="prow">
        ${(p.tags || []).slice(0, 3).map((t) => `<span class="ptag">#${esc(t)}</span>`).join('')}
        <button class="copybtn" data-id="${p.id}">${I.copy(14)} Copy</button>
      </div>
    </div>`).join('');
  c.querySelectorAll('.copybtn').forEach((b) => b.addEventListener('click', () => copy(b.getAttribute('data-id'))));
}

async function copy(id) {
  const all = await S.all();
  const p = all.find((x) => x.id === id);
  if (!p) return;
  const text = p.prompt || p.template || '';
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast(`Copied “${p.title}”`);
}

let tt;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 1600); }

render();
