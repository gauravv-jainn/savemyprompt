# SaveMyPrompt

A background macOS menu-bar app that lets a small team save prompts straight
out of **ChatGPT desktop** and **Claude desktop** into a shared prompt library.

Hover a message → a small gradient **bookmark** button appears just outside the
bubble → click it → a local **Ollama** model cleans the prompt up, extracts a
reusable template, suggests a folder from your existing taxonomy and adds tags →
you edit and confirm → it's written to a shared **Google Drive** folder with the
tags stored as Drive `appProperties`. A right-edge panel lets you browse, search
and copy any saved prompt to the clipboard.

**Zero ongoing cost:** local Ollama for AI, Google Drive free tier for storage,
no paid code-signing (teammates right-click → Open once on first launch).

---

## Repo layout

```
SaveMyPrompt/
├── swift-helper/           Phase 1 — native Accessibility helper (Swift CLI)
│   ├── Package.swift
│   ├── build.sh            builds + copies binary into electron/resources/
│   └── Sources/hoverhelper/  AX.swift, Scanner.swift, Targets.swift, …
├── electron/               Phases 2–8 — menu-bar Electron app
│   ├── main.js             tray, windows, IPC, orchestration
│   ├── preload.js          context-isolated bridge (window.smp)
│   ├── lib/                helper-bridge, ollama, auth, drive, config, log
│   ├── renderer/
│   │   ├── shared/         theme.css + icons.js (one design system)
│   │   ├── save-button/    Phase 3 — floating hover button
│   │   ├── preview/        Phase 5 — editable preview panel
│   │   └── panel/          Phase 7 — collapsed tab + browse/search panel
│   ├── assets/             icon.icns, tray template icons
│   ├── credentials.sample.json   OAuth client (rename to credentials.json)
│   └── package.json        deps + electron-builder config (Phase 8)
└── README.md
```

---

## Prerequisites

| Tool | Why | Install |
|------|-----|---------|
| macOS 12+ | Accessibility API, menu-bar app | — |
| Xcode / Swift 5.9+ | build the native helper | `xcode-select --install` (or full Xcode) |
| Node 18+ & npm | run/package the Electron app | https://nodejs.org |
| Ollama + a model | local prompt cleanup | `brew install ollama` then `ollama pull llama3.1:8b` |
| Google Cloud project | Drive storage + OAuth | see **Google setup** below |

> This machine already has Swift/Xcode. It does **not** have Node or Ollama yet —
> install both before running Phases 2+.

---

## Build order (verify each phase before the next)

### Phase 1 — Swift Accessibility helper (verify this first, it's load-bearing)

The entire architecture depends on ChatGPT/Claude exposing messages as readable
accessibility nodes. Confirm that before anything else.

```bash
cd swift-helper
swift build -c release
BIN=.build/release/hoverhelper

# 1. Check permission status
$BIN --check-permissions          # -> "accessibility: NOT GRANTED" the first time

# 2. Grant Accessibility to your terminal (or the built binary):
#    System Settings ▸ Privacy & Security ▸ Accessibility → enable it.

# 3. Discovery run — focus ChatGPT or Claude desktop and hover over messages:
$BIN
```

You'll see, per hovered message, the AX node under the cursor, its attributes
(including Chromium `AXDOMClassList`), the ancestry chain, and a `MESSAGE ✓`
line when a clean message node is detected. **If messages don't surface as clean
nodes** (you only ever see `MESSAGE ✗` / one giant blob of text), stop — the
hover-save approach won't work reliably and we need to rethink before Phase 2.

The helper enables Chromium's lazy accessibility tree automatically
(`AXManualAccessibility`), so the web content is readable.

Helpful flags: `--json` (NDJSON stream used by Electron), `--once` (single
sample), `--interval <ms>`.

### Phase 2 — IPC bridge (Swift → Electron)

```bash
cd swift-helper && ./build.sh          # builds + copies binary to electron/resources/
cd ../electron && npm install
npm run dev                            # SMP_DEV=1, logs to stderr
```

The Electron main process spawns the helper with `--json` and parses the NDJSON
stream (`lib/helper-bridge.js`). Focus ChatGPT/Claude and hover — you'll see
`hover`/`clear` events in the dev console/log. Data is flowing.

### Phase 3 — Floating save button

