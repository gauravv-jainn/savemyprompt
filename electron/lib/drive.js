'use strict';
// Phase 6 — Google Drive backend. The ONLY storage. A root "Prompt Library"
// folder holds one subfolder per category; each prompt is a Markdown file with
// tags mirrored into appProperties for querying. Output files (e.g. generated
// images) upload alongside their prompt.
const { Readable } = require('stream');
const { google } = require('googleapis');
const { existingClient } = require('./auth');
const { getSettings } = require('./config');
const log = require('./log');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
let _rootId = null;

function drive() {
  const auth = existingClient();
  if (!auth) throw new Error('not signed in to Google');
  return google.drive({ version: 'v3', auth });
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ---- Root + folders -------------------------------------------------------

async function ensureRoot() {
  if (_rootId) return _rootId;
  const s = getSettings();
  const d = drive();
  if (s.driveRootFolderId) {
    // Shared team folder configured explicitly.
    await d.files.get({ fileId: s.driveRootFolderId, fields: 'id,name' });
    _rootId = s.driveRootFolderId;
    return _rootId;
  }
  // Otherwise find/create "Prompt Library" in My Drive.
  const name = s.driveRootFolderName;
  const res = await d.files.list({
    q: `mimeType='${FOLDER_MIME}' and name='${esc(name)}' and 'root' in parents and trashed=false`,
    fields: 'files(id,name)',
    spaces: 'drive',
  });
  if (res.data.files.length) {
    _rootId = res.data.files[0].id;
  } else {
    const created = await d.files.create({
      requestBody: { name, mimeType: FOLDER_MIME },
      fields: 'id',
    });
    _rootId = created.data.id;
    log.info('drive: created root folder', _rootId,
      '— share this folder with your team so everyone sees the same library.');
  }
  return _rootId;
}

/** Find/create a category subfolder under root. `subtitle` -> folder description. */
async function ensureFolder(name, subtitle) {
  const d = drive();
  const root = await ensureRoot();
  const res = await d.files.list({
    q: `mimeType='${FOLDER_MIME}' and name='${esc(name)}' and '${root}' in parents and trashed=false`,
    fields: 'files(id,name,description)',
  });
  if (res.data.files.length) return res.data.files[0].id;
  const created = await d.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [root],
      description: subtitle || undefined,
    },
    fields: 'id',
  });
  log.info('drive: created folder', name, created.data.id);
  return created.data.id;
}

async function listFolders() {
  const d = drive();
  const root = await ensureRoot();
  const res = await d.files.list({
    q: `mimeType='${FOLDER_MIME}' and '${root}' in parents and trashed=false`,
    fields: 'files(id,name,description,modifiedTime)',
    orderBy: 'modifiedTime desc',
  });
  return res.data.files.map((f) => ({
    id: f.id,
    name: f.name,
    subtitle: f.description || null,
    modified: f.modifiedTime,
  }));
}

// ---- Saving ---------------------------------------------------------------

function buildMarkdown({ title, extracted, template, tags, folder, confidence, source }) {
  return `# ${title}

## Prompt
${extracted}

## Reusable template
${template}

---
tags: ${(tags || []).join(', ')}
folder: ${folder}
confidence: ${confidence || 'high'}
source: ${source || 'unknown'}
`;
}

function uploadStream(text) {
  return Readable.from([Buffer.from(text, 'utf8')]);
}

// Drive `appProperties has { key and value }` matches values EXACTLY, so a CSV
// "tags" value can't be queried per-tag. Store each tag as its own key too.
function tagKey(tag) {
  return 't_' + String(tag).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
}

/**
 * Save a confirmed prompt. Optionally attach an output file (image, etc.).
 * Returns { promptId, folderId, outputId? }.
 */
