# Lucent — Codebase Review

**Project**: Lucent — cross-platform desktop Markdown and structured-text viewer (Tauri 2 + TypeScript + Rust)  
**Date**: 2026-06-26  
**Review scope**: All frontend (`src/`) and backend (`src-tauri/src/`) source, configuration, tests

---

## Structure

- `src/` — TypeScript frontend (markdown rendering, tabs, search, data trees, log viewer)
- `src-tauri/src/` — Rust backend (file I/O, file watching, stdin streaming, PDF export, log indexing)
- `test/` — Vitest frontend tests (~39 tests)
- `examples/` — Demo documents covering all supported features

---

## Issues

### Bugs

| # | File | Line | Description |
|---|------|------|-------------|
| B1 | `tabs.ts` | 265–286 | **Scroll restoration race**: `repaint` fires async renderers (Mermaid) without `await`, so `scrollTop` is restored before async DOM mutations complete, causing visual jump |
| B2 | `tree.ts` | 159 | **Incomplete `CSS.escape` fallback**: Only escapes `"` and `\`; paths with `]`, spaces, `:`, `(`, `)` break `querySelector` |
| B3 | `main.ts` | 174 | **Path normalization mismatch**: `siblings.indexOf(cur)` may miss if file opened via drag-and-drop uses non-canonical path vs. Rust's absolute paths |
| B4 | `embedded-json.ts` | 28–31 | **O(n²) on unmatched brackets**: `findBalanced` scans entire rest of string for each unmatched opener; pathological lines cause high CPU |
| B5 | `tabs.ts` | 138–150 | **Content flash on async renderers**: `repaint` replaces DOM synchronously but Mermaid diagrams render async, showing empty placeholder flash |
| B6 | `tabs.ts` | 70–79 | **Leaky clipboard**: `getActiveDisplayedHtml` serializes entire content area including presentational wrappers into rich-text clipboard |
| B7 | `main.ts` | 335–339 | **No drag-over feedback**: `onDragDropEvent` handles drop but provides no visual feedback during drag-over |

### Code Quality

| # | File | Line | Description |
|---|------|------|-------------|
| CQ1 | `tabs.ts` | 268–284 | `repaint` handles ~5 separable concerns (mode check, rendered rendering, raw highlighting, scroll restore, follow-mode) |
| CQ2 | `renderers/data.ts` | 16–53 | `render` is 38 lines combining lang detection, size cap, parse, error UI, toolbar creation, tree rendering |
| CQ3 | `render.ts` | 53–81 | `splitHighlightedLines` has no empty-input guard; empty string `""` produces `[""]` with one empty row |
| CQ4 | `format.ts` | 4 | Duplicates `basename` logic also in `tabs.ts:28` |
| CQ5 | `settings.ts` | 9 | `JSON.parse(raw)` without schema validation — corrupt values flow into `StyleSettings` |
| CQ6 | `stdin.ts` | 17–18 | `void` discard of promises silently swallows unhandled rejections |
| CQ7 | `search/bar.ts` | 51 | Regex parse errors only show `"err"` with no detail message surfaced to user |
| CQ8 | `tabs.ts` | 70–79 | `querySelectorAll` on clone — fragile if search provider uses other class-based markers |

### Architecture

| # | File | Line | Description |
|---|------|------|-------------|
| A1 | `renderers/log.ts` | 7–11 | **Singleton `LogView`**: Module-level `currentLogView` assumes single log tab; breaks incremental updates with multiple log tabs |
| A2 | `tabs.ts` | 251 | `TabManager.streamLogUpdate` directly imports `getCurrentLogView()` — couples tab manager to log renderer internals |
| A3 | `main.ts` | 33–43 | `rebindSearch` lives in main.ts but contains format-specific logic about `TreeSearchProvider` vs. `DomSearchProvider` |
| A4 | `tabs.ts` | 265–286 | `Renderer.render()` is `void \| Promise<void>` but `repaint` never awaits — no renderer lifecycle contract |
| A5 | `tabs.ts` | 268 | No error boundary around renderers — thrown exception leaves content area partially rendered |
| A6 | Various | — | Log view's prefix-based reconciliation rebuilds all rows on ring-buffer eviction (up to 10,000 DOM nodes) |

### Performance

| # | File | Line | Description |
|---|------|------|-------------|
| P1 | `renderers/data.ts` | 6 | 5MB cap for tree view — no progressive loading or virtual scrolling for medium-large files |
| P2 | `tree.ts` | 64–68 | `collectFlat` eagerly creates `FlatNode` objects for entire tree; 100K nodes = 100K objects in memory |
| P3 | `tabs.ts` | 251–262 | Full DOM rebuild on non-prefix log changes (ring buffer drop) — up to 10,000 nodes torn down and recreated |

### Missing Features / Gaps

| # | File | Line | Description |
|---|------|------|-------------|
| M1 | `search/bar.ts` | 51 | Regex error detail not surfaced — user sees `"err"` with no explanation |
| M2 | `tabs.ts` | — | No middle-click close or `Cmd/Ctrl+W` keyboard shortcut for tabs |
| M3 | `main.ts` | — | No loading indicator for slow file opens (network volumes) — UI freezes until invoke returns |
| M4 | `render.ts` | 18–26 | `applyCodeTheme` creates `<style>` elements without cleanup on destroy |
| M5 | `main.ts` | — | No `highlight.js` language registration for many languages users might actually use |
| M6 | `export.ts` | 27 | Hardcoded `"light"` theme in exports — dark-theme users get light diagrams |

### Test Coverage Gaps

| # | Area | Description |
|---|------|-------------|
| T1 | `data/parse.ts`, `data/parse-value.ts`, `data/tree.ts` | No direct unit tests (only indirectly via `tree-provider.test.ts`) |
| T2 | `TabManager` lifecycle | No tests for `openOrActivate`, `closeTab`, `toggleMode`, `toggleFollow` |
| T3 | `format.ts` | No tests for `detectFormat`, `dataLangOf` |
| T4 | `settings.ts` | No tests for `loadSettings`, `saveSettings` |
| T5 | `export.ts` | No tests for `buildStandaloneHtml`, `exportHtml`, `exportPdf` |
| T6 | `clipboard.ts` | No tests for `copyAsMarkdown`, `copyAsRichText` |
| T7 | `SearchController`, `SearchBar` | No tests for controller or bar (only `SearchProvider` implementations) |
| T8 | `main.ts` | No integration tests for event handlers or toolbar actions |
| T9 | Rust `pdf.rs` | No tests (platform-specific, but mockable) |

### CSS / Accessibility

| # | File | Line | Description |
|---|------|------|-------------|
| X1 | `styles.css` | 412–425 | Duplicate `.doc ul.contains-task-list` rules with identical values |
| X2 | `styles.css` | 688 | Search bar `top: 56px` hardcodes toolbar height — breaks if toolbar wraps |
| X3 | `styles.css` | — | No `aria-selected` on tabs, only `.tab.active` class |
| X4 | Various | — | No `prefers-reduced-motion` support for smooth scroll/transitions |
| X5 | `styles.css` | 58 | `select` elements use `title` but not `aria-label` |
| X6 | `styles.css` | 768–785 | Dark theme uses `:has()` selector (no Firefox <121) — acceptable for Tauri |

### Dependency Concerns

| # | Dependency | Size | Notes |
|---|------------|------|-------|
| D1 | `mermaid` | ~5MB | Largest dep; only used for subset of documents with ` ```mermaid ` blocks |
| D2 | `highlight.js` | ~1.5MB | 190+ languages bundled; only ~15 are used in practice |
| D3 | `katex` fonts | ~2MB | CSS always imported; inline math uncommon in most docs |
| D4 | `js-yaml` ^5.1.0 | — | `js-yaml` has known issues; `yaml` package is more maintained |

