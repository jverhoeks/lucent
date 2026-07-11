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
import { iconMarkup } from "./icons";
import { HELP_TAB_PATH, HELP_TAB_TITLE, isHelpPath } from "./help";

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
  /** True while the file is being read from disk (placeholder tab). */
  loading?: boolean;
}

export interface WelcomeRecent {
  path: string;
  title: string;
}

export interface TabHooks {
  onChange: () => void; // tabs/active changed — refresh toolbar enabled state
  onTabClosed: (path: string) => void; // stop watching one closed document
  onCloseAll: () => void; // stop watching everything
  onSave?: (path: string, content: string) => Promise<string | null | void>; // save editor content to disk
  onSaveAs?: (path: string, content: string) => Promise<string | null | void>; // save editor content to a chosen path
  resolveLocalImage?: (basePath: string, relativePath: string) => Promise<string | null>;
  /** Recent files shown on the welcome screen (optional). */
  getRecentFiles?: () => WelcomeRecent[];
}

export function isScratchPath(path: string | undefined): boolean {
  return !!path?.startsWith(SCRATCH_PATH_PREFIX);
}

export { isHelpPath };

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

function buildConflictDiff(mine: string, disk: string): string {
  const mineLines = mine.split(/\r?\n/);
  const diskLines = disk.split(/\r?\n/);
  const max = Math.max(mineLines.length, diskLines.length);
  const rows: string[] = [];
  for (let i = 0; i < max; i++) {
    const mineLine = mineLines[i] ?? "";
    const diskLine = diskLines[i] ?? "";
    if (mineLine === diskLine) continue;
    rows.push(`L${i + 1}`);
    if (diskLines[i] !== undefined) rows.push(`- ${diskLine}`);
    if (mineLines[i] !== undefined) rows.push(`+ ${mineLine}`);
    if (rows.length > 120) {
      rows.push("… diff truncated");
      break;
    }
  }
  return rows.length ? rows.join("\n") : "No textual differences";
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
  /** Refreshes the split-pane preview after a conflict reload (set in edit mode). */
  private requestEditPreview: (() => void) | null = null;
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
    this.content.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".conflict-diff")) {
        e.preventDefault();
        this.toggleConflictDiff();
      } else if (target.closest(".conflict-accept")) {
        e.preventDefault();
        void this.acceptConflictMine();
      } else if (target.closest(".conflict-reload")) {
        e.preventDefault();
        this.reloadConflictFromDisk();
      }
    });
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
  getOpenTabs(): Array<{ path: string; title: string; dirty: boolean; active: boolean }> {
    return this.tabs.map((tab, index) => ({
      path: tab.path,
      title: tab.title,
      dirty: !!tab.editDirty,
      active: index === this.activeIndex,
    }));
  }
  snapshotSession(): SessionState {
    this.captureActiveDraft();
    const active = this.active();
    if (active) active.scrollTop = this.content.scrollTop;
    return {
      version: 1,
      activePath: active?.path === STDIN_PATH ? undefined : active?.path,
      tabs: this.tabs
        .filter((tab) => tab.path !== STDIN_PATH && !isHelpPath(tab.path))
        .map((tab) => ({
          path: tab.path,
          title: isScratchPath(tab.path) ? tab.title : undefined,
          content: isScratchPath(tab.path) ? tab.content : undefined,
          format: isScratchPath(tab.path) ? tab.format : undefined,
          forcedFormat: tab.forcedFormat,
          forcedLang: tab.forcedLang,
          mode: isScratchPath(tab.path) ? tab.mode : tab.mode === "raw" ? "raw" : "rendered",
          scrollTop: tab.scrollTop,
          follow: tab.follow,
          editDirty: isScratchPath(tab.path) ? tab.editDirty : undefined,
        })),
    };
  }

  restoreSessionTab(saved: SessionTab): void | Promise<void> {
    let tab = this.tabs.find((candidate) => candidate.path === saved.path);
    if (!tab && isScratchPath(saved.path) && typeof saved.content === "string") {
      tab = {
        path: saved.path,
        title: saved.title || basename(saved.path),
        content: saved.content,
        format: saved.format ?? "markdown",
        forcedFormat: saved.forcedFormat,
        forcedLang: saved.forcedLang,
        mode: saved.mode,
        scrollTop: saved.scrollTop,
        follow: saved.follow,
        editDirty: saved.editDirty ?? true,
      };
      this.tabs.push(tab);
      this.activeIndex = this.tabs.length - 1;
      this.renderTabbar();
    }
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

  /** True when the active tab is still waiting on a file read. */
  isActiveLoading(): boolean {
    return !!this.active()?.loading;
  }

  /** Show a placeholder tab while `path` is being opened. */
  beginOpen(path: string): void {
    const existing = this.tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      this.tabs[existing].loading = true;
      void this.activate(existing);
      return;
    }
    const format = detectFormat(path);
    this.tabs.push({
      path,
      title: basename(path),
      content: "",
      format,
      mode: format === "text" ? "raw" : "rendered",
      scrollTop: 0,
      loading: true,
    });
    void this.activate(this.tabs.length - 1);
  }

  /** Drop a failed open: remove an empty placeholder or clear the loading flag. */
  cancelOpen(path: string): void {
    const i = this.tabs.findIndex((t) => t.path === path);
    if (i < 0) return;
    const tab = this.tabs[i];
    if (tab.loading && !tab.editDirty && tab.content === "") {
      this.closeTab(i);
      return;
    }
    tab.loading = false;
    if (i === this.activeIndex) void this.repaint(false);
    else this.renderTabbar();
  }

  /** Open a file in a new tab, or activate (and refresh) an already-open one. */
  openOrActivate(path: string, content: string): void | Promise<void> {
    const existing = this.tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      this.tabs[existing].content = content;
      this.tabs[existing].loading = false;
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

  /** Open pasted/unsaved content in a new editable scratch tab. */
  openScratch(
    content: string,
    opts: { format?: Format; title?: string; extension?: string; forcedLang?: DataLang } = {},
  ): void | Promise<void> {
    const existing = this.tabs.filter((t) => isScratchPath(t.path)).length;
    const n = existing + 1;
    const format = opts.format ?? "markdown";
    const extension = opts.extension ?? (format === "markdown" ? "md" : format === "log" ? "log" : "txt");
    const title = opts.title ?? (n === 1 ? `Pasted.${extension}` : `Pasted ${n}.${extension}`);
    this.tabs.push({
      path: `${SCRATCH_PATH_PREFIX}${Date.now()}-${n}.${extension}>`,
      title,
      content,
      format,
      forcedLang: opts.forcedLang,
      mode: "edit",
      scrollTop: 0,
      editDirty: true,
    });
    return this.activate(this.tabs.length - 1);
  }

  /** Open pasted/unsaved Markdown in a new editable scratch tab. */
  openScratchMarkdown(content: string): void | Promise<void> {
    return this.openScratch(content, { format: "markdown", extension: "md" });
  }

  /** Open (or focus) the built-in Help guide as a rendered Markdown tab. */
  openHelpDocument(content: string): void | Promise<void> {
    const existing = this.tabs.findIndex((t) => t.path === HELP_TAB_PATH);
    if (existing >= 0) {
      this.tabs[existing].content = content;
      this.tabs[existing].format = "markdown";
      this.tabs[existing].mode = "rendered";
      this.tabs[existing].editDirty = false;
      return this.activate(existing);
    }
    this.tabs.push({
      path: HELP_TAB_PATH,
      title: HELP_TAB_TITLE,
      content,
      format: "markdown",
      mode: "rendered",
      scrollTop: 0,
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
      this.tabs[existing].loading = false;
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
      loading: false,
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
  private externalEditConflict(_t: Tab, _diskContent: string): void {
    this.showConflictBar();
  }

  private conflictBar(): HTMLElement | null {
    return this.content.querySelector<HTMLElement>(".edit-conflict");
  }

  private showConflictBar(): void {
    const bar = this.conflictBar();
    if (bar) bar.hidden = false;
  }

  private dismissConflictBar(): void {
    const bar = this.conflictBar();
    if (!bar) return;
    bar.hidden = true;
    const diff = bar.querySelector<HTMLElement>(".conflict-diff-view");
    if (diff) {
      diff.hidden = true;
      diff.textContent = "";
    }
  }

  private toggleConflictDiff(): void {
    const t = this.active();
    const disk = t?.pendingDiskContent;
    if (!t || disk === undefined) return;
    const diff = this.conflictBar()?.querySelector<HTMLElement>(".conflict-diff-view");
    if (!diff) return;
    if (diff.hidden) {
      const mine = this.activeEditorValue() ?? t.content;
      diff.textContent = buildConflictDiff(mine, disk);
    }
    diff.hidden = !diff.hidden;
  }

  /** Keep the editor buffer and write it over the newer on-disk version. */
  private async acceptConflictMine(): Promise<void> {
    const t = this.active();
    if (!t || t.pendingDiskContent === undefined) return;
    const editorValue = this.activeEditorValue();
    if (editorValue !== null) t.content = editorValue;
    if (!t.editDirty && editorValue !== null) t.editDirty = true;
    const saved = await this.saveActive();
    if (!saved) return;
    this.dismissConflictBar();
  }

  /** Discard local edits and load the on-disk version into the editor. */
  private reloadConflictFromDisk(): void {
    const t = this.active();
    const disk = t?.pendingDiskContent;
    if (!t || disk === undefined) return;
    t.content = disk;
    t.editDirty = false;
    t.pendingDiskContent = undefined;
    if (this.currentEditor) this.currentEditor.setValue(disk);
    else {
      const textarea = this.content.querySelector<HTMLTextAreaElement>(".split-textarea");
      if (textarea) textarea.value = disk;
    }
    this.requestEditPreview?.();
    this.dismissConflictBar();
    this.renderTabbar();
    this.hooks.onChange();
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
      this.showWelcome();
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
    this.showWelcome();
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
    const merged = this.applySavedContent(t, nextContent, savedPath);
    this.renderTabbar();
    this.hooks.onChange();
    if (merged) await this.repaint(true);
    return true;
  }

  /** Save the active tab to a user-chosen path. Returns true if saved. */
  async saveActiveAs(): Promise<boolean> {
    const t = this.active();
    if (!t || t.windowed || !this.hooks.onSaveAs) return false;
    const nextContent = this.activeEditorValue() ?? t.content;
    const savedPath = await this.hooks.onSaveAs(t.path, nextContent);
    if (savedPath === null) return false;
    const merged = this.applySavedContent(t, nextContent, savedPath);
    this.renderTabbar();
    this.hooks.onChange();
    if (merged) await this.repaint(true);
    return true;
  }

  /** Returns true when a scratch save merged into an already-open tab. */
  private applySavedContent(t: Tab, content: string, savedPath?: string | void): boolean {
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
        return true;
      }
      t.path = savedPath;
      t.title = basename(savedPath);
      t.format = detectFormat(savedPath);
      t.forcedFormat = undefined;
      t.forcedLang = undefined;
    }
    t.content = content;
    t.editDirty = false;
    if (t.pendingDiskContent !== undefined) {
      t.pendingDiskContent = undefined;
      this.dismissConflictBar();
    }
    return false;
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
    this.requestEditPreview = null;
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
    if (!t) { this.showWelcome(); return; }
    if (t.loading) { this.showTabLoading(t); return; }

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
      const conflictBar = document.createElement("div");
      conflictBar.className = "edit-conflict";
      conflictBar.setAttribute("role", "alert");
      conflictBar.hidden = true;
      const conflictMsg = document.createElement("span");
      conflictMsg.className = "conflict-message";
      const conflictTitle = document.createElement("strong");
      conflictTitle.textContent = t.title;
      conflictMsg.append(conflictTitle, " changed on disk while you were editing.");
      const diffBtn = document.createElement("button");
      diffBtn.type = "button";
      diffBtn.className = "conflict-diff";
      diffBtn.textContent = "Show changes";
      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "conflict-accept";
      acceptBtn.textContent = "Keep my version";
      const reloadBtn = document.createElement("button");
      reloadBtn.type = "button";
      reloadBtn.className = "conflict-reload";
      reloadBtn.textContent = "Use file on disk";
      const diffView = document.createElement("pre");
      diffView.className = "conflict-diff-view";
      diffView.hidden = true;
      conflictBar.append(conflictMsg, diffBtn, acceptBtn, reloadBtn, diffView);
      if (t.pendingDiskContent !== undefined) conflictBar.hidden = false;

      const split = document.createElement("div");
      split.className = "split-view";
      const edPane = document.createElement("div");
      edPane.className = "split-pane split-editor";
      const divider = document.createElement("div");
      divider.className = "split-divider";
      const prevPane = document.createElement("div");
      prevPane.className = "split-pane split-preview";
      split.append(edPane, divider, prevPane);
      this.content.replaceChildren(conflictBar, split);
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
      syncBtn.type = "button";
      syncBtn.className = "sync-toggle";
      const setSyncButton = (on: boolean) => {
        syncScrollEnabled = on;
        syncBtn.classList.toggle("active", on);
        syncBtn.setAttribute("aria-pressed", String(on));
        syncBtn.innerHTML = iconMarkup(on ? "ic-link" : "ic-unlink");
        syncBtn.title = on ? "Sync scrolling (on)" : "Sync scrolling (off)";
        syncBtn.setAttribute("aria-label", syncBtn.title);
      };
      setSyncButton(true);
      syncBtn.addEventListener("click", () => setSyncButton(!syncScrollEnabled));

      // ---- Show a plain textarea instantly, then upgrade to CodeMirror ----
      const textarea = document.createElement("textarea");
      textarea.className = "split-textarea";
      textarea.value = t.content;
      edPane.appendChild(textarea);

      const seq = this.repaintSeq;
      const fmt = effectiveFormat(t);
      let curText = t.content;
      let schedulePreview: () => void = () => {};

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

      this.requestEditPreview = () => {
        curText = this.activeEditorValue() ?? textarea.value;
        schedulePreview();
      };

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
  /** Placeholder while the active tab's file is still being read. */
  private showTabLoading(t: Tab): void {
    this.currentVlog?.destroy();
    this.currentVlog = null;
    this.currentLog = null;
    this.currentVlogLines = null;
    this.currentRenderer?.destroy?.();
    this.currentRenderer = null;
    this.content.replaceChildren();
    const panel = document.createElement("div");
    panel.className = "tab-loading";
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.setAttribute("aria-label", `Opening ${t.title}`);
    const spinner = document.createElement("span");
    spinner.className = "tab-loading-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const title = document.createElement("p");
    title.className = "tab-loading-title";
    title.textContent = `Opening ${t.title}`;
    const hint = document.createElement("p");
    hint.className = "tab-loading-hint";
    hint.textContent = "Reading from disk…";
    panel.append(spinner, title, hint);
    this.content.appendChild(panel);
  }

  /** Empty-state screen shown when no documents are open. */
  private showWelcome(): void {
    this.currentVlog?.destroy();
    this.currentVlog = null;
    this.currentLog = null;
    this.currentVlogLines = null;
    this.currentRenderer?.destroy?.();
    this.currentRenderer = null;
    this.content.replaceChildren();
    const welcome = document.createElement("div");
    welcome.className = "welcome";
    const mark = document.createElement("div");
    mark.className = "welcome-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "◇";
    const title = document.createElement("h1");
    title.className = "welcome-title";
    title.textContent = "Lucent";
    const lead = document.createElement("p");
    lead.className = "welcome-lead";
    lead.textContent =
      "Open a file to read Markdown, structured data, or logs — rendered cleanly, with editing when you need it.";
    const actions = document.createElement("div");
    actions.className = "welcome-actions";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "welcome-btn primary";
    openBtn.dataset.welcome = "open";
    openBtn.textContent = "Open file…";
    const pasteBtn = document.createElement("button");
    pasteBtn.type = "button";
    pasteBtn.className = "welcome-btn";
    pasteBtn.dataset.welcome = "paste";
    pasteBtn.textContent = "Paste into new document";
    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "welcome-btn";
    helpBtn.dataset.welcome = "help";
    helpBtn.textContent = "Help";
    actions.append(openBtn, pasteBtn, helpBtn);
    const drop = document.createElement("div");
    drop.className = "welcome-drop";
    drop.setAttribute("aria-hidden", "true");
    drop.textContent = "Drop files anywhere to open";
    const recent = this.hooks.getRecentFiles?.() ?? [];
    if (recent.length > 0) {
      const recentBlock = document.createElement("div");
      recentBlock.className = "welcome-recent";
      const recentTitle = document.createElement("h2");
      recentTitle.className = "welcome-recent-title";
      recentTitle.textContent = "Recent";
      const recentList = document.createElement("ul");
      recentList.className = "welcome-recent-list";
      for (const file of recent.slice(0, 5)) {
        const item = document.createElement("li");
        const row = document.createElement("button");
        row.type = "button";
        row.className = "welcome-recent-item";
        row.dataset.welcome = "recent";
        row.dataset.path = file.path;
        row.title = file.path;
        const name = document.createElement("span");
        name.className = "welcome-recent-name";
        name.textContent = file.title;
        const path = document.createElement("span");
        path.className = "welcome-recent-path";
        path.textContent = file.path;
        row.append(name, path);
        item.appendChild(row);
        recentList.appendChild(item);
      }
      recentBlock.append(recentTitle, recentList);
      welcome.append(mark, title, lead, actions, drop, recentBlock);
    } else {
      welcome.append(mark, title, lead, actions, drop);
    }
    const shortcuts = document.createElement("ul");
    shortcuts.className = "welcome-shortcuts";
    for (const text of [
      "F1 or ⌘/Ctrl+? help",
      "⌘/Ctrl+P quick switch",
      "⌘/Ctrl+F find in document",
    ]) {
      const li = document.createElement("li");
      li.textContent = text;
      shortcuts.appendChild(li);
    }
    welcome.appendChild(shortcuts);
    this.content.appendChild(welcome);
  }

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
      tab.className = "tab"
        + (active ? " active" : "")
        + (t.loading ? " loading" : "")
        + (t.editDirty ? " dirty" : "");
      tab.title = t.path;
      // a11y: expose tab semantics + selected state, and make tabs focusable
      // with roving tabindex (only the active tab is in the tab order).
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("aria-busy", String(!!t.loading));
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

      if (t.loading) {
        const spinner = document.createElement("span");
        spinner.className = "tab-spinner";
        spinner.setAttribute("aria-hidden", "true");
        tab.append(spinner);
      }

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = t.title;
      label.addEventListener("click", () => this.activate(i));

      const close = document.createElement("button");
      close.className = "close-btn";
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