With `npm run dev` running, hover a message: the gradient bookmark button fades
+ scales in (~170ms) just outside the bubble's top-right corner, positioned from
the helper's real screen coordinates. Move away and it fades out; move onto it
and it stays (so you can click it).

### Phase 4 — Ollama integration (test standalone first)

Make sure Ollama is running and the model is pulled, then sanity-check output on
a realistic agency prompt **before** trusting the UI:

```bash
ollama serve                # if not already running
ollama pull llama3.1:8b

curl http://localhost:11434/api/generate -d '{
  "model": "llama3.1:8b",
  "format": "json",
  "stream": false,
  "prompt": "Return ONLY JSON {\"extracted_prompt\":\"\",\"generalized_template\":\"\",\"suggested_folder\":\"\",\"tags\":[],\"confidence\":\"high\"} for: make me a product photo of the new coral sneaker on a white background, studio lighting"
}'
```

The app builds a richer prompt (with your Drive taxonomy) in `lib/ollama.js`.
Swap the model via `settings.json → ollamaModel` (e.g. `qwen2.5:7b`).

### Phase 5 — Preview panel

Clicking the save button captures the hovered message + surrounding context from
the helper, runs Ollama, and opens the preview panel: editable Title, Prompt,
Reusable template, Folder (with suggestion chips from your taxonomy), Tags, a
confidence badge and the captured context. **Nothing is written until you hit
Save.**

### Phase 6 — Google Drive

Sign in from the menu-bar icon (**Sign in to Google Drive**). On Save the app
creates/reuses a category subfolder inside the root **Prompt Library** folder,
writes the prompt as Markdown, stores tags in `appProperties`, and uploads any
output file alongside it.

### Phase 7 — Browse / search panel

The right-edge tab expands into the panel: recent folders → folder grid/list →
prompt cards with more/less truncation and one-click **Copy**. Search runs
against Drive `appProperties`/full-text. "Drop your prompt.." opens a manual-add
composer.

### Phase 8 — Packaging

```bash
cd electron
npm run dist        # builds the Swift helper, then an unsigned .dmg via electron-builder
```

Output: `electron/dist/SaveMyPrompt-1.0.0.dmg` (unsigned). The Swift binary is
bundled into `Contents/Resources/hoverhelper`. `LSUIElement` is set so there's no
dock icon.

---

## Google setup (one time, by the team lead)

1. **Google Cloud Console** → new project → **enable the Google Drive API**.
2. **OAuth consent screen** → External → **Testing** → add each teammate's Google
   address under **Test users** (works for up to ~100 users, no verification).
3. **Credentials** → Create OAuth client ID → **Desktop app** → download the JSON.
4. Save it as `electron/credentials.json` (see `credentials.sample.json`).
5. **Shared library folder:** create one **Prompt Library** folder in Drive,
   share it with the team, copy its folder id, and put it in each teammate's
   `settings.json` as `driveRootFolderId`. This is what makes everyone read/write
   the *same* library instead of separate personal ones.

---

## First launch for a teammate

1. **Gatekeeper:** right-click the app → **Open** → **Open** (once, because it's
   unsigned).
2. **Accessibility:** the helper opens System Settings ▸ Privacy & Security ▸
   **Accessibility** — enable **SaveMyPrompt**.
3. **Ollama:** `ollama serve` + `ollama pull llama3.1:8b`. The app warns if it
   can't reach `localhost:11434`.
4. **Google:** menu-bar icon → **Sign in to Google Drive**.

It launches at login automatically (toggle in the tray menu).

---

## Constraints honored

- Local Ollama for AI, Google Drive free tier for storage — **no ongoing cost**.
- **ChatGPT & Claude desktop only** for v1.
- **No auto-capture** — saving is always a deliberate click.
- **No database server** — Google Drive is the only backend (tags in `appProperties`).

## Troubleshooting

- **Button never appears:** check `hoverhelper --check-permissions`; re-grant
  Accessibility. Verify ChatGPT/Claude is the *frontmost* app.
- **"Ollama isn't running":** `ollama serve`; confirm the model in `settings.json`
  is pulled.
- **Can't see teammates' prompts:** everyone must set the same `driveRootFolderId`
  and the folder must be shared with them.
- **Logs:** `~/Library/Application Support/SaveMyPrompt/savemyprompt.log`.
