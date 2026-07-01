import { describe, it, expect } from "vitest";
import { excalidrawFromGraph } from "../src/export-excalidraw";
import type { DiagramGraph } from "../src/mermaid-whiteboard";

const seqIds = () => {
  let n = 0;
  return () => `id${n++}`;
};

const GRAPH: DiagramGraph = {
  nodes: [
    { id: "A", x: 100, y: 50, w: 80, h: 40, label: "Alpha", shapeKind: "rect", fill: { r: 236, g: 236, b: 255 }, stroke: { r: 147, g: 112, b: 219 } },
    { id: "B", x: 300, y: 50, w: 80, h: 40, label: "Beta", shapeKind: "diamond" },
  ],
  edges: [{ sourceId: "A", targetId: "B", arrowEnd: true }],
};

describe("excalidrawFromGraph", () => {
  it("emits an excalidraw/clipboard doc with shapes, bound text and an arrow", () => {
    const data = JSON.parse(excalidrawFromGraph(GRAPH, seqIds()));
    expect(data.type).toBe("excalidraw/clipboard");
    const shapes = data.elements.filter((e: any) => ["rectangle", "ellipse", "diamond"].includes(e.type));
    expect(shapes.map((s: any) => s.type)).toEqual(["rectangle", "diamond"]);
    const arrow = data.elements.find((e: any) => e.type === "arrow");
    expect(arrow.startBinding.elementId).toBe(shapes[0].id);
    expect(arrow.endBinding.elementId).toBe(shapes[1].id);
    expect(arrow.endArrowhead).toBe("arrow");
    // the source shape references both the arrow and its label text
    expect(shapes[0].boundElements.some((b: any) => b.type === "arrow")).toBe(true);
    expect(shapes[0].boundElements.some((b: any) => b.type === "text")).toBe(true);
  });

  it("maps colors to hex and binds label text to its container", () => {
    const data = JSON.parse(excalidrawFromGraph(GRAPH, seqIds()));
    const a = data.elements.find((e: any) => e.type === "rectangle");
    expect(a.backgroundColor).toBe("#ececff");
    expect(a.strokeColor).toBe("#9370db");
    const text = data.elements.find((e: any) => e.type === "text" && e.text === "Alpha");
    expect(text.containerId).toBe(a.id);
  });
});
