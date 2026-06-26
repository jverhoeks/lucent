import { describe, it, expect, vi } from "vitest";
import { LogSearchProvider } from "../src/search/log-provider";
import { SearchController } from "../src/search/controller";

function fakeView() {
  return {
    scrolled: [] as number[],
    highlighted: null as number | null,
    scrollToLine(i: number) { this.scrolled.push(i); },
    highlightLine(line: number | null) { this.highlighted = line; },
    rowEl(_i: number) { return null as HTMLElement | null; },
  };
}

describe("LogSearchProvider", () => {
  it("resolves matches async and notifies once per new query (no re-search loop)", async () => {
    const view = fakeView();
    const search = vi.fn(async (_q) => [2, 5, 9]);
    const onUpdate = vi.fn();
    const p = new LogSearchProvider(view as any, search, onUpdate);
    const q = { text: "x", caseSensitive: false, regex: false };
    expect(p.find(q)).toEqual([]);              // async pending → empty for now
    await Promise.resolve(); await Promise.resolve();
    expect(onUpdate).toHaveBeenCalledTimes(1);  // results arrived → notified
    expect(p.find(q).length).toBe(3);           // re-find returns the cache
    expect(search).toHaveBeenCalledTimes(1);    // SAME query → not re-run (no loop)
  });

  it("reveal scrolls the view to the matched line number and highlights it", async () => {
    const view = fakeView();
    const p = new LogSearchProvider(view as any, async () => [7, 42], () => {});
    p.find({ text: "x", caseSensitive: false, regex: false });
    await Promise.resolve(); await Promise.resolve();
    p.reveal(1);
    expect(view.scrolled.at(-1)).toBe(42);
    expect(view.highlighted).toBe(42);
  });

  it("empty query clears without searching", () => {
    const search = vi.fn();
    const p = new LogSearchProvider(fakeView() as any, search as any, () => {});
    expect(p.find({ text: "", caseSensitive: false, regex: false })).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("integrates with SearchController: no re-search loop, matches surface correctly", async () => {
    const view = fakeView();
    const backendSearch = vi.fn(async () => [2, 5, 9]);
    const c = new SearchController();
    const p = new LogSearchProvider(view as any, backendSearch, () => c.refresh());
    c.setProvider(p);
    c.setQuery({ text: "x", caseSensitive: false, regex: false });
    await Promise.resolve(); await Promise.resolve();
    expect(backendSearch).toHaveBeenCalledTimes(1); // no loop
    expect(c.count()).toBe(3);                       // matches surfaced
  });
});
