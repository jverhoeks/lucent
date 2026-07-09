import { loadHighlight } from "./highlight-loader";
import { detectFormat, dataLangOf, basename } from "./format";
import { getRenderer } from "./renderers/registry";
import { resolveLocalImages } from "./renderers/markdown";
import { prewarmMarkdown } from "./render";
import { LogView, toLines } from "./renderers/log";
import { VirtualLogView } from "./logs/virtual-log-view";
import { StyleSettings, Theme, Format, DataLang, Renderer, Mode } from "./types";
import type { EditorAPI, EditorLang } from "./editor";
import type { TreeView } from "./data/tree";
import type { SessionState, SessionTab } from "./session";

export const STDIN_PATH = "<stdin>";
export const SCRATCH_PATH_PREFIX = "<scratch:";

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
  mode: Mode;
  scrollTop: number;
  follow?: boolean;
  /** True when the editor buffer has unsaved changes. */
  editDirty?: boolean;
  /** New disk content held aside while this tab has an unsaved draft. */
  pendingDiskContent?: string;
  /** Saved editor scroll position (for sync scrolling). */
  editScroll?: number;
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
  onSave?: (path: string, content: string) => Promise<string | null | void>; // save editor content to disk
  resolveLocalImage?: (basePath: string, relativePath: string) => Promise<string | null>;
}

export function isScratchPath(path: string | undefined): boolean {
  return !!path?.startsWith(SCRATCH_PATH_PREFIX);
}

/** The format actually used to render this tab (override beats detection). */
function effectiveFormat(t: Tab): Format {
  return t.forcedFormat ?? t.format;
}

