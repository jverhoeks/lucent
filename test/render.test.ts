import { describe, it, expect } from "vitest";
import { renderMarkdown, splitHighlightedLines } from "../src/render";

describe("renderMarkdown", () => {
  it("renders headings", async () => {
    expect(await renderMarkdown("# Title")).toContain("Title");
  });
  it("highlights fenced code", async () => {
    const html = await renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("hljs");
    expect(html).toContain("language-js");
  });
  it("renders tables", async () => {
    const html = await renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
  });
  it("does NOT pass through raw HTML/script", async () => {
    const html = await renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
  });

  it("renders GFM task lists as checkboxes", async () => {
    const html = await renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });
  it("renders footnotes", async () => {
    const html = await renderMarkdown("Here[^1]\n\n[^1]: the note");
    expect(html).toContain("footnote");
  });
  it("renders emoji shortcodes", async () => {
    const html = await renderMarkdown("good :smile:");
    expect(html).not.toContain(":smile:");
  });
  it("leaves math untouched in the synchronous base render (katex is lazy)", async () => {
    expect(await renderMarkdown("$E = mc^2$")).not.toContain("katex");
  });
  it("renders custom containers", async () => {
    const html = await renderMarkdown("::: note\nheads up\n:::");
    expect(html).toContain('class="note"');
  });
  it("adds a code header with filename and a copy button", async () => {
    const html = await renderMarkdown('```js title="app.js"\nconst x = 1;\n```');
    expect(html).toContain("code-block");
    expect(html).toContain("code-copy");
    expect(html).toContain("app.js");
  });
  it("supports the lang:filename info form", async () => {
    const html = await renderMarkdown("```python:main.py\nprint(1)\n```");
    expect(html).toContain("main.py");
    expect(html).toContain("language-python");
  });
  it("renders one numbered row per source line", async () => {
    const html = await renderMarkdown("```\nalpha\nbeta\ngamma\n```");
    expect(html).toContain('data-line="1"');
    expect(html).toContain('data-line="2"');
    expect(html).toContain('data-line="3"');
    expect(html).not.toContain('data-line="4"'); // trailing newline not a line
    expect((html.match(/class="ln"/g) || []).length).toBe(3);
  });
  it("stores exact source (blank lines intact) in data-src", async () => {
    const html = await renderMarkdown("```\na\n\nb\n```");
    expect(html).toContain('data-src="a\n\nb');
  });
  it("offers line-number, copy, and save buttons on code blocks", async () => {
    const html = await renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("code-lines");
    expect(html).toContain("code-copy");
    expect(html).toContain("code-save");
  });
  it("sanitizes a malicious fence info string (no HTML injection)", async () => {
    const html = await renderMarkdown('```js"><img src=x onerror=alert(1)>\nx\n```');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).toContain("language-jsimg");
  });
  it("wraps mermaid fences for the post-render pass", async () => {
    const html = await renderMarkdown("```mermaid\ngraph TD; A-->B;\n```");
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("graph TD");
  });
});

describe("splitHighlightedLines", () => {
  it("splits plain lines", () => {
    expect(splitHighlightedLines("a\nb\nc")).toEqual(["a", "b", "c"]);
  });
  it("returns no rows for an empty code block", () => {
    expect(splitHighlightedLines("")).toEqual([]);
  });
  it("re-balances spans that straddle a newline", () => {
    const input = '<span class="c">line1\nline2</span>';
    const out = splitHighlightedLines(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('<span class="c">line1</span>');
    expect(out[1]).toBe('<span class="c">line2</span>');
  });
});