---

## Good Points

### Architecture

1. **Format-agnostic renderer registry** — `Renderer` interface + `registry.ts` dispatch makes adding new formats trivial (just renderer + format detection + registration)
2. **Search abstraction** — `SearchProvider` interface with `DomSearchProvider` (text nodes) and `TreeSearchProvider` (data model); `SearchController` is format-agnostic
3. **Incremental log rendering** — `LogView.setLines()` with prefix detection avoids DOM rebuilds for the common append-only case
4. **Export dual-path** — macOS uses native `WKWebView.createPDF`; other platforms fall back to browser `window.print()`
5. **Security in depth** — `markdown-it` with `html: false`, link scheme allowlisting, Rust-side `is_viewable()` gating, fence info sanitization, absolute path rejection in `resolve_sibling`
6. **Parent-directory file watching** — Watches parent dir (not file) to catch atomic saves (write-temp-then-rename), a well-known editor behavior
7. **Stdin pull model** — Frontend pulls buffer snapshot via `stdin_lines` command instead of relying on event payloads; avoids event-before-listener race
8. **Line number alignment in code blocks** — `splitHighlightedLines` correctly re-balances `<span>` elements across line boundaries; non-trivial problem solved well

### Code Quality

9. **TypeScript strict mode** — `strict: true`, `noUnusedLocals`, `noUnusedParameters`
10. **Resource limits** — File size caps (5MB tree, 5000 expand cap, 10,000 line stdin buffer) prevent OOM on unbounded inputs
11. **Module-level caching** — `render.ts:158` caches `mermaidConfiguredTheme` to avoid Mermaid re-init on every render
12. **Forward-compatible defaults** — `{ ...DEFAULT_SETTINGS, ...JSON.parse(raw) }` automatically picks up new defaults for existing users
13. **Clipboard API** — `copyAsRichText` provides both `text/html` and `text/plain` MIME types for proper paste experience
14. **Comments explain *why*** — The watcher atomic-save rationale, stdin pull-model explanation, and phantom-trailing-row comment are genuinely useful
15. **Self-contained PDF export** — CSS `body.exporting` rules restructure live DOM for native PDF capture (which uses screen media, not print media)
16. **Rust line-indexing architecture** — `LineIndex` builds byte-offset index for fast random-access windows; supports incremental `extend()` and regex/literal search — all without re-reading the file

