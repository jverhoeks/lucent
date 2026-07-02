/** Emit an Excalidraw clipboard payload from the shared diagram IR.
 *  Format: `{ type:"excalidraw/clipboard", elements:[…], files:{} }` on
 *  text/plain. Shapes → rectangle/ellipse/diamond (triangle/parallelogram
 *  degrade to rectangle — Excalidraw has no such primitive). Labels are bound
 *  text (containerId + the container's boundElements). Edges → arrows bound to
 *  shapes via startBinding/endBinding (reusing our per-element ids). */

import { extractGraph, contrastText, type DiagramGraph, type IRNode, type RGB } from "./mermaid-whiteboard";

function hex(c: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Mermaid shape kind → Excalidraw element type (no triangle/parallelogram). */
const TYPE: Record<NonNullable<IRNode["shapeKind"]>, string> = {
  rect: "rectangle",
  rounded: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  triangle: "rectangle",
  triangleDown: "rectangle",
  parallelogram: "rectangle",
  parallelogramAlt: "rectangle",
};

function defaultIdGen(): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  let s = "";
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

const FONT_SIZE = 16;
const LINE_HEIGHT = 1.25;

function textBox(text: string, width?: number): { width: number; height: number } {
  const lines = text.split("\n");
  return {
    width: width ?? Math.max(1, ...lines.map((line) => line.length)) * 8,
    height: Math.max(1, lines.length) * FONT_SIZE * LINE_HEIGHT,
  };
}

/** Pure: IR → Excalidraw clipboard JSON string. */
export function excalidrawFromGraph(g: DiagramGraph, idGen: () => string = defaultIdGen): string {
  const elements: Array<Record<string, unknown>> = [];
  const shapeId = new Map<string, string>();
  const boundOf = new Map<string, Array<{ id: string; type: string }>>();
  let seed = 1;
  const base = (id: string) => ({
    id,
    angle: 0,
    strokeWidth: 2,
    roughness: 1,
    opacity: 100,
    groupIds: [] as string[],
    frameId: null,
    seed: seed++,
    versionNonce: seed++,
    version: 1,
    isDeleted: false,
    updated: 1,
    link: null,
    locked: false,
  });

  // Subgraphs → frames (true containers). Membership is by `frameId`, so we
  // assign each element to its innermost group's frame. Excalidraw frames don't
  // nest, so a node in a nested subgraph belongs to that inner frame and the
  // outer frame owns only the nodes directly inside it. Frames are emitted
  // first so they render behind their members.
  const frameId = new Map<string, string>();
  for (const grp of g.groups ?? []) {
    const fid = idGen();
    frameId.set(grp.id, fid);
    elements.push({
      ...base(fid),
      type: "frame",
      x: grp.x - grp.w / 2,
      y: grp.y - grp.h / 2,
      width: grp.w,
      height: grp.h,
      strokeColor: "#bbbbbb",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeStyle: "solid",
      roundness: null,
      boundElements: null,
      name: grp.label || null,
    });
  }
  const frameOf = (groupId?: string): string | null =>
    (groupId && frameId.get(groupId)) || null;

  for (const n of g.nodes) {
    const sid = idGen();
    shapeId.set(n.id, sid);
    const bound: Array<{ id: string; type: string }> = [];
    boundOf.set(sid, bound);
    const kind = n.shapeKind ?? "rect";
    const fid = frameOf(n.groupId);
    elements.push({
      ...base(sid),
      type: TYPE[kind],
      x: n.x - n.w / 2,
      y: n.y - n.h / 2,
      width: n.w,
      height: n.h,
      strokeColor: n.stroke ? hex(n.stroke) : "#1e1e1e",
      backgroundColor: n.fill ? hex(n.fill) : "transparent",
      fillStyle: "solid",
      strokeStyle: "solid",
      roundness: kind === "rounded" ? { type: 3 } : null,
      boundElements: bound,
      frameId: fid,
    });
    if (n.label) {
      const tid = idGen();
      const labelBox = textBox(n.label, n.w);
      bound.push({ id: tid, type: "text" });
      elements.push({
        ...base(tid),
        type: "text",
        x: n.x - n.w / 2,
        y: n.y - labelBox.height / 2,
        width: labelBox.width,
        height: labelBox.height,
        strokeColor: n.fill ? hex(contrastText(n.fill)) : "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeStyle: "solid",
        roundness: null,
        boundElements: null,
        text: n.label,
        fontSize: FONT_SIZE,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: sid,
        originalText: n.label,
        lineHeight: LINE_HEIGHT,
        frameId: fid,
      });
    }
  }

  for (const e of g.edges) {
    const s = shapeId.get(e.sourceId);
    const t = shapeId.get(e.targetId);
    const src = g.nodes.find((n) => n.id === e.sourceId);
    const tgt = g.nodes.find((n) => n.id === e.targetId);
    if (!s || !t || !src || !tgt) continue;
    const aid = idGen();
    boundOf.get(s)?.push({ id: aid, type: "arrow" });
    if (t !== s) boundOf.get(t)?.push({ id: aid, type: "arrow" });
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const selfLoop = s === t;
    const loopW = Math.max(60, src.w);
    const loopH = Math.max(50, src.h + 20);
    const arrowX = selfLoop ? src.x - loopW / 2 : src.x;
    const arrowY = selfLoop ? src.y - src.h / 2 : src.y;
    const arrowPoints = selfLoop
      ? [[0, 0], [0, -loopH], [loopW, -loopH], [loopW, 0]]
      : [[0, 0], [dx, dy]];
    // An arrow belongs to a frame only when both endpoints sit in the same group.
    const edgeFrame = src.groupId && src.groupId === tgt.groupId ? frameOf(src.groupId) : null;
    // Bind the edge label to the arrow (moves with it), like a container label.
    const arrowBound: Array<{ id: string; type: string }> = [];
    let labelTextId: string | null = null;
    if (e.label) {
      labelTextId = idGen();
      arrowBound.push({ id: labelTextId, type: "text" });
    }
    elements.push({
      ...base(aid),
      type: "arrow",
      x: arrowX,
      y: arrowY,
      width: selfLoop ? loopW : dx,
      height: selfLoop ? loopH : dy,
      strokeColor: e.stroke ? hex(e.stroke) : "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeStyle: e.dashed ? "dashed" : "solid",
      roundness: { type: 2 },
      boundElements: arrowBound.length ? arrowBound : null,
      points: arrowPoints,
      lastCommittedPoint: null,
      startBinding: { elementId: s, focus: 0, gap: 4 },
      endBinding: { elementId: t, focus: 0, gap: 4 },
      startArrowhead: e.arrowStart ? "arrow" : null,
      endArrowhead: e.arrowEnd ? "arrow" : null,
      frameId: edgeFrame,
    });
    if (labelTextId && e.label) {
      const defaultLabelPos: [number, number] = selfLoop
        ? [src.x, src.y - src.h / 2 - loopH]
        : [src.x + dx / 2, src.y + dy / 2];
      const [lx, ly] = e.labelPos ?? defaultLabelPos;
      const labelBox = textBox(e.label);
      elements.push({
        ...base(labelTextId),
        type: "text",
        x: lx - labelBox.width / 2,
        y: ly - labelBox.height / 2,
        width: labelBox.width,
        height: labelBox.height,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeStyle: "solid",
        roundness: null,
        boundElements: null,
        text: e.label,
        fontSize: FONT_SIZE,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: aid,
        originalText: e.label,
        lineHeight: LINE_HEIGHT,
        frameId: edgeFrame,
      });
    }
  }

  for (const t of g.texts ?? []) {
    const box = textBox(t.text, t.w || undefined);
    const w = box.width || 40;
    const h = Math.max(t.h || 0, box.height);
    elements.push({
      ...base(idGen()),
      type: "text",
      x: t.x - w / 2,
      y: t.y - h / 2,
      width: w,
      height: h,
      strokeColor: t.color ? hex(t.color) : "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeStyle: "solid",
      roundness: null,
      boundElements: null,
      text: t.text,
      fontSize: FONT_SIZE,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: null,
      originalText: t.text,
      lineHeight: LINE_HEIGHT,
    });
  }

  for (const ln of g.lines ?? []) {
    if (ln.points.length < 2) continue;
    const [sx, sy] = ln.points[0];
    const [ex, ey] = ln.points[ln.points.length - 1];
    elements.push({
      ...base(idGen()),
      type: "line",
      x: sx,
      y: sy,
      width: ex - sx,
      height: ey - sy,
      strokeColor: ln.stroke ? hex(ln.stroke) : "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeStyle: ln.dashed ? "dashed" : "solid",
      roundness: null,
      boundElements: null,
      points: ln.points.map(([px, py]) => [px - sx, py - sy]),
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: ln.arrowStart ? "arrow" : null,
      endArrowhead: ln.arrowEnd ? "arrow" : null,
    });
  }

  return JSON.stringify({ type: "excalidraw/clipboard", elements, files: {} });
}

/** End-to-end: a rendered mermaid <svg> → Excalidraw clipboard JSON. */
export function svgToExcalidrawJson(svg: SVGSVGElement): string {
  return excalidrawFromGraph(extractGraph(svg));
}
