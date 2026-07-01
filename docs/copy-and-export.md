# Copy & export

Lucent is a viewer first, but it makes it easy to get content back *out* — as a
file, onto the clipboard, or into another tool as editable objects. This page
covers every path.

There are four surfaces:

1. [The document toolbar](#document-toolbar) — the whole document.
2. [Code blocks](#code-blocks) — a single fenced block.
3. [Mermaid diagrams](#mermaid-diagrams) — a single diagram, as an image **or as
   editable shapes** in another tool.
4. [The web build's Download menu](#web-download--format-conversion) — export with
   format conversion.

---

## Document toolbar

The toolbar's right-hand group acts on the whole rendered document:

| Action | What you get |
| --- | --- |
| **Copy as Markdown** | The document's raw Markdown source, on the clipboard as plain text. |
| **Copy as rich text** | The rendered HTML, on the clipboard as `text/html` — paste into Google Docs, Confluence, Word, or email and formatting (headings, lists, tables, code) is preserved. |
| **Export HTML** | A single, fully self-contained `.html` file (styles inlined) — open it anywhere, no assets needed. |
| **Export PDF** | A native PDF with a fixed A4 page. |

> On the **web build**, Export HTML / PDF are replaced by the
> [Download menu](#web-download--format-conversion).

---

## Code blocks

Hover a fenced code block for its header controls:

- **Copy** — the block's source text to the clipboard.
- **Save** — write the block to a file (the suggested name follows the block's
  language / filename header).
- **Line numbers** — toggle on, then click a line number to highlight that row.

---

## Mermaid diagrams

Hover a rendered [Mermaid](https://mermaid.js.org/) diagram and two button
groups appear:

- **Copy** — SVG · PNG · **WB** (Whiteboard) · **DIO** (draw.io) · **EX** (Excalidraw)
- **Download** — SVG · PNG

SVG and PNG are flat images. The **WB / DIO / EX** targets are the interesting
part: instead of an image, Lucent reconstructs the diagram as **native, editable
shapes, text, and connectors** in the destination tool — so you can keep editing
it there.

| Target | Format | Paste into | Notes |
| --- | --- | --- | --- |
| **SVG** (copy) | SVG markup as plain text | an editor, or save as `.svg` | WebKit can't put `image/svg+xml` on the clipboard, so it's copied as text. |
| **PNG** (copy) | raster image | any image field | — |
| **SVG / PNG** (download) | file | — | Saves the diagram to disk. |
| **WB** — Atlassian Whiteboard | native whiteboard clipboard (`text/html`) | an [Atlassian Whiteboard](https://www.atlassian.com/software/confluence/whiteboards) | Nodes, labels, and connectors come in as real, editable objects. |
| **DIO** — draw.io | mxGraph XML | a [draw.io / diagrams.net](https://www.drawio.com/) canvas | Open-format XML that draw.io recognizes on paste. |
| **EX** — Excalidraw | Excalidraw clipboard JSON | an [Excalidraw](https://excalidraw.com/) canvas | Triangles and parallelograms degrade to rectangles (Excalidraw has no such primitive). |

Shape kind, fill color, edge labels, and arrow directions are carried across
where the target supports them. A diagram that fails to parse keeps its source
text and gets no toolbar.

**How to use:** hover the diagram → click **WB** / **DIO** / **EX** → switch to
the destination tool → paste (`Cmd/Ctrl+V`). A ✓ on the button confirms the copy;
✗ means it failed.

---

## Web download & format conversion

The browser build has no native file dialogs, so it exposes a **Download as…**
menu instead. Pick a target format and Lucent converts on the way out:

- **Markdown (.md)**, **HTML (.html)**, **PDF (.pdf)** — the rendered document.
- **JSON / YAML / TOML / INI** — for structured-data files, convert *between*
  formats (e.g. open a YAML config, download it as JSON).

HTML and PDF reuse the same self-contained export as the desktop app; PDF opens
a print-ready page in a new tab.

---

## View as

Not an export, but related: the **View as…** menu reinterprets the *current*
file as Markdown, plain text, or a JSON / YAML / TOML / INI tree — regardless of
its extension. Handy for a `.txt` that's really JSON, or to see a config file's
structure before downloading it in another format.
