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
  shapeKind?: "rect" | "ellipse" | "diamond";
};

export type IREdge = {
  sourceId: string;
  targetId: string;
  label?: string;
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

export type DiagramGraph = {
  nodes: IRNode[];
  edges: IREdge[];
  texts?: IRText[];
};

export type WhiteboardElement = Record<string, unknown>;

type Anchor = { left: number; top: number };

const DEFAULT_STROKE: RGB = { r: 51, g: 51, b: 51 };
const DEFAULT_FILL: RGB = { r: 255, g: 255, b: 255 };
const DEFAULT_CONNECTOR: RGB = { r: 117, g: 129, b: 149 };

/** Mermaid node shape → whiteboard `shape` enum. Only rect (1) is verified from
 *  a real copy; other kinds fall back to rect until sample copies pin them down. */
const SHAPE_ENUM: Record<NonNullable<IRNode["shapeKind"]>, number> = {
  rect: 1,
  ellipse: 1,
  diamond: 1,
};

const vec2 = (x: number, y: number) => ({ x, y, type: "Vector2" as const });
const vec3 = (c: RGB) => ({ x: c.r, y: c.g, z: c.b, type: "Vector3" as const });

/** Stringified ProseMirror doc for a shape/text label. */
function proseDoc(text: string): string {
  const content = text
    ? [{ type: "text", text }]
    : ([] as Array<Record<string, unknown>>);
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
  const { cx, cy } = bboxCenter([...g.nodes, ...texts]);

  const nodeIds = new Map<string, string>();
  const nodeIndex = new Map<string, number>();
  const els: WhiteboardElement[] = [];

  for (const n of g.nodes) {
    const id = idGen();
    nodeIds.set(n.id, id);
    nodeIndex.set(n.id, els.length);
    const pos = vec2(n.x - cx, n.y - cy);
    const size = vec2(n.w, n.h);
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
      fillEnabled: !!n.fill,
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

  for (const e of g.edges) {
    const s = g.nodes.find((n) => n.id === e.sourceId);
    const t = g.nodes.find((n) => n.id === e.targetId);
    if (!s || !t) continue;
    const { source, target } = anchorsFor(t.x - s.x, t.y - s.y);
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
  }

  return els;
}

/** UTF-8 → base64 (btoa throws on unicode, so go via bytes). */
function bytesToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Pure: element array → the `text/html` clipboard string a whiteboard reads. */
export function encodeWhiteboardClipboard(els: WhiteboardElement[]): string {
  const b64 = bytesToBase64(JSON.stringify(els));
  return `<meta charset='utf-8'><div id="canvas-clipboard" data-canvas-clipboard="${b64}"></div>`;
}
