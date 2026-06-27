import type { Format, Mode, SearchProvider, SearchQuery } from "../types";
import type { TreeView } from "../data/tree";
import type { VirtualLogView } from "../logs/virtual-log-view";
import { DomSearchProvider } from "./dom-provider";
import { TreeSearchProvider } from "./tree-provider";
import { LogSearchProvider } from "./log-provider";
import { searchLogLines } from "../logs/log-search";

/** Everything the factory needs to pick a provider, gathered by the caller (the
 *  composition root) so the routing logic itself stays free of module globals,
 *  `invoke`, and TabManager — and is unit-testable in isolation. */
export interface SearchContext {
  format: Format | undefined;
  mode: Mode | undefined;
  /** Active tab is a huge windowed log (backend-indexed search). */
  windowed: boolean;
  /** The rendered content root (DOM-search fallback target). */
  content: HTMLElement;
  /** The active VirtualLogView (backend-windowed OR large in-memory log). */
  virtualLogView: VirtualLogView | null;
  /** In-memory lines backing a large rendered log (null for backend-windowed). */
  logLines: string[] | null;
  /** Active document path, needed to key the backend log search. */
  path: string | undefined;
  /** The active data tree, when one is rendered. */
  tree: TreeView | null;
  /** Backend log search for the windowed path. */
  logSearch: (path: string, q: SearchQuery) => Promise<number[]>;
  /** Called when an async (windowed) search resolves, to re-drive the controller. */
  onUpdate: () => void;
}

/**
 * Choose the SearchProvider for the active document:
 *  - windowed log (with a live view + path) → async backend LogSearchProvider;
 *  - rendered data with a tree → TreeSearchProvider (falls back to DOM if the
 *    tree isn't available);
 *  - everything else → DomSearchProvider over the rendered content.
 */
export function createSearchProvider(ctx: SearchContext): SearchProvider {
  // Any virtualized log (backend-windowed OR large in-memory) searches its full
  // model, not the windowed DOM: backend logs query Rust; in-memory logs scan
  // the line array synchronously. Both reveal via the VirtualLogView.
  if (ctx.virtualLogView) {
    const view = ctx.virtualLogView;
    const lines = ctx.logLines;
    const path = ctx.path;
    const runSearch =
      ctx.windowed && path
        ? (q: SearchQuery) => ctx.logSearch(path, q)
        : (q: SearchQuery) => Promise.resolve(searchLogLines(lines ?? [], q));
    return new LogSearchProvider(view, runSearch, ctx.onUpdate);
  }
  if ((ctx.mode === "rendered" || ctx.mode === "edit") && ctx.format === "data") {
    return ctx.tree ? new TreeSearchProvider(ctx.tree) : new DomSearchProvider(ctx.content);
  }
  return new DomSearchProvider(ctx.content);
}
