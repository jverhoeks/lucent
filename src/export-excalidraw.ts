/** Emit an Excalidraw clipboard payload from the shared diagram IR.
 *  Format: `{ type:"excalidraw/clipboard", elements:[…], files:{} }` on
 *  text/plain. Shapes → rectangle/ellipse/diamond (triangle/parallelogram
 *  degrade to rectangle — Excalidraw has no such primitive). Labels are bound
 *  text (containerId + the container's boundElements). Edges → arrows bound to
 *  shapes via startBinding/endBinding (reusing our per-element ids). */

import { extractGraph, type DiagramGraph, type IRNode, type RGB } from "./mermaid-whiteboard";

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

  for (const n of g.nodes) {
    const sid = idGen();
    shapeId.set(n.id, sid);
    const bound: Array<{ id: string; type: string }> = [];
    boundOf.set(sid, bound);
    const kind = n.shapeKind ?? "rect";
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
    });
    if (n.label) {
      const tid = idGen();
      bound.push({ id: tid, type: "text" });
      elements.push({
        ...base(tid),
        type: "text",
        x: n.x - n.w / 2,
        y: n.y - 10,
        width: n.w,
        height: 20,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeStyle: "solid",
        roundness: null,
        boundElements: null,
        text: n.label,
        fontSize: 16,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: sid,
        originalText: n.label,
        lineHeight: 1.25,
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
    boundOf.get(t)?.push({ id: aid, type: "arrow" });
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    elements.push({
      ...base(aid),
      type: "arrow",
      x: src.x,
      y: src.y,
      width: dx,
      height: dy,
      strokeColor: e.stroke ? hex(e.stroke) : "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeStyle: e.dashed ? "dashed" : "solid",
      roundness: { type: 2 },
      boundElements: null,
      points: [[0, 0], [dx, dy]],
      lastCommittedPoint: null,
      startBinding: { elementId: s, focus: 0, gap: 4 },
      endBinding: { elementId: t, focus: 0, gap: 4 },
      startArrowhead: e.arrowStart ? "arrow" : null,
      endArrowhead: e.arrowEnd ? "arrow" : null,
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
      startArrowhead: null,
      endArrowhead: ln.arrowEnd ? "arrow" : null,
    });
  }

  return JSON.stringify({ type: "excalidraw/clipboard", elements, files: {} });
}

/** End-to-end: a rendered mermaid <svg> → Excalidraw clipboard JSON. */
export function svgToExcalidrawJson(svg: SVGSVGElement): string {
  return excalidrawFromGraph(extractGraph(svg));
}
