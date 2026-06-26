import { renderLogRow } from "../renderers/log";

/** Fixed row height in pixels — keep in sync with CSS `.vlog-row { height }`. */
export const ROW_H = 20;

// ─── pure windowing math ──────────────────────────────────────────────────────

export interface VisibleRangeOpts {
  scrollTop: number;
  viewportH: number;
  rowH: number;
  lineCount: number;
  overscan: number;
}

export interface VisibleRange {
  start: number;
  count: number;
}

/**
 * Pure helper: given scroll state, return the window of lines that should be
 * rendered (with overscan). Result is clamped so that start ≥ 0 and
 * start + count ≤ lineCount.
 */
export function visibleRange(opts: VisibleRangeOpts): VisibleRange {
  const { scrollTop, viewportH, rowH, lineCount, overscan } = opts;
  const visible = Math.ceil(viewportH / rowH);
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const count = Math.max(0, Math.min(visible + 2 * overscan, lineCount - start));
  return { start, count };
}

/** Half-open range of rendered rows: `[start, end)`. */
export interface Block {
  start: number;
  end: number;
}

/**
 * Pure helper: decide whether the rendered block must be refetched/repainted
 * for the current visible range. The rendered block spans `margin` rows beyond
 * the viewport on each side; while the viewport stays within `margin/2` of both
 * block edges, native scroll keeps the rows positioned and we render nothing.
 * Returns true when nothing is rendered yet, or the viewport has scrolled within
 * `margin/2` of an edge that still has more lines beyond it.
 */
export function needsRefetch(
  visible: { start: number; end: number },
  block: Block | null,
  margin: number,
  lineCount: number,
): boolean {
  if (!block) return true;
  const half = Math.floor(margin / 2);
  if (block.start > 0 && visible.start < block.start + half) return true;
  if (block.end < lineCount && visible.end > block.end - half) return true;
  return false;
}

// ─── VirtualLogView ───────────────────────────────────────────────────────────

export interface VirtualLogViewOpts {
  overscan?: number;
}

export class VirtualLogView {
  private container: HTMLElement;
  private sizer: HTMLElement;
  private window: HTMLElement;
  private fetchWindow: (start: number, count: number) => Promise<string[]>;
  private opts: Required<VirtualLogViewOpts>;

  private lineCount_: number;
  /** Currently rendered block, or null when nothing is painted yet. */
  private block: Block | null = null;
  private rafId: number | null = null;
  /** Bumped on each fetch so a stale (superseded) fetch can bail before painting. */
  private fetchToken = 0;
  private currentMatch: number | null = null;

  /** Map from 0-based line number to rendered row element (in current window). */
  private rowMap = new Map<number, HTMLElement>();

