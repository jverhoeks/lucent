import { describe, it, expect } from "vitest";
import {
  whiteboardFromGraph,
  encodeWhiteboardClipboard,
  svgToWhiteboardClipboard,
  extractGraph,
  assignContainment,
  type DiagramGraph,
  type IRGroup,
  type IRNode,
} from "../src/mermaid-whiteboard";

/** Parse an SVG string into a live SVGSVGElement (jsdom). */
function parseSvg(markup: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  return doc.documentElement as unknown as SVGSVGElement;
}

const FLOWCHART_SVG = `
<svg aria-roledescription="flowchart-v2" class="flowchart" xmlns="http://www.w3.org/2000/svg">
  <g class="edgePaths">
    <path id="mermaid-123-L_A_B_0" data-id="L_A_B_0" class="edge-thickness-normal edge-pattern-solid flowchart-link" d="M100,50L300,50" marker-end="url(#arrow)"/>
  </g>
  <g class="edgeLabels"><g class="edgeLabel"><text>yes</text></g></g>
  <g class="nodes">
    <g class="node default" id="mermaid-123-flowchart-A-0" transform="translate(100, 50)">
      <rect class="basic label-container" x="-50" y="-20" width="100" height="40"/>
      <g class="label"><text><tspan class="text-inner-tspan">Alpha</tspan></text></g>
    </g>
    <g class="node default" id="mermaid-123-flowchart-B-0" transform="translate(300, 50)">
      <rect class="basic label-container" x="-40" y="-20" width="80" height="40"/>
      <g class="label"><text><tspan class="text-inner-tspan">Beta</tspan></text></g>
    </g>
  </g>
</svg>`;

/** Decode the base64 out of the clipboard HTML back to the element array. */
function decodeClipboard(html: string): any[] {
  const m = html.match(/data-canvas-clipboard="([^"]*)"/);
  if (!m) throw new Error("no canvas-clipboard attribute");
  const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const seqIds = () => {
  let n = 0;
  return () => `id${n++}`;
};

describe("encodeWhiteboardClipboard", () => {
  it("wraps elements as base64 in a canvas-clipboard div and round-trips", () => {
    const els = [{ type: "shape", text: "café ☕" }];
    const html = encodeWhiteboardClipboard(els);
    expect(html).toContain("data-canvas-clipboard=");
    expect(html).toContain("<meta charset");
    expect(decodeClipboard(html)).toEqual(els);
  });

  it("appends visible label paragraphs after the payload div (WebKit keeps the html flavor)", () => {
    const { html } = svgToWhiteboardClipboard(parseSvg(FLOWCHART_SVG));
    expect(html).toContain("data-canvas-clipboard=");
    expect(html).toContain("<p>Alpha</p>");
    expect(html).toContain("<p>Beta</p>");
    // the visible content must come AFTER the payload div, not replace it
    expect(html.indexOf("<p>Alpha</p>")).toBeGreaterThan(html.indexOf("</div>"));
    // and the base64 payload still round-trips
    expect(decodeClipboard(html).filter((e: any) => e.type === "shape")).toHaveLength(2);
  });
});

describe("extractGraph (flowchart)", () => {
  it("extracts nodes with id, center, size, and label", () => {
    const g = extractGraph(parseSvg(FLOWCHART_SVG));
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    const a = g.nodes.find((n) => n.id === "A")!;
    expect(a.x).toBe(100);
    expect(a.y).toBe(50);
    expect(a.w).toBe(100);
    expect(a.h).toBe(40);
    expect(a.label).toBe("Alpha");
  });

  it("extracts edges with endpoints from the path id and an arrow cap", () => {
    const g = extractGraph(parseSvg(FLOWCHART_SVG));
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({
      sourceId: "A",
      targetId: "B",
      arrowEnd: true,
    });
  });

  it("produces a payload that connects the two shapes end-to-end", () => {
    const els = whiteboardFromGraph(extractGraph(parseSvg(FLOWCHART_SVG)), seqIds());
    expect(els.filter((e) => e.type === "shape")).toHaveLength(2);
    const conn = els.find((e) => e.type === "connector");
    expect(conn).toMatchObject({ sourceIndex: 0, targetIndex: 1, endCap: 2 });
  });
});

