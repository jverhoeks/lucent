# Markdown Viewer (Tauri) — Design Spec

**Date:** 2026-06-25
**Status:** Approved for planning

## Summary

A cross-platform desktop application (macOS first, Windows/Linux capable) that
renders a Markdown file into a clean, readable document view. Built with
[Tauri](https://tauri.app) — a Rust backend that owns the filesystem and a
web-based UI that owns rendering. The app starts as a focused **viewer** and
grows, along a deliberately phased roadmap, into a rich renderer (Mermaid +
plugins) and finally a Markdown **editor** — all on the same architectural
boundary.

The product is delivered in three independently-shippable phases:

- **Phase 1 — Viewer:** open a file, render it (with syntax-highlighted code),
  auto-reload on disk changes, toggle raw/rendered, adjust fonts/styles, export
  to PDF and HTML, and copy the content as Markdown or as rich text.
- **Phase 2 — Rich rendering & plugins:** Mermaid diagrams plus a registry of
  `markdown-it` plugins (math, footnotes, emoji, containers, anchors).
- **Phase 3 — Editor:** a CodeMirror editing pane with save/save-as and live
  preview, reusing the Phase 1 rendering pipeline.

Each phase produces working, testable software on its own.

## Goals

- Open any `.md`/`.markdown` file and render it as an easy-to-read document.
- Keep the view current: auto-reload when the file changes on disk.
- Let the reader tune readability (font family, size, theme, content width).
- Switch instantly between the rendered view and the raw Markdown source.
- Export the rendered document to PDF and to a self-contained HTML file.
- Copy the whole document to the clipboard as Markdown (plain text) or as rich
  text (HTML) for pasting into Slack, Confluence, Word, Google Docs, email.
- Lay an architecture that admits Mermaid, plugins, and an editor without a
  rewrite.

## Non-Goals

- Multi-document tabs or a file-tree/workspace browser (single file at a time).
- Cloud sync, collaboration, or accounts.
- WYSIWYG editing (Phase 3 is a source editor with live preview, not WYSIWYG).

## Tech Stack

| Concern | Choice | License |
|---|---|---|
| App shell | Tauri 2.x (Rust + system webview) | Apache-2.0 OR MIT |
| Frontend API | `@tauri-apps/api` 2.x | Apache-2.0 OR MIT |
| Native dialogs | `tauri-plugin-dialog` 2.x (open/save) | Apache-2.0 OR MIT |
| Build/dev | Vite | MIT |
| Language (UI) | TypeScript | Apache-2.0 |
| Markdown → HTML | `markdown-it` | MIT |
| Syntax highlighting | `highlight.js` | BSD-3-Clause |
| File watching | `notify` (Rust crate) | CC0-1.0 |
| Diagrams (Phase 2) | `mermaid` | MIT |
| Editor (Phase 3) | CodeMirror 6 | MIT |
| Frontend tests | Vitest | MIT |

**Licensing note:** Two dependencies are permissive but outside strict
MIT/Apache-2.0 and are accepted for this project: `highlight.js`
(BSD-3-Clause — MIT plus a no-endorsement clause) and `notify` (CC0-1.0 —
public-domain dedication). Phase 2 `markdown-it` plugins are expected to be MIT
(see Phase 2 for the per-plugin list); KaTeX (for math) is MIT.

## Architecture

Two halves with a strict boundary:

- **Rust backend (`src-tauri/`)** owns the filesystem and OS integration. It
  reads files, watches the open file for changes, and writes export/save output.
  It knows nothing about Markdown.
- **Web frontend (`src/`)** owns all rendering and presentation. It receives
  raw Markdown text and turns it into HTML, manages view modes, styles,
  exports, and clipboard. It never touches the filesystem directly — all I/O
  goes through Tauri commands.

This boundary is the reuse seam for every phase: Phase 2 only touches the
frontend rendering pipeline; Phase 3 adds one Rust command (`write_file`) and
one frontend pane (CodeMirror).

```
┌─────────────────────────── Frontend (webview) ───────────────────────────┐
│  main.ts ─ wires events, listens for file-changed                         │
│    ├─ render.ts    markdown-it + highlight.js pipeline → HTML             │
│    ├─ viewer.ts    DOM: rendered ⇄ raw, applies style settings           │
│    ├─ settings.ts  load/save style prefs (localStorage)                  │
│    ├─ export.ts    standalone HTML / print-to-PDF                        │
│    └─ clipboard.ts copy as markdown / rich text                          │
└──────────────────────────────┬───────────────────────────────────────────┘
                                │ Tauri commands + events (IPC)
┌──────────────────────────────┴───────────────── Backend (Rust) ──────────┐
│  main.rs     app setup, command registration, watched-path state          │
│    ├─ commands.rs   open_file_dialog / read_file / save_text_file          │
│    └─ watcher.rs    notify watcher → emits "file-changed" with content     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 — Viewer

### Components

**Rust (`src-tauri/src/`)**

- `commands.rs`
  - `open_file_dialog() -> Option<String>` — opens the native file picker
    (filtered to `md`, `markdown`, `txt`), returns the chosen path or `None`.
  - `read_file(path: String) -> Result<FilePayload, AppError>` — reads the file
    as UTF-8; returns `{ path, content }`. Errors on missing/unreadable/non-UTF-8.
  - `save_text_file(path: String, contents: String) -> Result<(), AppError>` —
    writes a string to a path (used by HTML export; reused by Phase 3 save).
- `watcher.rs`
  - `watch_file(path, app_handle)` — starts a `notify` watcher on a background
    thread for exactly one path. On a modify/create event it re-reads the file
    and emits a `file-changed` event carrying `{ path, content }`. On
    remove/rename it emits `file-removed` with `{ path }`. Starting a new watch
    replaces any previous watch.
- `main.rs` — builds the Tauri app, registers the dialog plugin and the three
  commands, holds `WatchedPath(Mutex<Option<PathBuf>>)` app state.

**Types (shared shape, defined in Rust, mirrored in TS):**

- `FilePayload { path: String, content: String }`
- `AppError { kind: "not_found" | "unreadable" | "not_utf8" | "io", message: String }`

**Frontend (`src/`)**

- `main.ts` — bootstraps the app; wires the toolbar buttons (Open, toggle
  view, style controls, export menu, copy menu), global drag-and-drop, and a
  listener for `file-changed` / `file-removed` events.
- `render.ts` — owns a single configured `markdown-it` instance and exposes
  `renderMarkdown(text: string): string`. Configured with: `html: false`
  (untrusted raw HTML in the source is **not** passed through — sanitization by
  exclusion), `linkify: true`, `typographer: true`, and a `highlight` callback
  that runs `highlight.js` over fenced code blocks (graceful fallback to escaped
  plain text on unknown languages). **Built as a pipeline** (see Extensibility)
  so Phase 2 plugins drop in without changing the call site.
- `viewer.ts` — owns the content DOM. `showRendered(html)` and `showRaw(text)`
  swap between the rendered document and a `<pre>` of the source. Applies the
  active style settings (font family, size, theme class, max width) to the
  rendered container. Preserves scroll position across re-render.
- `settings.ts` — `loadSettings()` / `saveSettings(s)` persist a `StyleSettings`
  object (`{ fontFamily, fontSizePx, theme, maxWidthCh }`) to `localStorage`;
  ships sensible defaults on first run.
- `export.ts`
  - `exportHtml()` — serializes the current rendered HTML, inlines the active
    stylesheet + highlight.js theme CSS into a single self-contained document,
    and calls `save_text_file` via a native save dialog.
  - `exportPdf()` — applies a print stylesheet and calls `window.print()`,
    which on every platform offers "Save as PDF". (See Tradeoffs.)
- `clipboard.ts`
  - `copyAsMarkdown()` — writes the raw source as `text/plain`.
  - `copyAsRichText()` — writes the rendered HTML as a `text/html` clipboard
    flavor with a `text/plain` fallback, via `navigator.clipboard.write` +
    `ClipboardItem`.
- `styles.css` — the readable "document" stylesheet, theme presets
  (light / sepia / dark), font presets (sans / serif / mono), and an
  `@media print` block for PDF export.

### Data flow

1. **Open** — user clicks Open (→ `open_file_dialog`) or drops a file. Frontend
   calls `read_file(path)`, gets `{ path, content }`, renders via `render.ts`,
   displays via `viewer.ts`, then asks the backend to `watch_file(path)`.
2. **Auto-reload** — file changes on disk → `watcher.rs` emits `file-changed` →
   frontend re-renders the new content, preserving scroll position and the
   current view mode + style.
3. **File removed** — `file-removed` event → non-blocking banner; last-rendered
   content is retained.
4. **Toggle view** — flips rendered ⇄ raw with no backend call.
5. **Adjust style** — updates the rendered pane live and persists via `settings.ts`.
6. **Export** — HTML (self-contained file via save dialog) or PDF (print → Save
   as PDF).
7. **Copy** — as Markdown (plain) or as Rich Text (HTML) to the clipboard.

### Readability & styling

- Constrained content width (default ~74ch), line-height ~1.6, generous heading
  spacing.
- Adjustable: font family (sans / serif / mono), font size (14–22px), theme
  (light / sepia / dark), content width.
- Styled code blocks (highlight.js), tables, blockquotes, task lists, links.
- All choices persist between launches.

### Error handling

- File not found / unreadable / non-UTF-8 → typed `AppError`; UI shows a
  non-blocking banner ("Couldn't open *file* — *reason*") and keeps the prior view.
- Watched file deleted/moved → banner; retains last-rendered content.
- Export / clipboard failure → caught, surfaced as a banner; never crashes.
- Rendering never throws on bad input; raw HTML in the source is excluded
  (`html: false`) to prevent script injection inside the webview.

### Tradeoffs (Phase 1)

- **PDF export uses `window.print()` → "Save as PDF"** rather than one-click
  programmatic PDF. This is dependency-free and works identically on all three
  platforms. A future enhancement may use native webview PDF APIs
  (`WKWebView.createPDF`, WebView2 `PrintToPdfAsync`) for one-click export; it
  is intentionally out of scope here.

### Testing (Phase 1)

- **Rust unit tests:** `read_file` (valid / missing / non-UTF-8); `watch_file`
  (modifying a temp file fires a `file-changed` event with the new content).
- **Frontend unit tests (Vitest):** `render.ts` (headings, fenced code with
  highlighting, tables, task lists, links; confirms raw `<script>` is not
  emitted); `settings.ts` (persistence round-trip + defaults).
- **Manual smoke checklist** (in the plan): drag-drop open, native open dialog,
  visible auto-reload after editing the file elsewhere, raw/rendered toggle,
  each style control, HTML export opens standalone in a browser, PDF "Save as
  PDF", copy-as-markdown into a plain-text target, copy-as-rich-text into
  Confluence/Word/Google Docs retains formatting.

---

## Phase 2 — Rich rendering & plugins

Extends only the frontend rendering pipeline. No backend changes.

### Extensibility model

`render.ts` is structured as a configurable pipeline with two ordered stages:

1. **`markdown-it` plugins** — an array `MarkdownPlugin[]`, each
   `{ name: string, plugin: MarkdownItPluginFn, options?: object, enabled: boolean }`,
   applied via `md.use(plugin, options)` at instance construction. Adding a
   plugin is a one-line registry entry.
2. **Post-render passes** — an ordered array `PostRenderPass[]`, each
   `{ name: string, run(container: HTMLElement): Promise<void> | void, enabled: boolean }`,
   run against the rendered DOM after insertion. This is how DOM-transforming
   features (Mermaid, math typesetting that needs the DOM) hook in.

`renderMarkdown` becomes `renderInto(text, container)`: it produces HTML from
the plugin-configured `markdown-it`, inserts it, then awaits each enabled
post-render pass in order.

### Mermaid

- A `mermaid` post-render pass scans the container for
  `pre > code.language-mermaid` blocks, hands their text to `mermaid.render`,
  and replaces each block with the produced SVG. Mermaid is initialized with
  `startOnLoad: false` and a theme matched to the current app theme
  (light/sepia → default, dark → dark).
- On a Mermaid parse error, the pass leaves the original code block in place and
  shows an inline error note rather than failing the whole render.

### markdown-it plugin registry (initial set)

| Feature | Plugin | License |
|---|---|---|
| Math (TeX) | `markdown-it-katex` + `katex` | MIT |
| Footnotes | `markdown-it-footnote` | MIT |
| Emoji | `markdown-it-emoji` | MIT |
| Definition lists | `markdown-it-deflist` | MIT |
| Heading anchors | `markdown-it-anchor` | MIT / Unlicense |
| Callout/admonition containers | `markdown-it-container` | MIT |

(Per-plugin licenses are verified at the planning step before adding.)

### Settings & export interaction

- A **Plugins** settings panel lists registry entries with on/off toggles,
  persisted via `settings.ts` (extended with an `enabledPlugins` map). Toggling
  re-renders the current document.
- **Export must capture post-render output**: HTML/PDF export serializes the
  DOM *after* the post-render passes run, so Mermaid SVGs are already inline.
  Export additionally inlines KaTeX CSS (and any Mermaid-related CSS) into the
  self-contained HTML so exported files render offline.

### Testing (Phase 2)

- `render.ts` pipeline: a Mermaid fence becomes an `<svg>` in the container; a
  malformed Mermaid fence leaves the code block + shows an error note.
- Each enabled plugin: math renders KaTeX markup; footnote produces a footnote
  ref/anchor; container syntax produces the expected wrapper element.
- Plugin toggle: disabling a plugin removes its effect on re-render.
- Export: an exported HTML file containing a Mermaid diagram and a math formula
  renders correctly when opened standalone (manual smoke item).

---

## Phase 3 — Editor

Turns the viewer into a source editor with live preview, reusing the Phase 1/2
rendering pipeline and the existing Rust file I/O.

### Backend additions

- `save_text_file` (already defined in Phase 1) is reused for **Save**.
- `save_file_dialog() -> Option<String>` — native save dialog for **Save As**
  and **New** (choosing a destination path).
- **Self-write suppression:** when the app writes the open file, it sets an
  "ignore next change" flag (or compares the written content against the next
  `file-changed` payload) so the app's own save does not trigger an auto-reload
  loop that would clobber editor state.

### Frontend additions

- `editor.ts` — owns a CodeMirror 6 instance configured for Markdown
  (markdown language mode, line wrapping, the app theme). Exposes the current
  document text and a debounced `onChange` callback.
- **Layout modes** in `viewer.ts`: `view` (rendered only — Phase 1 behavior),
  `edit` (editor only), and `split` (editor + live preview side by side).
- **Live preview:** editor `onChange` (debounced ~150ms) re-runs the render
  pipeline into the preview pane.
- **Dirty state & saving:** a modified indicator; `Cmd/Ctrl+S` → `save_text_file`
  for an existing path, or `save_file_dialog` first for new/untitled documents.
  `Cmd/Ctrl+Shift+S` → Save As.
- **New document:** opens an empty editor in `edit`/`split` mode; first save
  prompts for a path.
- **Unsaved-changes guard:** opening another file or closing the window with
  unsaved changes prompts to save/discard/cancel.

### Data flow (editing)

1. Open or New → editor populated (existing content or empty).
2. Type → debounced render into the preview pane (no disk I/O).
3. Save → `save_text_file`; self-write suppression prevents a reload loop; dirty
   indicator clears.
4. External change to the open file while editing → if not dirty, auto-reload as
   in Phase 1; if dirty, prompt (reload-and-lose / keep-mine).

### Testing (Phase 3)

- `editor.ts`: setting/getting content; debounced change fires once per burst.
- Save round-trip: editing then saving writes expected bytes (Rust temp-file
  test for `save_text_file`); self-write suppression does not trigger a reload.
- Dirty-state logic: edits set dirty; save clears it; guard fires on
  open/close while dirty.
- Manual: split-view live preview updates as you type; Save/Save As/New; the
  unsaved-changes prompt.

---

## Build & distribution

- Single Tauri codebase. `npm run tauri dev` for development; `npm run tauri
  build` produces native bundles.
- macOS first (`.app` / `.dmg`). Windows (`.msi`/`.exe`) and Linux
  (`.deb`/`.AppImage`) are produced from the same code via platform-specific CI
  build jobs — no source changes required.

## Open questions

- None blocking Phase 1. (Future: one-click programmatic PDF export; per-plugin
  default-on/off choices for Phase 2; theme-sync details for Mermaid.)