async function savePrompt(entry) {
  const {
    title, extracted, template, tags = [], folder, confidence = 'high',
    source = 'unknown', outputFile, // { name, mimeType, data(base64) }
  } = entry;
  const d = drive();
  const folderId = await ensureFolder(folder);

  const md = buildMarkdown({ title, extracted, template, tags, folder, confidence, source });
  const preview = extracted.replace(/\s+/g, ' ').slice(0, 110);

  const created = await d.files.create({
    requestBody: {
      name: `${title}.md`.replace(/[\/\\]/g, '-'),
      parents: [folderId],
      mimeType: 'text/markdown',
      description: preview,
      appProperties: {
        smp: 'prompt',
        tags: tags.join(','),
        folder,
        confidence,
        source,
        preview,
        // one key per tag so `appProperties has { key='t_<tag>' }` can match.
        ...Object.fromEntries(tags.map((t) => [tagKey(t), '1'])),
      },
    },
    media: { mimeType: 'text/markdown', body: uploadStream(md) },
    fields: 'id,name',
  });
  const promptId = created.data.id;
  log.info('drive: saved prompt', promptId, title);

  let outputId = null;
  if (outputFile && outputFile.data) {
    const buf = Buffer.from(outputFile.data, 'base64');
    const out = await d.files.create({
      requestBody: {
        name: outputFile.name || `${title}-output`,
        parents: [folderId],
        mimeType: outputFile.mimeType || 'application/octet-stream',
        appProperties: { smp: 'output', promptId, tags: tags.join(',') },
      },
      media: { mimeType: outputFile.mimeType, body: Readable.from([buf]) },
      fields: 'id',
    });
    outputId = out.data.id;
    // Link the prompt back to its output.
    await d.files.update({
      fileId: promptId,
      requestBody: { appProperties: { outputId } },
    });
    log.info('drive: saved output file', outputId);
  }

  return { promptId, folderId, outputId };
}

// ---- Reading --------------------------------------------------------------

function parseMarkdown(md) {
  const prompt = (md.match(/## Prompt\n([\s\S]*?)\n## /) || [])[1] || '';
  const template = (md.match(/## Reusable template\n([\s\S]*?)\n---/) || [])[1] || '';
  return { prompt: prompt.trim(), template: template.trim() };
}

async function getContent(fileId) {
  const d = drive();
  const res = await d.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  const md = String(res.data);
  const { prompt, template } = parseMarkdown(md);
  return { markdown: md, prompt, template };
}

async function listPrompts(folderId) {
  const d = drive();
  const res = await d.files.list({
    q: `'${folderId}' in parents and appProperties has { key='smp' and value='prompt' } and trashed=false`,
    fields: 'files(id,name,description,appProperties,modifiedTime)',
    orderBy: 'modifiedTime desc',
  });
  return res.data.files.map(mapPromptFile);
}

function mapPromptFile(f) {
  const ap = f.appProperties || {};
  return {
    id: f.id,
    title: f.name.replace(/\.md$/, ''),
    preview: ap.preview || f.description || '',
    tags: ap.tags ? ap.tags.split(',').filter(Boolean) : [],
    folder: ap.folder || null,
    confidence: ap.confidence || null,
    source: ap.source || null,
    modified: f.modifiedTime,
  };
}

/** Search prompts by name, content (fullText), or tag. */
async function search(query) {
  const d = drive();
  let q = "trashed=false and appProperties has { key='smp' and value='prompt' }";
  const term = (query || '').trim();
  if (term) {
    const e = esc(term);
    const tk = tagKey(term);
    q += ` and (name contains '${e}' or fullText contains '${e}' or appProperties has { key='${tk}' })`;
  }
  const res = await d.files.list({
    q,
    fields: 'files(id,name,description,appProperties,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 100,
  });
  return res.data.files.map(mapPromptFile);
}

/** Build the taxonomy passed to Ollama: existing folders + distinct tags. */
async function getTaxonomy() {
  const folders = await listFolders();
  const recent = await search('');
  const tagSet = new Set();
  for (const p of recent) p.tags.forEach((t) => tagSet.add(t));
  return {
    folders: folders.map((f) => ({ name: f.name, subtitle: f.subtitle })),
    tags: Array.from(tagSet).slice(0, 60),
  };
}

module.exports = {
  ensureRoot,
  ensureFolder,
  listFolders,
  listPrompts,
  savePrompt,
  getContent,
  search,
  getTaxonomy,
};