const SUBGRAPH_SVG = `
<svg aria-roledescription="flowchart-v2" class="flowchart" xmlns="http://www.w3.org/2000/svg">
  <g class="edgePaths"><path data-id="L_A_B_0" d="M100,50L300,50" marker-end="url(#arrow)"/></g>
  <g class="edgeLabels"></g>
  <g class="clusters">
    <g class="cluster" id="g-Outer"><rect x="40" y="10" width="320" height="80"/><g class="cluster-label"><text>Customer AWS Account</text></g></g>
    <g class="cluster" id="g-Inner"><rect x="45" y="25" width="110" height="50"/><g class="cluster-label"><text>Per-Workspace</text></g></g>
  </g>
  <g class="nodes">
    <g class="node default" id="mermaid-123-flowchart-A-0" transform="translate(100, 50)"><rect class="basic label-container" x="-50" y="-20" width="100" height="40"/><g class="label"><text>Alpha</text></g></g>
    <g class="node default" id="mermaid-123-flowchart-B-0" transform="translate(300, 50)"><rect class="basic label-container" x="-40" y="-20" width="80" height="40"/><g class="label"><text>Beta</text></g></g>
  </g>
</svg>`;

describe("extractGraph (subgraph clusters)", () => {
  it("extracts nested groups (center-based) and assigns node membership", () => {
    const g = extractGraph(parseSvg(SUBGRAPH_SVG));
    expect(g.groups?.map((x) => x.label).sort()).toEqual(["Customer AWS Account", "Per-Workspace"]);
    const outer = g.groups!.find((x) => x.label === "Customer AWS Account")!;
    const inner = g.groups!.find((x) => x.label === "Per-Workspace")!;
    expect(outer).toMatchObject({ x: 200, y: 50, w: 320, h: 80 });
    expect(inner.parentId).toBe(outer.id);
    expect(g.nodes.find((n) => n.id === "A")!.groupId).toBe(inner.id);
    expect(g.nodes.find((n) => n.id === "B")!.groupId).toBe(outer.id);
  });
});

const SEQUENCE_SVG = `
<svg aria-roledescription="sequence" class="sequence" xmlns="http://www.w3.org/2000/svg">
  <line x1="10" y1="0" x2="10" y2="100" class="actor-line"/>
  <path d="M20 20 L120 20 L120 40" marker-end="url(#arrow)"/>
  <path d="M0 0 C10 10 20 20 30 30"/>
  <text x="0" y="0">Alice</text>
</svg>`;

const POLYGON_SVG = `
<svg aria-roledescription="flowchart-v2" class="flowchart" xmlns="http://www.w3.org/2000/svg">
  <g class="nodes">
    <g class="node default" id="mermaid-1-flowchart-T-0" transform="translate(50, 50)">
      <polygon points="50,0 0,100 100,100"/>
      <g class="label"><text>tri</text></g>
    </g>
    <g class="node default" id="mermaid-1-flowchart-V-1" transform="translate(250, 50)">
      <polygon points="0,0 100,0 50,100"/>
      <g class="label"><text>down</text></g>
    </g>
    <g class="node default" id="mermaid-1-flowchart-D-2" transform="translate(450, 50)">
      <polygon points="50,0 100,50 50,100 0,50"/>
      <g class="label"><text>dec</text></g>
    </g>
    <g class="node default" id="mermaid-1-flowchart-P-3" transform="translate(650, 50)">
      <polygon points="20,0 120,0 100,100 0,100"/>
      <g class="label"><text>para</text></g>
    </g>
  </g>
</svg>`;

