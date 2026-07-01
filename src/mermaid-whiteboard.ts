/** Convert a mermaid-rendered diagram into an Atlassian Whiteboard clipboard
 *  payload, so a paste yields native, editable shapes/text/connectors instead
 *  of a flat SVG/PNG image.
 *
 *  Split for testability:
 *   - `whiteboardFromGraph` / `encodeWhiteboardClipboard` are PURE (no DOM) and
 *     carry the id-minting, coordinate re-centering, ProseMirror text, and
 *     color/shape/cap mapping. Unit-tested in node.
 *   - `extractGraph` (DOM-dependent, reads the live <svg>) lives below and is
 *     covered by a rendered fixture + the paste round-trip.
 *
 *  Format notes (reverse-engineered from a real whiteboard copy):
 *   - Payload is `text/html`: `<meta …><div data-canvas-clipboard="BASE64">`,
 *     BASE64 = a JSON array of elements.
 *   - Coordinates are center-origin, y-down; `position` is the element CENTER.
 *   - Pasted shapes carry no id; connectors relink to shapes by array index
 *     (`sourceIndex`/`targetIndex`), with `sourceElement`/`targetElement`
 *     nanoids alongside for parity. So nodes MUST be emitted before connectors.
 */

export type RGB = { r: number; g: number; b: number };

/** A node/box in mermaid's own SVG coordinate space (`x`,`y` = center). */
export type IRNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  fill?: RGB | null;
  stroke?: RGB | null;
  /** id of the innermost group (subgraph) that contains this node, if any. */
  groupId?: string;
  shapeKind?:
    | "rect"
    | "rounded"
    | "ellipse"
    | "diamond"
    | "triangle"
    | "triangleDown"
    | "parallelogram"
    | "parallelogramAlt";
};

/** A subgraph / cluster container. `x,y` is the CENTER (graph coords), same
 *  convention as IRNode, so every emitter reuses the node top-left conversion.
 *  `parentId` is the innermost enclosing group (nesting), if any. */
export type IRGroup = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: RGB | null;
  parentId?: string;
};

export type IREdge = {
  sourceId: string;
  targetId: string;
  label?: string;
  labelPos?: [number, number];
  dashed?: boolean;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  stroke?: RGB | null;
};

/** Loose text not attached to a node (Layer-1 geometry fallback). */
export type IRText = {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color?: RGB | null;
};

/** A free line/polyline not anchored to nodes (sequence lifelines/messages,
 *  gantt axes, etc.). Points are in the SVG's coordinate space. */
export type IRLine = {
  points: Array<[number, number]>;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  dashed?: boolean;
  stroke?: RGB | null;
};

export type DiagramGraph = {
  nodes: IRNode[];
  edges: IREdge[];
  groups?: IRGroup[];
  texts?: IRText[];
  lines?: IRLine[];
};

export type WhiteboardElement = Record<string, unknown>;

type Anchor = { left: number; top: number };

const DEFAULT_STROKE: RGB = { r: 51, g: 51, b: 51 };
const DEFAULT_FILL: RGB = { r: 255, g: 255, b: 255 };
const DEFAULT_CONNECTOR: RGB = { r: 117, g: 129, b: 149 };
const PATH_LABEL_COLOR: RGB = { r: 23, g: 43, b: 77 }; // Atlaskit default text (readable on canvas)
// A pasted section's fill comes from a CONSTRAINED palette — any off-palette RGB
// falls back to a dark default (black on a dark board). We can't map an arbitrary
// cluster fill onto that palette, so every section uses white: an observed palette
// entry (from a real section copy) that renders light everywhere. The cluster's
// own fill is intentionally ignored (sections are readable regions, not faithful
// color reproductions). Contrast with shapes, which accept any RGB.
const SECTION_FILL: RGB = { r: 255, g: 255, b: 255 };

function sectionColor(_fill?: RGB | null): RGB {
  return SECTION_FILL;
}

