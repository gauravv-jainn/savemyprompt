/* SaveMyPrompt content script — runs on claude.ai + chatgpt.com.
   Detects messages via DOM selectors (reliable, no accessibility API),
   collects the hovered prompt, cleans + templates it deterministically, and
   stores it locally. Renders a Liquid Glass panel in a shadow root. */
(function () {
  if (window.__smpLoaded) return;
  window.__smpLoaded = true;

  const I = window.SMPIcons, C = window.SMPClean, S = window.SMPStore;

  // ---- site + selectors ----
  const host = location.host;
  const SITE = window.__SMP_FORCE_SITE || (host.includes('claude.ai') ? 'claude'
    : (host.includes('chatgpt.com') || host.includes('openai.com')) ? 'chatgpt' : null);
  if (!SITE) return;
  const SOURCE = SITE === 'claude' ? 'Claude' : 'ChatGPT';

  const SEL = {
    claude: {
      message: '[data-testid="user-message"], .font-claude-message',
      author: (el) => (el.closest('[data-testid="user-message"]') ? 'user' : 'assistant'),
    },
    chatgpt: {
      message: '[data-message-author-role]',
      author: (el) => {
        const m = el.closest('[data-message-author-role]');
        return m ? m.getAttribute('data-message-author-role') : null;
      },
    },
  }[SITE];

  function extractText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, svg, [role="button"], .sr-only, [aria-hidden="true"], .absolute').forEach((n) => n.remove());
    return C.clean(clone.innerText || clone.textContent || '');
  }

  // ---- hover tracking ----
  let lastHovered = null; // { el, text, author }
  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const msg = t.closest(SEL.message);
    if (!msg) return;
    if (lastHovered && lastHovered.el === msg) return;
    if (lastHovered && lastHovered.el) lastHovered.el.classList.remove('smp-hover-target');
    const text = extractText(msg);
    if (!text || text.length < 2) return;
    msg.classList.add('smp-hover-target');
    lastHovered = { el: msg, text, author: SEL.author(msg) };
    setCollectReady(true, text);
  }, true);

  // ---- shadow DOM ----
  const rootHost = document.createElement('div');
  rootHost.id = 'smp-root';
  const shadow = rootHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = window.SMP_CSS;
  shadow.appendChild(style);
  (document.documentElement || document.body).appendChild(rootHost);

  const pageStyle = document.createElement('style');
  pageStyle.textContent = window.SMP_PAGE_CSS;
  (document.head || document.documentElement).appendChild(pageStyle);

  const collectIco = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.6h10A1.6 1.6 0 0 1 18.6 5.2V20.2a.5.5 0 0 1-.77.42L12 17l-5.83 3.62A.5.5 0 0 1 5.4 20.2V5.2A1.6 1.6 0 0 1 7 3.6Z"/><path d="M12 7.4v4.6m0 0-1.8-1.8M12 12l1.8-1.8"/></svg>`;
  const plusIco = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <div class="fab" id="fab" title="SaveMyPrompt">${I.bookmark(22)}</div>
    <div class="panel hidden" id="panel">
      <div class="header">
        <button class="iconbtn" id="nav" title="Close"></button>
        <span class="logo">${I.bookmark(20)}</span>
        <span class="wordmark"><span class="gradient-text">savemyprompt</span><span style="color:#37bda9">.ai</span></span>
        <span class="grow"></span>
        <button class="iconbtn" id="addBtn" title="Add manually">${plusIco}</button>
        <button class="iconbtn" id="viewToggle" title="Toggle view" style="display:none"></button>
      </div>
      <div class="body">
        <button class="collect" id="collect">
          <span class="cico">${collectIco}</span>
          <span class="ctext"><span class="ctitle">Collect prompt</span>
            <span class="chint" id="chint">Hover a message, then click</span></span>
        </button>
        <div class="searchbar">${I.search()}<input id="search" placeholder="Search prompts…" spellcheck="false"></div>
        <div class="crumbs" id="crumbs"></div>
        <div class="content" id="content"></div>
      </div>
    </div>
    <div id="dialogHost"></div>
    <div class="toast" id="toast"></div>`;
  shadow.appendChild(wrap);

  const $ = (id) => shadow.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // ---- panel open/close ----
  const st = { open: false, view: 'root', folder: null, mode: 'grid', query: '' };
  function openPanel() { st.open = true; st.view = 'root'; $('search').value = ''; st.query = ''; $('fab').classList.add('hidden'); $('panel').classList.remove('hidden'); render(); }
  function closePanel() { st.open = false; $('panel').classList.add('hidden'); $('fab').classList.remove('hidden'); }
  $('fab').addEventListener('click', openPanel);
  $('nav').addEventListener('click', () => {
    if (st.view === 'root') closePanel();
    else { st.view = 'root'; st.folder = null; st.query = ''; $('search').value = ''; render(); }
  });
  $('addBtn').addEventListener('click', () => openDialog(null));
  $('viewToggle').addEventListener('click', () => { st.mode = st.mode === 'grid' ? 'list' : 'grid'; render(); });

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    st.query = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { st.view = st.query ? 'search' : (st.folder ? 'folder' : 'root'); render(); }, 180);
  });

  // ---- collect button ----
  function setCollectReady(ready, snippet) {
    const b = $('collect'); if (!b) return;
    b.classList.toggle('ready', !!ready);
    const s = (snippet || '').replace(/\s+/g, ' ').trim();
    $('chint').textContent = ready ? (s ? `“${s.slice(0, 44)}${s.length > 44 ? '…' : ''}”` : 'Ready — click to collect')
      : 'Hover a message, then click';
  }
  $('collect').addEventListener('click', () => {
    if (!lastHovered || !lastHovered.text) { toast('Hover a message in the chat first'); return; }
    openDialog({ text: lastHovered.text, author: lastHovered.author });
  });

  // ---- header nav state ----
  function updateHeader() {
    const nav = $('nav'), tog = $('viewToggle');
    if (st.view === 'root') { nav.innerHTML = I.close(); nav.title = 'Close'; tog.style.display = 'none'; }
    else {
      nav.innerHTML = I.back(); nav.title = 'Back';
      if (st.view === 'folder') { tog.style.display = ''; tog.innerHTML = st.mode === 'grid' ? I.list() : I.grid(); }
      else tog.style.display = 'none';
    }
  }

  // ---- render dispatch ----
  async function render() {
    updateHeader();
    $('crumbs').innerHTML = '';
    if (st.view === 'root') return renderRoot();
    if (st.view === 'folder') return renderFolder();
    if (st.view === 'search') return renderSearch();
  }

  async function renderRoot() {
    const folders = await S.folders();
    const c = $('content');
    if (!folders.length) {
      c.innerHTML = `<div class="empty">No prompts yet.<br>Hover a message in ${SOURCE} and hit <b>Collect prompt</b>.</div>`;
      return;
    }
    c.innerHTML = folders.map((f) => `
      <div class="row" data-folder="${esc(f.name)}">
        <span class="fico">${I.folder(30)}</span>
        <span class="rtext"><span class="rtitle">${esc(f.name)} <span class="pill">${f.count}</span></span></span>
      </div>`).join('');
    c.querySelectorAll('.row').forEach((r) => r.addEventListener('click', () => {
      st.folder = r.getAttribute('data-folder'); st.view = 'folder'; st.mode = 'grid'; render();
    }));
  }

  async function renderFolder() {
    $('crumbs').innerHTML = `<b>${esc(st.folder)}</b>`;
    const prompts = await S.promptsIn(st.folder);
    if (!prompts.length) { $('content').innerHTML = `<div class="empty">Empty folder.</div>`; return; }
    if (st.mode === 'grid') renderGrid(prompts); else renderList(prompts);
  }

  async function renderSearch() {
    $('crumbs').innerHTML = `Results for <b>${esc(st.query)}</b>`;
    const prompts = await S.search(st.query);
    if (!prompts.length) { $('content').innerHTML = `<div class="empty">No matches for “${esc(st.query)}”.</div>`; return; }
    renderList(prompts);
  }

  function renderGrid(prompts) {
    const c = $('content');
    c.innerHTML = `<div class="grid">${prompts.map((p) => `
      <div class="gcard" data-id="${p.id}" title="${esc(p.title)}">${I.folder(30)}<div class="glabel">${esc(p.title)}</div></div>`).join('')}</div>`;
    c.querySelectorAll('.gcard').forEach((g) => g.addEventListener('click', () => copyPrompt(g.getAttribute('data-id'))));
  }

  function renderList(prompts) {
    const c = $('content');
    c.innerHTML = prompts.map((p) => {
      const body = p.prompt || '';
      const long = body.length > 130;
      return `<div class="pcard" data-id="${p.id}">
        <span class="ham">${I.hamburger(16)}</span>
        <div class="pbody">
          <div class="ptitle">${esc(p.title)}</div>
          <div class="ptext ${long ? 'clamp' : ''}">${esc(body)}</div>
          <div class="prow2">
            ${long ? `<span class="more gradient-text">more</span>` : ''}
            <span class="ptags">${(p.tags || []).slice(0, 4).map((t) => `<span class="ptag">#${esc(t)}</span>`).join('')}</span>
            <button class="copybtn">${I.copy(14)} Copy</button>
            <button class="delbtn" title="Delete">${I.close(14)}</button>
          </div>
        </div></div>`;
    }).join('');
    c.querySelectorAll('.pcard').forEach((card) => {
      const id = card.getAttribute('data-id');
      const text = card.querySelector('.ptext');
      const more = card.querySelector('.more');
      if (more) more.addEventListener('click', () => { const cl = text.classList.toggle('clamp'); more.textContent = cl ? 'more' : 'less'; });
      card.querySelector('.copybtn').addEventListener('click', () => copyPrompt(id));
      card.querySelector('.delbtn').addEventListener('click', async () => { await S.deletePrompt(id); toast('Deleted'); render(); });
    });
  }

  // ---- copy ----
  async function copyPrompt(id) {
    const all = await S.all();
    const p = all.find((x) => x.id === id);
    if (!p) return;
    const text = p.prompt || p.template || '';
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast(`Copied “${p.title}”`);
  }

  // ---- preview / edit dialog ----
  let dlgTags = [];
  function openDialog(capture) {
    const manual = !capture;
    S.folderNames().then((existing) => {
      const text = capture ? capture.text : '';
      const title = manual ? '' : C.deriveTitle(text);
      const prompt = manual ? '' : C.clean(text);
      const template = manual ? '' : C.generalize(text);
      const folder = manual ? '' : C.suggestFolder(text, existing);
      dlgTags = manual ? [] : C.suggestTags(text);

      const dh = $('dialogHost');
      dh.innerHTML = `
        <div class="overlay" id="overlay">
          <div class="dialog">
            <div class="header">
              <span class="logo">${I.bookmark(20)}</span>
              <span class="wordmark"><span class="gradient-text">savemyprompt</span><span style="color:#37bda9">.ai</span></span>
              <span class="grow"></span>
              <button class="iconbtn" id="dlgClose">${I.close()}</button>
            </div>
            <div class="frow"><span class="eyebrow">${manual ? 'New prompt' : 'Save to library'}</span>
              <span class="src">${manual ? '' : 'from ' + SOURCE}</span></div>
            <div class="fields">
              <div class="field"><span class="flabel">Title</span><input class="input" id="d-title" placeholder="Short name" value="${esc(title)}"></div>
              <div class="field"><span class="flabel">Prompt</span><textarea class="input" id="d-prompt" rows="4" placeholder="The prompt…">${esc(prompt)}</textarea></div>
              <div class="field"><span class="flabel">Reusable template</span><textarea class="input" id="d-template" rows="3" placeholder="Version with [PLACEHOLDERS]…">${esc(template)}</textarea></div>
              <div class="field"><span class="flabel">Folder</span>
                <input class="input" id="d-folder" list="d-folders" placeholder="Category" value="${esc(folder)}">
                <datalist id="d-folders">${existing.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
                <div class="chips" id="d-folder-suggest"></div>
              </div>
              <div class="field"><span class="flabel">Tags</span><div class="chips" id="d-tags"></div>
                <input class="input" id="d-tag" placeholder="Add a tag, press Enter"></div>
            </div>
            <div class="footer">
              <button class="btn ghost" id="d-cancel">Cancel</button>
              <button class="btn primary" id="d-save">Save</button>
            </div>
          </div>
        </div>`;
      renderDlgTags();
      // folder suggestions
      const fs = $('d-folder-suggest');
      const names = [...new Set([folder, ...existing].filter(Boolean))].slice(0, 5);
      fs.innerHTML = names.map((n) => `<span class="chip suggest" data-f="${esc(n)}">${esc(n)}</span>`).join('');
      fs.querySelectorAll('.chip').forEach((ch) => ch.addEventListener('click', () => { $('d-folder').value = ch.getAttribute('data-f'); }));

      $('dlgClose').onclick = $('d-cancel').onclick = closeDialog;
      $('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeDialog(); });
      $('d-tag').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); const t = e.target.value.toLowerCase().trim(); if (!dlgTags.includes(t)) dlgTags.push(t); e.target.value = ''; renderDlgTags(); }
      });
      $('d-save').addEventListener('click', saveDialog);
    });
  }
  function renderDlgTags() {
    const box = $('d-tags'); if (!box) return;
    box.innerHTML = dlgTags.map((t, i) => `<span class="chip">#${esc(t)} <span class="x" data-i="${i}">×</span></span>`).join('');
    box.querySelectorAll('.x').forEach((x) => x.addEventListener('click', () => { dlgTags.splice(+x.getAttribute('data-i'), 1); renderDlgTags(); }));
  }
  function closeDialog() { $('dialogHost').innerHTML = ''; }
  async function saveDialog() {
    const payload = {
      title: $('d-title').value.trim() || 'Untitled',
      prompt: $('d-prompt').value.trim(),
      template: $('d-template').value.trim(),
      folder: $('d-folder').value.trim() || 'Uncategorized',
      tags: dlgTags,
      source: SOURCE,
    };
    if (!payload.prompt) { toast('Prompt is empty'); return; }
    await S.savePrompt(payload);
    closeDialog();
    toast('Saved to library');
    if (st.open) render();
  }

  // ---- toast ----
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  console.log('[SaveMyPrompt] ready on', SITE);
})();
