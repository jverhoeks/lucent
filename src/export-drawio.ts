/** Emit a draw.io (diagrams.net) clipboard payload from the shared diagram IR.
 *  draw.io's format is open mxGraph XML (`<mxGraphModel>`), which it recognizes
 *  on paste. Nodes → `mxCell` vertices with a style string + top-left geometry;
 *  edges → `mxCell` edges referencing vertex ids; free lines → edges with
 *  explicit source/target points. */

import { extractGraph, contrastText, type DiagramGraph, type IRNode, type RGB } from "./mermaid-whiteboard";

function hex(c: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Mermaid shape kind → draw.io style prefix. */
const STYLE: Record<NonNullable<IRNode["shapeKind"]>, string> = {
  rect: "whiteSpace=wrap;html=1;",
  rounded: "rounded=1;whiteSpace=wrap;html=1;",
  ellipse: "ellipse;whiteSpace=wrap;html=1;",
  diamond: "rhombus;whiteSpace=wrap;html=1;",
  triangle: "triangle;direction=north;whiteSpace=wrap;html=1;",
  triangleDown: "triangle;direction=south;whiteSpace=wrap;html=1;",
  parallelogram: "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;",
  parallelogramAlt:
    "shape=parallelogram;perimeter=parallelogramPerimeter;flipH=1;whiteSpace=wrap;html=1;",
};

/** Pure: IR → mxGraph XML string. */
export function drawioFromGraph(g: DiagramGraph): string {
  const cells: string[] = [];
  const cellId = new Map<string, string>();

  // Subgraphs → container cells. A child's geometry is relative to its IMMEDIATE
  // parent's absolute top-left (never the summed chain — draw.io re-sums it), so
  // we compute each box's absolute top-left once and subtract only the parent's.
  const groups = g.groups ?? [];
  const groupById = new Map(groups.map((gr) => [gr.id, gr]));
  const groupCell = new Map<string, string>();
  groups.forEach((gr, i) => groupCell.set(gr.id, `g${i}`));
  const absTL = (gr: { x: number; y: number; w: number; h: number }) => ({
    x: gr.x - gr.w / 2,
    y: gr.y - gr.h / 2,
  });
  // The (cell id, absolute top-left) of an element's immediate parent group.
  const parentOf = (groupId?: string) => {
    const p = groupId ? groupById.get(groupId) : undefined;
    return p ? { cell: groupCell.get(p.id)!, tl: absTL(p) } : { cell: "1", tl: { x: 0, y: 0 } };
  };
  const depth = (gr: (typeof groups)[number]): number => {
    let d = 0;
    let cur: (typeof groups)[number] | undefined = gr;
    while (cur?.parentId && groupById.has(cur.parentId)) {
      d++;
      cur = groupById.get(cur.parentId);
    }
    return d;
  };
  // Outermost first so parent cells precede their children.
  [...groups]
    .sort((a, b) => depth(a) - depth(b))
    .forEach((gr) => {
      const { cell: parent, tl } = parentOf(gr.parentId);
      const g0 = absTL(gr);
      const style =
        "rounded=0;whiteSpace=wrap;html=1;verticalAlign=top;container=1;collapsible=0;fillColor=none;";
      cells.push(
        `<mxCell id="${groupCell.get(gr.id)}" value="${xmlEscape(gr.label)}" style="${style}" vertex="1" parent="${parent}">` +
          `<mxGeometry x="${g0.x - tl.x}" y="${g0.y - tl.y}" width="${gr.w}" height="${gr.h}" as="geometry"/></mxCell>`,
      );
    });

  g.nodes.forEach((n, i) => {
    const id = `n${i}`;
    cellId.set(n.id, id);
    let style = STYLE[n.shapeKind ?? "rect"];
    style += n.fill ? `fillColor=${hex(n.fill)};` : "fillColor=none;";
    if (n.stroke) style += `strokeColor=${hex(n.stroke)};`;
    if (n.label && n.fill) style += `fontColor=${hex(contrastText(n.fill))};`;
    const { cell: parent, tl } = parentOf(n.groupId);
    const x = n.x - n.w / 2 - tl.x;
    const y = n.y - n.h / 2 - tl.y;
    cells.push(
      `<mxCell id="${id}" value="${xmlEscape(n.label)}" style="${style}" vertex="1" parent="${parent}">` +
        `<mxGeometry x="${x}" y="${y}" width="${n.w}" height="${n.h}" as="geometry"/></mxCell>`,
    );
  });

  g.edges.forEach((e, i) => {
    const s = cellId.get(e.sourceId);
    const t = cellId.get(e.targetId);
    if (!s || !t) return;
    let style = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;";
    style += `endArrow=${e.arrowEnd ? "classic" : "none"};startArrow=${e.arrowStart ? "classic" : "none"};`;
    if (e.dashed) style += "dashed=1;";
    if (e.stroke) style += `strokeColor=${hex(e.stroke)};`;
    cells.push(
      `<mxCell id="e${i}" value="${xmlEscape(e.label || "")}" style="${style}" edge="1" parent="1" source="${s}" target="${t}">` +
        `<mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
  });

  (g.lines ?? []).forEach((ln, i) => {
    if (ln.points.length < 2) return;
    const [sx, sy] = ln.points[0];
    const [ex, ey] = ln.points[ln.points.length - 1];
    let style = `endArrow=${ln.arrowEnd ? "classic" : "none"};startArrow=${ln.arrowStart ? "classic" : "none"};html=1;`;
    if (ln.dashed) style += "dashed=1;";
    if (ln.stroke) style += `strokeColor=${hex(ln.stroke)};`;
    cells.push(
      `<mxCell id="l${i}" style="${style}" edge="1" parent="1">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${sx}" y="${sy}" as="sourcePoint"/>` +
        `<mxPoint x="${ex}" y="${ey}" as="targetPoint"/>` +
        `</mxGeometry></mxCell>`,
    );
  });

  (g.texts ?? []).forEach((t, i) => {
    const w = t.w || 40;
    const h = t.h || 20;
    let style = "text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;";
    if (t.color) style += `fontColor=${hex(t.color)};`;
    cells.push(
      `<mxCell id="t${i}" value="${xmlEscape(t.text)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${t.x - w / 2}" y="${t.y - h / 2}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
    );
  });

  return (
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" ` +
    `connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel>`
  );
}

/** End-to-end: a rendered mermaid <svg> → draw.io XML. */
export function svgToDrawioXml(svg: SVGSVGElement): string {
  return drawioFromGraph(extractGraph(svg));
}
