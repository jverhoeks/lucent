import { describe, it, expect } from "vitest";
import { visibleRange } from "../src/logs/virtual-log-view";

describe("visibleRange", () => {
  it("computes [start,count] with overscan, clamped to the file", () => {
    // ROW_H=20, viewport=200 → 10 rows visible; overscan=5
    expect(visibleRange({ scrollTop: 0, viewportH: 200, rowH: 20, lineCount: 1000, overscan: 5 }))
      .toEqual({ start: 0, count: 20 }); // 0..(10+2*5)
    const r = visibleRange({ scrollTop: 2000, viewportH: 200, rowH: 20, lineCount: 1000, overscan: 5 });
    expect(r.start).toBe(95); // floor(2000/20) - 5
    expect(r.start + r.count).toBeLessThanOrEqual(1000);
  });
  it("never returns a negative start or exceeds lineCount", () => {
    expect(visibleRange({ scrollTop: 0, viewportH: 100, rowH: 20, lineCount: 3, overscan: 5 }))
      .toEqual({ start: 0, count: 3 });
  });
});
