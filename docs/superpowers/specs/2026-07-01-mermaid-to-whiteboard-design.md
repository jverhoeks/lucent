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

1. **Layer 1 — generic geometry.** Walk the SVG: `<rect>`→rect shape,
   `<circle>`/`<ellipse>`→ellipse, `<polygon>`→diamond/closest,
   `<text>`/`<tspan>`→text node, `<line>` + straight (M/L-only) `<path>`→free
   connectors, computed `fill`/`stroke`→`Vector3`.
   **Honest scope:** **flowchart is first-class** (semantic Layer 2).
   **Sequence / gantt** are usable via boxes + text + lines (lifelines,
   messages, bars, axes). **Pie** and any **curved/filled `<path>`** are
   **dropped** — a filled arc wedge has no editable whiteboard primitive, and
   we don't approximate it (curved/relative paths are skipped, not mangled).
   So "every diagram type" means "every type that maps to shapes/lines/text";
   pie is out. Tell the user this rather than implying full coverage.

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

The IR boundary keeps future emitters as new `xFromGraph()` + `encodeX()`
functions sharing the same `extractGraph` — see **Future export targets**.

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
- **Shape enum** (verified from real whiteboard copies): `1=rect, 2=ellipse,
  3=rounded-rect, 4=diamond` (also `5/6=triangle/inverted`, `7/8=parallelogram`,
  unused by mermaid mapping). Extractor detects rect→`rect` (or `rounded` when
  the rect has `rx>0`), circle/ellipse→`ellipse`, polygon→`diamond`.
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

## Future export targets (planned; not in v1)

The `DiagramGraph` IR → emitter seam makes each new target additive: shared
`extractGraph`, a new `xFromGraph()` + `encodeX()` pair, and a new toolbar entry
(Copy → Whiteboard / draw.io / Excalidraw / tldraw / …). Feasibility is gated by
how open each target's **clipboard** format is.

- **draw.io (diagrams.net) — high.** Clipboard is **mxGraph XML**
  (`<mxGraphModel><root><mxCell…/></root></mxGraphModel>`), open + documented.
  Node → `mxCell vertex` with a **style string** (`rounded=1;ellipse;rhombus;
  triangle;parallelogram;fillColor=#…;strokeColor=#…`) + `mxGeometry`; edge →
  `mxCell edge` with `source`/`target` + `endArrow`/`edgeStyle`. Uses **top-left
  x,y** (not center) and hex colors; edge waypoints via `<Array as="points">`.
- **Excalidraw — high.** Clipboard JSON `{type:"excalidraw/clipboard",
  elements:[…]}`. Elements: `rectangle`/`ellipse`/`diamond` + `arrow`/`line`;
  arrows bind to shapes via `startBinding`/`endBinding` + shapes' `boundElements`
  (maps cleanly to our anchored connectors, reusing our minted ids). Text is a
  bound `text` element. No triangle/parallelogram primitive → degrade. Extra
  props: `roughness`/`seed`/`fillStyle` (hand-drawn look), hex colors.
- **tldraw — high.** Clipboard JSON (`application/tldraw` records). `geo` shapes
  (`rectangle`/`ellipse`/`diamond`/`triangle`) with `props.color`/`props.dash`;
  `arrow` shapes with start/end **bindings**; groups via `parentId`. Colors are a
  **fixed named palette** (not hex) → need a nearest-color mapper.
- **Lucid (Lucidchart) — lower.** Clipboard is proprietary → reverse-engineer
  from a real copy (same capture dance as Atlassian). Alternatively target the
  documented **Lucid Standard Import** JSON as a *file* export, not clipboard.

**IR growth these targets motivate** (do just-in-time per target, TDD'd):
- **Edge labels** — extract mermaid `.edgeLabels`; add `IREdge.label` (all four
  targets render them). Currently unextracted.
- **Edge waypoints/routing** — `IREdge.points?` (draw.io points, tldraw/Atlassian
  segments) for non-straight edges.
- **Groups / subgraphs** — mermaid `g.cluster` → `IRGroup` (draw.io group,
  Excalidraw frame, tldraw group).
- **Richer node shapes** — hexagon/stadium/cylinder/parallelogram/trapezoid
  (mermaid v11 has these); map per target, degrade where unsupported.
- **Color mapping** — hex (draw.io/Excalidraw) vs enum/named-palette
  (Atlassian/tldraw) → a shared nearest-color helper.

## Scope / YAGNI

- **In (this PR):** flowchart full semantic (Layer 2); sequence/gantt via Layer 1
  geometry incl. lines; verified shape enum; copy-only. **Three targets:**
  Atlassian Whiteboard (`export`… in `mermaid-whiteboard.ts`), **draw.io**
  (`export-drawio.ts`, mxGraph XML via plain text) and **Excalidraw**
  (`export-excalidraw.ts`, `excalidraw/clipboard` JSON via plain text). Toolbar
  copy group: SVG / PNG / WB / DIO / EX.
- **Out (deferred):** tldraw / Lucid emitters (seam + plan ready); whiteboard→
  markdown import; pie & curved/filled paths; edge labels / waypoints / groups.
