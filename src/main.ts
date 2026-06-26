import "./styles.css";
import "katex/dist/katex.min.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { TabManager } from "./tabs";
import { applyCodeTheme } from "./render";
import { loadSettings, saveSettings } from "./settings";
import { copyAsMarkdown, copyAsRichText } from "./clipboard";
import { exportHtml, exportPdf } from "./export";
import { FilePayload, AppError, StyleSettings, Format, DataLang } from "./types";
import { SearchController } from "./search/controller";
import { DomSearchProvider } from "./search/dom-provider";
import { TreeSearchProvider } from "./search/tree-provider";
import { LogSearchProvider } from "./search/log-provider";
import { SearchBar } from "./search/bar";
import { getCurrentTree } from "./renderers/data";
import { initStdin } from "./stdin";
import { detectFormat } from "./format";

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
  const fmt = manager.getActiveFormat();
  const mode = manager.getActiveMode();
  // Windowed log: use async backend search
  if (manager.isActiveWindowed()) {
    const view = manager.getActiveVirtualLogView();
    const path = manager.getActivePath();
    if (view && path) {
      search.setProvider(new LogSearchProvider(
        view,
        (q) => invoke<number[]>("log_search", {
          path,
          query: q.text,
          caseSensitive: q.caseSensitive,
          regex: q.regex,
        }),
        () => search.refresh(),
      ));
      return;
    }
  }
  if (mode === "rendered" && fmt === "data") {
    const tree = getCurrentTree();
    search.setProvider(tree ? new TreeSearchProvider(tree) : new DomSearchProvider(content));
  } else {
    search.setProvider(new DomSearchProvider(content));
  }
}

const manager = new TabManager(tabbar, content, settings, {
  onChange: () => { refreshToolbar(); rebindSearch(); },
  onTabClosed: (path) => void invoke("unwatch_file", { path }),
  onCloseAll: () => void invoke("unwatch_all"),
});
initStdin(manager);
applyCodeTheme(settings.theme);

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

  // Reflect the active tab's view mode in the toggle button.
  const isRaw = manager.getActiveMode() === "raw";
  const toggle = btn("btn-toggle");
  toggle.textContent = isRaw ? "</> Raw" : "👁 Rendered";
  toggle.classList.toggle("toggled", isRaw);
  toggle.setAttribute("aria-pressed", String(isRaw));

  // Show tail button only for logs; reflect follow state.
  const tail = btn("btn-tail");
  const isLog = manager.getActiveFormat() === "log";
  tail.hidden = !isLog;
  tail.classList.toggle("toggled", manager.isFollowing());
  tail.setAttribute("aria-pressed", String(manager.isFollowing()));
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

/** Default save name for a code block: its filename if supplied, else by language. */
function suggestedCodeName(block: Element): string {
  const filename = block.getAttribute("data-filename");
  if (filename) return filename;
  const lang = (block.getAttribute("data-lang") || "").toLowerCase();
  const ext = LANG_EXT[lang] || lang || "txt";
  return `snippet.${ext}`;
}

/** A code block's exact raw source (stored at render time, blank lines intact). */
function codeSourceOf(block: Element): string {
  return block.getAttribute("data-src") ?? "";
}

async function readPath(path: string): Promise<string | null> {
  try {
    const payload = await invoke<FilePayload>("read_file", { path });
    return payload.content;
  } catch (e) {
    const msg = (e as AppError)?.message ?? String(e);
    showBanner(`Couldn't open ${path} — ${msg}`);
    return null;
  }
}

/** Files larger than this threshold are opened in windowed mode (no full read). */
const WINDOW_THRESHOLD = 5 * 1024 * 1024; // 5 MB

async function openPath(path: string) {
  // Check if this is a log file that should be opened windowed (no full content read)
  if (detectFormat(path) === "log") {
    try {
      const size = await invoke<number>("file_size", { path });
      if (size > WINDOW_THRESHOLD) {
        const lineCount = await invoke<number>("log_open", { path });
        manager.openWindowedLog(
          path,
          lineCount,
          (start, count) => invoke<string[]>("log_window", { path, start, count }),
        );
        await invoke("watch_file", { path });
        return;
      }
    } catch {
      // If file_size/log_open fails, fall through to normal open
    }
  }
  const fileContent = await readPath(path);
  if (fileContent === null) return;
  manager.openOrActivate(path, fileContent);
  await invoke("watch_file", { path });
}

async function openMany(paths: string[]) {
  for (const p of paths) await openPath(p);
}

