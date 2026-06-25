# Markdown Viewer — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

We are building a cross-platform desktop **Markdown viewer** (macOS first) with
Tauri 2. The full design lives in
`docs/superpowers/specs/2026-06-25-markdown-viewer-design.md` and is split into
three independently-shippable phases. **This plan covers Phase 1 only** — the
viewer. Phases 2 (Mermaid + plugins) and 3 (editor) get their own plans later.

The repo is currently empty (fresh git repo). Phase 1 delivers: open a `.md`
file (picker + drag-drop), render it to a clean readable document with
syntax-highlighted code, auto-reload when the file changes on disk, toggle
between rendered and raw views, adjust fonts/styles (persisted), export to
self-contained HTML and to PDF, and copy the whole document as Markdown or as
rich text.

**Goal:** A working Tauri desktop app that renders a Markdown file into a
readable, styleable document with reload, export, and copy.

**Architecture:** Rust backend owns the filesystem (read/save/watch); web
frontend (TypeScript + Vite, no UI framework) owns rendering and presentation.
All I/O crosses the Tauri command/event boundary. This boundary is the reuse
seam for Phases 2 and 3.

**Tech Stack:** Tauri 2.11.x, `@tauri-apps/api` 2.x, `@tauri-apps/plugin-dialog`
2.7.x, Vite, TypeScript, `markdown-it` 14.x, `highlight.js` 11.x, `notify` 8.x
(Rust), Vitest 4.x.

## Global Constraints

- **Phase 1 scope only.** No Mermaid, no markdown-it plugins beyond the core
  config, no editor. Structure `render.ts` so Phase 2 plugins drop in (see
  Task 6), but do not implement them.
- **Filesystem only via Rust.** The frontend never uses `fs` directly. Open/save
  *dialogs* use the JS `@tauri-apps/plugin-dialog` plugin (returns a path);
  actual read/write goes through Rust commands `read_file` / `save_text_file`.
- **No raw HTML passthrough.** `markdown-it` configured with `html: false` to
  prevent script injection in the webview (sanitization by exclusion).
- **Single file at a time.** No tabs, no workspace.
- **Licenses accepted:** `highlight.js` (BSD-3-Clause), `notify` (CC0-1.0); all
  else MIT/Apache-2.0.
- **Shared types** (`FilePayload { path, content }`, `AppError { kind, message }`)
  defined in Rust and mirrored as TS interfaces; keep names identical.
- Commit after each task with the message shown in its final step.

## File Structure

```
markdown-gui/
├─ package.json                  # npm scripts, frontend deps, vitest
├─ vite.config.ts                # Vite + vitest config (jsdom env)
├─ tsconfig.json
├─ index.html                    # app shell: toolbar + #content
├─ src/
│  ├─ main.ts                    # bootstrap + event wiring
│  ├─ types.ts                   # FilePayload, AppError, StyleSettings
│  ├─ render.ts                  # markdown-it + highlight.js pipeline
│  ├─ viewer.ts                  # DOM: rendered⇄raw, apply styles, scroll
│  ├─ settings.ts                # StyleSettings persistence (localStorage)
│  ├─ export.ts                  # self-contained HTML + print-to-PDF
│  ├─ clipboard.ts               # copy as markdown / rich text
│  └─ styles.css                 # document styles, themes, @media print
├─ test/
│  ├─ render.test.ts
│  ├─ settings.test.ts
│  └─ clipboard.test.ts
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json
   ├─ capabilities/default.json  # dialog + event permissions
   └─ src/
      ├─ main.rs                 # app setup, state, handler registration
      ├─ error.rs                # AppError
      ├─ commands.rs             # read_file, save_text_file
      └─ watcher.rs              # notify watcher → file-changed/file-removed
```

---

## Task 1: Scaffold the Tauri + Vite + TypeScript app

**Files:**
- Create: whole project skeleton via scaffolder, then trim to the structure above.

