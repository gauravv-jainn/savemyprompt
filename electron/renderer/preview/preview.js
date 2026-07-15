'use strict';
// Standalone visual preview (opened directly in a browser, no Electron bridge).
if (!window.smp) {
  window.smp = { on() {}, closePreview() {}, save() {}, async pickOutputFile() { return null; } };
}
const I = window.SMPIcons;
document.getElementById('logo').innerHTML = I.bookmark(20);
document.getElementById('wordmark').innerHTML = I.wordmark();
document.getElementById('close').innerHTML = I.close();

const el = (id) => document.getElementById(id);
const state = { tags: [], source: 'unknown', taxonomy: { folders: [], tags: [] }, output: null };
el('attach-ico').innerHTML = I.tray(16);

// ---- events from main ----
function applyCapture(data) {
  reset();
  state.source = (data.app && data.app.name) || 'unknown';
  el('src').textContent = state.source ? `from ${state.source}` : '';
  // Seed the prompt field with the raw text immediately (before the model).
  el('f-prompt').value = (data.hovered && data.hovered.text) || '';
  renderContext(data.context || []);
  showLoading(true);
}
function applyResult({ result, taxonomy }) {
  state.taxonomy = taxonomy || state.taxonomy;
  fillFolderList();
  el('f-prompt').value = result.extracted_prompt || el('f-prompt').value;
  el('f-template').value = result.generalized_template || '';
  el('f-folder').value = result.suggested_folder || '';
  el('f-title').value = deriveTitle(result.extracted_prompt);
  setConfidence(result.confidence);
  setTags(result.tags || []);
  renderFolderSuggestions(result.suggested_folder);
  showLoading(false);
  validate();
}
window.smp.on('preview:capture', applyCapture);
window.smp.on('preview:result', applyResult);

window.smp.on('preview:error', ({ text }) => {
  showLoading(false);
  showNotice('error', text);
  validate();
});

window.smp.on('preview:notice', ({ level, text }) => showNotice(level, text));

// ---- helpers ----
function reset() {
  el('notice').className = 'notice hidden';
  state.tags = [];
  state.output = null;
  ['f-title', 'f-prompt', 'f-template', 'f-folder', 'f-tag'].forEach((id) => (el(id).value = ''));
  el('tags').innerHTML = '';
  el('folder-suggest').innerHTML = '';
  el('conf').className = 'conf';
  el('conf').textContent = '';
  el('attach').classList.remove('has-file');
  el('attach-label').textContent = 'Attach an image or file…';
}

