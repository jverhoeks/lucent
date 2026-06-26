import { describe, it, expect } from "vitest";
import { renderMarkdown, splitHighlightedLines } from "../src/render";

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
  it("renders one numbered row per source line", () => {
    const html = renderMarkdown("```\nalpha\nbeta\ngamma\n```");
    expect(html).toContain('data-line="1"');
    expect(html).toContain('data-line="2"');
    expect(html).toContain('data-line="3"');
    expect(html).not.toContain('data-line="4"'); // trailing newline not a line
    expect((html.match(/class="ln"/g) || []).length).toBe(3);
  });
  it("stores exact source (blank lines intact) in data-src", () => {
    const html = renderMarkdown("```\na\n\nb\n```");
    expect(html).toContain('data-src="a\n\nb');
  });
  it("offers line-number, copy, and save buttons on code blocks", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("code-lines");
    expect(html).toContain("code-copy");
    expect(html).toContain("code-save");
  });
  it("sanitizes a malicious fence info string (no HTML injection)", () => {
    const html = renderMarkdown('```js"><img src=x onerror=alert(1)>\nx\n```');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    // the language token is reduced to a safe class, not raw markup
    expect(html).toContain("language-jsimg");
  });
  it("wraps mermaid fences for the post-render pass", () => {
    const html = renderMarkdown("```mermaid\ngraph TD; A-->B;\n```");
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
    // A span opened on line 1 and closed on line 2 must be closed/reopened.
    const input = '<span class="c">line1\nline2</span>';
    const out = splitHighlightedLines(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('<span class="c">line1</span>');
    expect(out[1]).toBe('<span class="c">line2</span>');
  });
});