**Deliverable:** `npm run tauri dev` opens an empty app window on macOS.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/jjverhoeks/src/tries/2026-06-25-markdown-gui
# Scaffold into the current (empty) git repo. Choose: TypeScript/JavaScript →
# npm → Vanilla → TypeScript when prompted, project name "." 
npm create tauri-app@latest . -- --template vanilla-ts --manager npm --identifier com.markdowngui.app
npm install
```

- [ ] **Step 2: Add dependencies**

```bash
npm install markdown-it highlight.js @tauri-apps/plugin-dialog
npm install -D @types/markdown-it vitest jsdom
# Rust deps
cd src-tauri
cargo add notify@8
cargo add tauri-plugin-dialog@2
cargo add serde --features derive
cd ..
```

- [ ] **Step 3: Add npm test script**

In `package.json` `"scripts"`, add: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Configure Vitest** — create `vite.config.ts` (merge if exists)

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tauri expects a fixed port during dev; leave Vite defaults otherwise.
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: { environment: "jsdom", globals: true, include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 5: Verify the app launches**

Run: `npm run tauri dev`
Expected: a desktop window opens (default scaffold content). Close it.

- [ ] **Step 6: Verify tests run (none yet)**

Run: `npm test`
Expected: Vitest reports "no test files found" (exit 0) — confirms the runner works.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold Tauri + Vite + TS app with deps"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types.ts`
- Create: `src-tauri/src/error.rs`

**Interfaces:**
- Produces (Rust): `AppError { kind: ErrorKind, message: String }` serialized to
  `{ kind: string, message: string }`; `FilePayload { path: String, content: String }`.
- Produces (TS): `FilePayload`, `AppError`, `StyleSettings`.

- [ ] **Step 1: Rust AppError** — create `src-tauri/src/error.rs`

```rust
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    NotFound,
    Unreadable,
    NotUtf8,
    Io,
}

#[derive(Debug, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}
```

- [ ] **Step 2: TS types** — create `src/types.ts`

```ts
export interface FilePayload {
  path: string;
  content: string;
}

export type ErrorKind = "not_found" | "unreadable" | "not_utf8" | "io";

export interface AppError {
  kind: ErrorKind;
  message: string;
}

export type Theme = "light" | "sepia" | "dark";
export type FontFamily = "sans" | "serif" | "mono";

export interface StyleSettings {
  fontFamily: FontFamily;
  fontSizePx: number; // 14..22
  theme: Theme;
  maxWidthCh: number; // content width
}

export const DEFAULT_SETTINGS: StyleSettings = {
  fontFamily: "sans",
  fontSizePx: 17,
  theme: "light",
  maxWidthCh: 74,
};
```

- [ ] **Step 3: Wire error module** — in `src-tauri/src/main.rs`, add `mod error;` near the top.

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo build && cd ..`
Expected: builds successfully (warnings about unused code are fine at this stage).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add shared FilePayload/AppError/StyleSettings types"
```

---

## Task 3: `read_file` command (TDD)

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs` (declare module, register handler)

**Interfaces:**
- Produces: `#[tauri::command] read_file(path: String) -> Result<FilePayload, AppError>`.

- [ ] **Step 1: Write the failing test** — in `src-tauri/src/commands.rs`

```rust
use crate::error::{AppError, ErrorKind};
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct FilePayload {
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FilePayload, AppError> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::new(ErrorKind::NotFound, format!("File not found: {path}")));
    }
    let bytes = fs::read(p).map_err(|e| AppError::new(ErrorKind::Unreadable, e.to_string()))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::new(ErrorKind::NotUtf8, "File is not valid UTF-8"))?;
    Ok(FilePayload { path, content })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_existing_utf8_file() {
        let dir = std::env::temp_dir().join("mdv_test_read");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.md");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"# Hello").unwrap();
        let payload = read_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(payload.content, "# Hello");
    }

    #[test]
    fn errors_on_missing_file() {
        let err = read_file("/no/such/file.md".into()).unwrap_err();
        assert!(matches!(err.kind, ErrorKind::NotFound));
    }

    #[test]
    fn errors_on_non_utf8() {
        let dir = std::env::temp_dir().join("mdv_test_read");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bin.md");
        std::fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        let err = read_file(path.to_string_lossy().to_string()).unwrap_err();
        assert!(matches!(err.kind, ErrorKind::NotUtf8));
    }
}
```

- [ ] **Step 2: Declare module + register handler** — in `src-tauri/src/main.rs`

