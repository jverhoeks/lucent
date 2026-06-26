import { describe, it, expect, vi } from "vitest";

// Mermaid pokes the layout engine (getBBox etc.) which jsdom lacks, so we mock
// the module to a no-op async `run`. These tests verify the render LIFECYCLE
// contract (A4/B1/B5), not mermaid's SVG output.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn(async () => {}),
  },
}));

import { markdownRenderer } from "../src/renderers/markdown";

const MERMAID_DOC = "```mermaid\ngraph TD; A-->B;\n```";

describe("markdownRenderer lifecycle (A4/B1/B5)", () => {
  it("returns a Promise (the awaitable post-render lifecycle)", async () => {
    const c = document.createElement("div");
    const result = markdownRenderer.render(MERMAID_DOC, c, { theme: "light" });
    expect(result).toBeInstanceOf(Promise);
    await result; // resolves cleanly
  });

  it("hides the raw mermaid source synchronously, before the async run (no flash)", () => {
    const c = document.createElement("div");
    // Do NOT await: between the innerHTML set and mermaid.run's first await, the
    // placeholder must already be hidden so it can't paint as a flash.
    markdownRenderer.render(MERMAID_DOC, c, { theme: "light" });
    const pre = c.querySelector("pre.mermaid") as HTMLElement;
    expect(pre).toBeTruthy();
    expect(pre.style.visibility).toBe("hidden");
  });

  it("reveals mermaid blocks once rendering settles (never permanently hidden)", async () => {
    const c = document.createElement("div");
    await markdownRenderer.render(MERMAID_DOC, c, { theme: "light" });
    const pre = c.querySelector("pre.mermaid") as HTMLElement;
    expect(pre.style.visibility).toBe(""); // revealed in the finally
  });

  it("resolves and paints plain markdown with no mermaid involvement", async () => {
    const c = document.createElement("div");
    await markdownRenderer.render("# Hi", c, { theme: "light" });
    expect(c.querySelector("h1")?.textContent).toContain("Hi");
    expect(c.querySelector("pre.mermaid")).toBeNull();
  });
});
