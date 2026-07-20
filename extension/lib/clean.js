/* Deterministic prompt processing — NO AI.
   Cleans a raw message, derives a reusable template with [PLACEHOLDERS], and
   suggests a folder + tags by keyword matching. All pure string/regex logic. */
(function () {
  // ---- cleaning ----
  function clean(raw) {
    if (!raw) return '';
    let t = raw.replace(/\r/g, '');
    // Drop trailing UI cruft some copies include.
    t = t.replace(/\n(Copy|Copy code|Edit|Retry|Share|Good response|Bad response)\b.*$/gim, '');
    // Collapse 3+ blank lines, trim each line's trailing space.
    t = t.split('\n').map((l) => l.replace(/[ \t]+$/g, '')).join('\n');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    return t;
  }

  // ---- generalize into a template ----
  // Order matters: specific patterns before the generic number sweep.
  function generalize(raw) {
    let t = clean(raw);
    const rules = [
      [/https?:\/\/[^\s)]+/g, '[URL]'],
      [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[EMAIL]'],
      [/[₹$€£]\s?\d[\d,]*(?:\.\d+)?/g, '[PRICE]'],
      [/\b\d{4}-\d{2}-\d{2}\b/g, '[DATE]'],
      [/\b\d{1,2}:\d{2}\s?(?:am|pm)?\b/gi, '[TIME]'],
      [/\b\d[\d,]*(?:\.\d+)?\s?(?:px|cm|mm|m|km|kg|g|ft|feet|foot|inch|inches|sq\.?\s?ft|square\s?feet|square\s?met(?:er|re)s?)\b/gi, '[SIZE]'],
      [/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, '[NUMBER]'],
      ['"[^"\\n]{1,80}"', '[TEXT]'],        // "quoted phrases"
      ['“[^”\\n]{1,80}”', '[TEXT]'],        // smart quotes
      [/\b\d+(?:\.\d+)?\b/g, '[NUMBER]'],   // remaining bare numbers
    ];
    for (const [pat, rep] of rules) {
      const re = pat instanceof RegExp ? pat : new RegExp(pat, 'g');
      t = t.replace(re, rep);
    }
    // Collapse runs of identical adjacent placeholders.
    t = t.replace(/(\[[A-Z]+\])(?:\s*\1)+/g, '$1');
    return t;
  }

  // ---- folder suggestion ----
  const CATEGORIES = [
    { folder: 'Image Generation', kw: ['image', 'photo', 'photograph', 'logo', 'poster', 'render', 'midjourney', 'dall-e', 'dalle', 'picture', 'illustration', 'banner', 'thumbnail', 'wallpaper', 'icon', 'mockup'] },
    { folder: 'Video Scripts', kw: ['video', 'script', 'reel', 'youtube', 'voiceover', 'storyboard', 'shorts', 'testimonial'] },
    { folder: 'Email Copy', kw: ['email', 'subject line', 'newsletter', 'cold email', 'drip', 'outreach'] },
    { folder: 'Ad Copy', kw: ['ad ', 'advert', 'headline', 'caption', 'copywriting', 'cta', 'landing page', 'tagline', 'slogan'] },
    { folder: 'Social Media', kw: ['instagram', 'tweet', 'twitter', 'linkedin', ' post', 'hashtag', 'threads', 'tiktok'] },
    { folder: 'Code', kw: ['python', 'javascript', 'typescript', 'function', 'code', 'api', 'bug', 'refactor', 'sql', 'react', 'script for', 'pipeline', 'ffmpeg'] },
    { folder: 'Real Estate', kw: ['plot', 'property', 'real estate', 'listing', 'apartment', 'commercial space', 'square feet', 'square meter'] },
    { folder: 'SEO & Blog', kw: ['seo', 'blog', 'article', 'keyword', 'meta description', 'outline'] },
    { folder: 'Branding', kw: ['brand', 'brand voice', 'tone of voice', 'mission statement', 'positioning'] },
  ];

  function suggestFolder(raw, existingFolders) {
    const low = (' ' + clean(raw).toLowerCase() + ' ');
    const scored = CATEGORIES
      .map((c) => ({ folder: c.folder, score: c.kw.reduce((s, k) => s + (low.includes(k) ? 1 : 0), 0) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = scored[0] ? scored[0].folder : null;
    // Prefer an existing folder if it matches the winning category name (case-insensitive).
    if (best && Array.isArray(existingFolders)) {
      const hit = existingFolders.find((f) => f.toLowerCase() === best.toLowerCase());
      if (hit) return hit;
    }
    return best || 'Uncategorized';
  }

  // ---- tags ----
  const TAG_VOCAB = ['image', 'video', 'email', 'ad', 'script', 'copywriting', 'social', 'code', 'seo', 'blog', 'product', 'campaign', 'logo', 'caption', 'headline', 'branding', 'real-estate', 'python', 'photo', 'template'];

  function suggestTags(raw) {
    const low = clean(raw).toLowerCase();
    const tags = [];
    for (const t of TAG_VOCAB) {
      const needle = t.replace('-', ' ');
      if (low.includes(needle) && !tags.includes(t)) tags.push(t);
    }
    return tags.slice(0, 5);
  }

  // ---- title ----
  function deriveTitle(raw) {
    const first = clean(raw).split('\n').find((l) => l.trim().length) || '';
    const s = first.replace(/[#>*`_]/g, '').trim();
    return s.length > 52 ? s.slice(0, 52).trim() + '…' : s;
  }

  window.SMPClean = { clean, generalize, suggestFolder, suggestTags, deriveTitle };
})();
