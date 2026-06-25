import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/render";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Title")).toContain("Title");
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
  it("does NOT pass through raw HTML/script", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
  });

  // ---- Phase 2: rich rendering plugins ----
  it("renders GFM task lists as checkboxes", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });
  it("renders footnotes", () => {
    const html = renderMarkdown("Here[^1]\n\n[^1]: the note");
    expect(html).toContain("footnote");
  });
  it("renders emoji shortcodes", () => {
    const html = renderMarkdown("good :smile:");
    expect(html).not.toContain(":smile:");
  });
  it("renders KaTeX math", () => {
    const html = renderMarkdown("$E = mc^2$");
    expect(html).toContain("katex");
  });
  it("renders custom containers", () => {
    const html = renderMarkdown("::: note\nheads up\n:::");
    expect(html).toContain('class="note"');
  });
  it("adds a code header with filename and a copy button", () => {
    const html = renderMarkdown('```js title="app.js"\nconst x = 1;\n```');
    expect(html).toContain("code-block");
    expect(html).toContain("code-copy");
    expect(html).toContain("app.js");
  });
  it("supports the lang:filename info form", () => {
    const html = renderMarkdown("```python:main.py\nprint(1)\n```");
    expect(html).toContain("main.py");
    expect(html).toContain("language-python");
  });
  it("emits a line-number gutter", () => {
    const html = renderMarkdown("```\nalpha\nbeta\ngamma\n```");
    expect(html).toContain("ln-gutter");
  });
  it("wraps mermaid fences for the post-render pass", () => {
    const html = renderMarkdown("```mermaid\ngraph TD; A-->B;\n```");
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("graph TD");
  });
});
