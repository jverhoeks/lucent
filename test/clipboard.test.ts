import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyAsMarkdown, copyAsRichText } from "../src/clipboard";

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
});