// ---- Toolbar actions ----
btn("btn-open").addEventListener("click", async () => {
  const sel = await open({
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
});

btn("btn-toggle").addEventListener("click", () => manager.toggleMode());
btn("btn-tail").addEventListener("click", () => manager.toggleFollow());
btn("btn-close-all").addEventListener("click", () => manager.closeAll());

btn("btn-next").addEventListener("click", async () => {
  const cur = manager.getActivePath();
  if (!cur) return;
  try {
    const siblings = await invoke<string[]>("list_sibling_viewable", { path: cur });
    const idx = siblings.indexOf(cur);
    if (idx < 0 || siblings.length < 2) return;
    const next = siblings[(idx + 1) % siblings.length]; // wrap around
    // Open the next file in its own tab — or, if it's already open, switch to
    // that tab (openOrActivate, via openPath). The current tab stays open.
    await openPath(next);
  } catch (e) {
    showBanner(`Couldn't list directory — ${(e as AppError)?.message ?? e}`);
  }
});

btn("btn-export-html").addEventListener("click", () => exportHtml(manager.getActiveRawText()));
btn("btn-export-pdf").addEventListener("click", () => exportPdf(manager.getActiveRawText()));
btn("btn-copy-md").addEventListener("click", () => copyAsMarkdown(manager.getActiveRawText()));
btn("btn-copy-rich").addEventListener("click", () => copyAsRichText(manager.getActiveDisplayedHtml()));

// ---- Style controls ----
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
    manager.rerenderActive(); // re-theme Mermaid diagrams
  }
}
selFont.addEventListener("change", () =>
  updateStyle({ fontFamily: selFont.value as StyleSettings["fontFamily"] })
);
inpSize.addEventListener("input", () => updateStyle({ fontSizePx: Number(inpSize.value) }));
selTheme.addEventListener("change", () =>
  updateStyle({ theme: selTheme.value as StyleSettings["theme"] })
);

// ---- "View as…" format override ----
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
    // onChange triggers rebindSearch via manager hooks
  }
  selViewAs.value = ""; // reset to the placeholder label
});

// ---- Link handling ----
// In-page anchors scroll; external URLs open in the system browser; relative
// .md links open in a new tab. Without this, clicking a link would navigate the
// whole webview away from the app.
content.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;

  // Per-block line-number toggle.
  const linesBtn = target.closest(".code-lines");
  if (linesBtn) {
    const on = linesBtn.closest(".code-block")?.classList.toggle("line-numbers");
    linesBtn.classList.toggle("toggled", !!on);
    linesBtn.setAttribute("aria-pressed", String(!!on));
    return;
  }

  // Click a line number to highlight that source line.
  const lnCell = target.closest("td.ln");
  if (lnCell) {
    lnCell.parentElement?.classList.toggle("hl");
    return;
  }

  // Copy-source button on a code block.
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

  // Save-source button on a code block.
  const saveBtn = target.closest(".code-save");
  if (saveBtn) {
    const block = saveBtn.closest(".code-block");
    if (block) {
      const path = await save({ defaultPath: suggestedCodeName(block) });
      if (path) {
        await invoke("save_text_file", { path, contents: codeSourceOf(block) });
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

  // Absolute URL (parses with a scheme): only hand http/https/mailto to the OS
  // handler; refuse anything else (file:, javascript:, custom app schemes, …).
  let url: URL | null = null;
  try {
    url = new URL(href);
  } catch {
    url = null; // not absolute → treat as a relative link below
  }
  if (url) {
    e.preventDefault();
    const allowed = ["http:", "https:", "mailto:"];
    if (allowed.includes(url.protocol)) {
      await openUrl(href);
    } else {
      showBanner(`Blocked link with unsupported scheme: ${url.protocol}`);
    }
    return;
  }

  // Relative link — resolve against the open file and open in a tab.
  e.preventDefault();
  const base = manager.getActivePath();
  if (!base) return;
  try {
    const target = await invoke<string>("resolve_sibling", {
      base,
      rel: href.split("#")[0],
    });
    await openPath(target);
  } catch {
    showBanner(`Couldn't open ${href}`);
  }
});

// ---- Disk watch events ----
listen<FilePayload>("file-changed", (e) => {
  manager.updateContent(e.payload.path, e.payload.content);
  rebindSearch();
});
listen<{ path: string }>("file-removed", (e) => showBanner(`File removed: ${e.payload.path}`));
// Windowed log grew: update the virtual view's line count if the tab is active
listen<{ path: string; lineCount: number }>("log-grew", (e) => {
  if (manager.getActivePath() === e.payload.path) {
    manager.getActiveVirtualLogView()?.setLineCount(e.payload.lineCount);
  }
});

// ---- Drag-and-drop ----
getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type === "drop" && e.payload.paths.length > 0) {
    void openMany(e.payload.paths);
  }
});

// ---- Files passed on the command line (e.g. `markdown-gui *.md`) ----
(async () => {
  refreshToolbar();
  const startup = await invoke<string[]>("get_startup_files");
  if (startup.length > 0) await openMany(startup);
})();
