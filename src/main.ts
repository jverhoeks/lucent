import "./styles.css";
import { HELP_MARKDOWN, parseExampleLink } from "./help";
import { isHelpPath, isScratchPath, TabManager } from "./tabs";
import { applyCodeTheme } from "./render";
import { loadSettings, saveSettings } from "./settings";
import { copyAsMarkdown, copyAsRichText } from "./clipboard";
import { AppError, StyleSettings, Format, DataLang } from "./types";
import { SearchController } from "./search/controller";
import { createSearchProvider } from "./search/factory";
import { SearchBar } from "./search/bar";
import { getCurrentTree } from "./renderers/data";
import { initStdin } from "./stdin";
import { detectFormat, siblingIndex, basename } from "./format";
import { guessPasteScratch } from "./paste-guess";
import { injectSprite, setButtonIcon } from "./icons";
import { readingTimeLabel } from "./reading-time";
import { restoreSessionTabs, saveSession } from "./session";
import { DocumentOutline } from "./outline";
import { loadRecentFiles, rememberRecentFile, type RecentFile } from "./recent";
import type { PlatformAdapter } from "./platform/types";
import { saveTextAsFile } from "./save";
import { ExportActions, refreshDownloadOptions } from "./export-actions";

const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "mdown", "mkd", "txt", "text", "log", "json", "yaml", "yml",
  "toml", "ini", "csv", "tsv", "xml", "html", "htm", "css", "js", "ts", "jsx",
  "tsx", "py", "rb", "rs", "go", "java", "c", "cpp", "h", "hpp", "sh", "bash",
  "zsh", "fish", "env", "gitignore", "dockerfile", "cfg", "conf",
]);

type DropProbeAdapter = Pick<
  PlatformAdapter,
  "fileSize" | "listViewableRecursive" | "probeIsText"
>;

/** True when the event target is inside a field that should receive normal paste. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    "input, textarea, select, [contenteditable], .cm-editor, .cm-content, .cm-line",
  );
}

async function isTextFile(path: string, adapter: DropProbeAdapter): Promise<boolean> {
  try {
    const ext = path.split("/").pop()?.split(".").pop()?.toLowerCase();
    if (ext && TEXT_EXTENSIONS.has(ext)) return true;
    const size = await adapter.fileSize(path);
    if (size > 1_048_576) return false;
    return await adapter.probeIsText(path, 512);
  } catch {
    return false;
  }
}

/** Expand dropped files/directories in root order and count every candidate
 * rejected by text probing or filesystem errors. */
export async function collectTextDropPaths(
  roots: string[],
  adapter: DropProbeAdapter,
): Promise<{ paths: string[]; skipped: number }> {
  const paths: string[] = [];
  let skipped = 0;
  for (const root of roots) {
    let children: string[];
    try {
      children = await adapter.listViewableRecursive(root);
    } catch {
      skipped++;
      continue;
    }
    for (const child of children) {
      if (await isTextFile(child, adapter)) paths.push(child);
      else skipped++;
    }
  }
  return { paths, skipped };
}

