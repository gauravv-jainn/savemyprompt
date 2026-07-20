/* Shared SVG icons. The bookmark + folder carry the yellow→teal gradient so
   the whole product reads as one system. Each gradient needs a unique id per
   page, so callers pass an `id`. */
(function () {
  function grad(id, soft) {
    const a = soft ? '#f7d06a' : '#f6c74a';
    const b = soft ? '#6fc7bb' : '#3bb6a6';
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset=".38" stop-color="#f0a93c"/>
      <stop offset="1" stop-color="${b}"/>
    </linearGradient></defs>`;
  }

  let n = 0;
  const uid = (p) => `${p}-${(n++).toString(36)}`;

  window.SMPIcons = {
    // Gradient bookmark — the app mark.
    bookmark(size = 22, soft = false) {
      const id = uid('bm');
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
        xmlns="http://www.w3.org/2000/svg">${grad(id, soft)}
        <path d="M6.5 3.2h11a2.3 2.3 0 0 1 2.3 2.3V21a.6.6 0 0 1-.92.5l-6.88-4.3-6.88 4.3A.6.6 0 0 1 4.2 21V5.5A2.3 2.3 0 0 1 6.5 3.2Z"
          fill="url(#${id})"/></svg>`;
    },

    // Duotone folder — gradient back tab, soft front.
    folder(size = 30) {
      const id = uid('fd');
      return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none"
        xmlns="http://www.w3.org/2000/svg">${grad(id)}
        <path d="M4 9.5A2.5 2.5 0 0 1 6.5 7h5.2c.7 0 1.35.29 1.82.8l1.2 1.3c.47.5 1.13.8 1.82.8H25.5A2.5 2.5 0 0 1 28 12.3v10.2A2.5 2.5 0 0 1 25.5 25h-19A2.5 2.5 0 0 1 4 22.5v-13Z"
          fill="url(#${id})" opacity="0.28"/>
        <path d="M4 13.4A2.4 2.4 0 0 1 6.4 11h19.2A2.4 2.4 0 0 1 28 13.4v9.1A2.5 2.5 0 0 1 25.5 25h-19A2.5 2.5 0 0 1 4 22.5v-9.1Z"
          fill="url(#${id})"/></svg>`;
    },

    close(size = 17) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    },
    back(size = 17) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`;
    },
    grid(size = 16) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">
        <rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/>
        <rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>`;
    },
    list(size = 16) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>`;
    },
    hamburger(size = 16) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
    },
    search(size = 16) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>`;
    },
    copy(size = 15) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="12" height="12" rx="2.4"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>`;
    },
    // Bucket / tray for the drop zone.
    tray(size = 20) {
      const id = uid('tr');
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
        xmlns="http://www.w3.org/2000/svg">${grad(id)}
        <path d="M3 13l2.2 5.2A2 2 0 0 0 7.04 19.5h9.92a2 2 0 0 0 1.84-1.3L21 13"
          stroke="url(#${id})" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12 3.5v9m0 0l-3-3m3 3l3-3" stroke="url(#${id})" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    },

    wordmark() {
      // "savemyprompt.ai" — warm start, teal ".ai".
      return `<span class="wordmark"><span class="gradient-text">savemyprompt</span><span style="color:#3bb6a6">.ai</span></span>`;
    },
  };
})();
