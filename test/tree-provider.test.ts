import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderTree } from "../src/data/tree";
import { TreeSearchProvider } from "../src/search/tree-provider";
import type { DataValue } from "../src/types";

const data: DataValue = {
  kind: "object",
  entries: [
    { key: "alpha", path: "root.alpha", value: { kind: "scalar", type: "string", text: "find-me" } },
    {
      key: "beta",
      path: "root.beta",
      value: {
        kind: "object",
        entries: [
          { key: "alpha2", path: "root.beta.alpha2", value: { kind: "scalar", type: "string", text: "deep find-me" } },
        ],
      },
    },
  ],
};

describe("TreeSearchProvider", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => root.remove());

  it("finds matches in keys and values across collapsed branches", () => {
    const tree = renderTree(data, root, { defaultDepth: 1 });
    tree.collapseAll();
    const p = new TreeSearchProvider(tree);
    // "alpha" matches key root.alpha AND key root.beta.alpha2 (collapsed)
    expect(p.find({ text: "alpha", caseSensitive: false, regex: false }).length).toBe(2);
    // "find-me" matches both scalar values
    expect(p.find({ text: "find-me", caseSensitive: false, regex: false }).length).toBe(2);
  });

  it("reveal expands ancestors so a collapsed match becomes visible", () => {
    const tree = renderTree(data, root, { defaultDepth: 1 });
    tree.collapseAll();
    const p = new TreeSearchProvider(tree);
    const matches = p.find({ text: "deep", caseSensitive: false, regex: false });
    expect(matches.length).toBe(1);
    p.reveal(matches[0].id);
    expect(root.querySelector('[data-path="root.beta.alpha2"]')?.classList.contains("search-current")).toBe(true);
  });

  it("respects case sensitivity and regex", () => {
    const tree = renderTree(data, root, { defaultDepth: 99 });
    const p = new TreeSearchProvider(tree);
    expect(p.find({ text: "ALPHA", caseSensitive: true, regex: false }).length).toBe(0);
    expect(p.find({ text: "alpha\\d", caseSensitive: false, regex: true }).length).toBe(1); // alpha2
  });
});
