import "./styles.css";
import { TabManager } from "./tabs";
import { applyCodeTheme } from "./render";
import { loadSettings, saveSettings } from "./settings";
import { copyAsMarkdown, copyAsRichText } from "./clipboard";
import { copyMermaidSvg, copyMermaidPng } from "./mermaid-export";
import { exportHtml, exportPdf } from "./export";
import { AppError, StyleSettings, Format, DataLang } from "./types";
import { SearchController } from "./search/controller";
import { createSearchProvider } from "./search/factory";
import { SearchBar } from "./search/bar";
import { getCurrentTree } from "./renderers/data";
import { initStdin } from "./stdin";
import { detectFormat, siblingIndex, basename, dataLangOf } from "./format";
import { injectSprite, setButtonIcon, iconMarkup } from "./icons";
import type { PlatformAdapter } from "./platform/types";

/** Trigger a browser file download from a string of content. */
function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Convert data between formats for download. */
async function convertData(source: string, from: string, to: string): Promise<string> {
  if (from === to) return source;
  let parsed: unknown;
  switch (from) {
    case "json": parsed = JSON.parse(source); break;
    case "yaml": { const { load } = await import("js-yaml"); parsed = load(source); break; }
    case "toml": { const { parse } = await import("smol-toml"); parsed = parse(source); break; }
    case "ini": { const { parse } = await import("ini"); parsed = parse(source); break; }
    default: throw new Error(`Unsupported source format: ${from}`);
  }
  switch (to) {
    case "json": return JSON.stringify(parsed, null, 2);
    case "yaml": { const { dump } = await import("js-yaml"); return dump(parsed, { indent: 2 }); }
    case "toml": { const { stringify } = await import("smol-toml"); return stringify(parsed as any); }
    case "ini": { const { stringify } = await import("ini"); return stringify(parsed as any); }
    default: throw new Error(`Unsupported target format: ${to}`);
  }
}

