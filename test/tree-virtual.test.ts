import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderTree, TreeView } from "../src/data/tree";
import { TreeSearchProvider } from "../src/search/tree-provider";
import type { DataValue } from "../src/types";

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** A flat object of `n` numeric entries — enough rows to exceed a small threshold. */
function bigData(n: number): DataValue {
  const entries = [];
  for (let i = 0; i < n; i++) {
    entries.push({ key: `k${i}`, path: `root.k${i}`, value: { kind: "scalar", type: "number", text: String(i) } as DataValue });
  }
  return { kind: "object", entries };
}

// A collapsed-deep value used to exercise reveal in virtual mode.
const nested: DataValue = {
  kind: "object",
  entries: [
    { key: "a", path: "root.a", value: { kind: "object", entries: [
      { key: "target", path: "root.a.target", value: { kind: "scalar", type: "string", text: "needle" } },
    ] } },
    { key: "b", path: "root.b", value: { kind: "scalar", type: "string", text: "other" } },
  ],
};

describe("TreeView virtual mode", () => {
  let root: HTMLElement;
  let tree: TreeView | null = null;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { tree?.destroy(); tree = null; root.remove(); });

  it("stays nested below the threshold (no virtual scaffolding)", () => {
    tree = renderTree(bigData(5), root, { virtualizeThreshold: 1000 });
    expect(root.classList.contains("tree-virtual")).toBe(false);
    expect(root.querySelector(".tree-sizer")).toBeNull();
    expect(root.querySelectorAll(".tree-row").length).toBe(5); // all rendered
  });

  it("virtualizes above the threshold: only a window of rows is in the DOM", async () => {
    tree = renderTree(bigData(200), root, { defaultDepth: 1, virtualizeThreshold: 10 });
    expect(root.classList.contains("tree-virtual")).toBe(true);
    expect(root.querySelector(".tree-sizer")).toBeTruthy();
    await raf(); // initial paint is deferred a frame to measure row height
    const rendered = root.querySelectorAll(".tree-row").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(200); // windowed — not every row materialized
    expect(tree.nodes().length).toBe(200); // model stays complete regardless
  });

  it("reveal materializes a collapsed deep row and marks it (model-based search)", () => {
    tree = renderTree(nested, root, { virtualizeThreshold: 1 }); // force virtual
    expect(root.classList.contains("tree-virtual")).toBe(true);
    tree.collapseAll();
    expect(root.querySelector('[data-path="root.a.target"]')).toBeNull(); // collapsed → not in window

    const p = new TreeSearchProvider(tree);
    const matches = p.find({ text: "needle", caseSensitive: false, regex: false });
    expect(matches.length).toBe(1); // found in the model even while collapsed
    p.reveal(matches[0].id);

    const row = root.querySelector('[data-path="root.a.target"]');
    expect(row).toBeTruthy(); // expanded + windowed into the DOM
    expect(row?.classList.contains("search-current")).toBe(true);
  });

  it("clear() removes the current-hit marker", () => {
    tree = renderTree(nested, root, { virtualizeThreshold: 1 });
    const p = new TreeSearchProvider(tree);
    const m = p.find({ text: "needle", caseSensitive: false, regex: false });
    p.reveal(m[0].id);
    expect(root.querySelector(".search-current")).toBeTruthy();
    p.clear();
    expect(root.querySelector(".search-current")).toBeNull();
  });

  it("expandToPath/collapseAll recompute the visible window", () => {
    tree = renderTree(nested, root, { virtualizeThreshold: 1 });
    tree.collapseAll();
    expect(root.querySelector('[data-path="root.a.target"]')).toBeNull();
    tree.expandToPath("root.a.target");
    expect(root.querySelector('[data-path="root.a"]')).toBeTruthy();
    expect(root.querySelector('[data-path="root.a.target"]')).toBeTruthy();
  });
});
