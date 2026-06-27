import { detectFormat, dataLangOf, basename } from "./format";
import { getRenderer } from "./renderers/registry";
import { LogView, toLines } from "./renderers/log";
import { VirtualLogView } from "./logs/virtual-log-view";
import { StyleSettings, Theme, Format, DataLang, Renderer } from "./types";

export const STDIN_PATH = "<stdin>";

/** A rendered (non-windowed) log with more than this many lines is rendered via
 *  a virtualized in-memory VirtualLogView instead of a full-DOM LogView. */
export const LOG_VIRTUALIZE_LINES = 500;

export interface Tab {
  path: string;
  title: string;
  content: string;
  format: Format;          // detected format
  forcedFormat?: Format;   // "View as…" override
  forcedLang?: DataLang;   // "View as data:lang" override
  mode: "rendered" | "raw";
  scrollTop: number;
  follow?: boolean;
  /** True when the file is too large to load into memory; rendered via VirtualLogView. */
  windowed?: boolean;
  /** Total line count for windowed tabs (from log_open). */
  lineCount?: number;
  /** Backend fetch callback for windowed tabs. */
  fetchWindow?: (start: number, count: number) => Promise<string[]>;
}

export interface TabHooks {
  onChange: () => void; // tabs/active changed — refresh toolbar enabled state
  onTabClosed: (path: string) => void; // stop watching one closed document
  onCloseAll: () => void; // stop watching everything
}

