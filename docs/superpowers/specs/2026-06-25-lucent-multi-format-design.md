# Lucent Multi-Format Viewer — Combined Design

> **Status:** Approved design. Covers four features as one architecture, to be
> implemented as three independently-shippable plans (P1–P3). Each plan gets its
> own document under `docs/superpowers/plans/`.

## Context

Lucent (github.com/jverhoeks/lucent) today is a Markdown viewer built on Tauri 2
(Rust backend + system webview) with a TypeScript/Vite frontend. The renderer is
Markdown-specific (`src/render.ts`), tabs and per-tab raw/rendered mode live in
`src/tabs.ts`, the filesystem layer is Rust (`src-tauri/src/commands.rs`,
`watcher.rs`), and the app already does file watching, multi-tab, export, copy,
and themes.

This design turns Lucent into a **multi-format viewer**: in-document search,
structured-data rendering (JSON/YAML/TOML/INI), and a log viewer with tailing and
embedded-JSON decoding — with every format offering both a **raw** view (source
text + search) and a **rendered** view (the nice, format-specific view + search).

## Goals

1. **Search (#1):** an in-document find bar — case toggle (`Aa`), regex toggle,
   next/prev, match count ("n of N"), highlight all matches. Works in every view.
2. **Structured data (#2):** JSON/YAML/TOML/INI parsed into a single unified
   **collapsible tree**, colorized by type, with `+/−` collapse, expand/collapse
   all, and copy key-path/value. Collapsed branches remain findable by search
   (a match auto-expands its ancestors).
3. **Logs (#3):** a log view with **tail/follow**, level highlighting, search,
   and the ability to **decode embedded/escaped JSON** in a line into structured
   form (reusing the #2 tree).
4. **Raw/rendered for all (#4):** the existing mode toggle generalizes — raw =
   source text + search (+ tail for logs); rendered = the format's nice view +
   search.

## Non-Goals (this round)

- **Editing.** Lucent stays read-only; an edit mode remains a future feature.
- **Universal virtualization.** Only logs (and the raw view of very large files)
  are windowed/streamed. Markdown, structured trees, and small text use the
  simple full-DOM path.
- **Per-format bespoke rendering** for structured data — JSON/YAML/TOML/INI all
  share one tree.

## Key Decisions (resolved)

| Decision | Choice |
|---|---|
| Largest file rendered smoothly | Huge/streaming **logs** — windowing/streaming built for logs |
| Format detection | **Extension** + manual **"View as…"** override |
| Structured-data rendering | **Unified collapsible tree** for all four formats |
| Search capability (v1) | Case toggle + next/prev + count + highlight **+ regex** |
| Editing | Read-only this round |
| Structured-data size | **Capped**; above the cap, fall back to raw + search |

---

## Architecture

### The document model

A document = **source + format + mode**.

```ts
type Format = "markdown" | "data" | "log" | "text";
type Mode = "rendered" | "raw";
type DataLang = "json" | "yaml" | "toml" | "ini";

interface Doc {
  path: string;
  format: Format;        // detected by extension, overridable via "View as…"
  forcedFormat?: Format; // set by "View as…"
  mode: Mode;
  // source access differs by path: in-memory string for simple formats,
  // or a streamed line-window handle for logs / very large raw files.
}
```

### Format dispatch

`src/format.ts` (new) maps extension → `Format`:

- `.md .markdown .mdown .mkd` → `markdown`
- `.json .yaml .yml .toml .ini` → `data` (with the specific `DataLang`)
- `.log` → `log`
- everything else → `text`

A **"View as…"** control in the toolbar lets the user override the detected
format for the active tab (e.g. view a `.txt` as `json`, or a `.log` as `text`).
The override sets `forcedFormat` and re-renders.

### Two render paths — dispatched, not universal

- **Full-DOM (simple):** markdown, the structured tree, and small raw text render
  fully into the DOM. This is the fast path and covers the higher-value features.
- **Windowed + backend-streamed:** logs, and the raw view of files above a size
  threshold, render only the rows visible in the viewport. The Rust backend
  seeks/tails the file and serves **line windows** on demand.
- The **structured tree sidesteps virtualization on its own**: it renders only
  *expanded* nodes and defaults to a shallow/collapsed state, so the DOM stays
  small until the user drills in. Only "expand all" on a very large parsed value
  needs a node-count guard (offer raw fallback past the cap).

Net: **virtualization is logs-only** (plus large raw text), keeping P1/P2 simple.

### Renderer interface

`src/renderers/` — one module per format, each producing the rendered view into a
container and exposing a search provider:

```ts
interface Renderer {
  format: Format;
  /** Render `source` into `container` for the given theme. */
  render(source: string, container: HTMLElement, ctx: RenderCtx): Promise<void>;
  /** The search provider bound to the just-rendered content (see Search). */
  searchProvider(): SearchProvider;
}
```

`render.ts` (markdown) is refactored to implement this interface; `tabs.ts`
dispatches to the renderer for the doc's format and mode.

---

## Feature A: Search (#1) — one controller, three providers

The payoff of designing together: a single controller, formats differ only in how
matches are found and revealed.

### UI

- A **search icon** in the toolbar and `Cmd/Ctrl+F` open a compact **search bar**
  overlaying the top of the content area.
- Controls: text input, **`Aa`** case-sensitivity toggle, **`.*`** regex toggle,
  **prev** / **next** buttons, a **"n of N"** match counter, and a close button.
- Keys: `Enter` = next, `Shift+Enter` = prev, `Esc` = close. Typing re-runs the
  search (debounced). Invalid regex shows an inline error and zero matches.

### Controller

`src/search/controller.ts` owns query, `caseSensitive`, `regex`, the ordered
match list, the current index, navigation, and highlight orchestration. It is
format-agnostic and talks only to a `SearchProvider`.

```ts
interface SearchQuery { text: string; caseSensitive: boolean; regex: boolean; }
interface Match { id: number; /* provider-defined location */ }

interface SearchProvider {
  /** Recompute all matches for the query; returns them in document order. */
  find(query: SearchQuery): Match[];
  /** Scroll/expand so match `id` is visible and emphasized; clear others. */
  reveal(id: number): void;
  /** Remove all highlight decorations. */
  clear(): void;
}
```

### The three providers

- **markdown / text (`DomSearchProvider`):** walks text nodes of the rendered DOM
  (it is all present), wraps matches in `<mark>`, tracks them; `reveal` scrolls
  the current mark into view and adds a `current` class. Used by markdown rendered
  view and small raw text.
- **structured tree (`TreeSearchProvider`):** searches the **parsed value in
  memory** (keys + scalar values, by `path`). `reveal` auto-expands the match's
  ancestor branches, then scrolls its row into view and highlights it. Matches in
  collapsed branches are still found (requirement from #2).
- **logs (`LogSearchProvider`):** searches the **backend line index** (windowed).
  `find` asks Rust for line numbers matching the query; `reveal` fetches the
  window around a line, scrolls to it, highlights it. Works while following.

`model-based ≠ streaming`: the first two providers are pure in-memory; only the
log provider crosses into Rust. The interface is built in P1; the two simple
providers ship in P1, the log provider in P3 with no controller changes.

---

## Feature B: Structured data — unified tree (#2)

### Parsing

`src/data/parse.ts` parses by `DataLang` into a **common value model**:

```ts
type DataValue =
  | { kind: "scalar"; type: "string" | "number" | "boolean" | "null"; value: unknown }
  | { kind: "array"; items: DataNode[] }
  | { kind: "object"; entries: DataNode[] };
interface DataNode { key: string | number; value: DataValue; path: string; }
```

- JSON → `JSON.parse`.
- YAML → `js-yaml` (`load`).
- TOML → `smol-toml` (`parse`).
- INI → `ini` (`parse`); sections become objects.

On parse error: show the message + location, fall back to the **raw** view.

### Rendering

`src/renderers/data.ts` renders the value model as a **collapsible tree**:

- Each node: a `+/−` toggle for containers, a colorized key, and a colorized
  value (type-based colors that follow the light/dark theme).
- **Renders only expanded nodes**; default state is expanded to a shallow depth
  (e.g. depth 1–2) so large files stay light. `Expand all` / `Collapse all`
  buttons; `Expand all` is guarded past a node-count cap.
- Per-node actions: **copy value**, **copy key-path** (e.g. `a.b[2].c`).
- **Raw mode** for `data` files: source text highlighted with the matching
  highlight.js grammar (`json`/`yaml`/`ini`/`toml`).

### Reuse contract

`renderTree(value: DataValue, container)` **takes an already-parsed value, not a
file path or text.** This is what lets the log embedded-JSON decoder (#3) feed a
decoded line's value straight into the same component.

### Size cap

Above a configured byte/node cap, skip the tree and show raw + search with a
notice ("file too large for tree view — showing raw"). Streaming is *not* used
for structured data.

---

## Feature C: Logs (#3)

### Backend (Rust)

Extend the filesystem layer to stream and tail:

- **Line-offset index:** on open, scan the file once to record byte offsets of
  line starts, enabling random-access window fetches without loading the whole
  file. Rebuilt/extended incrementally as the file grows.
- **`log_open(path) -> { lineCount, ... }`** — index the file, return metadata.
- **`log_window(path, start, count) -> string[]`** — return lines `[start, start+count)`.
- **`log_search(path, query, caseSensitive, regex) -> number[]`** — return
  matching line numbers (drives `LogSearchProvider`).
- **Tail/follow:** extend `watcher.rs` so growth emits a `log-appended` event with
  the new line range; the frontend appends and (if pinned to bottom) auto-scrolls.

### Rendered view

`src/renderers/log.ts` renders a **windowed** line view:

- Line numbers, monospace, per-line **level highlighting** via a heuristic
  (`ERROR`/`WARN`/`INFO`/`DEBUG`/`TRACE` tokens) coloring the row.
- A **follow/tail** toggle (on → auto-scroll as new lines arrive; manual scroll
  up un-pins).
- **Embedded JSON:** a line containing a JSON object/array (including escaped
  JSON inside a quoted string) gets an expander; expanding renders the decoded
  value with the **#2 tree** (`renderTree`). A global **"decode embedded JSON"**
  toggle expands all detected payloads.
- Search highlights matched lines (via `LogSearchProvider`) and works while
  following.

### Raw mode

Plain windowed text + search + tail (no level coloring, no JSON expansion).

---

## Dependencies & Licenses

| Dependency | Purpose | License |
|---|---|---|
| `js-yaml` | YAML parsing | MIT |
| `smol-toml` | TOML 1.0 parsing | MIT |
| `ini` | INI parsing | ISC |
| highlight.js grammars (`json`/`yaml`/`ini`/`toml`) | raw-mode highlight | already bundled (BSD-3) |

Virtualization/windowing is a **small custom utility** (no heavy dependency).
Rust adds a line-indexer/tailer module; no new crates expected beyond what
`notify` already provides.

## Security

- Structured-data parsers run on file content already trusted enough to open;
  parse defensively (catch + fall back to raw). No code execution: `js-yaml`'s
  safe `load` (default schema, no custom types).
- The tree and log renderers build DOM via `textContent`/element creation, **not**
  `innerHTML`, for all file-derived strings — no markup injection from data/log
  content. (Markdown keeps its existing `html:false` posture.)
- Embedded-JSON decoding only *parses and displays*; it never evaluates.

## Testing

- **Search controller** (Vitest): match ordering, count, next/prev wrap, case
  toggle, regex (incl. invalid regex → 0 matches), highlight/clear. Provider
  fakes for the three sources.
- **Data parse** (Vitest): each format → common model; error → fallback signal.
- **Tree** (Vitest/jsdom): expand/collapse, search auto-expand of ancestors,
  copy key-path, size-cap fallback.
- **Log backend** (Rust): line-index correctness, `log_window` ranges,
  `log_search` results, incremental growth/append events.
- **Embedded-JSON detection** (Vitest): plain JSON, escaped JSON in a string,
  non-JSON lines, partial/garbage → no false expander.

## Implementation Sequence — one design, three plans

Each phase leaves a working, shippable app.

- **P1 — Dispatch + modes + search foundation.**
  Format detection + "View as…", generalized raw/rendered modes across formats,
  the search **controller + provider interface**, and the **`DomSearchProvider`**
  (markdown + text). Ships: search on the current Markdown/text viewer.
- **P2 — Structured data.**
  Parsers + common value model, the unified **tree renderer** (`renderTree(value,
  container)`), raw-mode highlighting, size-cap fallback, and the
  **`TreeSearchProvider`**. Ships: JSON/YAML/TOML/INI viewing + search.
- **P3 — Logs.**
  Rust line-index/tailer + window/search commands, the windowed **log renderer**
  with level highlighting + follow, **embedded-JSON decode** (reusing the P2
  tree), and the **`LogSearchProvider`**. Ships: log viewing with tail + search +
  embedded JSON.

All streaming/windowing cost lands in P3; P1 and P2 ride the simple full-DOM path.