Add `mod commands;` near other `mod` lines, and add `commands::read_file` to the
`tauri::generate_handler![...]` macro inside the `tauri::Builder` chain.

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --bin <crate-name> 2>/dev/null || cargo test && cd ..`
Expected: PASS — 3 tests in `commands::tests`. (Use `cargo test` from `src-tauri`.)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: read_file command with not-found/utf8 error handling"
```

---

## Task 4: `save_text_file` command (TDD)

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs` (register handler)

**Interfaces:**
- Produces: `#[tauri::command] save_text_file(path: String, contents: String) -> Result<(), AppError>`
  (reused by HTML export now and by Phase 3 save later).

- [ ] **Step 1: Write the failing test** — append to `src-tauri/src/commands.rs`

```rust
#[tauri::command]
pub fn save_text_file(path: String, contents: String) -> Result<(), AppError> {
    std::fs::write(&path, contents).map_err(|e| AppError::new(ErrorKind::Io, e.to_string()))
}
```

Add to the `tests` module:

```rust
    #[test]
    fn writes_text_file() {
        let dir = std::env::temp_dir().join("mdv_test_save");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.html");
        save_text_file(path.to_string_lossy().to_string(), "<h1>Hi</h1>".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "<h1>Hi</h1>");
    }
```

- [ ] **Step 2: Register handler** — add `commands::save_text_file` to `generate_handler!`.

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test && cd ..`
Expected: PASS — `writes_text_file` plus the earlier 3.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: save_text_file command"
```

---

## Task 5: File watcher (TDD) — emits `file-changed` / `file-removed`

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/main.rs` (module, `WatchedPath` state, `watch_file`/`unwatch` commands)

**Interfaces:**
- Produces: `#[tauri::command] watch_file(path, state, app)` — starts watching one
  path; replaces any prior watch. Emits Tauri events `file-changed` (`FilePayload`)
  and `file-removed` (`{ path }`).
- The core file→payload reload logic is factored into a pure function
  `reload_payload(path) -> Option<FilePayload>` so it is unit-testable without Tauri.

- [ ] **Step 1: Write the failing test** — create `src-tauri/src/watcher.rs`

```rust
use crate::commands::{read_file, FilePayload};

/// Pure, testable: read the file fresh; None if it can't be read (e.g. removed).
pub fn reload_payload(path: &str) -> Option<FilePayload> {
    read_file(path.to_string()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reload_returns_fresh_content() {
        let dir = std::env::temp_dir().join("mdv_test_watch");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("w.md");
        std::fs::write(&path, "v1").unwrap();
        let p = path.to_string_lossy().to_string();
        assert_eq!(reload_payload(&p).unwrap().content, "v1");
        std::fs::write(&path, "v2").unwrap();
        assert_eq!(reload_payload(&p).unwrap().content, "v2");
    }

    #[test]
    fn reload_none_when_missing() {
        assert!(reload_payload("/no/such/watch.md").is_none());
    }
}
```

- [ ] **Step 2: Run the unit test to verify it passes**

Run: `cd src-tauri && cargo test watcher && cd ..`
Expected: PASS — 2 tests.

- [ ] **Step 3: Add the live watcher + commands** — append to `watcher.rs`

```rust
use notify::{RecommendedWatcher, RecursiveMode, Watcher, EventKind};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(serde::Serialize, Clone)]
struct RemovedPayload { path: String }

#[derive(Default)]
pub struct WatchState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

#[tauri::command]
pub fn watch_file(path: String, state: State<WatchState>, app: AppHandle) -> Result<(), String> {
    let watch_path = PathBuf::from(&path);
    let app2 = app.clone();
    let path2 = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) => {
                    if let Some(payload) = reload_payload(&path2) {
                        let _ = app2.emit("file-changed", payload);
                    }
                }
                EventKind::Remove(_) => {
                    let _ = app2.emit("file-removed", RemovedPayload { path: path2.clone() });
                }
                _ => {}
            }
        }
    }).map_err(|e| e.to_string())?;
    watcher.watch(&watch_path, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    // Replace any prior watcher (dropping it stops the old watch).
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}
```

