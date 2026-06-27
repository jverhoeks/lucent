import { describe, it, expect } from "vitest";
import { buildStandaloneHtml } from "../src/export";

describe("buildStandaloneHtml", () => {
  it("wraps body html in a full document with inline css", () => {
    const html = buildStandaloneHtml("<h1>Hello</h1>");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Markdown export</title>");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("katex.min.css");
    expect(html).toContain("<style>");
  });

  it("includes print auto-trigger script when autoPrint is true", () => {
    const html = buildStandaloneHtml("<p>test</p>", true);
    expect(html).toContain("window.print()");
  });

  it("omits print script when autoPrint is false", () => {
    const html = buildStandaloneHtml("<p>test</p>", false);
    expect(html).not.toContain("window.print()");
  });

  it("sets light theme and sans font on the content element", () => {
    const html = buildStandaloneHtml("<p>x</p>");
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('data-font="sans"');
  });

  it("defaults autoPrint to false", () => {
    const html = buildStandaloneHtml("<p>x</p>");
    expect(html).not.toContain("window.print()");
  });
});