export function initApp(adapter: PlatformAdapter): void {
  injectSprite();
  const tabbar = document.getElementById("tabbar")!;
  const tabstrip = document.getElementById("tabstrip")!;
  const content = document.getElementById("content")!;
  const banner = document.getElementById("banner")!;
  let settings: StyleSettings = loadSettings();
  let restoringSession = false;
  let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let outline: DocumentOutline | null = null;
  let outlinePinned = false;
  const isWeb = adapter.platform === "web";
  const downloadsFiles = adapter.capabilities?.downloads ?? isWeb;
  const watchesFiles = adapter.capabilities?.watching ?? !isWeb;
  const diagnostics: Array<{ time: string; message: string }> = [];

  const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;

  const search = new SearchController();
  const searchBar = new SearchBar(search);

  /** Re-bind the search provider to the freshly-rendered content. */
  function rebindSearch() {
    if (!searchBar.isOpen()) return;
    search.setProvider(createSearchProvider({
      format: manager.getActiveFormat(),
      mode: manager.getActiveMode(),
      windowed: manager.isActiveWindowed(),
      content,
      virtualLogView: manager.getActiveVirtualLogView(),
      logLines: manager.getActiveLogLines(),
      path: manager.getActivePath(),
      tree: getCurrentTree(),
      logSearch: (path, q) =>
        adapter.logSearch(path, q.text, q.caseSensitive, q.regex),
      onUpdate: () => search.refresh(),
      onError: (error) => showBanner(
        `Log search failed — ${error instanceof Error ? error.message : String(error)}. Retry the search.`,
      ),
    }));
  }

  const manager = new TabManager(tabbar, content, settings, {
    onChange: () => { refreshToolbar(); rebindSearch(); refreshOutline(); scheduleSessionSave(); },
    onTabClosed: (path) => { if (watchesFiles && !isScratchPath(path)) void adapter.unwatchFile(path); },
    onCloseAll: () => void adapter.unwatchAll(),
    onSave: async (path, content, expectedContent) => {
      if (isScratchPath(path)) {
        return saveTextAsFile(adapter, path, content);
      }
      return adapter.saveTextFile(path, content, expectedContent);
    },
    onSaveAs: (path, content) => saveTextAsFile(adapter, path, content),
    resolveLocalImage: adapter.localImageUrl
      ? (basePath, relativePath) => adapter.localImageUrl!(basePath, relativePath)
      : async () => null,
    getRecentFiles: () => loadRecentFiles().map((file) => ({
      path: file.path,
      title: file.title,
    })),
  });
  const exportActions = new ExportActions({
    adapter,
    manager,
    content,
    downloadsFiles,
    getTheme: () => settings.theme,
    showBanner,
  });

  const outlineElement = document.getElementById("outline");
  if (outlineElement) {
    outline = new DocumentOutline(outlineElement, content);
    new MutationObserver(refreshOutline).observe(content, { childList: true, subtree: true });
  }

  function refreshOutline(): void {
    const enabled = manager.getActiveFormat() === "markdown" && manager.getActiveMode() === "rendered";
    outline?.refresh(enabled);
    const outlineEl = document.getElementById("outline");
    if (outlineEl) outlineEl.classList.toggle("outline-pinned", outlinePinned);
    const outlineBtn = document.getElementById("btn-outline");
    if (outlineBtn instanceof HTMLButtonElement) {
      const hasOutline = Boolean(enabled && outlineEl && !outlineEl.hidden);
      outlineBtn.hidden = !enabled;
      outlineBtn.disabled = !hasOutline;
      outlineBtn.classList.toggle("toggled", outlinePinned && hasOutline);
      outlineBtn.setAttribute("aria-pressed", String(outlinePinned && hasOutline));
    }
  }

  function persistSession(): void {
    if (adapter.platform === "tauri" && !restoringSession) {
      if (!saveSession(manager.snapshotSession())) {
        showBanner("Draft recovery is unavailable: session storage is full or inaccessible");
      }
    }
  }

  function scheduleSessionSave(): void {
    if (adapter.platform !== "tauri" || restoringSession) return;
    if (sessionSaveTimer !== null) clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(() => {
      sessionSaveTimer = null;
      persistSession();
    }, 100);
  }

  if (adapter.platform === "tauri") {
    initStdin(manager);
  }
  applyCodeTheme(settings.theme);
  manager.applyStyle(settings);
  if (typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (settings.theme === "system") {
        applyCodeTheme("system");
        manager.applyStyle(settings);
        manager.rerenderActive();
      }
    });
  }

  function refreshToolbar() {
    const has = manager.count() > 0;
    const loading = manager.isActiveLoading();
    for (const id of [
      "btn-paste-new",
      "btn-search",
      "btn-toggle",
      "btn-tail",
      "btn-next",
      "btn-save-as",
      "btn-copy-md",
      "btn-copy-rich",
    ]) {
      btn(id).disabled = id === "btn-paste-new"
        ? typeof navigator.clipboard?.readText !== "function"
        : id === "btn-save-as"
          ? !has || manager.isActiveWindowed() || loading
          : !has || loading;
    }
    tabstrip.hidden = !has;

    const isRaw = manager.getActiveMode() === "raw";
    const isEdit = manager.getActiveMode() === "edit";
    const toggle = btn("btn-toggle");
    setButtonIcon(toggle, isRaw ? "ic-code" : "ic-eye", isRaw ? "Raw" : "Rendered");
    toggle.classList.toggle("toggled", isRaw);
    toggle.setAttribute("aria-pressed", String(isRaw));
    toggle.hidden = isEdit;

    const tail = btn("btn-tail");
    const isLog = manager.getActiveFormat() === "log";
    tail.hidden = !watchesFiles || !isLog || isEdit;
    tail.classList.toggle("toggled", manager.isFollowing());
    tail.setAttribute("aria-pressed", String(manager.isFollowing()));

    const editBtn = btn("btn-edit");
    const saveBtn = btn("btn-save");
    const fmt = manager.getActiveFormat();
    editBtn.disabled = loading || !has || isHelpPath(manager.getActivePath())
      || (fmt !== "markdown" && fmt !== "data");
    setButtonIcon(editBtn, isEdit ? "ic-check" : "ic-pencil", isEdit ? "Done" : "Edit");
    editBtn.classList.toggle("toggled", isEdit);
    saveBtn.hidden = !isEdit;
    saveBtn.disabled = !manager.isEditing();

    refreshDownloadOptions(document.querySelector<HTMLSelectElement>(".download-format")!, has, fmt);
    dlSelect.disabled = loading || !has;
    for (const sel of ["toolbar-export", "toolbar-copy"] as const) {
      document.querySelector<HTMLElement>(`.${sel}`)?.toggleAttribute("hidden", !has);
    }

    // Reading-time estimate — Markdown only; hidden for data/log/text tabs.
    const readingTime = document.getElementById("reading-time");
    if (readingTime) {
      const label = fmt === "markdown" ? readingTimeLabel(manager.getActiveRawText()) : "";
      readingTime.textContent = label;
      readingTime.hidden = label === "";
    }
  }

  const diagnosticPattern = /couldn('|’)t|failed|blocked|removed|unavailable|error/i;

  function renderDiagnostics(): void {
    const badge = document.getElementById("diagnostics-badge");
    if (badge) {
      const count = diagnostics.length;
      badge.textContent = count > 9 ? "9+" : String(count);
      badge.hidden = count === 0;
    }
    const list = document.getElementById("diagnostics-list");
    if (!list) return;
    list.replaceChildren();
    if (diagnostics.length === 0) {
      const empty = document.createElement("div");
      empty.className = "diagnostics-empty";
      empty.textContent = "No diagnostics";
      list.appendChild(empty);
      return;
    }
    for (const entry of diagnostics) {
      const row = document.createElement("div");
      row.className = "diagnostics-row";
      const time = document.createElement("span");
      time.className = "diagnostics-time";
      time.textContent = entry.time;
      const message = document.createElement("span");
      message.className = "diagnostics-message";
      message.textContent = entry.message;
      row.append(time, message);
      list.appendChild(row);
    }
  }

  function recordDiagnostic(msg: string): void {
    diagnostics.unshift({
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      message: msg,
    });
    diagnostics.splice(50);
    renderDiagnostics();
  }

  function showBanner(msg: string) {
    if (diagnosticPattern.test(msg)) recordDiagnostic(msg);
    banner.textContent = msg;
    banner.hidden = false;
    setTimeout(() => (banner.hidden = true), 4000);
  }

  const LANG_EXT: Record<string, string> = {
    javascript: "js", js: "js", typescript: "ts", ts: "ts", python: "py", py: "py",
    rust: "rs", rs: "rs", bash: "sh", sh: "sh", shell: "sh", json: "json", html: "html",
    css: "css", go: "go", java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs",
    yaml: "yaml", yml: "yml", sql: "sql", markdown: "md", md: "md",
  };

  function suggestedCodeName(block: Element): string {
    const filename = block.getAttribute("data-filename");
    if (filename) return filename;
    const lang = (block.getAttribute("data-lang") || "").toLowerCase();
    const ext = LANG_EXT[lang] || lang || "txt";
    return `snippet.${ext}`;
  }

  function codeSourceOf(block: Element): string {
    return block.getAttribute("data-src") ?? "";
  }

  async function readPath(path: string, quiet = false): Promise<string | null> {
    try {
      const payload = await adapter.readFile(path);
      return payload.content;
    } catch (e) {
      const msg = (e as AppError)?.message ?? String(e);
      if (!quiet) showBanner(`Couldn't open ${path} — ${msg}`);
      return null;
    }
  }

  const WINDOW_THRESHOLD = 5 * 1024 * 1024;

  async function openPath(path: string, quiet = false) {
    if (!quiet) manager.beginOpen(path);
    try {
      if (detectFormat(path) === "log") {
        try {
          const size = await adapter.fileSize(path);
          if (size > WINDOW_THRESHOLD) {
            const lineCount = await adapter.logOpen(path);
            manager.openWindowedLog(
              path,
              lineCount,
              (start, count) => adapter.logWindow(path, start, count),
            );
            await adapter.watchFile(path);
            rememberRecentFile(path);
            return;
          }
        } catch {
          // fall through
        }
      }
      const fileContent = await readPath(path, quiet);
      if (fileContent === null) {
        if (!quiet) manager.cancelOpen(path);
        return;
      }
      manager.openOrActivate(path, fileContent);
      await adapter.watchFile(path);
      rememberRecentFile(path);
    } catch (err) {
      if (!quiet) manager.cancelOpen(path);
      if (!quiet) {
        const msg = (err as AppError)?.message ?? String(err);
        showBanner(`Couldn't open ${basename(path)} — ${msg}`);
      }
    }
  }

  async function openMany(paths: string[]) {
    for (const p of paths) await openPath(p);
  }

  function openHelp(): void {
    void manager.openHelpDocument(HELP_MARKDOWN);
  }

  async function openExampleLink(href: string): Promise<void> {
    const rel = parseExampleLink(href);
    if (!rel || !adapter.resolveExample) {
      showBanner("Examples are not available in this build.");
      return;
    }
    const path = await adapter.resolveExample(rel);
    if (!path) {
      showBanner(`Example not found: ${rel}`);
      return;
    }
    await openPath(path);
  }

  const toolbarEl = document.getElementById("toolbar")!;
  const syncToolbarHeight = () =>
    document.documentElement.style.setProperty("--toolbar-h", `${toolbarEl.offsetHeight}px`);
  new ResizeObserver(syncToolbarHeight).observe(toolbarEl);
  syncToolbarHeight();

  btn("btn-help").addEventListener("click", () => openHelp());

  btn("btn-open").addEventListener("click", async () => {
    const sel = await adapter.openDialog({
      multiple: true,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] },
        { name: "Text", extensions: ["txt", "log", "text"] },
        { name: "Data", extensions: ["json", "yaml", "yml", "toml", "ini"] },
      ],
    });
    if (Array.isArray(sel)) await openMany(sel);
    else if (typeof sel === "string") await openPath(sel);
  });

  async function pasteIntoNewDoc(): Promise<void> {
    if (typeof navigator.clipboard?.readText !== "function") {
      showBanner("Clipboard read is not available");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        showBanner("Clipboard is empty");
        return;
      }
      const guess = guessPasteScratch(text);
      await manager.openScratch(text, guess);
      showBanner(`Pasted into ${guess.title}`);
    } catch (err) {
      showBanner(`Couldn't read clipboard — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  btn("btn-paste-new").addEventListener("click", () => {
    void pasteIntoNewDoc();
  });

  btn("btn-outline")?.addEventListener("click", () => {
    outlinePinned = !outlinePinned;
    refreshOutline();
  });
  btn("btn-search").addEventListener("click", () => {
    if (manager.count() === 0) return;
    searchBar.toggle();
    rebindSearch();
  });

  window.addEventListener("keydown", (e) => {
    const inEditable = isEditableTarget(e.target);
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v" && !inEditable) {
      e.preventDefault();
      void pasteIntoNewDoc();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      if (manager.count() === 0) return;
      e.preventDefault();
      searchBar.open();
      rebindSearch();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      openQuickSwitch();
    }
    if (e.key === "F1" || ((e.metaKey || e.ctrlKey) && e.key === "?")) {
      e.preventDefault();
      openHelp();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
      if (manager.count() > 0) { e.preventDefault(); manager.closeActiveTab(); }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      if (e.shiftKey) {
        if (manager.count() === 0 || manager.isActiveWindowed()) return;
        e.preventDefault();
        void manager.saveActiveAs().catch((err) =>
          showBanner(`Save As failed — ${err instanceof Error ? err.message : String(err)}`)
        );
        return;
      }
      if (manager.isEditing()) {
        e.preventDefault();
        void manager.saveActive().catch((err) =>
          showBanner(`Save failed — ${err instanceof Error ? err.message : String(err)}`)
        );
      }
    }
  });

  btn("btn-toggle").addEventListener("click", () => manager.toggleMode());
  btn("btn-edit").addEventListener("click", () => {
    const result = manager.toggleEdit();
    if (result instanceof Promise) {
      void result.catch((err) =>
        showBanner(`Save failed — ${err instanceof Error ? err.message : String(err)}`)
      );
    }
  });
  btn("btn-save").addEventListener("click", () => {
    void manager.saveActive().catch((err) =>
      showBanner(`Save failed — ${err instanceof Error ? err.message : String(err)}`)
    );
  });
  btn("btn-save-as").addEventListener("click", () => {
    void manager.saveActiveAs().catch((err) =>
      showBanner(`Save As failed — ${err instanceof Error ? err.message : String(err)}`)
    );
  });
  btn("btn-tail").addEventListener("click", () => manager.toggleFollow());
  btn("btn-close-all").addEventListener("click", () => manager.closeAll());

  const diagnosticsPanel = document.createElement("div");
  diagnosticsPanel.id = "diagnostics-panel";
  diagnosticsPanel.hidden = true;
  diagnosticsPanel.innerHTML = `
    <div class="diagnostics-panel-inner" role="dialog" aria-modal="true" aria-label="Diagnostics">
      <div class="diagnostics-head">
        <strong>Diagnostics</strong>
        <button type="button" id="btn-diagnostics-close" aria-label="Close diagnostics">×</button>
      </div>
      <div id="diagnostics-list"></div>
    </div>
  `;
  document.body.appendChild(diagnosticsPanel);
  renderDiagnostics();
  const diagnosticsBtn = btn("btn-diagnostics");
  const setDiagnosticsOpen = (open: boolean) => {
    diagnosticsPanel.hidden = !open;
    diagnosticsBtn.setAttribute("aria-expanded", String(open));
    if (open) document.getElementById("btn-diagnostics-close")?.focus();
    else diagnosticsBtn.focus();
  };
  diagnosticsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setDiagnosticsOpen(Boolean(diagnosticsPanel.hidden));
    renderDiagnostics();
  });
  document.getElementById("btn-diagnostics-close")?.addEventListener("click", () => {
    setDiagnosticsOpen(false);
  });
  document.addEventListener("click", (e) => {
    if (diagnosticsPanel.hidden) return;
    const inner = diagnosticsPanel.querySelector(".diagnostics-panel-inner");
    if (
      inner
      && !inner.contains(e.target as Node)
      && !diagnosticsBtn.contains(e.target as Node)
    ) {
      setDiagnosticsOpen(false);
    }
  });
  diagnosticsPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setDiagnosticsOpen(false);
    }
  });

  type QuickItem =
    | { kind: "tab"; path: string; title: string; detail: string; dirty: boolean; active: boolean }
    | { kind: "recent"; path: string; title: string; detail: string };

  const quick = document.createElement("div");
  quick.id = "quick-switcher";
  quick.hidden = true;
  quick.innerHTML = `
    <div class="quick-panel" role="dialog" aria-modal="true" aria-label="Quick switch">
      <input class="quick-input" type="text" role="combobox" aria-label="Quick switch" aria-controls="quick-list" aria-expanded="true" aria-autocomplete="list" placeholder="Open tab or recent file" />
      <div id="quick-list" class="quick-list" role="listbox" aria-label="Documents"></div>
      <div class="quick-footer">↑↓ navigate · Enter open · Esc close</div>
    </div>
  `;
  document.body.appendChild(quick);
  const quickInput = quick.querySelector<HTMLInputElement>(".quick-input")!;
  const quickList = quick.querySelector<HTMLElement>(".quick-list")!;
  let quickItems: QuickItem[] = [];
  let quickSelected = 0;
  let quickReturnFocus: HTMLElement | null = null;

  function quickSourceItems(): QuickItem[] {
    const tabs = manager.getOpenTabs().map((tab): QuickItem => ({
      kind: "tab",
      path: tab.path,
      title: tab.title,
      detail: tab.active ? "Open tab - active" : "Open tab",
      dirty: tab.dirty,
      active: tab.active,
    }));
    const openPaths = new Set(tabs.map((tab) => tab.path));
    const recent = loadRecentFiles()
      .filter((file: RecentFile) => !openPaths.has(file.path))
      .map((file): QuickItem => ({
        kind: "recent",
        path: file.path,
        title: file.title,
        detail: "Recent file",
      }));
    return [...tabs, ...recent];
  }

  function renderQuickRow(item: QuickItem, index: number): HTMLButtonElement {
    const row = document.createElement("button");
    row.type = "button";
    row.id = `quick-option-${index}`;
    row.className = "quick-item" + (index === quickSelected ? " selected" : "");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === quickSelected));
    row.innerHTML = `
      <span class="quick-title"></span>
      <span class="quick-detail"></span>
      <span class="quick-path"></span>
    `;
    row.querySelector(".quick-title")!.textContent =
      `${item.kind === "tab" && item.dirty ? "* " : ""}${item.title}`;
    row.querySelector(".quick-detail")!.textContent = item.detail;
    row.querySelector(".quick-path")!.textContent = item.path;
    row.addEventListener("mouseenter", () => { quickSelected = index; renderQuick(); });
    row.addEventListener("click", () => { void chooseQuick(index); });
    return row;
  }

  function renderQuick(): void {
    const q = quickInput.value.trim().toLowerCase();
    const filtered = quickSourceItems().filter((item) =>
      !q || item.title.toLowerCase().includes(q) || item.path.toLowerCase().includes(q),
    );
    const tabs = filtered.filter((item) => item.kind === "tab");
    const recents = filtered.filter((item) => item.kind === "recent");
    quickItems = [...tabs, ...recents];
    quickSelected = Math.min(quickSelected, Math.max(0, quickItems.length - 1));
    quickList.replaceChildren();
    if (quickItems.length === 0) {
      quickInput.removeAttribute("aria-activedescendant");
      const empty = document.createElement("div");
      empty.className = "quick-empty";
      empty.textContent = "No matches";
      quickList.appendChild(empty);
      return;
    }
    quickInput.setAttribute("aria-activedescendant", `quick-option-${quickSelected}`);
    let index = 0;
    const addSection = (label: string, items: QuickItem[]) => {
      if (items.length === 0) return;
      const head = document.createElement("div");
      head.className = "quick-section";
      head.textContent = label;
      quickList.appendChild(head);
      for (const item of items) {
        quickList.appendChild(renderQuickRow(item, index));
        index++;
      }
    };
    addSection("Open tabs", tabs);
    addSection("Recent files", recents);
  }

  function openQuickSwitch(): void {
    if (quick.hidden && document.activeElement instanceof HTMLElement) {
      quickReturnFocus = document.activeElement;
    }
    quick.hidden = false;
    quickInput.value = "";
    quickSelected = 0;
    renderQuick();
    quickInput.focus();
  }

  function closeQuickSwitch(): void {
    quick.hidden = true;
    quickReturnFocus?.focus();
    quickReturnFocus = null;
  }

  async function chooseQuick(index = quickSelected): Promise<void> {
    const item = quickItems[index];
    if (!item) return;
    closeQuickSwitch();
    if (item.kind === "tab") {
      await manager.activatePath(item.path);
    } else {
      await openPath(item.path);
    }
  }

  quickInput.addEventListener("input", () => {
    quickSelected = 0;
    renderQuick();
  });
  quickInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeQuickSwitch();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      quickSelected = Math.min(quickSelected + 1, Math.max(0, quickItems.length - 1));
      renderQuick();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      quickSelected = Math.max(quickSelected - 1, 0);
      renderQuick();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void chooseQuick();
    }
  });
  quick.addEventListener("mousedown", (e) => {
    if (e.target === quick) closeQuickSwitch();
  });

  // ---- Platform-specific toolbar ----
  // Web: hide controls that rely on directory watching or live filesystem tails.
  const btnNext = btn("btn-next");
  if (!watchesFiles) {
    btnNext.hidden = true;
    btn("btn-tail").hidden = true;
  }

  const dlSelect = document.querySelector<HTMLSelectElement>(".download-format")!;

  dlSelect.addEventListener("change", () => {
    void exportActions.downloadSelected(dlSelect);
  });
  btn("btn-next").addEventListener("click", async () => {
    const cur = manager.getActivePath();
    if (!cur) return;
    try {
      const siblings = await adapter.listSiblingViewable(cur);
      const idx = siblingIndex(siblings, cur);
      if (idx < 0 || siblings.length < 2) return;
      const next = siblings[(idx + 1) % siblings.length];
      await openPath(next);
    } catch (e) {
      showBanner(`Couldn't list directory — ${(e as AppError)?.message ?? e}`);
    }
  });

  btn("btn-copy-md").addEventListener("click", () => copyAsMarkdown(manager.getActiveRawText()));
  btn("btn-copy-rich").addEventListener("click", () => copyAsRichText(manager.getActiveDisplayedHtml({ forCopy: true })));

  const selFont = document.getElementById("sel-font") as HTMLSelectElement;
  const inpSize = document.getElementById("inp-size") as HTMLInputElement;
  const sizeValue = document.getElementById("size-value");
  const selTheme = document.getElementById("sel-theme") as HTMLSelectElement;
  selFont.value = settings.fontFamily;
  inpSize.value = String(settings.fontSizePx);
  selTheme.value = settings.theme;
  if (sizeValue) sizeValue.textContent = `${settings.fontSizePx}px`;

  function updateStyle(patch: Partial<StyleSettings>) {
    settings = { ...settings, ...patch };
    manager.applyStyle(settings);
    saveSettings(settings);
    if ("fontSizePx" in patch && sizeValue) {
      sizeValue.textContent = `${settings.fontSizePx}px`;
    }
    refreshToolbar();
    if ("theme" in patch) {
      applyCodeTheme(settings.theme);
      manager.rerenderActive();
    }
  }
  selFont.addEventListener("change", () =>
    updateStyle({ fontFamily: selFont.value as StyleSettings["fontFamily"] })
  );
  inpSize.addEventListener("input", () => updateStyle({ fontSizePx: Number(inpSize.value) }));
  selTheme.addEventListener("change", () =>
    updateStyle({ theme: selTheme.value as StyleSettings["theme"] })
  );

  // Appearance popover (font / size / theme). Self-contained: light-dismiss on
  // outside click or Escape. The Esc handler only acts while the popover is open
  // and stops propagation then, so it never steals Escape from the search bar.
  const appearanceBtn = document.getElementById("btn-appearance");
  const appearancePanel = document.getElementById("appearance-panel");
  if (appearanceBtn && appearancePanel) {
    const setOpen = (open: boolean) => {
      appearancePanel.hidden = !open;
      appearanceBtn.classList.toggle("toggled", open);
      appearanceBtn.setAttribute("aria-expanded", String(open));
    };
    appearanceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // `hidden` is `boolean | "until-found"` in current DOM typings; both
      // truthy states mean "closed", so coerce before toggling.
      setOpen(Boolean(appearancePanel.hidden));
    });
    document.addEventListener("click", (e) => {
      if (appearancePanel.hidden) return;
      if (!appearancePanel.contains(e.target as Node)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !appearancePanel.hidden) {
        e.stopPropagation();
        setOpen(false);
        appearanceBtn.focus();
      }
    });
  }

  const overflowBtn = document.getElementById("btn-toolbar-overflow");
  const overflowPanel = document.getElementById("toolbar-overflow-panel");
  if (overflowBtn && overflowPanel) {
    const setOverflowOpen = (open: boolean) => {
      overflowPanel.hidden = !open;
      overflowBtn.classList.toggle("toggled", open);
      overflowBtn.setAttribute("aria-expanded", String(open));
    };
    overflowBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOverflowOpen(Boolean(overflowPanel.hidden));
    });
    overflowPanel.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-overflow]");
      if (!item) return;
      const action = item.dataset.overflow;
      if (action === "next") btn("btn-next").click();
      else if (action === "tail") btn("btn-tail").click();
      else if (action === "diagnostics") diagnosticsBtn.click();
      else if (action === "help") openHelp();
      setOverflowOpen(false);
    });
    document.addEventListener("click", (e) => {
      if (overflowPanel.hidden) return;
      if (!overflowPanel.contains(e.target as Node) && e.target !== overflowBtn) setOverflowOpen(false);
    });
  }

  const selViewAs = document.getElementById("sel-viewas") as HTMLSelectElement;
  selViewAs.addEventListener("change", () => {
    const v = selViewAs.value;
    if (v) {
      if (v.startsWith("data:")) {
        const lang = v.slice("data:".length) as DataLang;
        manager.setActiveForcedFormat("data", lang);
      } else {
        manager.setActiveForcedFormat(v as Format);
      }
    }
    selViewAs.value = "";
  });

  content.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    const welcomeBtn = target.closest<HTMLElement>("[data-welcome]");
    if (welcomeBtn) {
      const action = welcomeBtn.dataset.welcome;
      if (action === "open") btn("btn-open").click();
      else if (action === "paste") void pasteIntoNewDoc();
      else if (action === "recent" && welcomeBtn.dataset.path) void openPath(welcomeBtn.dataset.path);
      else if (action === "help") openHelp();
      return;
    }

    const linesBtn = target.closest(".code-lines");
    if (linesBtn) {
      const on = linesBtn.closest(".code-block")?.classList.toggle("line-numbers");
      linesBtn.classList.toggle("toggled", !!on);
      linesBtn.setAttribute("aria-pressed", String(!!on));
      return;
    }

    const lnCell = target.closest("td.ln");
    if (lnCell) {
      lnCell.parentElement?.classList.toggle("hl");
      return;
    }

    const copyBtn = target.closest(".code-copy");
    if (copyBtn) {
      const block = copyBtn.closest(".code-block");
      if (block) {
        await navigator.clipboard.writeText(codeSourceOf(block));
        const prev = copyBtn.textContent;
        copyBtn.textContent = "✓";
        setTimeout(() => (copyBtn.textContent = prev), 1200);
      }
      return;
    }



    const saveSourceBtn = target.closest(".code-save");
    if (saveSourceBtn) {
      const block = saveSourceBtn.closest(".code-block");
      if (block) {
        const path = await adapter.saveDialog({ defaultPath: suggestedCodeName(block) });
        if (path) {
          await adapter.saveTextFile(path, codeSourceOf(block));
        }
      }
      return;
    }

    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) {
      e.preventDefault();
      const id = decodeURIComponent(href.slice(1));
      content.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    const exampleRel = parseExampleLink(href);
    if (exampleRel) {
      e.preventDefault();
      void openExampleLink(href);
      return;
    }

    let url: URL | null = null;
    try {
      url = new URL(href);
    } catch {
      url = null;
    }
    if (url) {
      e.preventDefault();
      const allowed = ["http:", "https:", "mailto:"];
      if (allowed.includes(url.protocol)) {
        await adapter.openUrl(href);
      } else {
        showBanner(`Blocked link with unsupported scheme: ${url.protocol}`);
      }
      return;
    }

    e.preventDefault();
    const base = manager.getActivePath();
    if (!base) return;
    try {
      const target = await adapter.resolveSibling(base, href.split("#")[0]);
      await openPath(target);
    } catch {
      showBanner(`Couldn't open ${href}`);
    }
  });

  content.addEventListener("change", async (e) => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>(".mermaid-select");
    if (!select?.value) return;
    const kind = select.value;
    const act = select.dataset.act as "copy" | "download";
    const block = select.closest<HTMLElement>(".mermaid");
    const placeholder = select.options[0];
    const prev = placeholder.textContent;
    try {
      const done = await exportActions.runMermaid(block, act, kind);
      if (done) {
        placeholder.textContent = "✓";
        setTimeout(() => (placeholder.textContent = prev), 1200);
      }
    } catch {
      placeholder.textContent = "✗";
      setTimeout(() => (placeholder.textContent = prev), 1200);
    } finally {
      select.value = "";
    }
  });

  const watchDebounceIds = new Map<string, ReturnType<typeof setTimeout>>();
  adapter.onFileChanged((path, content) => {
    const existing = watchDebounceIds.get(path);
    if (existing !== undefined) clearTimeout(existing);
    const id = setTimeout(() => {
      watchDebounceIds.delete(path);
      if (path === manager.getActivePath() && manager.isActiveWindowed()) {
        void adapter.logOpen(path).then((lineCount) => {
          manager.updateWindowedLog(path, lineCount);
          rebindSearch();
        }).catch((error) => showBanner(
          `Log refresh failed — ${error instanceof Error ? error.message : String(error)}`,
        ));
        return;
      }
      manager.updateContent(path, content);
      if (path === manager.getActivePath() && !manager.isActiveWindowed()) rebindSearch();
    }, 200);
    watchDebounceIds.set(path, id);
  });

  adapter.onFileRemoved((path) => showBanner(`File removed: ${path}`));

  window.addEventListener("beforeunload", (event) => {
    persistSession();
    if (!manager.hasDirtyTabs()) return;
    event.preventDefault();
    event.returnValue = true;
  });

  // Native webviews do not consistently honor beforeunload. Intercept the
  // Tauri close request so the same persistence and dirty-document guard run
  // for window close and application quit.
  if (adapter.platform === "tauri" && "__TAURI_INTERNALS__" in window) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().onCloseRequested(async (event) => {
        persistSession();
        if (manager.hasDirtyTabs() && !window.confirm("Quit with unsaved changes? Your drafts will be recovered next time.")) {
          event.preventDefault();
        }
      }),
    ).catch((error) => showBanner(
      `Close protection unavailable — ${error instanceof Error ? error.message : String(error)}`,
    ));
  }

  content.addEventListener("scroll", scheduleSessionSave, { passive: true });

  adapter.onDrop((event) => {
    if (event.type === "enter" || event.type === "over") {
      document.body.classList.add("drag-over");
    } else if (event.type === "leave") {
      document.body.classList.remove("drag-over");
    } else if (event.type === "progress") {
      showBanner(`Importing ${event.processed ?? 0}/${event.total ?? 0} files… Press Esc to cancel`);
    } else if (event.type === "drop") {
      document.body.classList.remove("drag-over");
      void collectTextDropPaths(event.paths, adapter).then(async (result) => {
        if (result.paths.length > 0) await openMany(result.paths);
        const skipped = result.skipped + (event.skipped ?? 0);
        showBanner(
          `Opened ${result.paths.length} file${result.paths.length === 1 ? "" : "s"}, ` +
          `skipped ${skipped} binary/unreadable${event.cancelled ? " (cancelled)" : ""}`,
        );
      });
    }
  });

  (async () => {
    refreshToolbar();
    // Attach the live "open with Lucent" listener BEFORE draining startup
    // files: getStartupFiles() flips the backend to event delivery, so the
    // listener must already be live or an open arriving in that window is lost.
    // openOrActivate dedups by path, so a file delivered via both routes just
    // focuses its existing tab.
    await adapter.onOpenFiles((paths) => {
      if (paths.length > 0) void openMany(paths);
    });
    if (adapter.platform === "tauri") {
      restoringSession = true;
      await restoreSessionTabs(manager, (path) => openPath(path, true));
      restoringSession = false;
      persistSession();
    }
    const startup = await adapter.getStartupFiles();
    if (startup.length > 0) await openMany(startup);
  })();
}
