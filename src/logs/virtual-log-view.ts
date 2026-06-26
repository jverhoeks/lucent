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
  private lastStart = -1;
  private lastCount = -1;
  private rafId: number | null = null;

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

    // Invalidate cache so next scroll/render fetches fresh data
    this.lastStart = -1;
    this.lastCount = -1;
    void this.renderVisible();
  }

  /** Scroll the container so that line `i` is near the top of the viewport. */
  scrollToLine(i: number): void {
    this.container.scrollTop = i * ROW_H;
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

  private async renderVisible(): Promise<void> {
    const { start, count } = visibleRange({
      scrollTop: this.container.scrollTop,
      viewportH: this.container.clientHeight,
      rowH: ROW_H,
      lineCount: this.lineCount_,
      overscan: this.opts.overscan,
    });

    // Skip if the range hasn't changed
    if (start === this.lastStart && count === this.lastCount) return;
    this.lastStart = start;
    this.lastCount = count;

    if (count === 0) {
      this.window.replaceChildren();
      this.rowMap.clear();
      this.window.style.transform = "";
      return;
    }

    const lines = await this.fetchWindow(start, count);

    // Re-check range after async fetch — if it changed while we were fetching,
    // skip this render (a newer one is already queued/running).
    if (start !== this.lastStart || count !== this.lastCount) return;

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
  }
}
