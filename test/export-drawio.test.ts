import { describe, it, expect } from "vitest";
import { drawioFromGraph } from "../src/export-drawio";
import type { DiagramGraph } from "../src/mermaid-whiteboard";

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, "text/xml");
}

const GRAPH: DiagramGraph = {
  nodes: [
    { id: "A", x: 100, y: 50, w: 80, h: 40, label: "Al<pha>", shapeKind: "rect", fill: { r: 236, g: 236, b: 255 }, stroke: { r: 147, g: 112, b: 219 } },
    { id: "B", x: 300, y: 50, w: 80, h: 40, label: "Beta", shapeKind: "diamond" },
  ],
  edges: [{ sourceId: "A", targetId: "B", arrowEnd: true }],
};

describe("drawioFromGraph", () => {
  it("emits mxGraphModel with two vertices and a connecting edge", () => {
    const doc = parse(drawioFromGraph(GRAPH));
    expect(doc.querySelector("mxGraphModel")).toBeTruthy();
    const cells = Array.from(doc.querySelectorAll("mxCell"));
    const vertices = cells.filter((c) => c.getAttribute("vertex") === "1");
    const edges = cells.filter((c) => c.getAttribute("edge") === "1");
    expect(vertices).toHaveLength(2);
    expect(edges).toHaveLength(1);
    // edge references the two vertex cell ids
    expect(edges[0].getAttribute("source")).toBe(vertices[0].getAttribute("id"));
    expect(edges[0].getAttribute("target")).toBe(vertices[1].getAttribute("id"));
    expect(edges[0].getAttribute("style")).toContain("endArrow=classic");
  });

  it("uses top-left geometry (center minus half size)", () => {
    const doc = parse(drawioFromGraph(GRAPH));
    const geo = doc.querySelector('mxCell[vertex="1"] mxGeometry')!;
    expect(geo.getAttribute("x")).toBe("60"); // 100 - 80/2
    expect(geo.getAttribute("y")).toBe("30"); // 50 - 40/2
    expect(geo.getAttribute("width")).toBe("80");
  });

  it("maps shape kinds to draw.io styles and hex colors", () => {
    const doc = parse(drawioFromGraph(GRAPH));
    const [a, b] = Array.from(doc.querySelectorAll('mxCell[vertex="1"]'));
    expect(a.getAttribute("style")).toContain("fillColor=#ececff");
    expect(a.getAttribute("style")).toContain("strokeColor=#9370db");
    expect(b.getAttribute("style")).toContain("rhombus");
  });

  it("binds an edge label to the edge cell's value", () => {
    const g: DiagramGraph = {
      nodes: [
        { id: "A", x: 0, y: 0, w: 80, h: 40, label: "A" },
        { id: "B", x: 0, y: 200, w: 80, h: 40, label: "B" },
      ],
      edges: [{ sourceId: "A", targetId: "B", arrowEnd: true, label: "ship it", labelPos: [0, 100] }],
    };
    const doc = parse(drawioFromGraph(g));
    const edge = doc.querySelector('mxCell[edge="1"]')!;
    expect(edge.getAttribute("value")).toBe("ship it");
  });

  it("emits loose texts as text vertices", () => {
    const g: DiagramGraph = { nodes: [], edges: [], texts: [{ x: 100, y: 50, w: 48, h: 20, text: "ship it" }] };
    const doc = parse(drawioFromGraph(g));
    const textCell = Array.from(doc.querySelectorAll('mxCell[vertex="1"]')).find(
      (c) => c.getAttribute("value") === "ship it",
    )!;
    expect(textCell).toBeTruthy();
    expect(textCell.getAttribute("style")).toContain("text;");
  });

  it("nests groups and member nodes as containers with immediate-parent-relative geometry", () => {
    const g: DiagramGraph = {
      nodes: [{ id: "A", x: 160, y: 160, w: 20, h: 20, label: "A", groupId: "inner" }],
      edges: [],
      groups: [
        { id: "outer", label: "Outer", x: 250, y: 250, w: 300, h: 300 }, // abs top-left (100,100)
        { id: "inner", label: "Inner", x: 200, y: 200, w: 100, h: 100, parentId: "outer" }, // abs (150,150)
      ],
    };
    const doc = parse(drawioFromGraph(g));
    const cell = (value: string) =>
      Array.from(doc.querySelectorAll("mxCell")).find((c) => c.getAttribute("value") === value)!;
    const outer = cell("Outer"), inner = cell("Inner"), node = cell("A");
    const geo = (c: Element) => c.querySelector("mxGeometry")!;

    expect(outer.getAttribute("style")).toContain("container=1");
    expect(outer.getAttribute("parent")).toBe("1");
    expect(geo(outer).getAttribute("x")).toBe("100"); // absolute, parent is the layer

    expect(inner.getAttribute("parent")).toBe(outer.getAttribute("id"));
    expect(geo(inner).getAttribute("x")).toBe("50"); // 150 - 100 (relative to outer only)

    expect(node.getAttribute("parent")).toBe(inner.getAttribute("id"));
    expect(geo(node).getAttribute("x")).toBe("0"); // 150 - 150
    expect(geo(node).getAttribute("y")).toBe("0");
  });

  it("XML-escapes the label into the value attribute", () => {
    const doc = parse(drawioFromGraph(GRAPH));
    const a = doc.querySelector('mxCell[vertex="1"]')!;
    // parsed back, the value is the literal text (escaping round-trips)
    expect(a.getAttribute("value")).toBe("Al<pha>");
  });
});