- [ ] **Step 4: Wire state + commands** — in `src-tauri/src/main.rs`

Add `mod watcher;`. In the builder chain add `.manage(watcher::WatchState::default())`
and add `watcher::watch_file` to `generate_handler!`.

- [ ] **Step 5: Verify build**

Run: `cd src-tauri && cargo build && cd ..`
Expected: compiles. (Live event emission is verified in the manual smoke test in Task 11.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: notify-based single-file watcher with reload events"
```

---

## Task 6: `render.ts` markdown pipeline (TDD)

**Files:**
- Create: `src/render.ts`
- Create: `test/render.test.ts`

**Interfaces:**
- Produces: `renderMarkdown(text: string): string` — Markdown → safe HTML.
- Internal shape is plugin-ready (`createRenderer()` returns a configured
  `MarkdownIt`; a `plugins: PluginEntry[]` array is applied) so Phase 2 adds
  entries without changing `renderMarkdown`'s signature.

- [ ] **Step 1: Write the failing test** — create `test/render.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/render";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
  });
  it("highlights fenced code", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("hljs");
    expect(html).toContain("language-js");
  });
  it("renders tables", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
  });
  it("renders task lists as checkboxes-or-list items", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain("<li");
  });
  it("does NOT pass through raw HTML/script", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/render`.

- [ ] **Step 3: Implement** — create `src/render.ts`

```ts
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";

export type PluginEntry = { name: string; plugin: any; options?: any };

// Phase 2 will push entries here; Phase 1 ships empty.
export const plugins: PluginEntry[] = [];

export function createRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,        // no raw HTML passthrough (sanitization by exclusion)
    linkify: true,
    typographer: true,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          const out = hljs.highlight(code, { language: lang }).value;
          return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`;
        } catch {
          /* fall through */
        }
      }
      const escaped = md.utils.escapeHtml(code);
      return `<pre class="hljs"><code>${escaped}</code></pre>`;
    },
  });
  for (const { plugin, options } of plugins) md.use(plugin, options);
  return md;
}

const renderer = createRenderer();

export function renderMarkdown(text: string): string {
  return renderer.render(text);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: render.ts markdown-it+highlight.js pipeline (plugin-ready)"
```

---

## Task 7: `settings.ts` persistence (TDD)

**Files:**
- Create: `src/settings.ts`
- Create: `test/settings.test.ts`

**Interfaces:**
- Consumes: `StyleSettings`, `DEFAULT_SETTINGS` from `src/types.ts`.
- Produces: `loadSettings(): StyleSettings`, `saveSettings(s: StyleSettings): void`.

- [ ] **Step 1: Write the failing test** — create `test/settings.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings } from "../src/settings";
import { DEFAULT_SETTINGS } from "../src/types";

describe("settings", () => {
  beforeEach(() => localStorage.clear());

  it("returns defaults when nothing stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("round-trips saved settings", () => {
    const s = { ...DEFAULT_SETTINGS, theme: "dark" as const, fontSizePx: 20 };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });
  it("falls back to defaults on corrupt storage", () => {
    localStorage.setItem("mdv.settings", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/settings`.

- [ ] **Step 3: Implement** — create `src/settings.ts`

```ts
import { StyleSettings, DEFAULT_SETTINGS } from "./types";

const KEY = "mdv.settings";

export function loadSettings(): StyleSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: StyleSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: settings.ts style-preference persistence"
```

---

## Task 8: `clipboard.ts` copy as markdown / rich text (TDD)

**Files:**
- Create: `src/clipboard.ts`
- Create: `test/clipboard.test.ts`

**Interfaces:**
- Produces: `copyAsMarkdown(text: string): Promise<void>`,
  `copyAsRichText(html: string): Promise<void>`.

- [ ] **Step 1: Write the failing test** — create `test/clipboard.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyAsMarkdown, copyAsRichText } from "../src/clipboard";

describe("clipboard", () => {
  let written: any[];
  beforeEach(() => {
    written = [];
    // @ts-expect-error test shim
    globalThis.ClipboardItem = class { constructor(public items: any) {} };
    Object.assign(navigator, {
      clipboard: {
        write: vi.fn(async (items: any[]) => { written.push(...items); }),
        writeText: vi.fn(async (_t: string) => {}),
      },
    });
  });

  it("copies markdown as plain text", async () => {
    await copyAsMarkdown("# Hi");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("# Hi");
  });
  it("copies rich text with html + plain flavors", async () => {
    await copyAsRichText("<h1>Hi</h1>");
    expect(navigator.clipboard.write).toHaveBeenCalled();
    expect(written.length).toBe(1);
    expect(Object.keys(written[0].items)).toContain("text/html");
    expect(Object.keys(written[0].items)).toContain("text/plain");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/clipboard`.

- [ ] **Step 3: Implement** — create `src/clipboard.ts`

```ts
export async function copyAsMarkdown(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function copyAsRichText(html: string): Promise<void> {
  const plain = html.replace(/<[^>]+>/g, ""); // crude fallback text
  const item = new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([plain], { type: "text/plain" }),
  });
  await navigator.clipboard.write([item]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: clipboard.ts copy-as-markdown and copy-as-rich-text"
```

---

## Task 9: `viewer.ts` DOM controller + `styles.css`

**Files:**
- Create: `src/viewer.ts`
- Create: `src/styles.css`
- Modify: `index.html` (toolbar + `#content` container)

**Interfaces:**
- Consumes: `renderMarkdown` (Task 6), `StyleSettings` (types).
- Produces: a `Viewer` controller — `setSource(text)`, `showRendered()`,
  `showRaw()`, `toggle()`, `applyStyle(s: StyleSettings)`, `getRenderedHtml()`,
  `getRawText()`.

- [ ] **Step 1: Build the app shell** — create `index.html` body

```html
<body>
  <header id="toolbar">
    <button id="btn-open">Open</button>
    <button id="btn-toggle">Raw / Rendered</button>
    <select id="sel-font"><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option></select>
    <input id="inp-size" type="range" min="14" max="22" />
    <select id="sel-theme"><option value="light">Light</option><option value="sepia">Sepia</option><option value="dark">Dark</option></select>
    <button id="btn-export-html">Export HTML</button>
    <button id="btn-export-pdf">Export PDF</button>
    <button id="btn-copy-md">Copy MD</button>
    <button id="btn-copy-rich">Copy Rich</button>
  </header>
  <main id="content"></main>
  <div id="banner" hidden></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

- [ ] **Step 2: Implement viewer** — create `src/viewer.ts`

```ts
import { renderMarkdown } from "./render";
import { StyleSettings } from "./types";

export class Viewer {
  private container: HTMLElement;
  private source = "";
  private mode: "rendered" | "raw" = "rendered";

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setSource(text: string) {
    this.source = text;
    this.repaint();
  }

  getRawText() { return this.source; }
  getRenderedHtml() { return renderMarkdown(this.source); }

  showRendered() { this.mode = "rendered"; this.repaint(); }
  showRaw() { this.mode = "raw"; this.repaint(); }
  toggle() { this.mode = this.mode === "rendered" ? "raw" : "rendered"; this.repaint(); }

  applyStyle(s: StyleSettings) {
    const el = this.container;
    el.dataset.theme = s.theme;
    el.dataset.font = s.fontFamily;
    el.style.setProperty("--font-size", `${s.fontSizePx}px`);
    el.style.setProperty("--max-width", `${s.maxWidthCh}ch`);
  }

  private repaint() {
    const scroll = this.container.scrollTop;
    if (this.mode === "rendered") {
      this.container.innerHTML = `<article class="doc">${renderMarkdown(this.source)}</article>`;
    } else {
      const pre = document.createElement("pre");
      pre.className = "raw";
      pre.textContent = this.source;
      this.container.replaceChildren(pre);
    }
    this.container.scrollTop = scroll; // preserve scroll across re-render
  }
}
```

- [ ] **Step 3: Write the document stylesheet** — create `src/styles.css`

Include: reset; `#toolbar` layout; `#content` with `--max-width`/`--font-size`
CSS variables; readable defaults (line-height 1.6, heading spacing); `[data-font]`
presets (sans/serif/mono); `[data-theme]` presets (light/sepia/dark) setting
background + text colors; styling for `table`, `blockquote`, `code`, `pre.hljs`,
`ul`, task-list items, links; a highlight.js theme import
(`@import "highlight.js/styles/github.css";` for light — swap via theme later);
and an `@media print` block that hides `#toolbar`/`#banner` and removes width
constraints for PDF export. Import it in `main.ts`.

- [ ] **Step 4: Verify build + smoke**

Run: `npm run tauri dev`
Expected: window shows the toolbar and an empty content area; no console errors.
(Full interaction wired in Task 10.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: viewer DOM controller, app shell, and document styles"
```

---

## Task 10: `export.ts` + `main.ts` wiring (open, drag-drop, reload, toggle, styles, export, copy)

**Files:**
- Create: `src/export.ts`
- Create: `src/main.ts`
- Modify: `src-tauri/capabilities/default.json` (permissions)

**Interfaces:**
- Consumes: `Viewer`, `loadSettings`/`saveSettings`, `copyAsMarkdown`/`copyAsRichText`,
  Rust commands `read_file`/`save_text_file`/`watch_file`, dialog plugin `open`/`save`.
- Produces: `exportHtml(viewer)`, `exportPdf()`.

- [ ] **Step 1: Implement export** — create `src/export.ts`

```ts
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Viewer } from "./viewer";

function buildStandaloneHtml(bodyHtml: string): string {
  // Inline the app + highlight.js CSS so the file renders offline.
  const css = Array.from(document.styleSheets)
    .flatMap((s) => { try { return Array.from(s.cssRules).map((r) => r.cssText); } catch { return []; } })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><article class="doc" data-theme="light" data-font="sans">${bodyHtml}</article></body></html>`;
}

export async function exportHtml(viewer: Viewer): Promise<void> {
  const path = await save({ filters: [{ name: "HTML", extensions: ["html"] }] });
  if (!path) return;
  await invoke("save_text_file", { path, contents: buildStandaloneHtml(viewer.getRenderedHtml()) });
}

export function exportPdf(): void {
  // Print stylesheet (@media print) drives layout; OS dialog offers "Save as PDF".
  window.print();
}
```

- [ ] **Step 2: Implement main wiring** — create `src/main.ts`

```ts
import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Viewer } from "./viewer";
import { loadSettings, saveSettings } from "./settings";
import { copyAsMarkdown, copyAsRichText } from "./clipboard";
import { exportHtml, exportPdf } from "./export";
import { FilePayload, AppError, StyleSettings } from "./types";

const content = document.getElementById("content")!;
const banner = document.getElementById("banner")!;
const viewer = new Viewer(content);
let settings: StyleSettings = loadSettings();
viewer.applyStyle(settings);

function showBanner(msg: string) {
  banner.textContent = msg;
  banner.hidden = false;
  setTimeout(() => (banner.hidden = true), 4000);
}

async function openPath(path: string) {
  try {
    const payload = await invoke<FilePayload>("read_file", { path });
    viewer.setSource(payload.content);
    await invoke("watch_file", { path });
  } catch (e) {
    showBanner(`Couldn't open ${path} — ${(e as AppError).message ?? e}`);
  }
}

