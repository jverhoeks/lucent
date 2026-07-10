import { describe, it, expect, vi, beforeEach } from "vitest";

// Simulate mermaid: `run({nodes})` records each rendered source and replaces the
// node's content with an <svg>, exactly as the real library does. Lets us assert
// which diagrams actually went through the (expensive) render vs. the cache.
let rendered: string[] = [];
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn(async ({ nodes }: { nodes: HTMLElement[] }) => {
      for (const n of nodes) {
        rendered.push(n.textContent ?? "");
        n.innerHTML = `<svg data-fake="1"><g></g></svg>`;
      }
    }),
  },
}));

import { runPostRender } from "../src/render";
import type { Theme } from "../src/types";

/** A container holding `pre.mermaid` blocks, each pre-hidden the way
 *  markdown.ts hides them before runPostRender reveals them. */
function mermaidDoc(...sources: string[]): HTMLElement {
  const c = document.createElement("div");
  for (const src of sources) {
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    pre.textContent = src;
    pre.style.visibility = "hidden";
    c.appendChild(pre);
  }
  return c;
}

const pres = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>("pre.mermaid"));

describe("mermaid SVG cache (#90)", () => {
  beforeEach(() => { rendered = []; });

  it("reuses a cached diagram on re-render — skips mermaid.run and reveals it", async () => {
    const src = "graph TD; A-->B; reuse-test";
    await runPostRender(mermaidDoc(src), "light");
    expect(rendered).toEqual([src]); // rendered once

    const c2 = mermaidDoc(src);
    await runPostRender(c2, "light");
    expect(rendered).toEqual([src]); // NOT rendered again — served from cache

    const pre = pres(c2)[0];
    expect(pre.querySelector("svg")).toBeTruthy();      // svg injected from cache
    expect(pre.style.visibility).not.toBe("hidden");    // and revealed (not left blank)
    expect(pre.dataset.mermaidSrc).toBe(src);           // source is still available for toolbar actions
  });

  it("adds source, edit, and export-all actions to rendered diagrams", async () => {
    const c = mermaidDoc("graph TD; A-->B;");
    await runPostRender(c, "light");

    const kinds = Array.from(c.querySelectorAll<HTMLElement>(".mermaid-btn")).map((btn) => btn.dataset.kind);
    expect(kinds).toEqual(expect.arrayContaining(["src", "edit", "all", "dio", "luc"]));
  });

  it("re-renders when the theme changes (theme is part of the key)", async () => {
    const src = "graph TD; theme-test";
    await runPostRender(mermaidDoc(src), "light" as Theme);
    await runPostRender(mermaidDoc(src), "dark" as Theme);
    expect(rendered).toEqual([src, src]); // once per theme
  });

  it("re-renders only the changed diagram; unchanged siblings come from cache", async () => {
    const a1 = "graph TD; A-first";
    const b = "graph TD; B-stable";
    await runPostRender(mermaidDoc(a1, b), "light");
    expect(rendered).toEqual([a1, b]);

    rendered = [];
    const a2 = "graph TD; A-edited";
    await runPostRender(mermaidDoc(a2, b), "light");
    expect(rendered).toEqual([a2]); // only the edited diagram re-runs; b is cached
  });

  it("renders duplicate same-source diagrams in one pass rather than injecting a shared clone", async () => {
    const src = "graph TD; dup";
    const c = mermaidDoc(src, src);
    await runPostRender(c, "light");
    // Both go through mermaid.run in the first pass (mermaid assigns unique ids);
    // the cache only reuses across separate renders, never a shared-id clone.
    expect(rendered).toEqual([src, src]);
    for (const p of pres(c)) expect(p.style.visibility).not.toBe("hidden");
  });
});
