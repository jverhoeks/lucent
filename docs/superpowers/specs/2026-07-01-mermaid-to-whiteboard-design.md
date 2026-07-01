# Mermaid → Whiteboard (Atlassian) — Design

**Date:** 2026-07-01
**Branch:** `feat/mermaid-to-whiteboard`
**Status:** approved (brainstorm) → planning

## Goal

Add a **"Copy → Whiteboard"** action to the existing mermaid diagram toolbar in
Lucent. It puts an Atlassian Whiteboard clipboard payload on the clipboard so a
paste into a Confluence/Jira Whiteboard yields **native, editable elements**
(shapes, text, connectors) — not a flat SVG/PNG image.

Value over today's SVG/PNG copy: SVG/PNG paste as one locked image; this pastes
as N independent objects you can drag, resize, recolor, retype, and — for
flowcharts — connectors that stay attached and reroute when you move a node.

## Target format (reverse-engineered)

Atlassian Whiteboard clipboard = HTML clipboard of the shape:

```html
<meta charset='utf-8'><div id="canvas-clipboard" data-canvas-clipboard="BASE64"></div>
```

`BASE64` decodes to a JSON array of elements. Element kinds we emit:

- **`shape`** — `position` (center-origin `Vector2`), `size`, `color`/`strokeColor`
  (`Vector3` RGB 0–255), `strokeStyle`, `shape` (enum; `1` = rect/square),
  `text` (a stringified ProseMirror doc), `alignment`, `basisSize`,
  `basisPosition`, `rotation`. Needs a stable element id (nanoid).
- **`text`** — free text node; `text` = stringified ProseMirror doc.
- **`connector`** — `start`/`end` points, `sourceElement`/`targetElement`
  (element ids), `sourceAnchor`/`targetAnchor` (`{left,top}` normalized on the
  shape box), `startCap`/`endCap` (arrowheads), `color`, `stroke`, `strokeStyle`,
  optional `segments` (line/arc routing).

ProseMirror text doc, empty vs with content:

```json
{"version":1,"type":"doc","content":[{"type":"paragraph","content":[]}]}
{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]}
```

Coordinates are **center-origin**, y-down. We re-center the diagram's bounding
box to the origin on emit.

## Approach: A+ (parse rendered SVG → IR → payload)

We reuse the SVG mermaid already renders (mermaid **11.15.0**,
`htmlLabels: false` so labels are pure `<text>`). We do **not** re-run layout.

Two layers:

1. **Layer 1 — generic geometry (ALL diagram types).** Walk the SVG:
   `<rect>`→rect shape, `<circle>`/`<ellipse>`→ellipse, `<polygon>`→diamond/
   closest, `<text>`/`<tspan>`→text node, `<path>`/`<line>`→connector line,
   computed `fill`/`stroke`→`Vector3`. Everything becomes editable, positioned
   as mermaid drew it. Non-graph diagrams (sequence/gantt/pie) land here as
   editable primitives ("looks-like", individually editable but not semantic).

2. **Layer 2 — semantic reconstruction (graph types: flowchart, and later
   state/ER/class).** Mermaid stamps structure into the SVG we read back:
   - nodes: `g.node` with id `flowchart-<id>-<n>` and/or `data-id`
   - edges: `path` id `L_<src>_<tgt>_<n>` (encodes endpoints) + marker refs +
     `stroke-dasharray`
   - groups: `g.cluster`
   We emit true **anchored connectors** (`sourceElement`/`targetElement` → minted
   shape ids) so they reroute on drag, plus subgraph frames.

Why not Approach B (parse source + own layout): only covers graph types (fails
"everything"), reimplements layout, couples to mermaid's per-type parser. A+
recovers the same semantics for graph types straight from the SVG.

## Architecture / units

New file **`src/mermaid-whiteboard.ts`**, split for testability:

- `type DiagramGraph` — the IR: `{ nodes: Node[], edges: Edge[], groups: Group[],
  loose: LoosePrimitive[] }`. Pure data, no DOM types.