### Testing

17. **Pure function testability** — `level.ts`, `embedded-json.ts`, `format.ts`, `parse-value.ts` are pure functions with no DOM deps, easy to unit test
18. **Rust unit tests** — Commands, stdin, watcher, and logindex all have unit tests with proper temp-dir usage

### Configuration

19. **Vite + Tauri config** — `strictPort`, `clearScreen: false`, HMR host handling follow Tauri best practices
20. **`.gitignore` thoughtfulness** — `!examples/*.log` preserves test fixtures while ignoring actual log files
21. **Comprehensive examples** — Demo documents cover every supported feature (math, mermaid, footnotes, callouts, all data formats)

---

## Recommendations (Priority Order)

### Must-Fix (correctness & data loss)

1. **Fix `CSS.escape` fallback** (`tree.ts:159`) — Use a robust CSS.escape polyfill; breaks tree rendering for data keys with special characters
2. **Fix path normalization for "Next"** (`main.ts:174`) — Normalize paths via Rust before comparison; "Next" silently does nothing on drag-and-drop opened files
3. **Detach `LogView` singleton** (`log.ts:7-11`) — Return instance from `render()` instead of module-level var; currently breaks incremental updates with multiple log tabs

### Should-Fix (UX & resilience)

4. **Add error boundary to `repaint`** (`tabs.ts:265-286`) — Wrap render call in try/catch with graceful fallback; renderer exceptions currently leave content area broken
5. **Code-split Mermaid + highlight.js + KaTeX** (S1–S4) — Lazy-load heavy deps per-format. Reduces initial bundle from ~8MB to ~400KB. Biggest single performance win
6. **Debounce file-watcher events** (S11) — 200ms debounce prevents cascading re-renders from editor save-multiple events
7. **Debounce `stdin` flush** — Already 50ms, but consider 100ms for very high-throughput pipes
8. **Surface regex error details** (`search/bar.ts:51`) — Pass error message to search bar for better UX

### Should-Build (experience & reach)