const STATE_SVG = `
<svg aria-roledescription="stateDiagram" class="statediagram" xmlns="http://www.w3.org/2000/svg">
  <g class="edgePaths">
    <path id="mermaid-1-edge0" data-id="edge0" class="transition" d="M100,67 C100,90 100,110 100,133" marker-end="url(#arrow)"/>
  </g>
  <g class="edgeLabels">
    <g class="edgeLabel" transform="translate(100, 100)"><g class="label"><text>ship it</text></g></g>
  </g>
  <g class="nodes">
    <g class="node" id="mermaid-1-state-Written-0" transform="translate(100, 50)">
      <rect class="basic label-container" x="-35" y="-17" width="70" height="35"/>
      <g class="label"><text>Written</text></g>
    </g>
    <g class="node" id="mermaid-1-state-Forgotten-1" transform="translate(100, 150)">
      <rect class="basic label-container" x="-43" y="-17" width="86" height="35"/>
      <g class="label"><text>Forgotten</text></g>
    </g>
  </g>
</svg>`;

describe("extractGraph (state diagram: g.node without flowchart ids)", () => {
  it("labels state boxes and links transitions geometrically", () => {
    const g = extractGraph(parseSvg(STATE_SVG));
    expect(g.nodes.map((n) => n.label).sort()).toEqual(["Forgotten", "Written"]);
    expect(g.edges).toHaveLength(1);
    const e = g.edges[0];
    const src = g.nodes.find((n) => n.id === e.sourceId)!;
    const tgt = g.nodes.find((n) => n.id === e.targetId)!;
    expect(src.label).toBe("Written"); // path starts near Written
    expect(tgt.label).toBe("Forgotten"); // ends near Forgotten
    expect(e.arrowEnd).toBe(true);
  });

  it("attaches the transition label to its edge (index-parallel)", () => {
    const g = extractGraph(parseSvg(STATE_SVG));
    expect(g.edges[0].label).toBe("ship it");
    expect(g.edges[0].labelPos).toEqual([100, 100]);
  });

  it("binds the edge label as a pathLabel on its connector (by array index)", () => {
    const els = whiteboardFromGraph(extractGraph(parseSvg(STATE_SVG)), seqIds());
    const connIndex = els.findIndex((e) => e.type === "connector");
    const pl = els.find((e) => e.type === "pathLabel");
    expect(pl).toBeTruthy();
    expect(pl!.sourcePathIndex).toBe(connIndex);
    expect(pl!.proportion).toBe(0.5);
    expect(JSON.parse(pl!.text as string).content[0].content[0].text).toBe("ship it");
  });
});

describe("extractGraph (polygon node shapes)", () => {
  it("classifies triangles, diamonds and parallelograms from polygon points", () => {
    const g = extractGraph(parseSvg(POLYGON_SVG));
    const kind = (id: string) => g.nodes.find((n) => n.id === id)!.shapeKind;
    expect(kind("T")).toBe("triangle");
    expect(kind("V")).toBe("triangleDown");
    expect(kind("D")).toBe("diamond");
    expect(kind("P")).toBe("parallelogram");
    // size comes from the polygon's point extent, not getBBox
    expect(g.nodes.find((n) => n.id === "T")!.h).toBe(100);
  });
});

describe("extractGraph (non-flowchart geometry: lines & polylines)", () => {
  it("extracts <line> and straight <path> as free lines, skipping curves", () => {
    const g = extractGraph(parseSvg(SEQUENCE_SVG));
    expect(g.lines).toHaveLength(2); // the line + the M/L path; the C curve is skipped
    const straightLine = g.lines!.find((l) => l.points.length === 2)!;
    expect(straightLine.points).toEqual([
      [10, 0],
      [10, 100],
    ]);
    const poly = g.lines!.find((l) => l.points.length === 3)!;
    expect(poly.points[0]).toEqual([20, 20]);
    expect(poly.arrowEnd).toBe(true);
  });

  it("emits free connectors (no anchors) for lines, recentered", () => {
    const g: DiagramGraph = {
      nodes: [],
      edges: [],
      lines: [{ points: [[0, 0], [100, 0]], arrowEnd: true }],
    };
    const els = whiteboardFromGraph(g, seqIds());
    expect(els).toHaveLength(1);
    const c = els[0];
    expect(c.type).toBe("connector");
    expect(c.start).toEqual([-50, 0]);
    expect(c.end).toEqual([50, 0]);
    expect(c.endCap).toBe(2);
    expect(c.sourceElement).toBeUndefined(); // free line, not anchored to a shape
  });
});