- `extractGraph(svg: SVGSVGElement): DiagramGraph` — **DOM-dependent**. Reads
  geometry via `getBBox()`/CTM and the mermaid id conventions above. Detects
  diagram type from the root svg class (`flowchart`, `sequence`, …) to choose
  Layer 2 vs Layer 1-only. Hard to unit test (needs real SVG layout) → covered
  by a rendered fixture + the paste round-trip.
- `whiteboardFromGraph(graph: DiagramGraph): WhiteboardElement[]` — **pure**.
  Mints ids, re-centers coords, builds ProseMirror text, maps colors→`Vector3`,
  shape kinds→enum, arrowheads→caps, anchors connectors to minted ids. Fully
  unit-testable in node (no DOM). **This is where TDD focuses.**
- `encodeWhiteboardClipboard(els: WhiteboardElement[]): string` — JSON →
  base64 → wrap in the `<meta><div data-canvas-clipboard>` HTML. Pure, testable.
- `svgToWhiteboardHtml(svg): string` — composition of the three above.

The IR boundary keeps future emitters (Excalidraw/tldraw) as new
`xFromGraph()` functions — out of scope for v1, but the seam is free.

Clipboard: reuse the existing `text/html` path. Add
`copyMermaidWhiteboard(svg)` to `src/mermaid-export.ts` (sits with the other
mermaid copy fns) that builds the html and writes it via a ClipboardItem
(`text/html` + a `text/plain` fallback = joined node labels).

## UI wiring

- `render.ts::mermaidActionGroup` — extend the button `kind` union to include
  `"wb"` and append a **WB button to the copy group only** (whiteboard is
  paste-only; no download group entry). Reuse existing `.mermaid-btn` styling;
  add a minimal style if the third button needs it.
- `main.ts` `.mermaid-btn` handler (lines ~532–558) — add branch:
  `kind === "wb"` (copy act) → `await copyMermaidWhiteboard(svg)`; keep the
  ✓/✗ label-flash feedback.

## Coordinate & mapping rules

- **Center-origin:** compute the union bbox of all emitted elements; translate so
  its center is `(0,0)`.
- **Shape size/position:** node center = its `g.node` translate; size = inner
  shape bbox. `basisPosition`/`basisSize` = same as position/size at scale 1.
- **Colors:** resolve computed `fill`/`stroke` (handles theme). Parse to RGB
  `Vector3`. `none`/transparent fill → `fillEnabled:false`.
- **Anchors:** infer from relative node centers (source-right→target-left, etc.)
  as `{left,top}` in {0,0.5,1}; fall back to `{left:0.5,top:0.5}`.
- **Caps:** default flowchart arrow → `endCap:2` (arrowhead), `startCap:1`
  (none); read marker refs to refine. `stroke-dasharray` present →
  `strokeStyle` = dashed variant.

## Error handling

- No `<svg>` in the block → button absent (decorate already guards on this).
- Extractor throws / unknown diagram type → fall back to **Layer 1 geometry**;
  never throw to the click handler (it shows ✗ on any throw).
- Empty graph → copy nothing, show ✗.

## Testing

- **Unit (TDD, node, no DOM):** `whiteboardFromGraph` and
  `encodeWhiteboardClipboard` against hand-built `DiagramGraph` fixtures:
  center-origin math, id minting + connector↔shape id matching, ProseMirror
  doc for empty/nonempty labels, color/shape/cap mapping, base64 round-trip
  (decode === input), the `<div data-canvas-clipboard>` wrapper shape.
- **Fixture:** a committed real mermaid-rendered flowchart SVG string; assert
  `extractGraph` yields the right node/edge counts and endpoint ids. (Layout
  numbers asserted loosely.)
- **Acceptance (manual, load-bearing):** generate a payload, paste into a real
  Atlassian Whiteboard; confirm drag, edit-text, and connector reroute work.
  This is the criterion that proves "usable," since our synthesized ids/coords
  must be accepted exactly as the whiteboard's own copies are.

## Scope / YAGNI

- **In:** flowchart full semantic (Layer 2); all other types via Layer 1
  geometry; Atlassian target only; copy-only (no download).
- **Out (v1):** other targets (Excalidraw/tldraw) — IR seam left open;
  whiteboard→markdown import; hand-tuned semantic mapping for
  sequence/gantt/pie (they degrade to editable geometry by design).
