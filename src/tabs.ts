import { renderMarkdown } from "./render";
import { StyleSettings } from "./types";

export interface Tab {
  path: string;
  title: string;
  content: string;
  mode: "rendered" | "raw";
  scrollTop: number;
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

export class TabManager {
  private tabs: Tab[] = [];
  private activeIndex = -1;

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
  getActiveRenderedHtml(): string {
    const t = this.active();
    return t ? renderMarkdown(t.content) : "";
  }
  getActiveMode(): "rendered" | "raw" | undefined {
    return this.active()?.mode;
  }

  /** Open a file in a new tab, or activate (and refresh) an already-open one. */
  openOrActivate(path: string, content: string): void {
    const existing = this.tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      this.tabs[existing].content = content;
      this.activate(existing);
      return;
    }
    this.tabs.push({
      path,
      title: basename(path),
      content,
      mode: "rendered",
      scrollTop: 0,
    });
    this.activate(this.tabs.length - 1);
  }

  /** Replace the active tab's document in place (used by "next file" paging). */
  replaceActive(path: string, content: string): void {
    const t = this.active();
    if (!t) return;
    t.path = path;
    t.title = basename(path);
    t.content = content;
    t.mode = "rendered";
    t.scrollTop = 0;
    this.repaint(true);
    this.renderTabbar();
    this.hooks.onChange();
  }

  /** Apply fresh content from a disk change, if that document is open. */
  updateContent(path: string, content: string): void {
    const i = this.tabs.findIndex((t) => t.path === path);
    if (i < 0) return;
    this.tabs[i].content = content;
    if (i === this.activeIndex) this.repaint(false);
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
    this.tabs = [];
    this.activeIndex = -1;
    this.content.replaceChildren();
    this.hooks.onCloseAll();
    this.renderTabbar();
    this.hooks.onChange();
  }

  toggleMode(): void {
    const t = this.active();
    if (!t) return;
    t.mode = t.mode === "rendered" ? "raw" : "rendered";
    this.repaint(false);
    this.hooks.onChange();
  }

  applyStyle(s: StyleSettings): void {
    const el = this.content;
    el.dataset.theme = s.theme;
    el.dataset.font = s.fontFamily;
    el.style.setProperty("--font-size", `${s.fontSizePx}px`);
    el.style.setProperty("--max-width", `${s.maxWidthCh}ch`);
  }

  private repaint(restoreScroll: boolean): void {
    const t = this.active();
    if (!t) {
      this.content.replaceChildren();
      return;
    }
    if (t.mode === "rendered") {
      this.content.innerHTML = `<article class="doc">${renderMarkdown(
        t.content
      )}</article>`;
    } else {
      const pre = document.createElement("pre");
      pre.className = "raw";
      pre.textContent = t.content;
      this.content.replaceChildren(pre);
    }
    if (restoreScroll) this.content.scrollTop = t.scrollTop;
  }

  private renderTabbar(): void {
    this.tabbar.replaceChildren();
    this.tabs.forEach((t, i) => {
      const tab = document.createElement("div");
      tab.className = "tab" + (i === this.activeIndex ? " active" : "");
      tab.title = t.path;

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = t.title;
      label.addEventListener("click", () => this.activate(i));

      const close = document.createElement("button");
      close.className = "tab-close";
      close.textContent = "×";
      close.title = "Close tab";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(i);
      });

      tab.append(label, close);
      this.tabbar.appendChild(tab);
    });
    this.tabbar.hidden = this.tabs.length === 0;
  }
}