// Toolbar
document.getElementById("btn-open")!.addEventListener("click", async () => {
  const sel = await open({ filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }] });
  if (typeof sel === "string") await openPath(sel);
});
document.getElementById("btn-toggle")!.addEventListener("click", () => viewer.toggle());
document.getElementById("btn-export-html")!.addEventListener("click", () => exportHtml(viewer));
document.getElementById("btn-export-pdf")!.addEventListener("click", () => exportPdf());
document.getElementById("btn-copy-md")!.addEventListener("click", () => copyAsMarkdown(viewer.getRawText()));
document.getElementById("btn-copy-rich")!.addEventListener("click", () => copyAsRichText(viewer.getRenderedHtml()));

// Style controls
const selFont = document.getElementById("sel-font") as HTMLSelectElement;
const inpSize = document.getElementById("inp-size") as HTMLInputElement;
const selTheme = document.getElementById("sel-theme") as HTMLSelectElement;
selFont.value = settings.fontFamily; inpSize.value = String(settings.fontSizePx); selTheme.value = settings.theme;
function updateStyle(patch: Partial<StyleSettings>) {
  settings = { ...settings, ...patch };
  viewer.applyStyle(settings);
  saveSettings(settings);
}
selFont.addEventListener("change", () => updateStyle({ fontFamily: selFont.value as any }));
inpSize.addEventListener("input", () => updateStyle({ fontSizePx: Number(inpSize.value) }));
selTheme.addEventListener("change", () => updateStyle({ theme: selTheme.value as any }));