9. **CI/CD pipeline** (R1) — GitHub Actions for build + test + release. Gates quality, enables distribution
10. **Virtual scrolling for logs + trees** (S6–S7) — Eliminates DOM size issues for large files (10K-line logs, near-5MB JSON trees)
11. **Code signing + auto-updater** (R3–R4) — Required for safe, trusted production distribution
12. **Add tab keyboard shortcuts** — `Cmd/Ctrl+W` close, middle-click close, `Cmd/Ctrl+Tab` cycle
13. **Add loading states** — Spinner or skeleton during `invoke("read_file")` for large/slow files

### Nice-to-Have (future)

14. **Test coverage for untested modules** — Focus on `TabManager` lifecycle, `data/tree.ts`, `format.ts`, `settings.ts`, `SearchController`
15. **Platform packaging** — DMG, MSI, AppImage, deb, rpm, Homebrew, winget (R7–R13)
16. **Session persistence** (F4) — Restore tabs on relaunch
17. **Live preview editing** (F10) — Split-pane source + rendered view
18. **Virtual scroll for data trees** (S7) — Only render visible rows, virtualize collapsed subtrees
19. **WebAssembly build / PWA** (R19) — Browser-based version without installation
20. **VS Code extension** (R20) — Embed viewer as VS Code custom editor

---

## Ideas & Future Features

### Reading & Navigation

| # | Idea | Reasoning |
|---|------|-----------|
| F1 | **Folder sidebar / file tree** | Navigate directories without OS file picker; essential for exploring a docs folder. Could show `.md` + supported files in the directory tree |
| F2 | **Document outline / TOC panel** | Clickable heading list extracted from rendered Markdown; pinned sidebar. Parsed via the existing `markdown-it-anchor` infrastructure |
| F3 | **Tab groups / workspaces** | Save and restore sets of open tabs (e.g., `lucent --workspace docs/project.json`). Maps well to the existing `TabManager` |
| F4 | **Session persistence** | Restore tabs on relaunch — save paths + scroll positions + format overrides to a session file. Straightforward given the existing serializable tab model |
| F5 | **Image rendering** | Render `![](./local.png)` blocks. Currently blocked by CSP — needs Tauri asset protocol or `convertFileSrc`. High-value for README viewing |
| F6 | **Reading time estimate** | Auto-calculated from word count. Trivial to add as a status-bar element |
| F7 | **Presentation mode** | Fullscreen slideshow from Markdown headings (horizontal rules = slide breaks). No new deps needed — just CSS and fullscreen API |
| F8 | **Scroll sync (split view)** | When adding a source-code pane, sync scroll positions so both panes track the same logical line range |
| F9 | **Bookmarks / highlights** | Persisted in-document annotations. Store path + scroll offset in localStorage or alongside settings |

### Editing & Authoring

| # | Idea | Reasoning |
|---|------|-----------|
| F10 | **Live preview editing** | Split pane with Markdown source on one side, rendered output on the other. Save-to-disk on blur or `Cmd+S`. The `raw` mode already exists — just make it editable |
| F11 | **Obsidian-compatible wikilinks** | `[[Note Name]]` and `![[embed]]` syntax. Massive ecosystem compatibility. Use a `markdown-it` plugin |
| F12 | **Command palette** | `Cmd+Shift+P` with fuzzy-matched actions (Open, Export, Toggle Theme, etc.). High discoverability for power users |
| F13 | **Typewriter / focus mode** | Typewriter: keep cursor line centered. Focus: dim all except current paragraph. CSS-only features |
| F14 | **Custom CSS snippets** | User drops `.css` files into `~/.config/lucent/snippets/`, app applies them. Low effort, high power-user value |
| F15 | **Spell checking** | Native webview spellcheck is available via `spellcheck="true"` on contenteditable — trivial if/when editing is added |
| F16 | **Vim mode (for raw editor)** | If raw mode becomes editable, a basic Vim mode via CodeMirror 6 or similar would attract developer users |

### Integration & Advanced

