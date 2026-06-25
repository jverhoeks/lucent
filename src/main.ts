import "./styles.css";
import "highlight.js/styles/github.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Viewer } from "./viewer";
import { loadSettings, saveSettings } from "./settings";
import { copyAsMarkdown, copyAsRichText } from "./clipboard";
import { exportHtml, exportPdf } from "./export";
import { FilePayload, AppError, StyleSettings } from "./types";

const content = document.getElementById("content")!;
const banner = document.getElementById("banner")!;
const viewer = new Viewer(content);
let settings: StyleSettings = loadSettings();
viewer.applyStyle(settings);

function showBanner(msg: string) {
  banner.textContent = msg;
  banner.hidden = false;
  setTimeout(() => (banner.hidden = true), 4000);
}

async function openPath(path: string) {
  try {
    const payload = await invoke<FilePayload>("read_file", { path });
    viewer.setSource(payload.content);
    await invoke("watch_file", { path });
  } catch (e) {
    const msg = (e as AppError)?.message ?? String(e);
    showBanner(`Couldn't open ${path} — ${msg}`);
  }
}

// ---- Toolbar ----
document.getElementById("btn-open")!.addEventListener("click", async () => {
  const sel = await open({
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });
  if (typeof sel === "string") await openPath(sel);
});
document
  .getElementById("btn-toggle")!
  .addEventListener("click", () => viewer.toggle());
document
  .getElementById("btn-export-html")!
  .addEventListener("click", () => exportHtml(viewer));
document
  .getElementById("btn-export-pdf")!
  .addEventListener("click", () => exportPdf());
document
  .getElementById("btn-copy-md")!
  .addEventListener("click", () => copyAsMarkdown(viewer.getRawText()));
document
  .getElementById("btn-copy-rich")!
  .addEventListener("click", () => copyAsRichText(viewer.getRenderedHtml()));

// ---- Style controls ----
const selFont = document.getElementById("sel-font") as HTMLSelectElement;
const inpSize = document.getElementById("inp-size") as HTMLInputElement;
const selTheme = document.getElementById("sel-theme") as HTMLSelectElement;
selFont.value = settings.fontFamily;
inpSize.value = String(settings.fontSizePx);
selTheme.value = settings.theme;

function updateStyle(patch: Partial<StyleSettings>) {
  settings = { ...settings, ...patch };
  viewer.applyStyle(settings);
  saveSettings(settings);
}
selFont.addEventListener("change", () =>
  updateStyle({ fontFamily: selFont.value as StyleSettings["fontFamily"] })
);
inpSize.addEventListener("input", () =>
  updateStyle({ fontSizePx: Number(inpSize.value) })
);
selTheme.addEventListener("change", () =>
  updateStyle({ theme: selTheme.value as StyleSettings["theme"] })
);

// ---- Auto-reload + removal ----
listen<FilePayload>("file-changed", (e) => viewer.setSource(e.payload.content));
listen<{ path: string }>("file-removed", (e) =>
  showBanner(`File removed: ${e.payload.path}`)
);

// ---- Drag-and-drop ----
getCurrentWebview().onDragDropEvent((e) => {
  if (e.payload.type === "drop" && e.payload.paths.length > 0) {
    openPath(e.payload.paths[0]);
  }
});