/** Mermaid node shape → whiteboard `shape` enum, verified from real whiteboard
 *  copies (1=rect, 2=ellipse, 3=rounded-rect, 4=diamond; 5/6=triangles,
 *  7/8=parallelograms exist but mermaid nodes don't map to them here). */
const SHAPE_ENUM: Record<NonNullable<IRNode["shapeKind"]>, number> = {
  rect: 1,
  ellipse: 2,
  rounded: 3,
  diamond: 4,
  triangle: 5,
  triangleDown: 6,
  parallelogram: 7,
  parallelogramAlt: 8,
};

const vec2 = (x: number, y: number) => ({ x, y, type: "Vector2" as const });
const vec3 = (c: RGB) => ({ x: c.r, y: c.g, z: c.b, type: "Vector3" as const });

/** Perceived luminance (0–255). */
function luminance(c: RGB): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

export function isDarkFill(c: RGB): boolean {
  return luminance(c) < 140;
}

/** A readable label color for a given fill — white on dark, near-black on light.
 *  Prevents black-on-black when a dark-theme diagram is pasted. */
export function contrastText(fill: RGB): RGB {
  return isDarkFill(fill) ? { r: 255, g: 255, b: 255 } : { r: 33, g: 33, b: 33 };
}

/** Stringified ProseMirror doc for a shape/text label. When `color` is given,
 *  the text carries an Atlaskit `textColor` mark (lenient — stripped if the
 *  target doesn't support it, never rejects the paste). */
function proseDoc(text: string, color?: string): string {
  const marks = color ? [{ type: "textColor", attrs: { color } }] : undefined;
  const textNode: Record<string, unknown> = { type: "text", text };
  if (marks) textNode.marks = marks;
  const content = text ? [textNode] : ([] as Array<Record<string, unknown>>);
  return JSON.stringify({
    version: 1,
    type: "doc",
    content: [{ type: "paragraph", content }],
  });
}