// Auto-reload + removal
listen<FilePayload>("file-changed", (e) => viewer.setSource(e.payload.content));
listen<{ path: string }>("file-removed", (e) => showBanner(`File removed: ${e.payload.path}`));

// Drag-and-drop
getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type === "drop" && e.payload.paths.length > 0) openPath(e.payload.paths[0]);
});
```

- [ ] **Step 3: Grant permissions** — edit `src-tauri/capabilities/default.json`

Ensure the `permissions` array includes (in addition to scaffold defaults):
`"core:event:default"`, `"dialog:allow-open"`, `"dialog:allow-save"`,
`"core:webview:allow-internal-toggle-devtools"` is optional. Custom commands
(`read_file`, `save_text_file`, `watch_file`) need no extra permission entry in
Tauri 2 — they are exposed via `generate_handler!`.

- [ ] **Step 4: Register dialog plugin in Rust** — in `src-tauri/src/main.rs`

Add `.plugin(tauri_plugin_dialog::init())` to the builder chain.

- [ ] **Step 5: Verify build + type-check**

Run: `npm run build` (Vite/tsc) then `cd src-tauri && cargo build && cd ..`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: wire open/drag-drop/reload/toggle/styles/export/copy"
```

---

## Task 11: End-to-end manual smoke test + fixture

