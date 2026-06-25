import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderTree } from "../src/data/tree";
import type { DataValue } from "../src/types";

const sample: DataValue = {
  kind: "object",
  entries: [
    { key: "name", path: "root.name", value: { kind: "scalar", type: "string", text: "lucent" } },
    {
      key: "nested",
      path: "root.nested",
      value: {
        kind: "object",
        entries: [
          { key: "deep", path: "root.nested.deep", value: { kind: "scalar", type: "number", text: "42" } },
        ],
      },
    },
  ],
};

describe("renderTree / TreeView", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => root.remove());

  it("renders top-level rows with data-path", () => {
    renderTree(sample, root, { defaultDepth: 1 });
    expect(root.querySelector('[data-path="root.name"]')).toBeTruthy();
    expect(root.querySelector('[data-path="root.nested"]')).toBeTruthy();
  });

  it("nodes() enumerates every node regardless of expand state", () => {
    const tree = renderTree(sample, root, { defaultDepth: 1 });
    const paths = tree.nodes().map((n) => n.path);
    expect(paths).toContain("root.nested.deep"); // present in model even if collapsed
    expect(tree.nodes().every(n => n.path !== "root")).toBe(true); // root is excluded per spec
  });

  it("collapsed children are not in the DOM until expanded", () => {
    const tree = renderTree(sample, root, { defaultDepth: 1 });
    tree.collapseAll();
    expect(root.querySelector('[data-path="root.nested.deep"]')).toBeNull();
    tree.expandToPath("root.nested.deep");
    expect(root.querySelector('[data-path="root.nested.deep"]')).toBeTruthy();
  });

  it("rowElement returns the row for a path once visible", () => {
    const tree = renderTree(sample, root, { defaultDepth: 99 });
    expect(tree.rowElement("root.nested.deep")).toBeTruthy();
  });

  it("renders scalar values with a type class", () => {
    renderTree(sample, root, { defaultDepth: 99 });
    const v = root.querySelector('[data-path="root.name"] .tree-value');
    expect(v?.classList.contains("type-string")).toBe(true);
  });

  it("expandAll() expands all containers, making deep nodes visible in the DOM", () => {
    const tree = renderTree(sample, root, { defaultDepth: 1 });
    expect(root.querySelector('[data-path="root.nested.deep"]')).toBeNull(); // collapsed by defaultDepth: 1
    tree.expandAll();
    expect(root.querySelector('[data-path="root.nested.deep"]')).toBeTruthy(); // now expanded
  });
});
