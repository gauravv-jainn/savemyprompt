'use strict';
// Phase 4 — local Ollama integration. Sends the hovered message + surrounding
// conversation + the team's existing taxonomy, and asks for a structured JSON
// object (extracted prompt, reusable template, folder match, tags, confidence).
const http = require('http');
const { getSettings } = require('./config');
const log = require('./log');

function endpoint(pathname) {
  const base = getSettings().ollamaUrl.replace(/\/$/, '');
  return base + pathname;
}

function postJson(url, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(chunks)); }
            catch (e) { reject(new Error('bad JSON from Ollama: ' + e.message)); }
          } else {
            reject(new Error(`Ollama HTTP ${res.statusCode}: ${chunks.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Ollama request timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.get(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname, timeout: timeoutMs },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try { resolve(JSON.parse(chunks)); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

/** Is Ollama up? Returns { ok, models } or { ok:false, error }. */
async function status() {
  try {
    const tags = await getJson(endpoint('/api/tags'));
    const models = (tags.models || []).map((m) => m.name);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const SYSTEM = `You are a prompt librarian for a marketing / creative agency. You turn a raw chat message into a reusable, well-organized library entry. You always return a single JSON object and nothing else.`;

function buildPrompt({ hovered, context, taxonomy }) {
  const convo = (context || [])
    .map((m) => {
      const who = m.author === 'user' ? 'USER' : m.author === 'assistant' ? 'ASSISTANT' : 'MESSAGE';
      return `[${who}] ${m.text}`;
    })
    .join('\n\n');

  const folders = (taxonomy.folders || []).map((f) => f.name);
  const tags = taxonomy.tags || [];

  return `${SYSTEM}

## Existing library taxonomy (MATCH these — do not invent new ones unless nothing fits)
Folders/categories: ${folders.length ? folders.join(', ') : '(none yet)'}
Common tags: ${tags.length ? tags.join(', ') : '(none yet)'}

## Surrounding conversation (oldest to newest, for context)
${convo || '(no surrounding context captured)'}

## The message the user wants to save (this is the focus)
${hovered.text}

## Your task
Return ONLY a JSON object with EXACTLY these keys:
{
  "extracted_prompt": "the effective prompt this message represents, folding in any refinements or constraints established earlier in the conversation, cleaned up and self-contained",
  "generalized_template": "a reusable version of that prompt with [SQUARE_BRACKET_PLACEHOLDERS] where instance-specific details (client names, product, dates, numbers, locations, style specifics) should go",
  "suggested_folder": "a short 1-3 word category naming what this prompt is FOR (its topic/use-case)",
  "tags": ["3 to 5 lowercase topical tags"],
  "confidence": "high or low"
}

Folder rules:
- Choose an existing folder ONLY if it clearly describes this prompt's TOPIC or use-case. Do NOT match a folder just because it exists.
- If no existing folder genuinely fits, invent a concise new one named after the domain/task (e.g. "Real Estate Copy", "Ad Headlines", "Image Generation"). A good new folder beats a bad match.

Tag rules:
- Tags describe the prompt's domain + task (e.g. ["real-estate", "sales-script", "copywriting"]). Prefer the common tags above only when they truly apply. No generic filler like "prompt", "ai", "text".

Output rules: valid JSON only, no prose, no markdown fences. Keep placeholders in ALL_CAPS inside square brackets. For image-generation prompts, keep the visual/style details but placeholder the subject/brand specifics.`;
}

function coerceResult(raw) {
  // Ollama with format:"json" returns { response: "<json string>" }.
  let obj = {};
  try {
    obj = typeof raw.response === 'string' ? JSON.parse(raw.response) : raw.response || {};
  } catch (e) {
    log.warn('ollama: could not parse response JSON, attempting salvage');
    const m = String(raw.response || '').match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch {} }
  }
  return {
    extracted_prompt: String(obj.extracted_prompt || '').trim(),
    generalized_template: String(obj.generalized_template || '').trim(),
    suggested_folder: String(obj.suggested_folder || '').trim() || 'Uncategorized',
    tags: Array.isArray(obj.tags)
      ? obj.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : [],
    confidence: obj.confidence === 'low' ? 'low' : 'high',
  };
}

/** Run the model. Returns the coerced result object (never throws on bad JSON). */
async function process({ hovered, context, taxonomy }) {
  const model = getSettings().ollamaModel;
  const prompt = buildPrompt({ hovered, context, taxonomy: taxonomy || {} });
  log.debug('ollama: generating with model', model);
  const raw = await postJson(endpoint('/api/generate'), {
    model,
    prompt,
    format: 'json',
    stream: false,
    keep_alive: '30m', // stay loaded between saves so only the 1st is a cold start
    options: { temperature: 0.2 },
  });
  return coerceResult(raw);
}

// Preload the model into memory (fire-and-forget) so the first real save is fast.
// Triggered when the user starts hovering messages in a target app.
let warmed = false;
let lastWarmAttempt = 0;
async function warm() {
  if (warmed) return;
  // Throttle retries so a downed Ollama can't cause a request storm on hover.
  const now = Date.now();
  if (now - lastWarmAttempt < 60000) return;
  lastWarmAttempt = now;
  const model = getSettings().ollamaModel;
  try {
    await postJson(endpoint('/api/generate'),
      { model, prompt: 'ok', stream: false, keep_alive: '30m', options: { num_predict: 1 } },
      300000);
    warmed = true;
    log.debug('ollama: model warmed');
  } catch (e) {
    log.debug('ollama: warm failed', e.message || 'connection error');
  }
}

module.exports = { status, process, buildPrompt, coerceResult, warm };
