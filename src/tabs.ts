import hljs from "highlight.js";
import { detectFormat, dataLangOf } from "./format";
import { getRenderer } from "./renderers/registry";
import { getCurrentLogView, toLines } from "./renderers/log";
import { VirtualLogView } from "./logs/virtual-log-view";
import { StyleSettings, Theme, Format, DataLang } from "./types";

export const STDIN_PATH = "<stdin>";

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

/** Basename of a path, handling both / and \ separators. */
export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
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
    clone.querySelectorAll("mark.search-hit, mark.search-current").forEach((m) => {
      m.replaceWith(document.createTextNode(m.textContent ?? ""));
    });
    // Also drop class-based highlight state (e.g. the tree's current-row marker)
    // so copy-rich never carries transient search styling.
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

  /** Return the active VirtualLogView (windowed tab), or null. */
  getActiveVirtualLogView(): VirtualLogView | null {
    return this.currentVlog;
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
    if (!(effectiveFormat(t) === "log" && t.mode === "rendered" && this.streamLogUpdate(lines))) {
      this.repaint(false);
    }
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
    const view = getCurrentLogView();
    if (!view) return false;
    const atBottom = t.follow;
    const prev = this.content.scrollTop;
    view.setLines(lines);
    if (atBottom) this.content.scrollTop = this.content.scrollHeight; // follow: newest
    else this.content.scrollTop = prev;                                // frozen: stay put
    return true;
  }

  private repaint(restoreScroll: boolean): void {
    const t = this.active();
    if (!t) { this.content.replaceChildren(); return; }

    // Windowed tab: build/rebuild VirtualLogView (no content read)
    if (t.windowed && t.lineCount !== undefined && t.fetchWindow) {
      this.currentVlog?.destroy();
      this.content.replaceChildren();
      this.currentVlog = new VirtualLogView(this.content, t.lineCount, t.fetchWindow);
      return;
    }

    // Destroy any lingering windowed view when switching to a non-windowed tab
    this.currentVlog?.destroy();
    this.currentVlog = null;

    if (t.mode === "rendered") {
      try {
        getRenderer(effectiveFormat(t)).render(
          t.content, this.content,
          { theme: this.theme, dataLang: t.forcedLang },
          t.path,
        );
      } catch (err) {
        // A renderer throwing must not leave the content area half-built —
        // show the raw text plus a clear error instead of a broken view.
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
    } else {
      const pre = document.createElement("pre");
      pre.className = "raw";
      const lang = effectiveFormat(t) === "data" ? (t.forcedLang ?? dataLangOf(t.path)) : null;
      if (lang && hljs.getLanguage(lang)) {
        pre.classList.add("hljs");
        pre.innerHTML = hljs.highlight(t.content, { language: lang }).value; // hljs output is escaped/safe
      } else {
        pre.textContent = t.content;
      }
      this.content.replaceChildren(pre);
    }
    if (restoreScroll) this.content.scrollTop = t.scrollTop;
    if (t.follow && effectiveFormat(t) === "log") this.content.scrollTop = this.content.scrollHeight;
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
