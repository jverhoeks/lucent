import { describe, it, expect } from "vitest";
import { visibleRange, needsRefetch } from "../src/logs/virtual-log-view";

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

describe("needsRefetch", () => {
  const margin = 20; // half = 10
  const lineCount = 1000;

  it("refetches when nothing is rendered yet", () => {
    expect(needsRefetch({ start: 100, end: 110 }, null, margin, lineCount)).toBe(true);
  });

  it("renders nothing while the viewport stays well inside the block", () => {
    // block [80,140); viewport [100,110) is > margin/2 from both edges
    expect(needsRefetch({ start: 100, end: 110 }, { start: 80, end: 140 }, margin, lineCount))
      .toBe(false);
  });

  it("refetches when scrolled within margin/2 of the bottom edge", () => {
    // block ends at 140, half=10 → trigger once visible.end > 130
    expect(needsRefetch({ start: 125, end: 135 }, { start: 80, end: 140 }, margin, lineCount))
      .toBe(true);
  });

  it("refetches when scrolled within margin/2 of the top edge", () => {
    // block starts at 80, half=10 → trigger once visible.start < 90
    expect(needsRefetch({ start: 85, end: 95 }, { start: 80, end: 140 }, margin, lineCount))
      .toBe(true);
  });

  it("does not refetch at a top edge that is already line 0", () => {
    expect(needsRefetch({ start: 0, end: 10 }, { start: 0, end: 60 }, margin, lineCount))
      .toBe(false);
  });

  it("does not refetch at a bottom edge that is already the last line", () => {
    // block.end === lineCount, so there is nothing more to load below
    expect(needsRefetch({ start: 90, end: 100 }, { start: 40, end: 100 }, margin, 100))
      .toBe(false);
  });
});
