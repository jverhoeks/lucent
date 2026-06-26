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

  it("incrementally drops the front on ring-buffer eviction (reuses surviving rows)", () => {
    const c = mk();
    const v = renderLog("a\nb\nc", c, { theme: "light" });
    const rowB = c.querySelectorAll(".log-line")[1]; // the 'b' row, must survive
    v.setLines(["b", "c", "d"]); // 'a' evicted from front, 'd' appended
    const rows = [...c.querySelectorAll(".log-line")];
    expect(rows.map((r) => r.querySelector(".log-msg")!.textContent)).toEqual(["b", "c", "d"]);
    expect(rows[0]).toBe(rowB); // survivor reused, not torn down + recreated
    // gutters renumbered to the new positions
    expect([...c.querySelectorAll(".log-gutter")].map((g) => g.textContent)).toEqual(["1", "2", "3"]);
  });

  it("full-rebuilds when there is no front overlap", () => {
    const c = mk();
    const v = renderLog("a\nb\nc", c, { theme: "light" });
    const rowA = c.querySelector(".log-line");
    v.setLines(["x", "y", "z"]); // nothing in common → safe full rebuild
    const texts = [...c.querySelectorAll(".log-msg")].map((e) => e.textContent);
    expect(texts).toEqual(["x", "y", "z"]);
    expect(c.querySelector(".log-line")).not.toBe(rowA); // genuinely rebuilt
  });

  it("lineCount tracks rendered lines", () => {
    const c = mk();
    const v = renderLog("a\nb", c, { theme: "light" });
    v.setLines(["a", "b", "c"]);
    expect(v.lineCount()).toBe(3);
  });
});
