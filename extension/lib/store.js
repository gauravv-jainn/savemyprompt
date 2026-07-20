/* Local library storage on chrome.storage.local. Shape:
   { prompts: [ {id,title,prompt,template,folder,tags[],source,createdAt} ] }
   Folders are derived from the prompts' folder field. */
(function () {
  const KEY = 'smp_library';

  function read() {
    return new Promise((resolve) => {
      chrome.storage.local.get(KEY, (o) => resolve((o && o[KEY]) || { prompts: [] }));
    });
  }
  function write(lib) {
    return new Promise((resolve) => chrome.storage.local.set({ [KEY]: lib }, resolve));
  }

  function uid() {
    return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  async function savePrompt(entry) {
    const lib = await read();
    const rec = {
      id: uid(),
      title: (entry.title || 'Untitled').trim(),
      prompt: (entry.prompt || '').trim(),
      template: (entry.template || '').trim(),
      folder: (entry.folder || 'Uncategorized').trim(),
      tags: Array.isArray(entry.tags) ? entry.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean) : [],
      source: entry.source || 'unknown',
      createdAt: Date.now(),
    };
    lib.prompts.unshift(rec);
    await write(lib);
    return rec;
  }

  async function updatePrompt(id, patch) {
    const lib = await read();
    const p = lib.prompts.find((x) => x.id === id);
    if (p) { Object.assign(p, patch); await write(lib); }
    return p;
  }

  async function deletePrompt(id) {
    const lib = await read();
    lib.prompts = lib.prompts.filter((x) => x.id !== id);
    await write(lib);
  }

  async function folders() {
    const lib = await read();
    const map = new Map();
    for (const p of lib.prompts) {
      const f = p.folder || 'Uncategorized';
      map.set(f, (map.get(f) || 0) + 1);
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }
  async function folderNames() {
    return (await folders()).map((f) => f.name);
  }

  async function promptsIn(folder) {
    const lib = await read();
    return lib.prompts.filter((p) => (p.folder || 'Uncategorized') === folder);
  }

  async function search(q) {
    const lib = await read();
    const term = (q || '').trim().toLowerCase();
    if (!term) return lib.prompts;
    return lib.prompts.filter((p) =>
      (p.title + ' ' + p.prompt + ' ' + p.template + ' ' + (p.tags || []).join(' ') + ' ' + p.folder)
        .toLowerCase()
        .includes(term)
    );
  }

  async function all() {
    return (await read()).prompts;
  }

  window.SMPStore = { savePrompt, updatePrompt, deletePrompt, folders, folderNames, promptsIn, search, all };
})();