/** The format actually used to render this tab (override beats detection). */
function effectiveFormat(t: Tab): Format {
  return t.forcedFormat ?? t.format;
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeIndex = -1;
  private theme: Theme = "light";
  /** The VirtualLogView for the currently active windowed tab, if any. */
  private currentVlog: VirtualLogView | null = null;
  /** The LogView for the currently active rendered (non-windowed) log tab, if
   *  any — owned here (mirroring currentVlog) so streamLogUpdate can apply
   *  incremental updates without a module-global "last render wins" singleton. */
  private currentLog: LogView | null = null;
  /** The in-memory line source backing a large rendered log's VirtualLogView
   *  (null for backend-windowed logs and small LogView logs). The view's
   *  fetchWindow reads from this, so growth = reassign + setLineCount. */
  private currentVlogLines: string[] | null = null;
  /** Monotonic repaint generation; an async post-render tail only applies if it
   *  still matches (i.e. no newer repaint has run since). */
  private repaintSeq = 0;
  /** The Renderer from the previous repaint (for lifecycle cleanup). */
  private currentRenderer: Renderer | null = null;

  constructor(
    private tabbar: HTMLElement,
    private content: HTMLElement,
    style: StyleSettings,
    private hooks: TabHooks
  ) {
    this.applyStyle(style);
    this.renderTabbar();
  }

  count(): number {
    return this.tabs.length;
  }
  active(): Tab | undefined {
    return this.tabs[this.activeIndex];
  }
  getActivePath(): string | undefined {
    return this.active()?.path;
  }
  getActiveRawText(): string {
    return this.active()?.content ?? "";
  }
  /**
   * The HTML currently displayed for the active doc (renderer-agnostic), with
   * transient search-highlight <mark> wrappers stripped so copy-as-rich-text
   * never leaks highlight markup (or copies stale state) into the clipboard.
   */
  getActiveDisplayedHtml(): string {
    if (!this.active()) return "";
    const clone = this.content.cloneNode(true) as HTMLElement;
    // Strip presentational wrappers that leak internal UI structure:
    // code-block header/buttons, log gutters, JSON toggle buttons, line-number
    // cells, and class-based highlight state (search marks, tree current-row).
    clone.querySelectorAll(
      ".code-actions, .code-header, .log-gutter, .log-json-toggle, td.ln",
    ).forEach((e) => e.remove());
    clone.querySelectorAll("mark.search-hit, mark.search-current").forEach((m) => {
      m.replaceWith(document.createTextNode(m.textContent ?? ""));
    });
    clone.querySelectorAll(".search-current").forEach((e) => e.classList.remove("search-current"));
    return clone.innerHTML;
  }
  getActiveMode(): "rendered" | "raw" | undefined {
    return this.active()?.mode;
  }
  getActiveFormat(): Format | undefined {
    const t = this.active();
    return t ? effectiveFormat(t) : undefined;
  }

  setActiveForcedFormat(format: Format, lang?: DataLang): void {
    const t = this.active();
    if (!t) return;
    t.forcedFormat = format;
    t.forcedLang = lang;
    t.mode = format === "text" ? "raw" : "rendered";
    this.repaint(false);
    this.hooks.onChange();
  }

  /** Open a file in a new tab, or activate (and refresh) an already-open one. */
  openOrActivate(path: string, content: string): void {
    const existing = this.tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      this.tabs[existing].content = content;
      this.activate(existing);
      return;
    }
    const format = detectFormat(path);
    this.tabs.push({
      path,
      title: basename(path),
      content,
      format,
      mode: format === "text" ? "raw" : "rendered",
      scrollTop: 0,
    });
    this.activate(this.tabs.length - 1);
  }

  /** Open a huge log in windowed mode (no full content read). */
  openWindowedLog(
    path: string,
    lineCount: number,
    fetchWindow: (start: number, count: number) => Promise<string[]>,
  ): void {
    const existing = this.tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      // Refresh windowed state in case it was already open
      this.tabs[existing].windowed = true;
      this.tabs[existing].lineCount = lineCount;
      this.tabs[existing].fetchWindow = fetchWindow;
      this.activate(existing);
      return;
    }
    this.tabs.push({
      path,
      title: basename(path),
      content: "",
      format: "log",
      mode: "rendered",
      scrollTop: 0,
      windowed: true,
      lineCount,
      fetchWindow,
    });
    this.activate(this.tabs.length - 1);
  }

  /** Return the active VirtualLogView (backend-windowed OR large in-memory log), or null. */
  getActiveVirtualLogView(): VirtualLogView | null {
    return this.currentVlog;
  }

  /** The in-memory lines backing the active large rendered log (for synchronous
   *  search), or null when the active log is backend-windowed or a small LogView. */
  getActiveLogLines(): string[] | null {
    return this.currentVlogLines;
  }

  /** True when the active tab is a windowed log. */
  isActiveWindowed(): boolean {
    return !!this.active()?.windowed;
  }

  /** Replace the active tab's document in place (used by "next file" paging). */
  replaceActive(path: string, content: string): void {
    const t = this.active();
    if (!t) return;
    // Destroy windowed view if this tab was windowed
    this.currentVlog?.destroy();
    this.currentVlog = null;
    t.path = path;
    t.title = basename(path);
    t.content = content;
    t.format = detectFormat(path);
    t.forcedFormat = undefined;
    t.forcedLang = undefined;
    t.windowed = undefined;
    t.lineCount = undefined;
    t.fetchWindow = undefined;
    t.mode = t.format === "text" ? "raw" : "rendered";
    t.scrollTop = 0;
    this.repaint(true);
    this.renderTabbar();
    this.hooks.onChange();
  }

  /** Apply fresh content from a disk change, if that document is open. */
  updateContent(path: string, content: string): void {
    const i = this.tabs.findIndex((t) => t.path === path);
    if (i < 0) return;
    // Windowed logs never hold full content; growth comes via the log-grew event.
    if (this.tabs[i].windowed) return;
    this.tabs[i].content = content;
    if (i !== this.activeIndex) return;
    const t = this.tabs[i];
    // Use the SAME line-splitting as the renderer (toLines) so the incremental
    // prefix check matches — a raw split keeps a trailing "" that yields a
    // phantom row and breaks the prefix every update.
    const lines = toLines(content);
    if (effectiveFormat(t) === "log" && t.mode === "rendered") {
      const big = lines.length > LOG_VIRTUALIZE_LINES;
      // In-memory virtual log growing: swap the line source + update the count
      // (the window re-renders cheaply); honor the follow flag explicitly.
      if (big && this.currentVlog && this.currentVlogLines) {
        this.currentVlogLines = lines;
        const prev = this.content.scrollTop;
        this.currentVlog.setLineCount(lines.length);
        this.content.scrollTop = t.follow ? this.content.scrollHeight : prev;
        return;
      }
      // Small log on the incremental LogView path.
      if (!big && this.currentLog && this.streamLogUpdate(lines)) return;
      // Otherwise (no view yet, or the line count crossed the threshold so the
      // view type no longer matches) → full repaint builds the right renderer.
    }
    this.repaint(false);
  }

  activate(index: number): void {
    if (index < 0 || index >= this.tabs.length) return;
    const cur = this.active();
    if (cur) cur.scrollTop = this.content.scrollTop;
    this.activeIndex = index;
    this.repaint(true);
    this.renderTabbar();
    this.hooks.onChange();
  }

  closeActiveTab(): void {
    if (this.activeIndex >= 0) this.closeTab(this.activeIndex);
  }

  closeTab(index: number): void {
    if (index < 0 || index >= this.tabs.length) return;
    const [closed] = this.tabs.splice(index, 1);
    // If the closed tab was the active windowed tab, destroy its view
    if (index === this.activeIndex) {
      this.currentVlog?.destroy();
      this.currentVlog = null;
    }
    this.hooks.onTabClosed(closed.path);
    if (this.tabs.length === 0) {
      this.activeIndex = -1;
      this.content.replaceChildren();
    } else {
      this.activeIndex = Math.min(index, this.tabs.length - 1);
      this.repaint(true);
    }
    this.renderTabbar();
    this.hooks.onChange();
  }

  closeAll(): void {
    this.currentVlog?.destroy();
    this.currentVlog = null;
    this.tabs = [];
    this.activeIndex = -1;
    this.content.replaceChildren();
    this.hooks.onCloseAll();
    this.renderTabbar();
    this.hooks.onChange();
  }

  /** Re-render the active tab (e.g. after a theme change so Mermaid re-themes). */
  rerenderActive(): void {
    this.repaint(false);
  }

  toggleMode(): void {
    const t = this.active();
    if (!t) return;
    t.mode = t.mode === "rendered" ? "raw" : "rendered";
    this.repaint(false);
    this.hooks.onChange();
  }

  isFollowing(): boolean { return !!this.active()?.follow; }
  toggleFollow(): void {
    const t = this.active();
    if (!t) return;
    t.follow = !t.follow;
    if (t.follow) this.content.scrollTop = this.content.scrollHeight;
    this.hooks.onChange();
  }

  /** Create + activate the synthetic stdin log tab, or activate it if it exists. */
  openStdin(): void {
    const existing = this.tabs.findIndex((t) => t.path === STDIN_PATH);
    if (existing >= 0) { this.activate(existing); return; }
    this.tabs.push({
      path: STDIN_PATH,
      title: "stdin",
      content: "",
      format: "log",
      forcedFormat: "log",
      mode: "rendered",
      follow: true,
      scrollTop: 0,
    });
    this.activate(this.tabs.length - 1);
  }

  /** Replace the stdin tab's content with the latest snapshot from the Rust
   *  buffer (creating the tab on the first non-empty snapshot). The buffer is
   *  already capped backend-side, so no frontend ring-cap is needed. */
  setStdin(lines: string[]): void {
    let i = this.tabs.findIndex((t) => t.path === STDIN_PATH);
    if (i < 0) {
      if (lines.length === 0) return;
      this.openStdin();
      i = this.tabs.findIndex((t) => t.path === STDIN_PATH);
    }
    this.tabs[i].content = lines.join("\n");
    if (i === this.activeIndex && !this.streamLogUpdate(lines)) this.repaint(false);
  }

  applyStyle(s: StyleSettings): void {
    this.theme = s.theme;
    const el = this.content;
    el.dataset.theme = s.theme;
    el.dataset.font = s.fontFamily;
    el.style.setProperty("--font-size", `${s.fontSizePx}px`);
    el.style.setProperty("--max-width", `${s.maxWidthCh}ch`);
  }

  /** Stream `lines` into the active rendered-log view incrementally; preserves the
   *  user's scroll when not following, pins to bottom when following. Returns true
   *  if it handled the update incrementally. */
  private streamLogUpdate(lines: string[]): boolean {
    const t = this.active();
    if (!t || effectiveFormat(t) !== "log" || t.mode !== "rendered") return false;
    const view = this.currentLog;
    if (!view) return false; // first stdin frame before any repaint → let repaint build it
    const atBottom = t.follow;
    const prev = this.content.scrollTop;
    view.setLines(lines);
    if (atBottom) this.content.scrollTop = this.content.scrollHeight; // follow: newest
    else this.content.scrollTop = prev;                                // frozen: stay put
    return true;
  }

  private repaint(restoreScroll: boolean): void {
    // Bump the generation counter FIRST — before any early return — so that a
    // switch to a windowed/empty tab also invalidates an in-flight async
    // post-render tail from a previous repaint. Otherwise a pending Mermaid
    // callback could re-settle scroll (or show an error) against now-stale
    // content it no longer owns.
    const seq = ++this.repaintSeq;
    // Clear the owned rendered-log view + its in-memory line source on EVERY
    // repaint path (windowed, empty, rendered) so they can never dangle at
    // detached DOM; the log branch below re-sets whichever it builds.
    this.currentLog = null;
    this.currentVlogLines = null;

    const t = this.active();
    if (!t) { this.content.replaceChildren(); return; }

    // Windowed tab: build/rebuild VirtualLogView (no content read)
    if (t.windowed && t.lineCount !== undefined && t.fetchWindow) {
      this.currentVlog?.destroy();
      this.content.replaceChildren();
      this.currentVlog = new VirtualLogView(this.content, t.lineCount, t.fetchWindow);
      return;
    }

    // Destroy any lingering virtual log view when switching to a non-windowed
    // tab, and drop the `.vlog` class it added to the shared content element
    // (the in-memory virtual branch below re-adds it when it builds one).
    this.currentVlog?.destroy();
    this.currentVlog = null;
    this.content.classList.remove("vlog");

    if (t.mode === "rendered") {
      // Rendered log. Large logs (> threshold) render via a virtualized
      // in-memory VirtualLogView (bounded DOM); smaller logs use the full-DOM
      // LogView, which TabManager owns so it can stream incremental updates and
      // which keeps inline-JSON expansion working for the common case.
      if (effectiveFormat(t) === "log") {
        const lines = toLines(t.content);
        try {
          if (lines.length > LOG_VIRTUALIZE_LINES) {
            this.content.replaceChildren();
            this.currentVlogLines = lines;
            this.currentVlog = new VirtualLogView(
              this.content,
              lines.length,
              (start, count) => Promise.resolve((this.currentVlogLines ?? []).slice(start, start + count)),
            );
          } else {
            const view = new LogView(this.content);
            view.setLines(lines);
            this.currentLog = view;
          }
        } catch (err) {
          this.showRenderError(t, err);
          return;
        }
        this.settleScroll(t, restoreScroll);
        return;
      }

      const renderer = getRenderer(effectiveFormat(t));
      // Release the previous renderer's resources before the new render.
      if (renderer !== this.currentRenderer) {
        this.currentRenderer?.destroy?.();
        this.currentRenderer = renderer;
      }
      let result: void | Promise<void>;
      try {
        result = renderer.render(
          t.content, this.content,
          { theme: this.theme, dataLang: t.forcedLang },
          t.path,
        );
      } catch (err) {
        // A renderer throwing synchronously must not leave the content area
        // half-built — show raw text plus a clear error instead.
        this.showRenderError(t, err);
        return;
      }
      // Immediate settle for the synchronous paint, so plain documents feel
      // instant and don't wait on a microtask.
      this.settleScroll(t, restoreScroll);
      // Async renderers (Mermaid) mutate the DOM after `render` returns. Re-settle
      // once they resolve so a restored scrollTop isn't left clamped against the
      // shorter pre-SVG layout; route a late rejection to the same error view.
      // The `seq` guard drops the callback if a newer repaint has superseded us.
      if (result instanceof Promise) {
        result.then(
          () => { if (seq === this.repaintSeq) this.settleScroll(t, restoreScroll); },
          (err) => { if (seq === this.repaintSeq) this.showRenderError(t, err); },
        );
      }
      return;
    }

    const pre = document.createElement("pre");
    pre.className = "raw";
    pre.textContent = t.content; // paint plain text instantly — no async dependency
    this.content.replaceChildren(pre);
    this.settleScroll(t, restoreScroll);
    // Async upgrade: lazy-load highlight.js and re-highlight when available.
    // The plain text is already visible, so there is no flash — the highlighted
    // replacement lands in a future microtask.
    const lang = effectiveFormat(t) === "data" ? (t.forcedLang ?? dataLangOf(t.path)) : null;
    if (lang) {
      const mySeq = this.repaintSeq;
      import("./highlight").then((m) => {
        if (mySeq !== this.repaintSeq) return; // superseded by a newer repaint
        const hljs = m.default;
        if (hljs.getLanguage(lang)) {
          pre.classList.add("hljs");
          pre.innerHTML = hljs.highlight(t.content, { language: lang }).value;
        }
      }).catch(() => {
        /* plain text is the acceptable fallback */
      });
    }
  }

  /** Restore the tab's saved scroll, then pin a followed log to the newest line. */
  private settleScroll(t: Tab, restoreScroll: boolean): void {
    if (restoreScroll) this.content.scrollTop = t.scrollTop;
    if (t.follow && effectiveFormat(t) === "log") this.content.scrollTop = this.content.scrollHeight;
  }

  /** Replace the content area with the raw text plus a render-failure note. */
  private showRenderError(t: Tab, err: unknown): void {
    const wrap = document.createElement("div");
    wrap.className = "render-error";
    const note = document.createElement("p");
    note.textContent = `Couldn't render this file: ${err instanceof Error ? err.message : String(err)}`;
    const pre = document.createElement("pre");
    pre.className = "raw";
    pre.textContent = t.content;
    wrap.append(note, pre);
    this.content.replaceChildren(wrap);
  }

  private renderTabbar(): void {
    this.tabbar.replaceChildren();
    this.tabbar.setAttribute("role", "tablist");
    this.tabs.forEach((t, i) => {
      const active = i === this.activeIndex;
      const tab = document.createElement("div");
      tab.className = "tab" + (active ? " active" : "");
      tab.title = t.path;
      // a11y: expose tab semantics + selected state, and make tabs focusable
      // with roving tabindex (only the active tab is in the tab order).
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.addEventListener("auxclick", (e) => {
        if (e.button === 1) { e.preventDefault(); this.closeTab(i); }
      });
      tab.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const d = e.key === "ArrowRight" ? 1 : -1;
          this.activate((i + d + this.tabs.length) % this.tabs.length);
          (this.tabbar.children[this.activeIndex] as HTMLElement | undefined)?.focus();
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.activate(i);
        }
      });

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = t.title;
      label.addEventListener("click", () => this.activate(i));

      const close = document.createElement("button");
      close.className = "tab-close";
      close.textContent = "×";
      close.title = "Close tab";
      close.setAttribute("aria-label", `Close ${t.title}`);
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(i);
      });

      tab.append(label, close);
      this.tabbar.appendChild(tab);
    });
  }
}