export function initApp(adapter: PlatformAdapter): void {
  injectSprite();
  const tabbar = document.getElementById("tabbar")!;
  const tabstrip = document.getElementById("tabstrip")!;
  const content = document.getElementById("content")!;
  const banner = document.getElementById("banner")!;
  let settings: StyleSettings = loadSettings();

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
      logSearch: (path, q) => adapter.readFile(path).then((p) => {
        // Simple client-side log search fallback
        const lines = p.content.split("\n");
        const matches = lines
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => {
            const text = q.caseSensitive ? line : line.toLowerCase();
            const query = q.caseSensitive ? q.text : q.text.toLowerCase();
            if (q.regex) {
              try { return new RegExp(query, q.caseSensitive ? "" : "i").test(line); }
              catch { return false; }
            }
            return text.includes(query);
          })
          .map(({ i }) => i);
        return matches;
      }),
      onUpdate: () => search.refresh(),
    }));
  }

  const manager = new TabManager(tabbar, content, settings, {
    onChange: () => { refreshToolbar(); rebindSearch(); },
    onTabClosed: (path) => void adapter.unwatchFile(path),
    onCloseAll: () => void adapter.unwatchAll(),
    onSave: async (path, content) => {
      await adapter.saveTextFile(path, content);
    },
  });

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
    for (const id of [
      "btn-search",
      "btn-toggle",
      "btn-tail",
      "btn-next",
      "btn-export-html",
      "btn-export-pdf",
      "btn-copy-md",
      "btn-copy-rich",
    ]) {
      btn(id).disabled = !has;
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
    tail.hidden = !isLog || isEdit;
    tail.classList.toggle("toggled", manager.isFollowing());
    tail.setAttribute("aria-pressed", String(manager.isFollowing()));

    const editBtn = btn("btn-edit");
    const saveBtn = btn("btn-save");
    const fmt = manager.getActiveFormat();
    editBtn.disabled = !has || (fmt !== "markdown" && fmt !== "data");
    setButtonIcon(editBtn, isEdit ? "ic-check" : "ic-pencil", isEdit ? "Done" : "Edit");
    editBtn.classList.toggle("toggled", isEdit);
    saveBtn.hidden = !isEdit;
    saveBtn.disabled = !manager.isEditing();

    // Web download button visibility
    const dlSelect = document.querySelector(".download-format") as HTMLElement | null;
    const dlBtn = document.getElementById("btn-download") as HTMLElement | null;
    if (dlSelect && dlBtn) {
      dlSelect.hidden = !has;
      dlBtn.hidden = !has;
    }
  }

  function showBanner(msg: string) {
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

  async function readPath(path: string): Promise<string | null> {
    try {
      const payload = await adapter.readFile(path);
      return payload.content;
    } catch (e) {
      const msg = (e as AppError)?.message ?? String(e);
      showBanner(`Couldn't open ${path} — ${msg}`);
      return null;
    }
  }

  const WINDOW_THRESHOLD = 5 * 1024 * 1024;

  async function openPath(path: string) {
    showBanner(`Loading ${basename(path)} …`);
    if (detectFormat(path) === "log") {
      try {
        const size = await adapter.fileSize(path);
        if (size > WINDOW_THRESHOLD) {
          const content = await adapter.readFile(path);
          const lines = content.content.split("\n");
          manager.openWindowedLog(
            path,
            lines.length,
            (_start, _count) => Promise.resolve([]), // simplified for web
          );
          return;
        }
      } catch {
        // fall through
      }
    }
    const fileContent = await readPath(path);
    if (fileContent === null) return;
    manager.openOrActivate(path, fileContent);
    await adapter.watchFile(path);
  }

  async function openMany(paths: string[]) {
    for (const p of paths) await openPath(p);
  }

  const toolbarEl = document.getElementById("toolbar")!;
  const syncToolbarHeight = () =>
    document.documentElement.style.setProperty("--toolbar-h", `${toolbarEl.offsetHeight}px`);
  new ResizeObserver(syncToolbarHeight).observe(toolbarEl);
  syncToolbarHeight();

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

  btn("btn-search").addEventListener("click", () => {
    if (manager.count() === 0) return;
    searchBar.toggle();
    rebindSearch();
  });

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      if (manager.count() === 0) return;
      e.preventDefault();
      searchBar.open();
      rebindSearch();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
      if (manager.count() > 0) { e.preventDefault(); manager.closeActiveTab(); }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      if (manager.isEditing()) { e.preventDefault(); void manager.saveActive(); }
    }
  });

  btn("btn-toggle").addEventListener("click", () => manager.toggleMode());
  btn("btn-edit").addEventListener("click", () => manager.toggleEdit());
  btn("btn-save").addEventListener("click", () => void manager.saveActive());
  btn("btn-tail").addEventListener("click", () => manager.toggleFollow());
  btn("btn-close-all").addEventListener("click", () => manager.closeAll());

  // ---- Platform-specific toolbar ----
  // Web: hide Next (no directory concept), hide export HTML/PDF, add Download
  const isWeb = adapter.platform === "web";
  const btnNext = btn("btn-next");
  if (isWeb) {
    btnNext.hidden = true;
    btn("btn-export-html").hidden = true;
    btn("btn-export-pdf").hidden = true;
  }

  if (isWeb) {
    const group = btnNext.closest(".group")!;
    const dlSelect = document.createElement("select");
    dlSelect.className = "download-format";
    dlSelect.title = "Download format";
    dlSelect.innerHTML = `
      <option value="">Download as…</option>
      <option value="md">Markdown (.md)</option>
      <option value="html">HTML (.html)</option>
      <option value="pdf">PDF (.pdf)</option>
      <option value="json">JSON (.json)</option>
      <option value="yaml">YAML (.yaml)</option>
      <option value="toml">TOML (.toml)</option>
      <option value="ini">INI (.ini)</option>
    `;
    const dlBtn = document.createElement("button");
    dlBtn.id = "btn-download";
    dlBtn.className = "primary";
    dlBtn.setAttribute("aria-label", "Download");
    dlBtn.setAttribute("data-tip", "Download");
    dlBtn.innerHTML = iconMarkup("ic-download");
    dlBtn.disabled = true;
    dlBtn.addEventListener("click", async () => {
      const fmt = dlSelect.value;
      if (!fmt) return;
      const src = manager.getActiveRawText();
      if (!src) return;
      const path = manager.getActivePath() ?? "untitled";
      const base = basename(path).replace(/\.[^.]+$/, "") || "document";
      try {
        let content = src;
        let mime = "text/plain";
        let ext = fmt;
        if (fmt === "html" || fmt === "pdf") {
          content = (await import("./export")).buildStandaloneHtml(
            manager.getActiveDisplayedHtml(),
            fmt === "pdf",
          );
          mime = "text/html";
          ext = "html";
        } else {
          const fromFmt = dataLangOf(path) ?? "markdown";
          if (fromFmt !== "markdown" && fmt !== "md" && fromFmt !== fmt) {
            content = await convertData(src, fromFmt, fmt);
          }
          const mimeMap: Record<string, string> = {
            md: "text/markdown", html: "text/html", json: "application/json",
            yaml: "text/yaml", toml: "text/toml", ini: "text/plain",
          };
          mime = mimeMap[fmt] ?? "text/plain";
        }
        if (fmt === "pdf") {
          const blob = new Blob([content], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } else {
          downloadFile(content, `${base}.${ext}`, mime);
        }
      } catch (err) {
        showBanner(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      dlSelect.value = "";
    });
    dlSelect.addEventListener("change", () => {
      dlBtn.disabled = !dlSelect.value;
    });
    group.appendChild(dlSelect);
    group.appendChild(dlBtn);

    dlSelect.hidden = true;
    dlBtn.hidden = true;
  }

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

  btn("btn-export-html").addEventListener("click", () => exportHtml(manager.getActiveRawText(), adapter));
  btn("btn-export-pdf").addEventListener("click", () => exportPdf(manager.getActiveRawText(), adapter));
  btn("btn-copy-md").addEventListener("click", () => copyAsMarkdown(manager.getActiveRawText()));
  btn("btn-copy-rich").addEventListener("click", () => copyAsRichText(manager.getActiveDisplayedHtml()));

  const selFont = document.getElementById("sel-font") as HTMLSelectElement;
  const inpSize = document.getElementById("inp-size") as HTMLInputElement;
  const selTheme = document.getElementById("sel-theme") as HTMLSelectElement;
  selFont.value = settings.fontFamily;
  inpSize.value = String(settings.fontSizePx);
  selTheme.value = settings.theme;

  function updateStyle(patch: Partial<StyleSettings>) {
    settings = { ...settings, ...patch };
    manager.applyStyle(settings);
    saveSettings(settings);
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
      setOpen(appearancePanel.hidden);
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

    const mermaidBtn = target.closest<HTMLElement>(".mermaid-copy");
    if (mermaidBtn) {
      const svg = mermaidBtn.closest(".mermaid")?.querySelector("svg");
      const label = mermaidBtn.querySelector(".mermaid-copy-label");
      if (svg && label) {
        const prev = label.textContent;
        try {
          if (mermaidBtn.dataset.kind === "png") await copyMermaidPng(svg as SVGSVGElement);
          else await copyMermaidSvg(svg as SVGSVGElement);
          label.textContent = "✓";
        } catch {
          label.textContent = "✗";
        }
        setTimeout(() => (label.textContent = prev), 1200);
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

  let watchDebounceId: ReturnType<typeof setTimeout> | undefined;
  adapter.onFileChanged((path, content) => {
    if (watchDebounceId !== undefined) clearTimeout(watchDebounceId);
    watchDebounceId = setTimeout(() => {
      watchDebounceId = undefined;
      manager.updateContent(path, content);
      if (path === manager.getActivePath() && !manager.isActiveWindowed()) rebindSearch();
    }, 200);
  });

  adapter.onFileRemoved((path) => showBanner(`File removed: ${path}`));

  async function isTextFile(path: string): Promise<boolean> {
    try {
      const ext = path.split("/").pop()?.split(".").pop()?.toLowerCase();
      const textExts = new Set(["md","markdown","mdown","mkd","txt","text","log","json","yaml","yml","toml","ini","csv","tsv","xml","html","htm","css","js","ts","jsx","tsx","py","rb","rs","go","java","c","cpp","h","hpp","sh","bash","zsh","fish","env","gitignore","dockerfile","cfg","conf"]);
      if (ext && textExts.has(ext)) return true;
      const size = await adapter.fileSize(path);
      if (size > 1_048_576) return false;
      return await adapter.probeIsText(path, 512);
    } catch {
      return true;
    }
  }

  async function collectDropPaths(paths: string[]): Promise<string[]> {
    const result: string[] = [];
    for (const p of paths) {
      try {
        const children = await adapter.listViewableRecursive(p);
        for (const child of children) {
          if (await isTextFile(child)) result.push(child);
        }
      } catch {
        // skip silently
      }
    }
    return result;
  }

  adapter.onDrop((event) => {
    if (event.type === "enter" || event.type === "over") {
      document.body.classList.add("drag-over");
    } else if (event.type === "leave") {
      document.body.classList.remove("drag-over");
    } else if (event.type === "drop") {
      document.body.classList.remove("drag-over");
      if (event.paths.length > 0) {
        const total = event.paths.length;
        void collectDropPaths(event.paths).then((collected) => {
          const skipped = total - collected.length;
          if (collected.length > 0) void openMany(collected);
          if (skipped > 0) {
            showBanner(`Opened ${collected.length} file${collected.length === 1 ? "" : "s"}, skipped ${skipped} binary/unreadable`);
          }
        });
      }
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
    const startup = await adapter.getStartupFiles();
    if (startup.length > 0) await openMany(startup);
  })();
}