function fmtToEditorLang(t: Tab): EditorLang | undefined {
  const fmt = effectiveFormat(t);
  if (fmt === "markdown") return "markdown";
  if (fmt === "data") {
    const lang = t.forcedLang ?? dataLangOf(t.path);
    if (lang === "json") return "json";
    if (lang === "yaml") return "yaml";
  }
  return undefined;
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeIndex = -1;
  private theme: Theme = "light";
  /** The VirtualLogView for the currently active windowed tab, if any. */
  private currentVlog: VirtualLogView | null = null;
  /** The data TreeView from the editor preview, if any. */
  private currentDataTree: TreeView | null = null;
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

  /** Pending idle handle for adjacent-tab pre-warming (requestIdleCallback id,
   *  or a setTimeout id in environments without it). */
  private prewarmHandle: number | null = null;
  /** The active CodeMirror editor instance (edit mode). */
  private currentEditor: EditorAPI | null = null;
  /** Debounce timer for live preview in edit mode. */
  private editPreviewTimer: ReturnType<typeof setTimeout> | null = null;
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
  hasDirtyTabs(): boolean {
    return this.tabs.some((t) => t.editDirty);
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
  snapshotSession(): SessionState {
    const active = this.active();
    if (active) active.scrollTop = this.content.scrollTop;
    return {
      version: 1,
      activePath: active?.path === STDIN_PATH || isScratchPath(active?.path) ? undefined : active?.path,
      tabs: this.tabs
        .filter((tab) => tab.path !== STDIN_PATH && !isScratchPath(tab.path))
        .map((tab) => ({
          path: tab.path,
          forcedFormat: tab.forcedFormat,
          forcedLang: tab.forcedLang,
          mode: tab.mode === "raw" ? "raw" : "rendered",
          scrollTop: tab.scrollTop,
          follow: tab.follow,
        })),
    };
  }

  restoreSessionTab(saved: SessionTab): void | Promise<void> {
    const tab = this.tabs.find((candidate) => candidate.path === saved.path);
    if (!tab) return;
    tab.forcedFormat = saved.forcedFormat;
    tab.forcedLang = saved.forcedLang;
    tab.mode = saved.mode;
    tab.scrollTop = saved.scrollTop;
    tab.follow = saved.follow;
    this.hooks.onChange();
    if (tab === this.active()) return this.repaint(true);
  }

  activatePath(path: string): void | Promise<void> {
    const index = this.tabs.findIndex((tab) => tab.path === path);
    if (index >= 0) return this.activate(index);
  }
  /**
   * The HTML currently displayed for the active doc (renderer-agnostic), with
   * transient search-highlight <mark> wrappers stripped so copy-as-rich-text
   * never leaks highlight markup (or copies stale state) into the clipboard.
   */
  getActiveDisplayedHtml(opts?: { forCopy?: boolean }): string {
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
    // Copy-as-rich-text cleanups (export keeps the full structure):
    if (opts?.forCopy) {
      // Unwrap heading anchor links so titles paste as clean headings.
      // markdown-it-anchor's headerLink() wraps each heading in an
      // <a href="#slug">; that bare fragment is a dead link in Confluence /
      // Word / Docs (which strip it to plain text anyway). Unwrap (not
      // textContent) to preserve inline formatting inside the heading.
      clone.querySelectorAll("a.header-anchor").forEach((a) => a.replaceWith(...a.childNodes));
      // Flatten the per-line code-block <table> (line numbers + highlight
      // cells) into a plain <pre><code> from the original source. Pasting the
      // table into Confluence/Word otherwise loses the line breaks. data-src
      // holds the raw code with newlines; textContent escapes it safely.
      clone.querySelectorAll(".code-block").forEach((el) => {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        const lang = el.getAttribute("data-lang");
        if (lang) code.className = `language-${lang}`;
        code.textContent = el.getAttribute("data-src") ?? el.textContent ?? "";
        pre.appendChild(code);
        el.replaceWith(pre);
      });
    }
    return clone.innerHTML;
  }
  getActiveMode(): Mode | undefined {
    return this.active()?.mode;
  }
  getActiveFormat(): Format | undefined {
    const t = this.active();
    return t ? effectiveFormat(t) : undefined;
  }
  getActiveDataLang(): DataLang | undefined {
    const t = this.active();
    if (!t || effectiveFormat(t) !== "data") return undefined;
    return t.forcedLang ?? dataLangOf(t.path) ?? undefined;
  }

  setActiveForcedFormat(format: Format, lang?: DataLang): void | Promise<void> {
    const t = this.active();
    if (!t) return;
    t.forcedFormat = format;
    t.forcedLang = lang;
    t.mode = format === "text" ? "raw" : "rendered";
    this.hooks.onChange();
    return this.repaint(false);
  }

  /** Open a file in a new tab, or activate (and refresh) an already-open one. */
  openOrActivate(path: string, content: string): void | Promise<void> {
    const existing = this.tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      this.tabs[existing].content = content;
      return this.activate(existing);
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
    return this.activate(this.tabs.length - 1);
  }

  /** Open pasted/unsaved Markdown in a new editable scratch tab. */
  openScratchMarkdown(content: string): void | Promise<void> {
    const existing = this.tabs.filter((t) => isScratchPath(t.path)).length;
    const n = existing + 1;
    this.tabs.push({
      path: `${SCRATCH_PATH_PREFIX}${Date.now()}-${n}.md>`,
      title: n === 1 ? "Pasted.md" : `Pasted ${n}.md`,
      content,
      format: "markdown",
      mode: "edit",
      scrollTop: 0,
      editDirty: true,
    });
    return this.activate(this.tabs.length - 1);
  }

  /** Open a huge log in windowed mode (no full content read). */
  openWindowedLog(
    path: string,
    lineCount: number,
    fetchWindow: (start: number, count: number) => Promise<string[]>,
  ): void | Promise<void> {
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
  replaceActive(path: string, content: string): void | Promise<void> {
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
    this.renderTabbar();
    this.hooks.onChange();
    return this.repaint(true);
  }

  /** Signal a file-changed-on-disk conflict during edit mode. */
  private externalEditConflict(_t: Tab, diskContent: string): void {
    const conflictBar = this.content.querySelector(".edit-conflict") as HTMLElement | null;
    if (conflictBar) {
      conflictBar.hidden = false;
      conflictBar.dataset.diskContent = diskContent;
    }
  }

  /** Apply fresh content from a disk change, if that document is open. */
  updateContent(path: string, content: string): void {
    const i = this.tabs.findIndex((t) => t.path === path);
    if (i < 0) return;
    // Windowed logs never hold full content; growth comes via the log-grew event.
    if (this.tabs[i].windowed) return;
    // Never overwrite an unsaved draft. Inactive tabs retain the disk version
    // until activation rebuilds their conflict bar.
    if (this.tabs[i].editDirty) {
      this.tabs[i].pendingDiskContent = content;
      if (i === this.activeIndex) this.externalEditConflict(this.tabs[i], content);
      return;
    }
    this.tabs[i].content = content;
    if (i !== this.activeIndex) return;
    const t = this.tabs[i];

    // Edit mode with no unsaved changes: update editor buffer + preview in place
    // without destroying the editor (full repaint would destroyEditor).
    if (t.mode === "edit" && this.currentEditor) {
      this.currentEditor.setValue(content);
      const fmt = effectiveFormat(t);
      if (fmt === "markdown") {
        import("./render").then(({ renderMarkdown }) => {
          renderMarkdown(content).then((html) => {
            const article = this.content.querySelector(".split-preview .doc") as HTMLElement | null;
            if (article) article.innerHTML = html;
          });
        });
      }
      return;
    }

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

  activate(index: number): void | Promise<void> {
    if (index < 0 || index >= this.tabs.length) return;
    this.captureActiveDraft();
    const cur = this.active();
    if (cur) cur.scrollTop = this.content.scrollTop;
    this.activeIndex = index;
    this.renderTabbar();
    this.hooks.onChange();
    return this.repaint(true);
  }

  closeActiveTab(): void {
    if (this.activeIndex >= 0) this.closeTab(this.activeIndex);
  }

  closeTab(index: number): void | Promise<void> {
    if (index < 0 || index >= this.tabs.length) return;
    this.captureActiveDraft();
    if (this.tabs[index].editDirty && !window.confirm(`Discard unsaved changes to ${this.tabs[index].title}?`)) {
      return;
    }
    const [closed] = this.tabs.splice(index, 1);
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
      this.renderTabbar();
      this.hooks.onChange();
      return this.repaint(true);
    }
    this.renderTabbar();
    this.hooks.onChange();
  }

  closeAll(): void {
    this.captureActiveDraft();
    if (this.hasDirtyTabs() && !window.confirm("Discard unsaved changes and close all tabs?")) return;
    this.currentVlog?.destroy();
    this.currentVlog = null;
    this.destroyEditor();
    this.tabs = [];
    this.activeIndex = -1;
    this.content.replaceChildren();
    this.hooks.onCloseAll();
    this.renderTabbar();
    this.hooks.onChange();
  }

  /** Re-render the active tab (e.g. after a theme change so Mermaid re-themes). */
  rerenderActive(): void | Promise<void> {
    return this.repaint(false);
  }

  toggleMode(): void | Promise<void> {
    const t = this.active();
    if (!t) return;
    t.mode = t.mode === "rendered" ? "raw" : "rendered";
    this.hooks.onChange();
    return this.repaint(false);
  }

  isEditing(): boolean {
    return !!this.active()?.editDirty || !!this.currentEditor;
  }

  /** Enter or exit split-screen edit mode. Supported: markdown and data (json/yaml/toml/ini). */
  toggleEdit(): void | Promise<void> {
    const t = this.active();
    if (!t) return;

    // Exiting edit mode: auto-save before leaving
    if (t.mode === "edit" || this.currentEditor) {
      const doExit = () => {
        this.destroyEditor();
        t.mode = "rendered";
        this.hooks.onChange();
        return this.repaint(false);
      };
      const editorValue = this.activeEditorValue();
      if (t.editDirty && editorValue !== null) {
        const nextContent = editorValue;
        const saved = this.hooks.onSave?.(t.path, nextContent);
        if (!saved) {
          t.content = nextContent;
          t.editDirty = false;
          return doExit();
        }
        return saved.then((savedPath) => {
          if (savedPath === null) return;
          this.applySavedContent(t, nextContent, savedPath);
          this.renderTabbar();
          this.hooks.onChange();
          return doExit();
        });
      }
      return doExit();
    }

    // Only markdown and data files support the editor
    const fmt = effectiveFormat(t);
    if (fmt !== "markdown" && fmt !== "data") return;

    t.mode = "edit";
    t.editDirty = false;
    this.hooks.onChange();
    return this.repaint(false);
  }

  /** Save the editor buffer to disk. Returns true if saved. */
  async saveActive(): Promise<boolean> {
    const t = this.active();
    const editorValue = this.activeEditorValue();
    if (!t || editorValue === null || !t.editDirty) return false;
    const nextContent = editorValue;
    const savedPath = await this.hooks.onSave?.(t.path, nextContent);
    if (savedPath === null) return false;
    this.applySavedContent(t, nextContent, savedPath);
    this.renderTabbar();
    this.hooks.onChange();
    return true;
  }

  private applySavedContent(t: Tab, content: string, savedPath?: string | void): void {
    if (typeof savedPath === "string" && savedPath) {
      const currentIndex = this.tabs.indexOf(t);
      const existingIndex = this.tabs.findIndex((tab) => tab !== t && tab.path === savedPath);
      if (existingIndex >= 0) {
        const existing = this.tabs[existingIndex];
        existing.content = content;
        existing.editDirty = false;
        existing.pendingDiskContent = undefined;
        existing.format = detectFormat(savedPath);
        existing.forcedFormat = undefined;
        existing.forcedLang = undefined;
        existing.mode = t.mode;
        existing.scrollTop = t.scrollTop;
        if (currentIndex >= 0) {
          const [closed] = this.tabs.splice(currentIndex, 1);
          this.hooks.onTabClosed(closed.path);
        }
        this.activeIndex = currentIndex >= 0 && currentIndex < existingIndex
          ? existingIndex - 1
          : existingIndex;
        return;
      }
      t.path = savedPath;
      t.title = basename(savedPath);
      t.format = detectFormat(savedPath);
      t.forcedFormat = undefined;
      t.forcedLang = undefined;
    }
    t.content = content;
    t.editDirty = false;
    t.pendingDiskContent = undefined;
  }

  /** Preserve the active editor buffer before a repaint/tab switch destroys
   *  CodeMirror. The tab stays dirty until a disk write succeeds. */
  private captureActiveDraft(): void {
    const t = this.active();
    const editorValue = this.activeEditorValue();
    if (t?.editDirty && editorValue !== null) t.content = editorValue;
  }

  private activeEditorValue(): string | null {
    if (this.currentEditor) return this.currentEditor.getValue();
    const textarea = this.content.querySelector<HTMLTextAreaElement>(".split-textarea");
    return textarea?.value ?? null;
  }

  /** Destroy the active editor and clean up the split view. */
  private destroyEditor(): void {
    this.currentEditor?.destroy();
    this.currentEditor = null;
    this.currentDataTree?.destroy();
    this.currentDataTree = null;
    if (this.editPreviewTimer !== null) {
      clearTimeout(this.editPreviewTimer);
      this.editPreviewTimer = null;
    }
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
  setStdin(lines: string[]): void | Promise<void> {
    let i = this.tabs.findIndex((t) => t.path === STDIN_PATH);
    if (i < 0) {
      if (lines.length === 0) return;
      this.openStdin();
      i = this.tabs.findIndex((t) => t.path === STDIN_PATH);
    }
    this.tabs[i].content = lines.join("\n");
    if (i === this.activeIndex && !this.streamLogUpdate(lines)) return this.repaint(false);
  }

  applyStyle(s: StyleSettings): void {
    this.theme = s.theme;
    const el = this.content;
    const resolved = s.theme === "system"
      ? (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : s.theme;
    el.dataset.theme = resolved;
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

  /** Re-render the active tab. Returns a Promise when the render is async
   *  (e.g. markdown with Mermaid, or raw mode that lazy-loads highlight.js)
   *  so callers can await the content being populated. */
  /** During idle time, warm the Markdown render cache for the tabs immediately
   *  left and right of the active one. Pure cache population — it never touches
   *  the DOM, so it can't clobber the visible tab. Only Markdown benefits (data
   *  trees and logs don't use the worker); windowed logs are skipped. */
  private prewarmAdjacent(): void {
    if (typeof window === "undefined") return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const schedule = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const cancel = w.cancelIdleCallback ?? window.clearTimeout;
    if (this.prewarmHandle !== null) cancel(this.prewarmHandle);
    this.prewarmHandle = schedule(() => {
      this.prewarmHandle = null;
      for (const i of [this.activeIndex - 1, this.activeIndex + 1]) {
        const neighbour = this.tabs[i];
        if (neighbour && !neighbour.windowed && effectiveFormat(neighbour) === "markdown") {
          prewarmMarkdown(neighbour.content);
        }
      }
    });
  }

  private repaint(restoreScroll: boolean): void | Promise<void> {
    // Bump the generation counter FIRST — before any early return — so that a
    // switch to a windowed/empty tab also invalidates an in-flight async
    // post-render tail from a previous repaint. Otherwise a pending Mermaid
    // callback could re-settle scroll (or show an error) against now-stale
    // content it no longer owns.
    this.captureActiveDraft();
    const seq = ++this.repaintSeq;
    // Clear the owned rendered-log view + its in-memory line source on EVERY
    // repaint path (windowed, empty, rendered) so they can never dangle at
    // detached DOM; the log branch below re-sets whichever it builds.
    this.currentLog = null;
    this.currentVlogLines = null;
    // Clear any active editor before switching modes/tabs.
    this.destroyEditor();
    this.content.classList.remove("editing");

    const t = this.active();
    if (!t) { this.content.replaceChildren(); return; }

    // Warm the render cache for neighbouring Markdown tabs during idle time so
    // switching to them paints from cache instead of a fresh worker render.
    this.prewarmAdjacent();

    return this.renderActiveMode(t, seq, restoreScroll);
  }

  /** Dispatch the active tab to the renderer for its storage/mode shape. */
  private renderActiveMode(t: Tab, seq: number, restoreScroll: boolean): void | Promise<void> {
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

    if (t.mode === "rendered") return this.renderRenderedMode(t, seq, restoreScroll);

    if (t.mode === "edit") return this.renderEditMode(t, restoreScroll);
    return this.renderRawMode(t, restoreScroll);
  }

  /** Render a document/log in its formatted view. */
  private renderRenderedMode(t: Tab, seq: number, restoreScroll: boolean): void | Promise<void> {
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
    if (renderer !== this.currentRenderer) {
      this.currentRenderer?.destroy?.();
      this.currentRenderer = renderer;
    }
    let result: void | Promise<void>;
    try {
      result = renderer.render(
        t.content, this.content,
        {
          theme: this.theme,
          dataLang: t.forcedLang,
          isCurrent: () => seq === this.repaintSeq && this.active() === t,
          resolveLocalImage: this.hooks.resolveLocalImage,
        },
        t.path,
      );
    } catch (err) {
      this.showRenderError(t, err);
      return;
    }
    this.settleScroll(t, restoreScroll);
    if (result instanceof Promise) {
      return result.then(
        () => { if (seq === this.repaintSeq) this.settleScroll(t, restoreScroll); },
        (err) => { if (seq === this.repaintSeq) this.showRenderError(t, err); },
      );
    }
  }

  /** Build the split editor and its live Markdown/data preview. */
  private renderEditMode(t: Tab, restoreScroll: boolean): void {
      const split = document.createElement("div");
      split.className = "split-view";
      const edPane = document.createElement("div");
      edPane.className = "split-pane split-editor";
      const divider = document.createElement("div");
      divider.className = "split-divider";
      const prevPane = document.createElement("div");
      prevPane.className = "split-pane split-preview";
      split.append(edPane, divider, prevPane);
      this.content.replaceChildren(split);
      this.content.classList.add("editing");

      // ---- Drag the split divider (synchronous, no imports) ----
      let dragging = false;
      const onDivMove = (e: MouseEvent) => {
        if (!dragging) return;
        const rect = split.getBoundingClientRect();
        if (rect.width === 0) return;
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        const clamped = Math.max(20, Math.min(80, pct));
        edPane.style.width = `${clamped}%`;
        prevPane.style.width = `${100 - clamped}%`;
      };
      const onDivUp = () => {
        if (dragging) {
          dragging = false;
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
      };
      divider.addEventListener("mousedown", (e) => {
        e.preventDefault();
        dragging = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      });
      document.addEventListener("mousemove", onDivMove);
      document.addEventListener("mouseup", onDivUp);

      // ---- Sync scrolling (toggled on by default) ----
      let syncScrollEnabled = true;
      let syncing = false; // guard against mutual recursion

      const syncScroll = (from: HTMLElement, to: HTMLElement) => {
        if (!syncScrollEnabled || syncing) return;
        syncing = true;
        const pct = from.scrollTop / (from.scrollHeight - from.clientHeight || 1);
        to.scrollTop = pct * (to.scrollHeight - to.clientHeight || 1);
        syncing = false;
      };
      // Both panes sync each other via the scroll event on prevPane + the
      // editor's scroll event registered later once CodeMirror is ready.

      const syncBtn = document.createElement("button");
      syncBtn.className = "sync-toggle toggled";
      syncBtn.title = "Toggle sync scrolling";
      syncBtn.textContent = "🔗";
      syncBtn.addEventListener("click", () => {
        syncScrollEnabled = !syncScrollEnabled;
        syncBtn.classList.toggle("toggled", syncScrollEnabled);
        syncBtn.textContent = syncScrollEnabled ? "🔗" : "🔗";
        syncBtn.title = syncScrollEnabled ? "Sync scrolling (on)" : "Sync scrolling (off)";
      });

      // ---- Conflict indicator bar ----
      const conflictBar = document.createElement("div");
      conflictBar.className = "edit-conflict";
      conflictBar.hidden = true;
      conflictBar.innerHTML = `
        <span>⚠ File changed on disk</span>
        <button class="conflict-accept">Overwrite with mine</button>
        <button class="conflict-reload">Reload from disk</button>
      `;
      if (t.pendingDiskContent !== undefined) {
        conflictBar.hidden = false;
        conflictBar.dataset.diskContent = t.pendingDiskContent;
      }

      // ---- Show a plain textarea instantly, then upgrade to CodeMirror ----
      const textarea = document.createElement("textarea");
      textarea.className = "split-textarea";
      textarea.value = t.content;
      edPane.appendChild(textarea);

      const seq = this.repaintSeq;
      const fmt = effectiveFormat(t);
      let curText = t.content;
      let schedulePreview: () => void;

      if (fmt === "markdown") {
        // ---- Helper: wrap rendered HTML in a `.doc` container ----
        const setPreview = (html: string) => {
          const article = document.createElement("article");
          article.className = "doc";
          article.innerHTML = html;
          prevPane.replaceChildren(article);
          void resolveLocalImages(article, t.path, {
            theme: this.theme,
            isCurrent: () => seq === this.repaintSeq && this.active() === t,
            resolveLocalImage: this.hooks.resolveLocalImage,
          });
        };

        // ---- Initial preview: full render with math + mermaid ----
        (async () => {
          try {
            const { renderMarkdown, renderMath, hasMath, runPostRender } = await import("./render");
            if (seq !== this.repaintSeq) return;
            setPreview(await renderMarkdown(t.content));
            if (hasMath(t.content)) {
              try {
                const html = await renderMath(t.content);
                if (this.active() === t && seq === this.repaintSeq) setPreview(html);
              } catch { /* keep the base render */ }
            }
            await runPostRender(prevPane, this.theme);
          } catch { /* preview failure is non-fatal */ }
        })();

        // ---- Live preview (debounced, base render only — no math/mermaid) ----
        schedulePreview = () => {
          if (this.editPreviewTimer !== null) clearTimeout(this.editPreviewTimer);
          this.editPreviewTimer = setTimeout(async () => {
            this.editPreviewTimer = null;
            if (this.active() !== t) return;
            if (seq !== this.repaintSeq) return;
            const { renderMarkdown } = await import("./render");
            if (seq !== this.repaintSeq) return;
            try {
              setPreview(await renderMarkdown(curText));
            } catch { /* preview failure is non-fatal */ }
          }, 100);
        };

        schedulePreview();
      } else if (fmt === "data") {
        // ---- Data preview: parse + render tree (editable) ----
        let currentTreeView: TreeView | null = null;
        let suppressPreview = false;

        schedulePreview = () => {
          if (suppressPreview) return;
          if (this.editPreviewTimer !== null) clearTimeout(this.editPreviewTimer);
          this.editPreviewTimer = setTimeout(async () => {
            this.editPreviewTimer = null;
            if (this.active() !== t) return;
            if (seq !== this.repaintSeq) return;
            try {
              const { parseData, serializeData } = await import("./data/parse");
              const { renderStructuredComments } = await import("./data/comments");
              const { renderTree } = await import("./data/tree");
              if (seq !== this.repaintSeq) return;

              if (currentTreeView) {
                currentTreeView.destroy();
                currentTreeView = null;
                this.currentDataTree = null;
              }
              prevPane.replaceChildren();

              if (!curText.trim()) {
                prevPane.textContent = "(empty)";
                return;
              }

              const lang = t.forcedLang ?? dataLangOf(t.path);
              if (!lang) {
                prevPane.textContent = "Could not detect a data format";
                return;
              }

              const result = parseData(curText, lang);
              if (!result.ok || !result.value) {
                const errDiv = document.createElement("div");
                errDiv.className = "data-parse-error";
                errDiv.textContent = `Parse error: ${result.error?.message ?? "unknown"}`;
                prevPane.appendChild(errDiv);
                return;
              }

              renderStructuredComments(result.comments, prevPane);
              const treeWrap = document.createElement("div");
              treeWrap.className = "tree";
              prevPane.appendChild(treeWrap);
              currentTreeView = renderTree(result.value, treeWrap, {
                defaultDepth: 2,
                editable: true,
                onEdit: (val) => {
                  try {
                    const serialized = serializeData(val, lang, result.comments);
                    curText = serialized;
                    suppressPreview = true;
                    if (this.currentEditor) {
                      this.currentEditor.setValue(serialized);
                    } else {
                      textarea.value = serialized;
                    }
                    suppressPreview = false;
                    if (serialized !== t.content) {
                      t.editDirty = true;
                      this.renderTabbar();
                      this.hooks.onChange();
                    }
                  } catch {
                    suppressPreview = false;
                  }
                },
              });
              this.currentDataTree = currentTreeView;
            } catch (err) {
              prevPane.replaceChildren();
              const errDiv = document.createElement("div");
              errDiv.className = "data-parse-error";
              errDiv.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
              prevPane.appendChild(errDiv);
            }
          }, 100);
        };

        schedulePreview();
      }

      // ---- Sync button in preview pane toolbar ----
      const previewToolbar = document.createElement("div");
      previewToolbar.className = "preview-toolbar";
      previewToolbar.appendChild(syncBtn);
      prevPane.prepend(previewToolbar);

      // ---- Scroll sync between panes ----
      // Preview scroll → editor. Editor scroll → preview is registered later
      // once CodeMirror is ready (or via textarea scroll before upgrade).
      prevPane.addEventListener("scroll", () => {
        if (this.currentEditor) {
          syncScroll(prevPane, this.currentEditor.getScrollDOM());
        } else {
          syncScroll(prevPane, textarea);
        }
      });
      textarea.addEventListener("scroll", () => {
        syncScroll(textarea, prevPane);
      });

      // ---- Append conflict bar below split ----
      split.after(conflictBar);

      conflictBar.querySelector(".conflict-accept")?.addEventListener("click", () => {
        if (conflictBar.dataset.diskContent !== undefined) {
          conflictBar.hidden = true;
          delete conflictBar.dataset.diskContent;
          t.pendingDiskContent = undefined;
        }
      });

      conflictBar.querySelector(".conflict-reload")?.addEventListener("click", () => {
        const diskContent = conflictBar.dataset.diskContent;
        if (diskContent !== undefined) {
          t.content = diskContent;
          curText = diskContent;
          t.editDirty = false;
          t.pendingDiskContent = undefined;
          conflictBar.hidden = true;
          delete conflictBar.dataset.diskContent;
          schedulePreview();
          if (this.currentEditor) {
            this.currentEditor.setValue(diskContent);
          } else {
            textarea.value = diskContent;
          }
          this.renderTabbar();
          this.hooks.onChange();
        }
      });

      // ---- Textarea input (same for all formats) ----
      textarea.addEventListener("input", () => {
        curText = textarea.value;
        if (curText !== t.content) {
          t.editDirty = true;
          this.renderTabbar();
          this.hooks.onChange();
        }
        schedulePreview();
      });

      // ---- Async upgrade: replace textarea with CodeMirror ----
      (async () => {
        try {
          const ed = await import("./editor");
          if (seq !== this.repaintSeq) return;
          // Build off-DOM so the textarea remains usable until CodeMirror has
          // loaded successfully. This also gives us a disposable instance if a
          // tab switch supersedes the render while createEditor is awaiting.
          const editorHost = document.createElement("div");
          const editor = await ed.createEditor(editorHost, curText, this.theme, fmtToEditorLang(t));
          if (seq !== this.repaintSeq || this.active() !== t) {
            editor.destroy();
            return;
          }
          edPane.replaceChildren(editorHost);
          this.currentEditor = editor;

          editor.onUpdate((text) => {
            if (text !== (this.active()?.content ?? t.content)) {
              t.editDirty = true;
              this.renderTabbar();
              this.hooks.onChange();
            }
            curText = text;
            schedulePreview();
          });

          // Sync scroll from editor → preview
          editor.onScroll((scrollTop) => {
            if (!syncScrollEnabled || syncing) return;
            syncing = true;
            const pct = scrollTop / (editor.getScrollHeight() - editor.getClientHeight() || 1);
            prevPane.scrollTop = pct * (prevPane.scrollHeight - prevPane.clientHeight || 1);
            syncing = false;
          });

          // When the editor is destroyed later, clean up drag listeners
          const origDestroy = editor.destroy.bind(editor);
          const patchDestroy = () => {
            document.removeEventListener("mousemove", onDivMove);
            document.removeEventListener("mouseup", onDivUp);
            origDestroy();
          };
          editor.destroy = patchDestroy;

          if (seq === this.repaintSeq) this.settleScroll(t, restoreScroll);
        } catch { /* CodeMirror failed to load — keep the textarea fallback. */ }
      })();
  }

  /** Paint raw text immediately, then enhance recognized data with highlighting. */
  private renderRawMode(t: Tab, restoreScroll: boolean): void {
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
      loadHighlight().then((hljs) => {
        if (mySeq !== this.repaintSeq) return; // superseded by a newer repaint
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
      label.textContent = t.editDirty ? "● " + t.title : t.title;
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
