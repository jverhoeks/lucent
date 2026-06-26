import type { Format, SearchProvider, SearchQuery } from "../types";
import type { TreeView } from "../data/tree";
import type { VirtualLogView } from "../logs/virtual-log-view";
import { DomSearchProvider } from "./dom-provider";
import { TreeSearchProvider } from "./tree-provider";
import { LogSearchProvider } from "./log-provider";

/** Everything the factory needs to pick a provider, gathered by the caller (the
 *  composition root) so the routing logic itself stays free of module globals,
 *  `invoke`, and TabManager — and is unit-testable in isolation. */
export interface SearchContext {
  format: Format | undefined;
  mode: "rendered" | "raw" | undefined;
  /** Active tab is a huge windowed log (backend-indexed search). */
  windowed: boolean;
  /** The rendered content root (DOM-search fallback target). */
  content: HTMLElement;
  /** The active VirtualLogView, for windowed-log reveal/scroll. */
  virtualLogView: VirtualLogView | null;
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
  if (ctx.windowed && ctx.virtualLogView && ctx.path) {
    const path = ctx.path;
    return new LogSearchProvider(
      ctx.virtualLogView,
      (q) => ctx.logSearch(path, q),
      ctx.onUpdate,
    );
  }
  if (ctx.mode === "rendered" && ctx.format === "data") {
    return ctx.tree ? new TreeSearchProvider(ctx.tree) : new DomSearchProvider(ctx.content);
  }
  return new DomSearchProvider(ctx.content);
}
