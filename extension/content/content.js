/* SaveMyPrompt content script — runs on many LLM chat sites.
   - A hover button appears on EVERY message → one-click save.
   - "Scan this chat" pulls every prompt from the whole conversation.
   - Deterministic cleaning/templating (no AI); local chrome.storage library. */
(function () {
  if (window.__smpLoaded) return;
  window.__smpLoaded = true;

  // claude.ai / chatgpt.com enforce Trusted Types, which makes innerHTML throw.
  // Register a default policy (in the content script's isolated world) so our
  // own generated HTML is accepted — otherwise the whole panel fails to build.
  try {
    if (window.trustedTypes && window.trustedTypes.createPolicy && !window.trustedTypes.defaultPolicy) {
      window.trustedTypes.createPolicy('default', {
        createHTML: (s) => s, createScript: (s) => s, createScriptURL: (s) => s,
      });
    }
  } catch (e) { /* isolated worlds usually don't enforce TT; ignore if blocked */ }

  const I = window.SMPIcons, C = window.SMPClean, S = window.SMPStore;

  // A stale content script left over after an extension update throws
  // "Extension context invalidated" on any chrome.* call — map that to a clear
  // instruction instead of a cryptic error.
  function friendlyErr(e) {
    const m = (e && e.message) ? e.message : String(e);
    if (/context invalidated|Extension context/i.test(m)) return 'Reload this tab — the extension was updated.';
    return m;
  }

  try {
  const host = location.host;

  // ---- site registry (tuned selectors where known; generic fallback else) ----
  const SITES = {
    'claude.ai': { name: 'Claude', user: '[data-testid="user-message"], .font-user-message', msg: '[data-testid="user-message"], .font-user-message, .font-claude-message, [data-test-render-count]' },
    'chatgpt.com': { name: 'ChatGPT', user: '[data-message-author-role="user"]', msg: '[data-message-author-role]' },
    'chat.openai.com': { name: 'ChatGPT', user: '[data-message-author-role="user"]', msg: '[data-message-author-role]' },
    'gemini.google.com': { name: 'Gemini', user: 'user-query, .query-text', msg: 'user-query, .query-text, model-response, .model-response-text, message-content' },
    'aistudio.google.com': { name: 'AI Studio', user: '[data-turn-role="User"], .user-prompt-container', msg: '[data-turn-role], .turn-content' },
    'perplexity.ai': { name: 'Perplexity', user: '[class*="whitespace-pre-line"]', msg: '[class*="whitespace-pre-line"], [class*="prose"]' },
    'poe.com': { name: 'Poe', user: '[class*="humanMessageBubble"]', msg: '[class*="MessageBubble"], [class*="Message_"]' },
    'chat.deepseek.com': { name: 'DeepSeek', user: '[class*="_user"], [class*="user-message"]', msg: '[class*="message"]' },
    'chat.mistral.ai': { name: 'Mistral', user: '[data-message-author-role="user"]', msg: '[data-message-author-role]' },
    'grok.com': { name: 'Grok', user: '[class*="message-bubble"][class*="user"], [class*="items-end"]', msg: '[class*="message-bubble"]' },
    'copilot.microsoft.com': { name: 'Copilot', user: '[data-content="user-message"]', msg: '[data-content]' },
    'meta.ai': { name: 'Meta AI', user: 'div[dir="auto"]', msg: 'div[dir="auto"]' },
  };

  function resolveSite() {
    const h = (window.__SMP_FORCE_SITE || host).toLowerCase();
    for (const key in SITES) if (h.includes(key)) return Object.assign({ generic: false }, SITES[key]);
    const base = h.replace(/^www\./, '').split('.')[0] || 'AI';
    return { name: base.charAt(0).toUpperCase() + base.slice(1), user: null, msg: null, generic: true };
  }
  const SITE = resolveSite();

  // ---- text extraction ----
  function extractText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, svg, [role="button"], .sr-only, [aria-hidden="true"], .smp-ignore').forEach((n) => n.remove());
    return C.clean(clone.innerText || clone.textContent || '');
  }
  const txt = (el) => extractText(el);

  function authorOf(el) {
    if (SITE.user) {
      try { if (el.matches(SITE.user) || el.closest(SITE.user)) return 'user'; } catch (e) {}
      return 'assistant';
    }
    const cls = String(el.className || '').toLowerCase() + ' ' + (el.getAttribute && (el.getAttribute('data-message-author-role') || '') );
    if (/user|human|query|prompt|items-end/.test(cls)) return 'user';
    if (/assistant|model|response|bot|\bai\b/.test(cls)) return 'assistant';
    return null;
  }

  // Nearest message container to an element (site selector, else generic turn).
  function messageAt(el) {
    if (!(el instanceof Element)) return null;
    if (SITE.msg) { try { const m = el.closest(SITE.msg); if (m) return m; } catch (e) {} }
    let cur = el;
    for (let i = 0; i < 14 && cur && cur !== document.body; i++) {
      const len = txt(cur).length;
      if (len >= 15 && len <= 8000) {
        const p = cur.parentElement;
        if (p) {
          const sibs = [...p.children].filter((s) => { const l = txt(s).length; return l >= 15 && l <= 8000; });
          if (sibs.length >= 2) return cur;
        }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // Every turn in the whole conversation.
  function allTurns() {
    let els = [];
    if (SITE.msg) { try { els = [...document.querySelectorAll(SITE.msg)]; } catch (e) {} }
    if (els.length < 2) els = genericTurns();
    const seen = new Set();
    return els
      .map((el) => ({ el, text: extractText(el), author: authorOf(el) }))
      .filter((t) => {
        if (!t.text || t.text.length < 2) return false;
        const k = t.text.slice(0, 80);
        if (seen.has(k)) return false; seen.add(k); return true;
      });
  }

  function genericTurns() {
    const scope = document.querySelector('main, [role="main"], [class*="conversation"], [class*="thread"], [class*="messages"]') || document.body;
    const groups = new Map();
    scope.querySelectorAll('div, article, section, li').forEach((el) => {
      const len = txt(el).length;
      if (len < 15 || len > 8000) return;
      const p = el.parentElement; if (!p) return;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
    });
    let best = [], n = 0;
    for (const arr of groups.values()) if (arr.length > n) { n = arr.length; best = arr; }
    return n >= 2 ? best : [];
  }

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

  const scanIco = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5a1 1 0 0 1 1-1h2M4 17v2a1 1 0 0 0 1 1h2M20 7V5a1 1 0 0 0-1-1h-2M20 17v2a1 1 0 0 1-1 1h-2M4 12h16"/></svg>`;
  const plusIco = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <div class="hoverbtn" id="hoverbtn" title="Save this message">${I.bookmark(17)}</div>
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
        <div class="actions">
          <button class="actionbtn primary" id="scan"><span class="aico">${scanIco}</span> Scan this chat</button>
        </div>
        <div class="searchbar">${I.search()}<input id="search" placeholder="Search saved prompts…" spellcheck="false"></div>
        <div class="crumbs" id="crumbs"></div>
        <div class="content" id="content"></div>
      </div>
    </div>
    <div id="dialogHost"></div>
    <div class="toast" id="toast"></div>`;
  shadow.appendChild(wrap);

  const $ = (id) => shadow.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---- per-message hover button ----
  const hb = $('hoverbtn');
  let hbMsg = null, hbOver = false, hideTimer = null;
  function positionHb(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.bottom < 0 || r.top > innerHeight) { hideHb(); return; }
    hb.style.left = clamp(r.right - 38, 8, innerWidth - 40) + 'px';
    hb.style.top = clamp(r.top + 6, 8, innerHeight - 40) + 'px';
  }
  function showHb() { hb.classList.add('show'); }
  function clearHighlight() { if (hbMsg) hbMsg.classList.remove('smp-hover-target'); }
  function hideHb() { hb.classList.remove('show'); clearHighlight(); hbMsg = null; }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!hbOver) hideHb(); }, 320); }

  // Single decision point: show when the cursor is over a message, keep it while
  // stationary, hide only when the cursor moves to a non-message area.
  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (rootHost.contains(t)) { clearTimeout(hideTimer); return; } // over our own UI
    const msg = messageAt(t);
    if (!msg) { scheduleHide(); return; }
    const text = extractText(msg);
    if (!text || text.length < 2) { scheduleHide(); return; }
    clearTimeout(hideTimer);
    if (msg !== hbMsg) { clearHighlight(); msg.classList.add('smp-hover-target'); }
    hbMsg = msg;
    hb._payload = { text, author: authorOf(msg) };
    positionHb(msg);
    showHb();
  }, true);
  hb.addEventListener('mouseenter', () => { hbOver = true; clearTimeout(hideTimer); });
  hb.addEventListener('mouseleave', () => { hbOver = false; scheduleHide(); });
  hb.addEventListener('click', (e) => { e.stopPropagation(); if (hb._payload) openDialog(hb._payload); });
  window.addEventListener('scroll', () => { if (hbMsg && hb.classList.contains('show')) positionHb(hbMsg); }, true);

  // ---- panel ----
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
  $('scan').addEventListener('click', () => { st.view = 'scan'; render(); });

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    st.query = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { st.view = st.query ? 'search' : (st.folder ? 'folder' : 'root'); render(); }, 180);
  });

  function updateHeader() {
    const nav = $('nav'), tog = $('viewToggle');
    if (st.view === 'root') { nav.innerHTML = I.close(); nav.title = 'Close'; tog.style.display = 'none'; }
    else {
      nav.innerHTML = I.back(); nav.title = 'Back';
      if (st.view === 'folder') { tog.style.display = ''; tog.innerHTML = st.mode === 'grid' ? I.list() : I.grid(); }
      else tog.style.display = 'none';
    }
  }

  let rseq = 0;
  async function render() {
    const seq = ++rseq;
    updateHeader();
    $('crumbs').innerHTML = '';
    if (st.view === 'root') return renderRoot(seq);
    if (st.view === 'scan') return renderScan(seq);
    if (st.view === 'folder') return renderFolder(seq);
    if (st.view === 'search') return renderSearch(seq);
  }

  // ---- scan whole chat ----
  async function renderScan(seq) {
    const turns = allTurns();
    if (seq !== rseq) return;
    const c = $('content');
    if (!turns.length) {
      c.innerHTML = `<div class="empty">Couldn't find messages on this page.<br>Try scrolling the chat once, then Scan again.</div>`;
      return;
    }
    const rows = turns.map((t, i) => `
      <div class="scanrow"><span class="role ${t.author === 'assistant' ? 'assistant' : ''}">${t.author || 'msg'}</span>
        <div class="stext">${esc(t.text)}</div>
        <button class="ssave" data-i="${i}">Save</button></div>`).join('');
    c.innerHTML = `<div class="scanhead"><span class="count">${turns.length} messages in this chat</span>
      <span class="saveall gradient-text" id="saveall">Save all prompts</span></div>${rows}`;
    c.querySelectorAll('.ssave').forEach((b) => b.addEventListener('click', () => {
      const t = turns[+b.getAttribute('data-i')]; openDialog({ text: t.text, author: t.author });
    }));
    $('saveall').addEventListener('click', () => saveAll(turns));
  }

  async function saveAll(turns) {
    try {
      const existing = await S.folderNames();
      const targets = turns.filter((t) => t.author !== 'assistant');
      const list = targets.length ? targets : turns;
      for (const t of list) {
        await S.savePrompt({
          title: C.deriveTitle(t.text), prompt: C.clean(t.text), template: C.generalize(t.text),
          folder: C.suggestFolder(t.text, existing), tags: C.suggestTags(t.text), source: SITE.name,
        });
      }
      toast(`Saved ${list.length} prompt${list.length === 1 ? '' : 's'}`);
      st.view = 'root'; render();
    } catch (e) {
      console.error('[SaveMyPrompt] save all failed:', e);
      toast('Save failed: ' + friendlyErr(e));
    }
  }

  // ---- library ----
  async function renderRoot(seq) {
    const folders = await S.folders();
    if (seq !== rseq) return;
    const c = $('content');
    if (!folders.length) { c.innerHTML = `<div class="empty">No prompts yet.<br>Hover any message and hit the <b>bookmark</b>, or use <b>Scan this chat</b>.</div>`; return; }
    c.innerHTML = folders.map((f) => `
      <div class="row" data-folder="${esc(f.name)}"><span class="fico">${I.folder(30)}</span>
        <span class="rtext"><span class="rtitle">${esc(f.name)} <span class="pill">${f.count}</span></span></span></div>`).join('');
    c.querySelectorAll('.row').forEach((r) => r.addEventListener('click', () => { st.folder = r.getAttribute('data-folder'); st.view = 'folder'; st.mode = 'grid'; render(); }));
  }
  async function renderFolder(seq) {
    $('crumbs').innerHTML = `<b>${esc(st.folder)}</b>`;
    const prompts = await S.promptsIn(st.folder);
    if (seq !== rseq) return;
    if (!prompts.length) { $('content').innerHTML = `<div class="empty">Empty folder.</div>`; return; }
    st.mode === 'grid' ? renderGrid(prompts) : renderList(prompts);
  }
  async function renderSearch(seq) {
    $('crumbs').innerHTML = `Results for <b>${esc(st.query)}</b>`;
    const prompts = await S.search(st.query);
    if (seq !== rseq) return;
    if (!prompts.length) { $('content').innerHTML = `<div class="empty">No matches for “${esc(st.query)}”.</div>`; return; }
    renderList(prompts);
  }
  function renderGrid(prompts) {
    const c = $('content');
    c.innerHTML = `<div class="grid">${prompts.map((p) => `<div class="gcard" data-id="${p.id}" title="${esc(p.title)}">${I.folder(30)}<div class="glabel">${esc(p.title)}</div></div>`).join('')}</div>`;
    c.querySelectorAll('.gcard').forEach((g) => g.addEventListener('click', () => copyPrompt(g.getAttribute('data-id'))));
  }
  function renderList(prompts) {
    const c = $('content');
    c.innerHTML = prompts.map((p) => {
      const long = (p.prompt || '').length > 130;
      return `<div class="pcard" data-id="${p.id}"><span class="ham">${I.hamburger(16)}</span><div class="pbody">
        <div class="ptitle">${esc(p.title)}</div><div class="ptext ${long ? 'clamp' : ''}">${esc(p.prompt || '')}</div>
        <div class="prow2">${long ? `<span class="more gradient-text">more</span>` : ''}
          <span class="ptags">${(p.tags || []).slice(0, 4).map((t) => `<span class="ptag">#${esc(t)}</span>`).join('')}</span>
          <button class="copybtn">${I.copy(14)} Copy</button><button class="delbtn" title="Delete">${I.close(14)}</button></div></div></div>`;
    }).join('');
    c.querySelectorAll('.pcard').forEach((card) => {
      const id = card.getAttribute('data-id');
      const text = card.querySelector('.ptext'), more = card.querySelector('.more');
      if (more) more.addEventListener('click', () => { const cl = text.classList.toggle('clamp'); more.textContent = cl ? 'more' : 'less'; });
      card.querySelector('.copybtn').addEventListener('click', () => copyPrompt(id));
      card.querySelector('.delbtn').addEventListener('click', async () => { await S.deletePrompt(id); toast('Deleted'); render(); });
    });
  }

  async function copyPrompt(id) {
    const p = (await S.all()).find((x) => x.id === id);
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
      $('dialogHost').innerHTML = `
        <div class="overlay" id="overlay"><div class="dialog">
          <div class="header"><span class="logo">${I.bookmark(20)}</span>
            <span class="wordmark"><span class="gradient-text">savemyprompt</span><span style="color:#37bda9">.ai</span></span>
            <span class="grow"></span><button class="iconbtn" id="dlgClose">${I.close()}</button></div>
          <div class="frow"><span class="eyebrow">${manual ? 'New prompt' : 'Save to library'}</span><span class="src">${manual ? '' : 'from ' + SITE.name}</span></div>
          <div class="fields">
            <div class="field"><span class="flabel">Title</span><input class="input" id="d-title" placeholder="Short name" value="${esc(title)}"></div>
            <div class="field"><span class="flabel">Prompt</span><textarea class="input" id="d-prompt" rows="4">${esc(prompt)}</textarea></div>
            <div class="field"><span class="flabel">Reusable template</span><textarea class="input" id="d-template" rows="3" placeholder="Version with [PLACEHOLDERS]…">${esc(template)}</textarea></div>
            <div class="field"><span class="flabel">Folder</span><input class="input" id="d-folder" list="d-folders" placeholder="Category" value="${esc(folder)}">
              <datalist id="d-folders">${existing.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
              <div class="chips" id="d-folder-suggest"></div></div>
            <div class="field"><span class="flabel">Tags</span><div class="chips" id="d-tags"></div><input class="input" id="d-tag" placeholder="Add a tag, press Enter"></div>
          </div>
          <div class="footer"><button class="btn ghost" id="d-cancel">Cancel</button><button class="btn primary" id="d-save">Save</button></div>
        </div></div>`;
      renderDlgTags();
      const names = [...new Set([folder, ...existing].filter(Boolean))].slice(0, 5);
      const fs = $('d-folder-suggest');
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
      title: $('d-title').value.trim() || 'Untitled', prompt: $('d-prompt').value.trim(),
      template: $('d-template').value.trim(), folder: $('d-folder').value.trim() || 'Uncategorized',
      tags: dlgTags, source: SITE.name,
    };
    if (!payload.prompt) { toast('Prompt is empty'); return; }
    try {
      await S.savePrompt(payload);
      const n = (await S.all()).length;
      closeDialog();
      toast(`Saved ✓ — ${n} in library`);
      if (st.open) render();
    } catch (e) {
      console.error('[SaveMyPrompt] save failed:', e);
      toast('Save failed: ' + friendlyErr(e));
    }
  }

  let toastTimer;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1900); }

  console.log('[SaveMyPrompt] ready on', SITE.name, SITE.generic ? '(generic)' : '');
  } catch (e) {
    console.error('[SaveMyPrompt] init failed:', e);
  }
})();
