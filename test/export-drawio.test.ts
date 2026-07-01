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

  it("XML-escapes the label into the value attribute", () => {
    const doc = parse(drawioFromGraph(GRAPH));
    const a = doc.querySelector('mxCell[vertex="1"]')!;
    // parsed back, the value is the literal text (escaping round-trips)
    expect(a.getAttribute("value")).toBe("Al<pha>");
  });
});