/** Default nanoid-ish id generator (21 url-safe chars). */
function defaultIdGen(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const g = globalThis as { crypto?: Crypto };
  const rnd = new Uint8Array(21);
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(rnd);
  else for (let i = 0; i < rnd.length; i++) rnd[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (const b of rnd) out += alphabet[b & 63];
  return out;
}

/** Union bounding box of all boxes, returning the center. */
function bboxCenter(boxes: Array<{ x: number; y: number; w: number; h: number }>): {
  cx: number;
  cy: number;
} {
  if (boxes.length === 0) return { cx: 0, cy: 0 };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x - b.w / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    minY = Math.min(minY, b.y - b.h / 2);
    maxY = Math.max(maxY, b.y + b.h / 2);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Anchor sides for an edge, chosen by the dominant axis between centers. */
function anchorsFor(dx: number, dy: number): { source: Anchor; target: Anchor } {
  if (Math.abs(dx) >= Math.abs(dy)) {
    const right = dx >= 0;
    return {
      source: { left: right ? 1 : 0, top: 0.5 },
      target: { left: right ? 0 : 1, top: 0.5 },
    };
  }
  const down = dy >= 0;
  return {
    source: { left: 0.5, top: down ? 1 : 0 },
    target: { left: 0.5, top: down ? 0 : 1 },
  };
}

/** Point on a box's edge for a normalized anchor, in centered coords. */
function anchorPoint(
  n: IRNode,
  a: Anchor,
  cx: number,
  cy: number,
): [number, number] {
  return [n.x - cx + (a.left - 0.5) * n.w, n.y - cy + (a.top - 0.5) * n.h];
}

/** Pure: IR graph → whiteboard element array (nodes first, then texts, then
 *  connectors, so connector indices are stable). */
export function whiteboardFromGraph(
  g: DiagramGraph,
  idGen: () => string = defaultIdGen,
): WhiteboardElement[] {
  const texts = g.texts ?? [];
  const lines = g.lines ?? [];
  const linePointBoxes = lines.flatMap((l) =>
    l.points.map(([x, y]) => ({ x, y, w: 0, h: 0 })),
  );
  const { cx, cy } = bboxCenter([...g.nodes, ...texts, ...linePointBoxes]);

  const nodeIds = new Map<string, string>();
  const nodeIndex = new Map<string, number>();
  const els: WhiteboardElement[] = [];

  // Subgraphs become `section` regions. Sections are containers by spatial
  // containment (no child ids), so they just need to sit behind the shapes.
  // Emit largest-area first → nested sections and shapes paint on top. These
  // precede the shapes, so the node/connector index bookkeeping below (which
  // reads the live els.length) stays correct.
  for (const grp of [...(g.groups ?? [])].sort((a, b) => b.w * b.h - a.w * a.h)) {
    els.push({
      type: "section",
      source: 1,
      position: vec2(grp.x - cx, grp.y - cy),
      size: vec2(grp.w, grp.h),
      color: vec3(sectionColor(grp.fill)),
      title: grp.label,
      titleWidth: 140,
      hasDropShadow: false,
      rotation: 0,
    });
  }

  for (const n of g.nodes) {
    const id = idGen();
    nodeIds.set(n.id, id);
    nodeIndex.set(n.id, els.length);
    const pos = vec2(n.x - cx, n.y - cy);
    const size = vec2(n.w, n.h);
    // The whiteboard renders shape label text in a fixed dark color (it ignores
    // our textColor mark). A dark fill would be unreadable behind that text, so
    // we only fill when mermaid gives a light color — dark (or absent) fills are
    // left empty and the light canvas shows through. We never fabricate a fill.
    const fillable = !!n.fill && !isDarkFill(n.fill);
    els.push({
      type: "shape",
      source: 1,
      position: pos,
      size,
      color: vec3(n.fill ?? DEFAULT_FILL),
      strokeColor: vec3(n.stroke ?? DEFAULT_STROKE),
      strokeStyle: 1,
      text: proseDoc(n.label),
      shape: SHAPE_ENUM[n.shapeKind ?? "rect"],
      fillEnabled: fillable,
      fontScale: 1,
      basisSize: size,
      basisPosition: pos,
      alignment: "center",
      verticalAlignment: 1,
      rotation: 0,
    });
  }

  for (const t of texts) {
    const pos = vec2(t.x - cx, t.y - cy);
    const size = vec2(t.w, t.h);
    els.push({
      type: "text",
      source: 1,
      position: pos,
      size,
      text: proseDoc(t.text),
      allowFlexibleWidth: true,
      color: vec3(t.color ?? DEFAULT_STROKE),
      fontScale: 1,
      basisSize: size,
      basisPosition: pos,
      alignment: "left",
      rotation: 0,
    });
  }

  const pathLabels: Array<{ index: number; id: string; label: string }> = [];
  for (const e of g.edges) {
    const s = g.nodes.find((n) => n.id === e.sourceId);
    const t = g.nodes.find((n) => n.id === e.targetId);
    if (!s || !t) continue;
    const { source, target } = anchorsFor(t.x - s.x, t.y - s.y);
    const connIndex = els.length;
    const connId = idGen();
    els.push({
      type: "connector",
      source: 1,
      presentation: 2,
      segments: [],
      start: anchorPoint(s, source, cx, cy),
      end: anchorPoint(t, target, cx, cy),
      position: vec2(0, 0),
      size: vec2(0, 0),
      sourceElement: nodeIds.get(e.sourceId),
      targetElement: nodeIds.get(e.targetId),
      sourceAnchor: source,
      targetAnchor: target,
      startCap: e.arrowStart ? 2 : 1,
      endCap: e.arrowEnd ? 2 : 1,
      color: vec3(e.stroke ?? DEFAULT_CONNECTOR),
      stroke: 1,
      strokeStyle: e.dashed ? 2 : 1,
      sourceIndex: nodeIndex.get(e.sourceId),
      targetIndex: nodeIndex.get(e.targetId),
    });
    if (e.label) pathLabels.push({ index: connIndex, id: connId, label: e.label });
  }

  for (const ln of lines) {
    if (ln.points.length < 2) continue;
    const pts = ln.points.map(([x, y]) => [x - cx, y - cy] as [number, number]);
    els.push({
      type: "connector",
      source: 1,
      presentation: 2,
      segments: [],
      start: pts[0],
      end: pts[pts.length - 1],
      position: vec2(0, 0),
      size: vec2(0, 0),
      startCap: ln.arrowStart ? 2 : 1,
      endCap: ln.arrowEnd ? 2 : 1,
      color: vec3(ln.stroke ?? DEFAULT_CONNECTOR),
      stroke: 1,
      strokeStyle: ln.dashed ? 2 : 1,
    });
  }

  // Edge labels: a `pathLabel` bound to its connector by array index (relinked
  // on paste like sourceIndex), positioned at the path midpoint (proportion 0.5).
  for (const pl of pathLabels) {
    els.push({
      type: "pathLabel",
      source: 1,
      sourcePathId: pl.id,
      proportion: 0.5,
      position: vec2(0, 0),
      size: vec2(0, 0),
      color: vec3(PATH_LABEL_COLOR),
      text: proseDoc(pl.label),
      fontScale: 1,
      pathOffsetPosition: 0,
      sourcePathIndex: pl.index,
    });
  }

  return els;
}

// ---------------------------------------------------------------------------
// DOM extraction (browser / jsdom). Reads a mermaid-rendered <svg> into the IR.
// Flowchart geometry parses from attributes (self-consistent: whiteboardFromGraph
// re-centers by bbox, so any global transform cancels). Colors need
// getComputedStyle on the live element (CSS-class-driven), so they resolve only
// in a real browser; the unit fixture asserts structure, not color.
// ---------------------------------------------------------------------------

// Node group ids across diagram types: flowchart-A-0, state-Written-0,
// classId-Foo-1, entity-Bar-2, er-Baz-3.
const NODE_ID_RE = /(?:flowchart|statediagram|state|classId|class|entity|er)-(.+)-\d+$/;

/** Parse `translate(x, y)` from an element's transform attribute. */
function transformTranslate(el: Element): { x: number; y: number } {
  const m = (el.getAttribute("transform") || "").match(
    /translate\(\s*([-\d.]+)\s*[ ,]\s*([-\d.]+)\s*\)/,
  );
  return { x: m ? parseFloat(m[1]) : 0, y: m ? parseFloat(m[2]) : 0 };
}

/** `rgb()/rgba()` string → RGB, or null. */
function parseRgb(v: string | null | undefined): RGB | null {
  if (!v) return null;
  const m = v.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (!m) return null;
  return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]) };
}

