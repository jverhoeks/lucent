import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/render";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
  });
  it("highlights fenced code", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("hljs");
    expect(html).toContain("language-js");
  });
  it("renders tables", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
  });
  it("renders task lists as list items", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain("<li");
  });
  it("does NOT pass through raw HTML/script", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
  });
});
