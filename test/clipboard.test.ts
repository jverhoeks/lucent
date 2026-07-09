import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyAsMarkdown, copyAsRichText, stabilizeInlineSpaces } from "../src/clipboard";

describe("clipboard", () => {
  let written: any[];
  beforeEach(() => {
    written = [];
    // @ts-expect-error test shim for jsdom
    globalThis.ClipboardItem = class {
      constructor(public items: any) {}
    };
    Object.assign(navigator, {
      clipboard: {
        write: vi.fn(async (items: any[]) => {
          written.push(...items);
        }),
        writeText: vi.fn(async (_t: string) => {}),
      },
    });
  });

  it("copies markdown as plain text", async () => {
    await copyAsMarkdown("# Hi");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("# Hi");
  });

  it("copies rich text with html + plain flavors", async () => {
    await copyAsRichText("<h1>Hi</h1>");
    expect(navigator.clipboard.write).toHaveBeenCalled();
    expect(written.length).toBe(1);
    expect(Object.keys(written[0].items)).toContain("text/html");
    expect(Object.keys(written[0].items)).toContain("text/plain");
  });

  it("stabilizes spaces after bold, italic, code, and link boundaries", () => {
    const html = "<p><strong>bold</strong> test <em>italic</em> next <code>x</code> value <a href='#'>link</a> end</p>";
    const stable = stabilizeInlineSpaces(html);
    expect(stable).toContain("</strong>&nbsp;test");
    expect(stable).toContain("</em>&nbsp;next");
    expect(stable).toContain("</code>&nbsp;value");
    expect(stable).toContain("</a>&nbsp;end");
  });

  it("keeps ordinary spaces in the plain-text clipboard flavor", async () => {
    await copyAsRichText("<p><strong>bold</strong> test<br><em>next</em> value</p>");
    const html = await written[0].items["text/html"].text();
    const plain = await written[0].items["text/plain"].text();
    expect(html).toContain("</strong>&nbsp;test");
    expect(plain).toBe("bold test\nnext value");
  });

  it("keeps block boundaries in the plain-text clipboard flavor", async () => {
    await copyAsRichText("<h1>Title</h1><p>First</p><p>Second</p>");
    const plain = await written[0].items["text/plain"].text();
    expect(plain).toBe("Title\nFirst\nSecond");
  });
});
