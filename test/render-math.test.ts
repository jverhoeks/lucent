import { describe, it, expect } from "vitest";
import { renderMarkdown, renderMath, hasMath } from "../src/render";

describe("lazy math rendering (KaTeX code-split)", () => {
  it("hasMath detects paired $…$, $$…$$, and bare \\begin{} environments", () => {
    expect(hasMath("inline $E=mc^2$ here")).toBe(true);
    expect(hasMath("$$\n a=b \n$$")).toBe(true);
    expect(hasMath("\\begin{align} x &= y \\end{align}")).toBe(true); // no `$` at all
  });

  it("hasMath is false for prose without math", () => {
    expect(hasMath("just regular text, no formulae")).toBe(false);
    expect(hasMath("a lone $ sign")).toBe(false); // single $ → not paired
  });

  it("renderMath produces katex markup (the lazy path) while base render does not", async () => {
    expect(await renderMarkdown("$E = mc^2$")).not.toContain("katex");
    const html = await renderMath("$E = mc^2$");
    expect(html).toContain("katex"); // real katex.renderToString is pure → works in jsdom
  });

  it("renderMath still renders ordinary Markdown around the math", async () => {
    const html = await renderMath("# Title\n\nText with $a^2$.");
    expect(html).toContain("Title");
    expect(html).toContain("katex");
  });
});