**Files:**
- Create: `test/fixtures/sample.md` (headings, code fence, table, task list, blockquote, link, long paragraph).

**Deliverable:** every Phase 1 feature verified in the running app.

- [ ] **Step 1: Create the fixture** — `test/fixtures/sample.md` with one of each
  Markdown element listed above.

- [ ] **Step 2: Run the app**

Run: `npm run tauri dev`

- [ ] **Step 3: Work the smoke checklist** (confirm each):
  1. Open via the **Open** dialog → renders readable document.
  2. **Drag-drop** `sample.md` onto the window → renders.
  3. Edit `sample.md` in another editor and save → view **auto-reloads** (scroll preserved).
  4. **Toggle** → shows raw markdown `<pre>`, toggle back → rendered.
  5. **Font / size / theme** controls change the view live; relaunch app → choices **persisted**.
  6. **Export HTML** → open the saved `.html` in a browser → renders standalone (styles present).
  7. **Export PDF** → OS print dialog → "Save as PDF" produces a clean doc (no toolbar).
  8. **Copy MD** → paste into a plain text field → raw markdown.
  9. **Copy Rich** → paste into Confluence/Google Docs/Word → formatting retained.
  10. Delete the open file → **banner** appears, last content retained.
  11. Open a non-UTF-8/binary file → **banner** with a clear error, prior view kept.

- [ ] **Step 4: Run the full automated suite**

Run: `npm test && (cd src-tauri && cargo test)`
Expected: all Vitest + cargo tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test: add markdown fixture and Phase 1 smoke checklist"
```

---

## Verification (end-to-end)

- **Automated:** `npm test` (render, settings, clipboard) and `cd src-tauri &&
  cargo test` (read_file, save_text_file, watcher reload) all pass.
- **Build:** `npm run build` and `cargo build` succeed; `npm run tauri build`
  produces a macOS `.app`/`.dmg`.
- **Manual:** the Task 11 smoke checklist passes in `npm run tauri dev`.

## Notes for later phases (not in scope now)

- `render.ts` exposes `createRenderer()` + a `plugins` array and (Phase 2)
  should evolve to a `renderInto(text, container)` form to host DOM post-render
  passes (Mermaid). Keep the `renderMarkdown` string API until then.
- `save_text_file` is intentionally generic so Phase 3 "Save" reuses it; Phase 3
  adds `save_file_dialog` and self-write suppression in the watcher.