function deriveTitle(text) {
  if (!text) return '';
  const firstLine = String(text).split('\n')[0].replace(/[#*`>]/g, '').trim();
  return firstLine.length > 48 ? firstLine.slice(0, 48).trim() + '…' : firstLine;
}

function setConfidence(c) {
  const node = el('conf');
  if (c === 'low') { node.className = 'conf low'; node.textContent = 'low confidence'; }
  else { node.className = 'conf high'; node.textContent = 'high confidence'; }
}

function setTags(tags) {
  state.tags = [...new Set(tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean))];
  renderTags();
}
function renderTags() {
  el('tags').innerHTML = '';
  state.tags.forEach((t, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `#${t} <span class="x" data-i="${i}">×</span>`;
    chip.querySelector('.x').onclick = () => { state.tags.splice(i, 1); renderTags(); };
    el('tags').appendChild(chip);
  });
}

function fillFolderList() {
  const dl = el('folderlist');
  dl.innerHTML = '';
  (state.taxonomy.folders || []).forEach((f) => {
    const o = document.createElement('option');
    o.value = f.name;
    dl.appendChild(o);
  });
}

function renderFolderSuggestions(suggested) {
  const wrap = el('folder-suggest');
  wrap.innerHTML = '';
  const names = new Set();
  if (suggested) names.add(suggested);
  (state.taxonomy.folders || []).slice(0, 5).forEach((f) => names.add(f.name));
  [...names].slice(0, 6).forEach((name) => {
    const c = document.createElement('span');
    c.className = 'chip suggest';
    c.textContent = name;
    c.onclick = () => { el('f-folder').value = name; validate(); };
    wrap.appendChild(c);
  });
}

function renderContext(ctx) {
  const body = el('ctx-body');
  el('ctx-summary').textContent = `Captured context (${ctx.length} message${ctx.length === 1 ? '' : 's'})`;
  body.innerHTML = '';
  ctx.forEach((m) => {
    const d = document.createElement('div');
    d.className = 'ctx-msg';
    const who = m.author ? m.author.toUpperCase() : 'MESSAGE';
    d.innerHTML = `<b>${who}</b> ${escapeHtml((m.text || '').slice(0, 400))}`;
    body.appendChild(d);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function showLoading(on) { el('loading').classList.toggle('show', on); }
function showNotice(level, text) {
  const n = el('notice');
  n.className = `notice ${level}`;
  n.textContent = text;
}

function validate() {
  const ok = el('f-prompt').value.trim() && el('f-folder').value.trim() && el('f-title').value.trim();
  el('save').disabled = !ok;
}

// ---- tag input ----
el('f-tag').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    e.preventDefault();
    const t = e.target.value.toLowerCase().trim();
    if (!state.tags.includes(t)) { state.tags.push(t); renderTags(); }
    e.target.value = '';
  }
});
['f-prompt', 'f-folder', 'f-title'].forEach((id) => el(id).addEventListener('input', validate));

// ---- attach output file ----
el('attach').onclick = async () => {
  try {
    const file = await window.smp.pickOutputFile();
    if (!file) return;
    state.output = file;
    el('attach').classList.add('has-file');
    el('attach-label').textContent = file.name;
  } catch (e) { /* cancelled */ }
};

// ---- actions ----
el('cancel').onclick = () => window.smp.closePreview();
el('close').onclick = () => window.smp.closePreview();

el('save').onclick = async () => {
  const payload = {
    title: el('f-title').value.trim(),
    extracted: el('f-prompt').value.trim(),
    template: el('f-template').value.trim(),
    folder: el('f-folder').value.trim(),
    tags: state.tags,
    confidence: el('conf').classList.contains('low') ? 'low' : 'high',
    source: state.source,
    outputFile: state.output || undefined,
  };
  el('save').disabled = true;
  el('save').textContent = 'Saving…';
  try {
    await window.smp.save(payload);
  } catch (e) {
    showNotice('error', 'Save failed: ' + e.message);
    el('save').textContent = 'Save to Drive';
    validate();
  }
};

// ---- standalone visual QA (?demo) ----
if (location.search.includes('demo')) {
  applyCapture({
    app: { name: 'ChatGPT' },
    hovered: { text: 'make me a product photo of the new sneaker on a white background' },
    context: [
      { author: 'user', text: 'We are launching the Nike Air Max in coral. Need studio shots.' },
      { author: 'assistant', text: 'Sure — what background and lighting do you want?' },
      { author: 'user', text: 'make me a product photo of the new sneaker on a white background' },
    ],
  });
  setTimeout(() => applyResult({
    result: {
      extracted_prompt: 'Studio product photograph of the Nike Air Max (coral colorway) centered on a seamless pure-white background, soft key light from the left with a subtle rim light, shot on an 85mm lens, shallow depth of field, ultra-sharp, high-end commercial product photography, no text or props.',
      generalized_template: 'Studio product photograph of [PRODUCT] ([COLORWAY]) centered on a seamless [BACKGROUND_COLOR] background, soft key light from the [DIRECTION], subtle rim light, shot on an [LENS], shallow depth of field, ultra-sharp, high-end commercial product photography, no text or props.',
      suggested_folder: 'Image Generation',
      tags: ['image', 'product', 'studio', 'ecommerce'],
      confidence: 'high',
    },
    taxonomy: { folders: [{ name: 'Image Generation' }, { name: 'Nike — Spring Campaign' }, { name: 'Email Copy' }, { name: 'Ad Headlines' }], tags: ['image', 'email', 'campaign'] },
  }), 650);
}
