import { describe, it, expect } from "vitest";
import { createSearchProvider, type SearchContext } from "../src/search/factory";
import { DomSearchProvider } from "../src/search/dom-provider";
import { TreeSearchProvider } from "../src/search/tree-provider";
import { LogSearchProvider } from "../src/search/log-provider";
import type { TreeView } from "../src/data/tree";
import type { VirtualLogView } from "../src/logs/virtual-log-view";

// Providers only stash their args in the constructor, so opaque stubs are enough
// to assert routing — we're testing which provider the factory PICKS, not its behavior.
function ctx(over: Partial<SearchContext>): SearchContext {
  return {
    format: undefined,
    mode: undefined,
    windowed: false,
    content: document.createElement("div"),
    virtualLogView: null,
    logLines: null,
    path: undefined,
    tree: null,
    logSearch: async () => [],
    onUpdate: () => {},
    ...over,
  };
}

describe("createSearchProvider routing", () => {
  it("windowed log with a live view + path → LogSearchProvider", () => {
    const p = createSearchProvider(ctx({
      windowed: true,
      virtualLogView: {} as VirtualLogView,
      path: "/huge.log",
      format: "log",
    }));
    expect(p).toBeInstanceOf(LogSearchProvider);
  });

  it("windowed but no view yet → falls through to DomSearchProvider", () => {
    const p = createSearchProvider(ctx({ windowed: true, virtualLogView: null, path: "/huge.log" }));
    expect(p).toBeInstanceOf(DomSearchProvider);
  });

  it("large in-memory log (virtual view, not windowed) → LogSearchProvider", () => {
    const p = createSearchProvider(ctx({
      windowed: false,
      virtualLogView: {} as VirtualLogView,
      logLines: ["line a", "line b"],
      format: "log",
    }));
    expect(p).toBeInstanceOf(LogSearchProvider);
  });

  it("rendered data with a tree → TreeSearchProvider", () => {
    const p = createSearchProvider(ctx({ mode: "rendered", format: "data", tree: {} as TreeView }));
    expect(p).toBeInstanceOf(TreeSearchProvider);
  });

  it("rendered data without a tree → DomSearchProvider", () => {
    const p = createSearchProvider(ctx({ mode: "rendered", format: "data", tree: null }));
    expect(p).toBeInstanceOf(DomSearchProvider);
  });

  it("rendered markdown → DomSearchProvider", () => {
    const p = createSearchProvider(ctx({ mode: "rendered", format: "markdown" }));
    expect(p).toBeInstanceOf(DomSearchProvider);
  });

  it("raw data (not rendered) → DomSearchProvider, not Tree", () => {
    const p = createSearchProvider(ctx({ mode: "raw", format: "data", tree: {} as TreeView }));
    expect(p).toBeInstanceOf(DomSearchProvider);
  });
});