function computedColors(el: Element | null): { fill: RGB | null; stroke: RGB | null } {
  const g = globalThis as { getComputedStyle?: (e: Element) => CSSStyleDeclaration };
  if (!el || typeof g.getComputedStyle !== "function") return { fill: null, stroke: null };
  const cs = g.getComputedStyle(el);
  const fillRaw = cs.fill || (el as Element).getAttribute("fill") || "";
  const strokeRaw = cs.stroke || (el as Element).getAttribute("stroke") || "";
  const noFill = fillRaw === "none" || fillRaw === "transparent" || fillRaw === "";
  return { fill: noFill ? null : parseRgb(fillRaw), stroke: parseRgb(strokeRaw) };
}

/** Endpoints from a mermaid edge id like `L_A_B_0` / `L-A-B-0`, tolerating a
 *  `mermaid-<epoch>-` prefix on the `id` attribute (the `data-id` is clean). */
function parseEdgeId(raw: string): { src: string; tgt: string } | null {
  if (!raw) return null;
  const m = raw.match(/L[_-].*$/); // strip any leading prefix down to the L marker
  const s = m ? m[0] : raw;
  const sep = s.includes("_") ? "_" : "-";
  const parts = s.split(sep);
  if (parts.length < 4 || parts[0] !== "L") return null;
  return { src: parts[1], tgt: parts[2] };
}