  constructor(
    container: HTMLElement,
    lineCount: number,
    fetchWindow: (start: number, count: number) => Promise<string[]>,
    opts: VirtualLogViewOpts = {},
  ) {
    this.container = container;
    this.lineCount_ = lineCount;
    this.fetchWindow = fetchWindow;
    this.opts = { overscan: opts.overscan ?? 5 };

    // Build DOM structure
    container.classList.add("vlog");

    this.sizer = document.createElement("div");
    this.sizer.className = "vlog-sizer";
    this.sizer.style.height = `${lineCount * ROW_H}px`;

    this.window = document.createElement("div");
    this.window.className = "vlog-window";

    this.sizer.appendChild(this.window);
    container.appendChild(this.sizer);

    // Attach scroll listener
    this.onScroll = this.onScroll.bind(this);
    container.addEventListener("scroll", this.onScroll, { passive: true });

    // Defer initial render until layout so clientHeight is measured
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      void this.renderVisible();
    });
  }

  // ─── public API ────────────────────────────────────────────────────────────

  /** Update total line count (e.g. file grew). If following the bottom, scroll to end. */
  setLineCount(n: number): void {
    const oldHeight = this.lineCount_ * ROW_H;
    const wasAtBottom =
      this.lineCount_ > 0 &&
      this.container.scrollTop + this.container.clientHeight >= oldHeight - ROW_H;

    this.lineCount_ = n;
    this.sizer.style.height = `${n * ROW_H}px`;

    if (wasAtBottom) {
      this.container.scrollTop = n * ROW_H;
    }

    // Invalidate the block so the next render fetches fresh data.
    this.block = null;
    void this.renderVisible();
  }

  /** Scroll the container so that line `i` is near the top of the viewport. */
  scrollToLine(i: number): void {
    this.container.scrollTop = i * ROW_H;
  }

  /**
   * Set (or clear) the search-current highlight on `line`. If the match row is
   * already in the rendered block, apply the class directly; otherwise force a
   * block rebuild around it (`renderVisible` re-applies `currentMatch` on paint),
   * avoiding the rAF race in `reveal()`. Pass `null` to clear.
   */
  highlightLine(line: number | null): void {
    this.currentMatch = line;
    this.window
      .querySelectorAll(".search-current")
      .forEach((el) => el.classList.remove("search-current"));
    if (line === null) return;

    const el = this.rowMap.get(line);
    if (el) {
      el.classList.add("search-current");
    } else {
      // Match isn't in the current block — force a fresh fetch/paint around it.
      this.block = null;
      void this.renderVisible();
    }
  }

  /**
   * Return the rendered row element for `line` if it is currently in the
   * rendered window, or `null` otherwise (e.g. for search-hit highlighting).
   */
  rowEl(line: number): HTMLElement | null {
    return this.rowMap.get(line) ?? null;
  }

  /** Toggle `.wrap` class on the window element (CSS switches `white-space`). */
  setWrap(on: boolean): void {
    this.window.classList.toggle("wrap", on);
  }

  /** Remove event listeners. */
  destroy(): void {
    this.container.removeEventListener("scroll", this.onScroll);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private onScroll(): void {
    if (this.rafId !== null) return; // already scheduled
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      void this.renderVisible();
    });
  }

  /** Raw visible row range `[start, end)` (no overscan), clamped to the file. */
  private visibleRows(): { start: number; end: number } {
    const r = visibleRange({
      scrollTop: this.container.scrollTop,
      viewportH: this.container.clientHeight,
      rowH: ROW_H,
      lineCount: this.lineCount_,
      overscan: 0,
    });
    return { start: r.start, end: r.start + r.count };
  }

  /** Rows of buffer rendered beyond the viewport on each side (≥ one viewport). */
  private blockMargin(): number {
    const viewportRows = Math.ceil(this.container.clientHeight / ROW_H);
    return Math.max(this.opts.overscan, viewportRows);
  }

  private async renderVisible(): Promise<void> {
    const visible = this.visibleRows();
    const margin = this.blockMargin();

    // While the viewport stays inside the rendered block, native scroll keeps
    // the rows correctly positioned — render nothing, fetch nothing.
    if (!needsRefetch(visible, this.block, margin, this.lineCount_)) return;

    const start = Math.max(0, visible.start - margin);
    const end = Math.min(this.lineCount_, visible.end + margin);
    const count = end - start;

    if (count <= 0) {
      this.window.replaceChildren();
      this.rowMap.clear();
      this.window.style.transform = "";
      this.block = null;
      return;
    }

    const token = ++this.fetchToken;
    const lines = await this.fetchWindow(start, count);
    // A newer fetch superseded this one — bail without touching the DOM so the
    // currently-painted block stays on screen (no blank flash).
    if (token !== this.fetchToken) return;

    this.window.replaceChildren();
    this.rowMap.clear();

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < lines.length; i++) {
      const lineNo = start + i;
      const text = lines[i] ?? "";
      const { row, panel } = renderLogRow(text, lineNo);
      // Add vlog-row class for fixed-height CSS (does not affect LogView output)
      row.classList.add("vlog-row");
      this.rowMap.set(lineNo, row);
      fragment.appendChild(row);
      if (panel) fragment.appendChild(panel);
    }

    this.window.appendChild(fragment);
    this.window.style.transform = `translateY(${start * ROW_H}px)`;
    this.block = { start, end: start + lines.length };

    // Re-apply the search-current highlight (all rows are freshly created).
    if (this.currentMatch !== null) {
      this.rowMap.get(this.currentMatch)?.classList.add("search-current");
    }
  }
}
