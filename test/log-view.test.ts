import { describe, it, expect, beforeEach } from "vitest";
import { renderLog } from "../src/renderers/log";

function mk() {
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

describe("LogView incremental rendering", () => {
  beforeEach(() => document.body.replaceChildren());

  it("renders one row per line with level classes", () => {
    const c = mk();
    renderLog("INFO a\nERROR b", c, { theme: "light" });
    expect(c.querySelectorAll(".log-line").length).toBe(2);
    expect(c.querySelector(".log-line.lvl-error")).toBeTruthy();
  });

  it("drops a single trailing empty line from a final newline", () => {
    const c = mk();
    renderLog("a\nb\n", c, { theme: "light" }); // file ends with newline
    expect(c.querySelectorAll(".log-line").length).toBe(2); // not 3 (no phantom blank)
  });

  it("appends ONLY new rows when lines are extended (no rebuild)", () => {
    const c = mk();
    const v = renderLog("a\nb", c, { theme: "light" });
    const firstRow = c.querySelector(".log-line"); // identity check: must survive
    v.setLines(["a", "b", "c", "d"]);
    expect(c.querySelectorAll(".log-line").length).toBe(4);
    expect(c.querySelector(".log-line")).toBe(firstRow); // original node reused, not rebuilt
  });

  it("full-rebuilds when the front diverges (e.g. ring-cap dropped oldest)", () => {
    const c = mk();
    const v = renderLog("a\nb\nc", c, { theme: "light" });
    v.setLines(["b", "c", "d"]); // 'a' dropped from front → not a prefix
    const texts = [...c.querySelectorAll(".log-msg")].map((e) => e.textContent);
    expect(texts).toEqual(["b", "c", "d"]);
  });

  it("lineCount tracks rendered lines", () => {
    const c = mk();
    const v = renderLog("a\nb", c, { theme: "light" });
    v.setLines(["a", "b", "c"]);
    expect(v.lineCount()).toBe(3);
  });
});