| # | Idea | Reasoning |
|---|------|-----------|
| F17 | **Plugin system for renderers** | Allow user-installed renderers (`.wasm` or JS files in `~/.config/lucent/renderers/`). Realizes the format-agnostic architecture to its fullest |
| F18 | **Pandoc export** | Export to `.docx`, `.latex`, `.epub`, `.pdf`, `.html`. Use the Rust `pandoc` crate or shell out to `pandoc` binary |
| F19 | **Git integration** | Show `git blame` info inline, diff view for changed files, branch indicator. High-value for developer documentation workflows |
| F20 | **Backlinks graph** | Like Obsidian's backlinks panel and graph view. Requires wikilink parsing + link index. Displays via Mermaid or D3 |
| F21 | **Configuration panel UI** | Replace localStorage-driven settings with a proper settings pane (themes, fonts, keybindings, renderer options) |
| F22 | **Multi-window / detachable tabs** | Drag a tab out to create a new window. Tauri v2 supports multiple webview windows natively |
| F23 | **WebSocket live reload** | Watch remote files (e.g., over SSHFS or Dropbox) via WebSocket events from a companion server |
| F24 | **Highlight.js language bundle picker** | Let users select which languages to include at build time (or lazy-load on demand) instead of bundling all 190+ |

---

## Speed & Performance

### Startup

