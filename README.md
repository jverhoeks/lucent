# Lucent

**A clear, fast, native viewer for Markdown, structured data, and logs.**

Lucent opens a file and renders it into a clean, readable document — rich
Markdown, syntax-highlighted code, diagrams, math, JSON/YAML/TOML/INI trees,
and logs — then gets out of your way. It's a desktop app (built with
[Tauri](https://tauri.app/), so it ships as a small native binary, not a
browser tab) that's fast to launch and pleasant to read in, with an opt-in
split-screen editor for when you want to write too.

![Lucent rendering a Markdown document — a styled callout, a Mermaid diagram with its copy/export toolbar, syntax-highlighted code, KaTeX math, and a table](docs/screenshot.png)

> **Status:** v0.3 — a multi-format viewer with editing. Markdown, structured
> data (JSON / YAML / TOML / INI), and logs all render the way they deserve.
> Runs as a native desktop app and as a zero-install web build.

---

## Features

- **Rich Markdown rendering** — GitHub-flavored Markdown with tables, task lists,
  footnotes, definition lists, emoji, and admonition blocks (note / warning / tip).
- **Code blocks done right** — syntax highlighting (highlight.js), a filename/
  language header, one-click **copy** and **save-to-file**, and toggleable,
  click-to-highlight **line numbers** that always stay aligned.
- **Diagrams & math** — [Mermaid](https://mermaid.js.org/) diagrams and
  [KaTeX](https://katex.org/) math render inline, and follow the theme.
- **Mermaid diagrams you can take with you** — hover any diagram for a toolbar:
  **copy** or **download** as SVG / PNG, or **copy as editable shapes** straight
  into [Atlassian Whiteboard](https://www.atlassian.com/software/confluence/whiteboards),
  [draw.io](https://www.drawio.com/), or [Excalidraw](https://excalidraw.com/) —
  native shapes, text, and connectors, not a flat image. See
  [Copy & export](docs/copy-and-export.md).
- **Structured data as a tree** — JSON, YAML, TOML, and INI render as a
  navigable, collapsible tree instead of raw text.
- **Logs, made readable** — level highlighting, tail / follow for live files,
  in-view search, and inline decoding of embedded (even base64-encoded) JSON.
- **Edit mode** — opt-in split-screen editor ([CodeMirror](https://codemirror.net/))
  with live preview and `Cmd/Ctrl+S` to save. Lucent reads *and* writes when you
  want it to, without becoming an editor-first app.
- **View as** — reinterpret any file on the fly: Markdown, plain text, or a
  JSON / YAML / TOML / INI tree, regardless of extension.
- **Tabs & multi-open** — open many files at once, page through a folder with
  **Next**, or launch from the shell: `lucent *.md`.
- **Live reload** — edits on disk refresh the view automatically (scroll preserved).
- **Raw ⇄ rendered** toggle, drag-and-drop, and a plain-text mode for any file.
- **Adjustable & persistent** — font family, size, and **light / sepia / dark**
  theme (code and diagrams follow the theme), plus **find** (`Cmd/Ctrl+F`) with
  case and regex — all remembered between launches.
- **Export & copy** — one-click **PDF** (native, fixed A4 page) and
  **standalone HTML** (fully self-contained), plus copy the document as Markdown
  or as rich text (paste into Docs / Confluence / Word with formatting intact).
- **Runs in the browser too** — a web build with a **Download as…** menu that
  converts between Markdown, HTML, PDF, JSON, YAML, TOML, and INI on the way out.
- **Opens `.md` for you** — registers as a `.md` file handler on the OS, so
  double-clicking a Markdown file opens it in Lucent.
- **Private by design** — `markdown-it` runs with raw-HTML passthrough disabled,
  links are scheme-allowlisted, and all filesystem access goes through a small
  audited Rust layer.

See the [`examples/`](examples/) folder for a tour of everything Lucent renders,
and [Copy & export](docs/copy-and-export.md) for every way to get content back
out. Sample outputs from the kitchen-sink example:
[HTML export](docs/99-kitchen-sink.html) · [PDF export](docs/99-kitchen-sink.pdf).

## Roadmap

- **HTML** rendered safely.

## Install / Run

On macOS, install via Homebrew:

```bash
brew tap jverhoeks/tap
brew install --cask lucent
```

Or build from source. Requires [Node.js](https://nodejs.org/) and the
[Rust toolchain](https://www.rust-lang.org/tools/install) (for Tauri).

```bash
npm install
npm run tauri dev      # run the desktop app in development
npm run tauri build    # produce a native app bundle (.app / .dmg on macOS)
npm run dev            # web build in the browser (Vite dev server)
npm run build:web      # static web bundle
```

### Tests

```bash
npm test                       # frontend (Vitest)
cd src-tauri && cargo test     # backend (Rust)
```

## Tech

Tauri 2 (Rust backend + system webview) · TypeScript + Vite frontend ·
markdown-it · highlight.js · Mermaid · KaTeX · CodeMirror ·
js-yaml / smol-toml / ini for structured data.

## License

[Apache-2.0](LICENSE) © Jacob Verhoeks
