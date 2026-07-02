import { describe, expect, it, vi } from "vitest";
import { DocumentOutline, extractOutline } from "../src/outline";

describe("document outline", () => {
  it("extracts heading IDs, levels, and text", () => {
    const article = document.createElement("article");
    article.innerHTML = '<h1 id="one">One</h1><p>x</p><h3 id="deep">Deep <em>heading</em></h3>';
    expect(extractOutline(article)).toEqual([
      { id: "one", level: 1, label: "One" },
      { id: "deep", level: 3, label: "Deep heading" },
    ]);
  });

  it("shows navigation for a rendered document and scrolls to a heading", () => {
    const root = document.createElement("aside");
    root.innerHTML = "<nav></nav>";
    const content = document.createElement("main");
    content.innerHTML = '<article class="doc"><h2 id="target">Target</h2></article>';
    const heading = content.querySelector("h2") as HTMLElement;
    heading.scrollIntoView = vi.fn();
    const outline = new DocumentOutline(root, content);

    outline.refresh(true);
    expect(root.hidden).toBe(false);
    expect(root.querySelector("button")?.textContent).toBe("Target");
    root.querySelector("button")?.click();
    expect(heading.scrollIntoView).toHaveBeenCalledOnce();
  });
});
