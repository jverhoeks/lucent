# Lucent Help

Lucent is a fast, native viewer for **Markdown**, **structured data** (JSON / YAML / TOML / INI), and **logs**. Open a file, read it rendered, edit when you need to, and export or copy content back out.

> **Tip:** Click any **example** link below to open that sample file in a new tab. Examples ship with Lucent (desktop) or are served with the web build.

---

## Quick start

1. **Open** a file — toolbar folder icon, drag-and-drop anywhere, or double-click a `.md` file (desktop).
2. **Read** in rendered mode; use **Raw** to see source.
3. **Edit** Markdown or structured data in split-screen mode; save with `Cmd/Ctrl+S`.
4. **Export** via **Download as…** or copy as Markdown / rich text.

When no documents are open, the welcome screen offers **Open**, **Paste into new document**, **Recent files**, and this **Help** guide.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+O` | Open file(s) (via toolbar) |
| `Cmd/Ctrl+P` | Quick switcher — open tabs and recent files |
| `Cmd/Ctrl+F` | Find in document |
| `Cmd/Ctrl+W` | Close active tab |
| `Cmd/Ctrl+S` | Save (while editing) |
| `Cmd/Ctrl+Shift+S` | Save As |
| `Cmd/Ctrl+Shift+V` | Paste clipboard into a new document |
| `F1` or `Cmd/Ctrl+?` | Open this Help guide |

---

## Toolbar

| Control | Purpose |
| --- | --- |
| **Open** | Pick one or more files |
| **Paste** | New scratch document from clipboard (format guessed) |
| **Next** | Next viewable file in the same folder (desktop) |
| **Edit / Done** | Split-screen editor with live preview (Markdown & data) |
| **Save** | Visible while editing |
| **Save As** | Save to a new path |
| **Rendered / Raw** | Toggle rendered view vs plain source |
| **Tail** | Follow new log lines (log tabs, desktop) |
| **Outline** | Pin the heading outline (useful on narrow windows) |
| **Find** | In-document search (case + regex) |
| **Diagnostics** | Recent errors and blocked actions |
| **View as…** | Reinterpret file as Markdown, text, or a data tree |
| **Download as…** | Export HTML, PDF, Markdown, or convert data formats |
| **Appearance** | Font, size, and **reading theme** (light / sepia / dark) |
| **Copy** | Copy as Markdown or rich text (formatted HTML) |
| **Help** | This document |

On narrow windows, **Next**, **Tail**, and **Diagnostics** move into the **More (⋯)** menu.

---

## Markdown examples

Open any link to see Lucent render it:

| # | Topic | Open |
| --- | --- | --- |
| 1 | Headings, lists, tables, quotes | [Basics](example:01-basics.md) |
| 2 | Links and anchors | [Links](example:02-links.md) |
| 3 | Task lists | [Task lists](example:03-task-lists.md) |
| 4 | KaTeX math | [Math](example:04-math.md) |
| 5 | Mermaid diagrams | [Mermaid](example:05-mermaid.md) |
| 6 | Footnotes | [Footnotes](example:06-footnotes.md) |
| 7 | Emoji | [Emoji](example:07-emoji.md) |
| 8 | Definition lists | [Definition lists](example:08-definition-lists.md) |
| 9 | Note / warning / tip callouts | [Callouts](example:09-callouts.md) |
| 10 | Syntax highlighting | [Code highlighting](example:10-code-highlighting.md) |
| 11 | Everything at once | [Kitchen sink](example:99-kitchen-sink.md) |

### Mermaid export

Hover a rendered diagram for **Copy** (SVG, PNG, source, Whiteboard, draw.io, Lucid, Excalidraw) and **Download** actions. See the [Mermaid example](example:05-mermaid.md) and try the hover toolbar.

### Code blocks

Hover a fenced block for **copy**, **save**, and **line numbers** (click a line number to highlight).

---

## Structured data examples

These files render as a collapsible tree. Use **View as…** to switch between JSON, YAML, TOML, and INI.

| Format | Open |
| --- | --- |
| JSON | [data-sample.json](example:data-sample.json) |
| YAML | [data-sample.yaml](example:data-sample.yaml) |
| TOML | [data-sample.toml](example:data-sample.toml) |
| INI | [data-sample.ini](example:data-sample.ini) |

**Edit** a data file to change the tree live. Comments in YAML, TOML, INI, and JSON-style `//` / `/* */` are preserved when converting between formats.

---

## Log examples

| File | Notes |
| --- | --- |
| [sample.log](example:sample.log) | General application log |
| [access.log](example:access.log) | HTTP-style access lines |
| [syslog.log](example:syslog.log) | Syslog format |
| [structured.log](example:structured.log) | Embedded JSON per line |

Use **Tail** (desktop) to follow a growing file. **Find** searches the visible log; large windowed logs use an indexed backend search.

---

## Editing & saving

- **Markdown** and **data** files support split-screen edit with sync-scrolling preview.
- **Save** writes to disk; scratch tabs prompt for a path on first save.
- If a file changes on disk while you edit, a conflict bar offers **Show changes**, **Keep my version**, or **Use file on disk**.

---

## Paste into new document

`Cmd/Ctrl+Shift+V` (or toolbar **Paste**) creates a scratch tab. Lucent guesses the format:

- Markdown headings and lists before YAML
- Vitest / test output → plain text
- Log-like timestamps → log view
- Mermaid requires a real diagram header (`graph TD`, `sequenceDiagram`, etc.)

---

## Export & copy

| Action | Result |
| --- | --- |
| **Copy as Markdown** | Raw source on the clipboard |
| **Copy as rich text** | Rendered HTML — paste into Docs, Word, Confluence |
| **Download as → HTML** | Self-contained `.html` with your reading theme |
| **Download as → PDF** | Fixed A4 PDF (desktop; light code theme in PDF) |
| **Download as → JSON/YAML/TOML/INI** | Convert structured data; comments preserved where supported |

---

## Privacy & updates

- No analytics or telemetry.
- Markdown HTML passthrough is disabled; links are scheme-allowlisted.
- Desktop builds check GitHub for **signed** updates only when you accept.

---

## Troubleshooting

Open **Diagnostics** (toolbar or **More** menu) for recent errors — failed opens, blocked links, save failures.

| Issue | Try |
| --- | --- |
| Example link does nothing | Desktop: reinstall or run from a copy that includes `examples/`. Web: reload after build. |
| PDF export empty in edit mode | Switch to **Rendered** before exporting. |
| Huge log won't load fully | Lucent opens it in **windowed** mode automatically. |

---

## More documentation

- [Copy & export reference](https://github.com/jverhoeks/lucent/blob/main/docs/copy-and-export.md) (GitHub)
- [Examples folder README](https://github.com/jverhoeks/lucent/blob/main/examples/README.md) (GitHub)
- [Project README](https://github.com/jverhoeks/lucent/blob/main/README.md) (GitHub)

**Lucent** v0.4 — Apache-2.0 · Jacob Verhoeks