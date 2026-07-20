# SaveMyPrompt — Chrome Extension

A hover-to-save prompt library for LLM chat sites, right in the browser. **Hover
any message → click the bookmark button** that appears → it cleans the prompt,
builds a reusable `[PLACEHOLDER]` template, auto-suggests a folder + tags, you
edit and save. Or **Scan this chat** to pull every prompt from the whole
conversation at once. Browse, search, and copy any saved prompt to your clipboard.

**Works on:** ChatGPT, Claude, Gemini, AI Studio, Perplexity, Poe, DeepSeek,
Mistral, Grok, Copilot, Meta AI (+ a generic detector for other LLM chat pages).

**No AI. No account. No servers.** All cleaning/templating is deterministic
string/regex logic; the library is stored locally with `chrome.storage`.

## Why an extension (vs the desktop app)
A content script has **direct DOM access** to claude.ai / chatgpt.com, so message
detection just works — no macOS Accessibility API, no permissions, no pid gates.

## Load it (unpacked, ~30 seconds)
1. Open **chrome://extensions**
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked** → select this `extension/` folder
4. Open **https://claude.ai** or **https://chatgpt.com** (reload if already open)
5. You'll see the **bookmark tab** on the right edge, and the **SaveMyPrompt icon**
   in your toolbar (click it for a quick library view).

Works in any Chromium browser (Chrome, Edge, Brave, Arc) via the same steps.

## How to use
- **Save one**: hover any message → a **bookmark button** appears at its corner →
  click it → review the cleaned prompt + template + folder + tags → **Save**.
- **Save the whole chat**: click the right-edge tab → **Scan this chat** → every
  message is listed with a **Save** each, plus **Save all prompts**.
- **Add manually**: the **＋** in the panel header opens a blank editor.
- **Browse**: click the tab → folders → grid/list of prompts.
- **Copy**: click **Copy** on any prompt (or a grid card) to put it on your clipboard.
- **Search**: the search box matches title, text, template, tags, and folder.

## What each part does
```
extension/
├── manifest.json          MV3 manifest (content script + popup)
├── lib/
│   ├── clean.js           deterministic clean / generalize / suggestFolder / suggestTags
│   ├── store.js           chrome.storage.local library (folders, prompts, search)
│   ├── icons.js           gradient bookmark + UI icons
│   └── styles.js          Liquid Glass CSS for the shadow-DOM panel
├── content/content.js     injected on claude.ai + chatgpt.com — detection, panel, collect
├── popup/                 toolbar popup (quick library browse + copy)
└── icons/                 16/48/128 toolbar/store icons
```

## Templating rules (deterministic)
Instance-specifics are replaced with `[PLACEHOLDERS]`: URLs → `[URL]`, emails →
`[EMAIL]`, money → `[PRICE]`, dates → `[DATE]`, times → `[TIME]`, measurements →
`[SIZE]`, quoted phrases → `[TEXT]`, remaining numbers → `[NUMBER]`. Folder is
chosen by keyword categories; tags come from a topical vocabulary.

## If message detection ever misses
Site DOM classes change occasionally. The selectors live at the top of
`content/content.js` (`SEL`) — update `claude` / `chatgpt` selectors there and
reload the extension. Current selectors:
- ChatGPT: `[data-message-author-role]`
- Claude: `[data-testid="user-message"], .font-claude-message`

## Roadmap
- Optional team sync (export/import JSON, or a shared backend) — currently the
  library is per-browser via `chrome.storage.local`.