| # | Idea | Impact | Effort |
|---|------|--------|--------|
| S1 | **Code-split heavy deps** — Mermaid, KaTeX, highlight.js, js-yaml, smol-toml, ini all loaded eagerly in `main.ts:5-9`. Dynamic `import()` per-format on first use | Reduces initial JS bundle from ~8MB to ~400KB. Shaves 200-400ms from app launch | Medium |
| S2 | **Lazy-load Mermaid** — Only initialize Mermaid when a document with a ` ```mermaid ` fence is opened. Currently initialized on every render via `runPostRender()` | Saves ~5MB parse/init time on plain Markdown documents | Medium |
| S3 | **Lazy-load KaTeX CSS** — KaTeX font CSS is imported globally (`import "katex/dist/katex.min.css"` in `main.ts:2`). Only needed when document has `$...$` math. Could inject `<link>` dynamically | Saves ~2MB of font download on documents without math | Low |
| S4 | **`highlight.js` language subset** — Register only ~15 languages actually used (see `LANG_EXT` map in `main.ts:90-95`). Currently all 190+ are bundled | Reduces hljs from ~1.5MB to ~200KB | Low |
| S5 | **Rust-side Markdown rendering** — Move `markdown-it` pipeline to Rust (`pulldown-cmark`) + a Rust syntax highlighter (`syntect`). Eliminates JS rendering entirely for most documents | Would make initial rendering near-instant. Major architectural change | High |

### Rendering & Scrolling

| # | Idea | Impact | Effort |
|---|------|--------|--------|
| S6 | **Virtual scrolling for log files** — Only render the ~40 visible log lines, recycle DOM nodes as the user scrolls. Currently renders all lines into the DOM | Drastically reduces DOM size for large logs (10K lines → 40 visible). Eliminates the full-rebuild cost on non-prefix updates | Medium |
| S7 | **Virtual scrolling for data trees** — Same approach for the collapsible tree view. Only render visible rows, virtualize collapsed subtrees | Key for large JSON/YAML files near the 5MB cap | Medium |
| S8 | **`content-visibility: auto` on rendered content** — CSS containment on off-screen `<article.doc>`, `<div.log>`, `<div.tree>` children. Browser skips layout/paint for off-screen content | Near-zero-effort performance win. Single CSS property | Low |
| S9 | **DOM pooling for tree expand/collapse** — Reuse tree-row `<div>` elements instead of creating new DOM nodes on every expand. The `TreeView` currently creates fresh elements | Reduces GC pressure during rapid expand/collapse of large trees | Low |
| S10 | **Pre-render adjacent tabs** — When switching tabs, start rendering hidden tabs in the background via `requestIdleCallback` | Makes tab switch feel instant | Medium |

### File I/O & Events

| # | Idea | Impact | Effort |
|---|------|--------|--------|
| S11 | **Debounce file-watcher events** — Editor saves can fire multiple `notify` events per second. Currently each triggers a re-read + re-render. A 200ms debounce prevents cascading renders | Prevents double/triple renders on save. Noticeable on large files | Low |
| S12 | **Use `mmap` for large files** — Instead of `read_file` → `String`, memory-map the file on the Rust side. Zero-copy reads. Particularly beneficial for `logindex.rs` which scans byte-by-byte | Faster first render for large files. Key for log files >100MB | Medium |
| S13 | **Offload markdown-it to a Web Worker** — `markdown-it` + `highlight.js` + `mermaid` all run on the main thread, blocking UI. Moving to a Worker keeps the UI responsive | Keeps toolbar/search responsive during render of large Markdown files (5K+ lines) | Medium |

### Incremental / Streaming

| # | Idea | Impact | Effort |
|---|------|--------|--------|
| S14 | **Incremental Markdown re-render for append-only files** — Like log tracking but for Markdown. If a file grows, only re-render the new lines. Currently re-renders entire document | Critical for tweaking docs in an external editor while watching the preview | High |
| S15 | **Binary log index persistence** — Serialize `LogIndex` byte-offset map to disk so re-opening a 500MB log file doesn't re-scan from scratch | Reduces log re-open time from minutes to milliseconds | Medium |

### Bundle Size

| # | Idea | Impact | Effort |
|---|------|--------|--------|
| S16 | **Tree-shake markdown-it plugins** — Replace `markdown-it-container` (generic, full implementation) with a lighter custom container parser for just note/warning/tip | Minor CSS/JS savings | Low |
| S17 | **Evaluate `micromark` as markdown-it replacement** — `micromark` is the modern, modular, tree-shakeable successor. Smaller baseline and only pay for what you use | Could reduce markdown parser from ~50KB to ~10KB gzipped | High |
| S18 | **Remove `katex` font files from bundle** — Load from CDN instead of bundling. Only an issue for standalone HTML export (which already uses a CDN link for KaTeX CSS) | Saves ~2MB in `dist/` | Low |

---

## Distribution

### Build & CI

| # | Idea | Reasoning |
|---|------|-----------|
| R1 | **CI/CD pipeline (GitHub Actions)** — Run `cargo test` + `npm test` on PR, build binaries for macOS (x64 + arm64), Windows (x64), Linux (x64 + arm64) on merge to main. Tagged releases push to GitHub Releases | Without this, every release is manual. Essential for any public distribution |
| R2 | **macOS universal binary** — `lipo` x64 + arm64 into a single `.app` bundle. Apple Silicon users get native performance; Intel users can run too. Tauri supports this via `--target universal-apple-darwin` | Single download for all Macs. Smaller than two separate downloads |
| R3 | **Code signing** — macOS notarization via Apple Developer ID, Windows Authenticode signing. Without this, Gatekeeper blocks installs on macOS and SmartScreen warns on Windows | Required for production distribution. Otherwise users see "unidentified developer" warnings |
| R4 | **Auto-updater** — Tauri updater plugin with a `latest.json` feed on GitHub Releases or a static server. Users get notified of updates automatically | Without this, users stay on old versions forever. Sets up an upgrade channel |
| R5 | **Release automation** — `semantic-release` or `release-please` for automatic version bumps, changelog generation, and GitHub Release creation from conventional commits | Reduces release overhead to merging a PR |
| R6 | **Nightly builds** — Automated nightly builds from `main` branch for early adopters to test bleeding-edge features | Lets power users test/find bugs before stable releases |

### Platform Packaging

| # | Idea | Reasoning |
|---|------|-----------|
| R7 | **macOS DMG with backdrop** — Standard `.dmg` with background image, `Applications` folder symlink, drag-to-install. Tool: `create-dmg` or `appdmg` | Users expect DMG, not raw `.app` zips |
| R8 | **Windows MSI installer** — Windows Installer XML (WiX) or `msi` bundle. Tauri supports MSI natively as an alternative to NSIS | MSI allows silent install, enterprise deployment, and is more trusted than NSIS .exe |
| R9 | **Linux AppImage + deb + rpm** — AppImage for universal Linux, `.deb` for Debian/Ubuntu, `.rpm` for Fedora/RHEL. Tauri supports all three via `tauri.conf.json` bundles | AppImage is the most accessible; native packages are expected by distro users |
| R10 | **Homebrew cask** — A `lucent.rb` cask in the homebrew-cask repo. `brew install --cask lucent` | The standard macOS install path for developer tools |
| R11 | **winget / chocolatey** — Windows package manager entries. `winget install lucent` | Growing expectation for Windows users, especially developers |
| R12 | **Flatpak / Snap** — Sandboxed Linux packages with automatic updates. Work well with Tauri's sandbox model | Broader Linux reach beyond AppImage |
| R13 | **AUR package** — Arch Linux user-submitted package. Trivial to create and maintain | Essential for Arch users |

### Quality & Trust

| # | Idea | Reasoning |
|---|------|-----------|
| R14 | **Crash reporting (opt-in)** — Integrate Sentry or similar crash-reporting SDK. Without this, you're flying blind on user issues | Gives insight into real-world crashes. Opt-in for privacy |
| R15 | **Usage telemetry (opt-in)** — Anonymous feature-usage stats: which formats opened, which features used, themes chosen. Helps prioritize development | Controversial but valuable. Must be opt-in with clear explanation |
| R16 | **Landing page / website** — `lucent.dev` or similar with screenshots, feature list, download links, changelog | Required for discoverability. Even a single-page site is better than a README |
| R17 | **App icon set** — Full icon set for all platforms (1024x1024 macOS, 256x256 Windows ICO, 256x256 Linux PNG, SVG). Currently uses Tauri defaults | Professional appearance. Users judge by the icon |
| R18 | **`lucent --help` docs** — Comprehensive CLI help with examples for all flags (`--stdin`, `--theme`, etc.). Currently minimal | Critical for terminal-first user onboarding |

### Advanced Distribution

| # | Idea | Reasoning |
|---|------|-----------|
| R19 | **WebAssembly build / PWA** — Compile the frontend (sans Tauri APIs) to a static site that works in a browser. Uses `localStorage` for settings, `fetch` for files, File System Access API for opening local files | Would make Lucent usable without installation. Reaches the widest possible audience |
| R20 | **VS Code extension** — Embed the Lucent viewer as a VS Code custom editor. Register for `.md` files. ~100 lines of extension glue | Puts Lucent in front of every VS Code user. Huge distribution channel |
| R21 | **Docker image with headless rendering** — `lucent render README.md --format pdf > output.pdf` via headless Chromium (puppeteer). Useful for CI pipelines | Server-side rendering use case. Complements the desktop app |
| R22 | **`npm create lucent` / scaffolding** — Template to create a new Tauri + Lucent project with custom renderers. Lowers the bar for plugin development | Grows the ecosystem |
| R23 | **PWA in Tauri (hybrid)** — Keep the current Tauri shell but also publish to Chrome Web Store / Microsoft Store as a PWA. `@tauri-apps/api` calls degrade gracefully | Two distribution vectors from one codebase |

### Positioning & Marketing

| # | Idea | Reasoning |
|---|------|-----------|
| R24 | **Emphasize Tauri vs. Electron** — Lucent's binary is ~5MB vs. Obsidian's ~200MB. Startup is ~100ms vs. ~2s. This is a genuine differentiator and should be front-and-center | Performance is a feature. Developer audience cares deeply about bloat |
| R25 | **OpenCollective / GitHub Sponsors** — Funding for code signing certs ($300/yr for Apple, $300/yr for Windows), CI minutes, domain, CDN | Distro costs are non-trivial. Async funding avoids ads/bloating the app |
| R26 | **Scoop (Windows)** — Maintain a scoop bucket for Lucent. Developer-oriented Windows users prefer scoop over winget | Complements the winget/chocolatey coverage |
| R27 | **NixOS / Nixpkgs** — Package in nixpkgs for NixOS users. Nix makes building Tauri apps straightforward | Nix users are an influential technical audience |