describe("payload conformance to the real whiteboard format", () => {
  // Field shape frozen from a genuine Atlassian Whiteboard clipboard copy.
  const SHAPE_KEYS = [
    "type", "source", "position", "size", "color", "strokeColor", "strokeStyle",
    "text", "shape", "fillEnabled", "fontScale", "basisSize", "basisPosition",
    "alignment", "verticalAlignment", "rotation",
  ].sort();
  const CONNECTOR_KEYS = [
    "type", "source", "presentation", "segments", "start", "end", "position",
    "size", "sourceElement", "targetElement", "sourceAnchor", "targetAnchor",
    "startCap", "endCap", "color", "stroke", "strokeStyle", "sourceIndex",
    "targetIndex",
  ].sort();

  it("emits shapes and connectors with exactly the real field set", () => {
    const g: DiagramGraph = {
      nodes: [
        { id: "A", x: 0, y: 0, w: 100, h: 100, label: "A" },
        { id: "B", x: 300, y: 0, w: 100, h: 100, label: "B" },
      ],
      edges: [{ sourceId: "A", targetId: "B", arrowEnd: true }],
    };
    const els = whiteboardFromGraph(g, seqIds());
    const shape = els.find((e) => e.type === "shape")!;
    const conn = els.find((e) => e.type === "connector")!;
    expect(Object.keys(shape).sort()).toEqual(SHAPE_KEYS);
    expect(Object.keys(conn).sort()).toEqual(CONNECTOR_KEYS);
    // Vector tagging must match the format exactly.
    expect((shape.position as any).type).toBe("Vector2");
    expect((shape.color as any).type).toBe("Vector3");
  });
});

describe("assignContainment", () => {
  it("nests groups and assigns each node to its innermost group", () => {
    const groups: IRGroup[] = [
      { id: "outer", label: "O", x: 0, y: 0, w: 400, h: 400 },
      { id: "inner", label: "I", x: 0, y: 0, w: 100, h: 100 },
    ];
    const nodes: IRNode[] = [
      { id: "a", x: 0, y: 0, w: 20, h: 20, label: "a" }, // inside inner (and outer)
      { id: "b", x: 150, y: 150, w: 20, h: 20, label: "b" }, // inside outer only
      { id: "c", x: 999, y: 999, w: 20, h: 20, label: "c" }, // outside all
    ];
    assignContainment(groups, nodes);
    expect(groups.find((g) => g.id === "inner")!.parentId).toBe("outer");
    expect(groups.find((g) => g.id === "outer")!.parentId).toBeUndefined();
    expect(nodes.find((n) => n.id === "a")!.groupId).toBe("inner");
    expect(nodes.find((n) => n.id === "b")!.groupId).toBe("outer");
    expect(nodes.find((n) => n.id === "c")!.groupId).toBeUndefined();
  });
});