/** Absolute (svg-root) box of an element via getBBox + CTM. Browser-only. */
function elementBox(
  el: Element,
): { x: number; y: number; w: number; h: number } | null {
  const g = el as SVGGraphicsElement;
  let b: DOMRect | undefined;
  try {
    b = g.getBBox?.();
  } catch {
    return null;
  }
  if (!b || !b.width) return null;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const m = g.getCTM?.();
  if (!m) return { x: cx, y: cy, w: b.width, h: b.height };
  return {
    x: m.a * cx + m.c * cy + m.e,
    y: m.b * cx + m.d * cy + m.f,
    w: b.width * (m.a || 1),
    h: b.height * (m.d || 1),
  };
}

/** Parse an SVG `points` list into [x,y] pairs, dropping a closing duplicate. */
function parsePolygonPoints(s: string): Array<[number, number]> | null {
  const nums = (s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
  if (nums.length < 6 || nums.length % 2 !== 0) return null;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  const a = pts[0];
  const z = pts[pts.length - 1];
  if (pts.length > 3 && a[0] === z[0] && a[1] === z[1]) pts.pop();
  return pts;
}

/** Classify a polygon by its vertices into a whiteboard-mappable shape kind. */
function classifyPolygon(pts: Array<[number, number]>): NonNullable<IRNode["shapeKind"]> {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const eps = Math.max(w, h) * 0.15;
  const near = (a: number, b: number) => Math.abs(a - b) <= eps;

  if (pts.length === 3) {
    const top = pts.filter((p) => near(p[1], minY)).length;
    const bot = pts.filter((p) => near(p[1], maxY)).length;
    return top <= bot ? "triangle" : "triangleDown"; // apex up vs apex down
  }
  if (pts.length === 4) {
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const isDiamond = pts.every(
      (p) =>
        (near(p[0], cx) && (near(p[1], minY) || near(p[1], maxY))) ||
        (near(p[1], cy) && (near(p[0], minX) || near(p[0], maxX))),
    );
    if (isDiamond) return "diamond";
    const top = pts.filter((p) => near(p[1], minY)).sort((a, b) => a[0] - b[0]);
    const bot = pts.filter((p) => near(p[1], maxY)).sort((a, b) => a[0] - b[0]);
    if (top.length === 2 && bot.length === 2) {
      return top[0][0] > bot[0][0] ? "parallelogram" : "parallelogramAlt";
    }
    return "diamond";
  }
  return "rect"; // hexagon etc. → safe fallback
}

/** Size + kind of a node's inner shape, from attributes first, bbox as fallback. */
function nodeShape(
  el: Element | null,
): { w: number; h: number; kind: IRNode["shapeKind"] } {
  if (el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "rect") {
      const w = parseFloat(el.getAttribute("width") || "0");
      const h = parseFloat(el.getAttribute("height") || "0");
      const rx = parseFloat(el.getAttribute("rx") || "0");
      if (w && h) return { w, h, kind: rx > 0 ? "rounded" : "rect" };
    } else if (tag === "circle") {
      const r = parseFloat(el.getAttribute("r") || "0");
      if (r) return { w: 2 * r, h: 2 * r, kind: "ellipse" };
    } else if (tag === "ellipse") {
      const rx = parseFloat(el.getAttribute("rx") || "0");
      const ry = parseFloat(el.getAttribute("ry") || "0");
      if (rx && ry) return { w: 2 * rx, h: 2 * ry, kind: "ellipse" };
    } else if (tag === "polygon") {
      const pts = parsePolygonPoints(el.getAttribute("points") || "");
      if (pts && pts.length >= 3) {
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        return {
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
          kind: classifyPolygon(pts),
        };
      }
      const box = elementBox(el);
      if (box) return { w: box.w, h: box.h, kind: "diamond" };
    }
    const box = elementBox(el);
    if (box) return { w: box.w, h: box.h, kind: "rect" };
  }
  return { w: 80, h: 40, kind: "rect" };
}

