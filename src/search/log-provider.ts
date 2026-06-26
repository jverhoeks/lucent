import type { SearchProvider, SearchQuery, Match } from "../types";

interface ScrollTarget {
  scrollToLine(line: number): void;
  rowEl(line: number): HTMLElement | null;
}

/** Search a windowed log over the backend index. `find` is synchronous per the
 *  SearchProvider contract, but the backend search is async — so find() kicks the
 *  search for a NEW query and returns the cached results; when results arrive it
 *  calls onUpdate() (wired to controller.refresh()), and the controller's
 *  re-find() returns the now-populated cache. Same query key → no re-search,
 *  so there is no refresh→find→search loop.
 *
 *  IMPORTANT: clear() only removes decorations; it does NOT reset the cache or
 *  lastKey. This is intentional: SearchController calls clear() then find() on
 *  every refresh(). If clear() nuked the cache, refresh()→clear()→find() would
 *  see a new key → kick another async search → resolve → onUpdate → refresh → ...
 *  infinite loop. Cache reset happens only when the query text changes (in find). */
export class LogSearchProvider implements SearchProvider {
  private lineNos: number[] = [];
  private lastKey: string | null = null;
  constructor(
    private view: ScrollTarget,
    private runSearch: (q: SearchQuery) => Promise<number[]>,
    private onUpdate: () => void,
  ) {}

  find(q: SearchQuery): Match[] {
    if (!q.text) { this.lastKey = null; this.lineNos = []; return []; }
    const key = `${q.caseSensitive}|${q.regex}|${q.text}`;
    if (key === this.lastKey) return this.lineNos.map((_, i) => ({ id: i })); // cached
    this.lastKey = key;
    this.lineNos = [];
    void this.runSearch(q).then((nums) => {
      if (this.lastKey !== key) return; // a newer query superseded this one
      this.lineNos = nums;
      this.onUpdate();
    });
    return []; // pending; populated on the onUpdate-triggered re-find
  }

  reveal(id: number): void {
    const line = this.lineNos[id];
    if (line === undefined) return;
    this.clearCurrent();
    this.view.scrollToLine(line);
    this.view.rowEl(line)?.classList.add("search-current");
  }

  private clearCurrent(): void {
    for (const ln of this.lineNos) this.view.rowEl(ln)?.classList.remove("search-current");
  }

  /** Removes highlight decorations only. Does NOT reset the search cache or
   *  lastKey — see class comment for why this matters. */
  clear(): void { this.clearCurrent(); }
}