describe("whiteboardFromGraph (sections)", () => {
  it("emits a section behind the shapes for a subgraph, outermost first", () => {
    const g: DiagramGraph = {
      nodes: [{ id: "A", x: 0, y: 0, w: 100, h: 40, label: "A", groupId: "inner" }],
      edges: [],
      groups: [
        { id: "outer", label: "Outer", x: 0, y: 0, w: 400, h: 300 },
        { id: "inner", label: "Inner", x: 0, y: 0, w: 200, h: 120, parentId: "outer" },
      ],
    };
    const els = whiteboardFromGraph(g, seqIds());
    const secs = els.filter((e) => e.type === "section");
    expect(secs.map((s) => s.title)).toEqual(["Outer", "Inner"]); // largest painted first
    expect(secs[1].size).toMatchObject({ x: 200, y: 120 });
    // sections precede shapes so they render behind, and connector indices are unaffected
    const firstShape = els.findIndex((e) => e.type === "shape");
    expect(els.indexOf(secs[0])).toBeLessThan(firstShape);
  });

  it("colors a dark cluster's section with an observed-valid palette color, not an invented one", () => {
    // The whiteboard renders a pasted section's fill from a constrained palette;
    // an off-palette RGB (our old invented {244,245,247}) falls back to a dark
    // default → black on a dark board. White {255,255,255} is a real, copied
    // section color, so it renders light.
    const g: DiagramGraph = {
      nodes: [],
      edges: [],
      groups: [{ id: "G", label: "G", x: 0, y: 0, w: 300, h: 200, fill: { r: 71, g: 73, b: 73 } }],
    };
    const s = whiteboardFromGraph(g, seqIds()).find((e) => e.type === "section")!;
    expect(s.color).toMatchObject({ x: 255, y: 255, z: 255 });
  });

  it("also snaps a light cluster fill to white (an arbitrary light RGB is still off-palette)", () => {
    const g: DiagramGraph = {
      nodes: [],
      edges: [],
      groups: [{ id: "G", label: "G", x: 0, y: 0, w: 300, h: 200, fill: { r: 236, g: 236, b: 255 } }],
    };
    const s = whiteboardFromGraph(g, seqIds()).find((e) => e.type === "section")!;
    expect(s.color).toMatchObject({ x: 255, y: 255, z: 255 });
  });

  it("keeps connector source/target indices correct when sections precede shapes", () => {
    const g: DiagramGraph = {
      nodes: [
        { id: "A", x: 0, y: 0, w: 80, h: 40, label: "A" },
        { id: "B", x: 200, y: 0, w: 80, h: 40, label: "B" },
      ],
      edges: [{ sourceId: "A", targetId: "B", arrowEnd: true }],
      groups: [{ id: "G", label: "G", x: 100, y: 0, w: 400, h: 200 }],
    };
    const els = whiteboardFromGraph(g, seqIds());
    const conn = els.find((e) => e.type === "connector")!;
    const shapes = els.filter((e) => e.type === "shape");
    // one section shifts both shapes to indices 1 and 2; the connector must track that
    expect(conn.sourceIndex).toBe(els.indexOf(shapes[0]));
    expect(conn.targetIndex).toBe(els.indexOf(shapes[1]));
  });
});