/** First and last coordinate pair of a path's `d` (works through curves). */
function pathEndpoints(
  d: string,
): { start: [number, number]; end: [number, number] } | null {
  const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
  if (nums.length < 4) return null;
  return {
    start: [nums[0], nums[1]],
    end: [nums[nums.length - 2], nums[nums.length - 1]],
  };
}

/** Id of the node whose center is nearest a point (edge-endpoint matching). */
function nearestNodeId(nodes: IRNode[], pt: [number, number]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    const dx = n.x - pt[0];
    const dy = n.y - pt[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

/** Layer 2: any `g.node`-based diagram (flowchart, state, class, ER) → semantic
 *  nodes + edges. Edges link by their `L_src_tgt` id when present (flowchart),
 *  otherwise by matching each path endpoint to the nearest node (state/class,
 *  whose edge ids like `edge0` carry no endpoints). */
/** True when a group's box (center + half-extent) covers the point. */
function groupCovers(g: IRGroup, px: number, py: number): boolean {
  return Math.abs(px - g.x) <= g.w / 2 && Math.abs(py - g.y) <= g.h / 2;
}

/** Resolve nesting: each group's `parentId` becomes the smallest strictly-larger
 *  group that covers its center, and each node's `groupId` becomes the smallest
 *  group covering the node's center. Pure — operates on center-based boxes. */
export function assignContainment(groups: IRGroup[], nodes: IRNode[]): void {
  const innermost = (px: number, py: number, excludeId?: string): IRGroup | undefined => {
    let best: IRGroup | undefined;
    for (const g of groups) {
      if (g.id === excludeId || !groupCovers(g, px, py)) continue;
      if (!best || g.w * g.h < best.w * best.h) best = g;
    }
    return best;
  };
  for (const g of groups) {
    const p = innermost(g.x, g.y, g.id);
    if (p && p.w * p.h > g.w * g.h) g.parentId = p.id;
  }
  for (const n of nodes) {
    const g = innermost(n.x, n.y);
    if (g) n.groupId = g.id;
  }
}

/** Read mermaid subgraph clusters (`g.cluster`) into center-based groups. */
function extractGroups(svg: SVGSVGElement): IRGroup[] {
  const groups: IRGroup[] = [];
  svg.querySelectorAll("g.cluster").forEach((c, i) => {
    const rect = c.querySelector("rect");
    if (!rect) return;
    const x = num(rect, "x"), y = num(rect, "y"), w = num(rect, "width"), h = num(rect, "height");
    if (x == null || y == null || w == null || h == null) return;
    const label = (c.querySelector(".cluster-label") || c.querySelector("text"))?.textContent?.trim() || "";
    groups.push({
      id: c.getAttribute("id") || `sg${i}`,
      label,
      x: x + w / 2,
      y: y + h / 2,
      w,
      h,
      fill: computedColors(rect).fill,
    });
  });
  return groups;
}

function extractNodeGraph(svg: SVGSVGElement): DiagramGraph {
  const nodes: IRNode[] = [];
  const byId = new Set<string>();
  svg.querySelectorAll("g.node").forEach((gEl, i) => {
    const rawId = gEl.getAttribute("id") || "";
    const m = rawId.match(NODE_ID_RE);
    let id = (m ? m[1] : gEl.getAttribute("data-id")) || `n${i}`;
    if (byId.has(id)) id = `${id}#${i}`; // keep ids unique for edge references
    byId.add(id);
    const { x, y } = transformTranslate(gEl);
    const shapeEl =
      gEl.querySelector("rect.label-container") ||
      gEl.querySelector("rect, polygon, circle, ellipse, path");
    const { w, h, kind } = nodeShape(shapeEl);
    const label =
      (gEl.querySelector(".label text") || gEl.querySelector("text"))?.textContent?.trim() ||
      "";
    const { fill, stroke } = computedColors(shapeEl);
    nodes.push({ id, x, y, w, h, label, fill, stroke, shapeKind: kind });
  });

  // Edge labels are emitted index-parallel to the edge paths (an empty
  // placeholder group for unlabeled edges), so the k-th label belongs to the
  // k-th path. Mermaid positions each at the edge midpoint (graph coords).
  const edgeLabels = Array.from(svg.querySelectorAll("g.edgeLabels g.edgeLabel"));
  const edges: IREdge[] = [];
  svg.querySelectorAll("g.edgePaths path").forEach((p, i) => {
    const parsed = parseEdgeId(p.getAttribute("data-id") || p.getAttribute("id") || "");
    let src: string | null = null;
    let tgt: string | null = null;
    if (parsed && byId.has(parsed.src) && byId.has(parsed.tgt)) {
      src = parsed.src;
      tgt = parsed.tgt;
    } else {
      const ep = pathEndpoints(p.getAttribute("d") || "");
      if (ep) {
        src = nearestNodeId(nodes, ep.start);
        tgt = nearestNodeId(nodes, ep.end);
      }
    }
    if (!src || !tgt || src === tgt) return;
    const labelEl = edgeLabels[i];
    const label = labelEl?.textContent?.trim() || undefined;
    const lp = labelEl ? transformTranslate(labelEl) : { x: 0, y: 0 };
    edges.push({
      sourceId: src,
      targetId: tgt,
      arrowEnd: !!p.getAttribute("marker-end"),
      arrowStart: !!p.getAttribute("marker-start"),
      dashed: isDashed(p),
      stroke: computedColors(p).stroke,
      label,
      labelPos: label && !(lp.x === 0 && lp.y === 0) ? [lp.x, lp.y] : undefined,
    });
  });

  const groups = extractGroups(svg);
  if (groups.length) assignContainment(groups, nodes);
  return groups.length ? { nodes, edges, groups } : { nodes, edges };
}

/** Points of a straight (M/L only) SVG path in `d`. Returns null for anything
 *  with curves/arcs or relative commands — we don't approximate those. */
function parsePathPoints(d: string): Array<[number, number]> | null {
  if (!d || /[^MLZ0-9eE.,\s+-]/.test(d)) return null; // reject curves, arcs, relative
  const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
  if (!nums || nums.length < 4 || nums.length % 2 !== 0) return null;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < nums.length; i += 2) pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
  return pts;
}

function num(el: Element, attr: string): number | null {
  const v = el.getAttribute(attr);
  return v == null || v === "" ? null : parseFloat(v);
}

function isDashed(el: Element): boolean {
  return (
    !!el.getAttribute("stroke-dasharray") ||
    (el.getAttribute("style") || "").includes("dasharray") ||
    (el.getAttribute("class") || "").includes("dashed")
  );
}

/** Layer 1: any diagram → editable geometry (shapes, loose text, free lines).
 *  Boxes/text need getBBox (browser-only); lines come from attributes/`d` so
 *  line-based diagrams (sequence, gantt) get usable output. */
function extractGeometry(svg: SVGSVGElement): DiagramGraph {
  const nodes: IRNode[] = [];
  svg.querySelectorAll("rect, circle, ellipse, polygon").forEach((el) => {
    const box = elementBox(el);
    if (!box) return;
    const tag = el.tagName.toLowerCase();
    const kind: IRNode["shapeKind"] =
      tag === "circle" || tag === "ellipse" ? "ellipse" : tag === "polygon" ? "diamond" : "rect";
    const { fill, stroke } = computedColors(el);
    nodes.push({ id: `g${nodes.length}`, ...box, label: "", fill, stroke, shapeKind: kind });
  });
  const texts: IRText[] = [];
  svg.querySelectorAll("text").forEach((t) => {
    const s = t.textContent?.trim();
    const box = elementBox(t);
    if (!s || !box) return;
    texts.push({ ...box, text: s, color: computedColors(t).fill });
  });

  const lines: IRLine[] = [];
  svg.querySelectorAll("line").forEach((el) => {
    const x1 = num(el, "x1"), y1 = num(el, "y1"), x2 = num(el, "x2"), y2 = num(el, "y2");
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    lines.push({
      points: [[x1, y1], [x2, y2]],
      arrowStart: !!el.getAttribute("marker-start"),
      arrowEnd: !!el.getAttribute("marker-end"),
      dashed: isDashed(el),
      stroke: computedColors(el).stroke,
    });
  });
  svg.querySelectorAll("path").forEach((el) => {
    const pts = parsePathPoints(el.getAttribute("d") || "");
    if (!pts) return;
    lines.push({
      points: pts,
      arrowStart: !!el.getAttribute("marker-start"),
      arrowEnd: !!el.getAttribute("marker-end"),
      dashed: isDashed(el),
      stroke: computedColors(el).stroke,
    });
  });

  return { nodes, edges: [], texts, lines };
}

/** Read a mermaid-rendered <svg> into the IR. Any diagram that uses `g.node`
 *  (flowchart, stateDiagram, class, ER) gets semantic reconstruction; the rest
 *  (sequence, gantt, pie) degrade to editable geometry. */
export function extractGraph(svg: SVGSVGElement): DiagramGraph {
  if (svg.querySelector("g.node")) return extractNodeGraph(svg);
  return extractGeometry(svg);
}

/** UTF-8 → base64 (btoa throws on unicode, so go via bytes). */
function bytesToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Pure: element array → the `text/html` clipboard string a whiteboard reads.
 *  `visibleHtml` is appended after the payload div: WebKit's clipboard sanitizer
 *  DROPS the whole text/html flavor if it has no visible content, so an
 *  attribute-only div would never reach the pasteboard as `public.html`. The
 *  real whiteboard copy carries trailing `<p>` content for exactly this reason. */
export function encodeWhiteboardClipboard(
  els: WhiteboardElement[],
  visibleHtml = "",
): string {
  const b64 = bytesToBase64(JSON.stringify(els));
  return `<meta charset='utf-8'><div id="canvas-clipboard" data-canvas-clipboard="${b64}"></div>${visibleHtml}`;
}

/** End-to-end: a rendered mermaid <svg> → whiteboard clipboard HTML. */
export function svgToWhiteboardHtml(svg: SVGSVGElement, idGen?: () => string): string {
  return encodeWhiteboardClipboard(whiteboardFromGraph(extractGraph(svg), idGen));
}

/** End-to-end producing both clipboard flavors: `html` is the payload the
 *  whiteboard reads; `text` is the diagram's labels, so a paste into a plain
 *  editor is not empty (matching the real copy, which carries a text/plain). */
export function svgToWhiteboardClipboard(
  svg: SVGSVGElement,
  idGen?: () => string,
): { html: string; text: string } {
  const g = extractGraph(svg);
  const labels = [
    ...g.nodes.map((n) => n.label),
    ...(g.texts ?? []).map((t) => t.text),
  ].filter(Boolean);
  const visible = labels.map((l) => `<p>${htmlEscape(l)}</p>`).join("");
  return {
    html: encodeWhiteboardClipboard(whiteboardFromGraph(g, idGen), visible),
    text: labels.join("\n"),
  };
}