describe("whiteboardFromGraph", () => {
  it("leaves dark fills empty so the whiteboard's dark label text stays readable", () => {
    const g: DiagramGraph = {
      nodes: [{ id: "A", x: 0, y: 0, w: 100, h: 40, label: "Written", fill: { r: 31, g: 32, b: 32 } }],
      edges: [],
    };
    const s = whiteboardFromGraph(g, seqIds())[0];
    // a dark fill would be unreadable behind the fixed dark label text → no fill
    expect(s.fillEnabled).toBe(false);
    // no textColor mark (relies on the whiteboard's default dark text)
    expect(JSON.parse(s.text as string).content[0].content[0].marks).toBeUndefined();
  });

  it("keeps a light fill as-is, without fabricating a color", () => {
    const g: DiagramGraph = {
      nodes: [{ id: "A", x: 0, y: 0, w: 100, h: 40, label: "Alpha", fill: { r: 236, g: 236, b: 255 } }],
      edges: [],
    };
    const s = whiteboardFromGraph(g, seqIds())[0];
    expect(s.fillEnabled).toBe(true);
    expect(s.color).toMatchObject({ x: 236, y: 236, z: 255 });
  });

  it("emits one centered shape for a single node", () => {
    const g: DiagramGraph = {
      nodes: [{ id: "A", x: 100, y: 50, w: 160, h: 80, label: "hello" }],
      edges: [],
    };
    const els = whiteboardFromGraph(g, seqIds());
    expect(els).toHaveLength(1);
    const s = els[0];
    expect(s.type).toBe("shape");
    // single node → its center becomes the origin
    expect(s.position).toEqual({ x: 0, y: 0, type: "Vector2" });
    expect(s.size).toEqual({ x: 160, y: 80, type: "Vector2" });
    expect(s.shape).toBe(1);
    expect(JSON.parse(s.text)).toEqual({
      version: 1,
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    });
  });

  it("emits an empty ProseMirror doc for a blank label", () => {
    const g: DiagramGraph = {
      nodes: [{ id: "A", x: 0, y: 0, w: 10, h: 10, label: "" }],
      edges: [],
    };
    const s = whiteboardFromGraph(g, seqIds())[0];
    expect(JSON.parse(s.text)).toEqual({
      version: 1,
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    });
  });

  it("recenters the diagram bounding box to the origin", () => {
    const g: DiagramGraph = {
      nodes: [
        { id: "A", x: 0, y: 0, w: 100, h: 100, label: "A" },
        { id: "B", x: 200, y: 0, w: 100, h: 100, label: "B" },
      ],
      edges: [],
    };
    const els = whiteboardFromGraph(g, seqIds());
    // bbox center is x=100 → shifts to -100 and +100
    expect(els[0].position.x).toBe(-100);
    expect(els[1].position.x).toBe(100);
  });

  it("links an edge to its shapes by array index with an arrow cap", () => {
    const g: DiagramGraph = {
      nodes: [
        { id: "A", x: 0, y: 0, w: 100, h: 100, label: "A" },
        { id: "B", x: 300, y: 0, w: 100, h: 100, label: "B" },
      ],
      edges: [{ sourceId: "A", targetId: "B", arrowEnd: true }],
    };
    const els = whiteboardFromGraph(g, seqIds());
    const conn = els.find((e) => e.type === "connector");
    expect(conn).toBeTruthy();
    expect(conn.sourceIndex).toBe(0);
    expect(conn.targetIndex).toBe(1);
    // ids minted for the shapes are referenced by the connector
    expect(conn.sourceElement).toBe("id0");
    expect(conn.targetElement).toBe("id1");
    // A is left of B → source right anchor, target left anchor
    expect(conn.sourceAnchor).toEqual({ left: 1, top: 0.5 });
    expect(conn.targetAnchor).toEqual({ left: 0, top: 0.5 });
    expect(conn.endCap).toBe(2);
    expect(conn.startCap).toBe(1);
  });

  it("maps node shape kinds to the real whiteboard shape enum", () => {
    const g: DiagramGraph = {
      nodes: [
        { id: "r", x: 0, y: 0, w: 10, h: 10, label: "", shapeKind: "rect" },
        { id: "e", x: 20, y: 0, w: 10, h: 10, label: "", shapeKind: "ellipse" },
        { id: "d", x: 40, y: 0, w: 10, h: 10, label: "", shapeKind: "diamond" },
        { id: "o", x: 60, y: 0, w: 10, h: 10, label: "", shapeKind: "rounded" },
      ],
      edges: [],
    };
    const els = whiteboardFromGraph(g, seqIds());
    expect(els.map((e) => e.shape)).toEqual([1, 2, 4, 3]);
  });

  it("maps triangles and parallelograms to the real enum (5/6/7/8)", () => {
    const mk = (id: string, shapeKind: any) => ({ id, x: 0, y: 0, w: 10, h: 10, label: "", shapeKind });
    const g: DiagramGraph = {
      nodes: [
        mk("t", "triangle"),
        mk("v", "triangleDown"),
        mk("p", "parallelogram"),
        mk("q", "parallelogramAlt"),
      ],
      edges: [],
    };
    expect(whiteboardFromGraph(g, seqIds()).map((e) => e.shape)).toEqual([5, 6, 7, 8]);
  });

  it("maps fill/stroke to Vector3 and disables fill when absent", () => {
    const g: DiagramGraph = {
      nodes: [
        {
          id: "A",
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          label: "A",
          fill: { r: 255, g: 239, b: 174 },
          stroke: { r: 174, g: 42, b: 25 },
        },
        { id: "B", x: 50, y: 0, w: 10, h: 10, label: "B" },
      ],
      edges: [],
    };
    const [a, b] = whiteboardFromGraph(g, seqIds());
    expect(a.color).toEqual({ x: 255, y: 239, z: 174, type: "Vector3" });
    expect(a.strokeColor).toEqual({ x: 174, y: 42, z: 25, type: "Vector3" });
    expect(a.fillEnabled).toBe(true);
    expect(b.fillEnabled).toBe(false);
  });
});
