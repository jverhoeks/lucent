import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import appCss from "./styles.css?inline";
import hljsCss from "highlight.js/styles/github.css?inline";
import { renderMarkdown, renderMath, hasMath, runPostRender, applyCodeTheme } from "./render";
import type { Theme } from "./types";

// KaTeX glyph fonts aren't system fonts, so the exported HTML links the
// CDN-hosted stylesheet (which serves its own fonts) rather than inlining CSS
// whose relative font URLs would 404. Hardcoded to the installed version (a
// static `import katex` here would defeat the lazy-loading in render.ts). BUMP ON
// KATEX UPGRADE — drives only the exported HTML's CDN link; the live app's
// bundled CSS auto-updates.
const KATEX_VERSION = "0.16.47";
const KATEX_CDN = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;

/**
 * Render Markdown to fully-resolved HTML for export: run the same pipeline plus
 * the Mermaid post-render pass off-screen, so diagrams become inline SVG and
 * math is laid out. Returns the document's inner HTML.
 */
async function renderDocumentHtml(rawText: string, theme: Theme = "light"): Promise<string> {
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;";
  // Export must include rendered math, so use the (lazy) math renderer when the
  // source contains any — otherwise the cheap synchronous base render.
  const body = hasMath(rawText) ? await renderMath(rawText) : renderMarkdown(rawText);
  holder.innerHTML = `<article class="doc">${body}</article>`;
  document.body.appendChild(holder);
  try {
    await runPostRender(holder, theme);
    // The copy/save/line-toggle buttons are non-functional in a static file.
    holder.querySelectorAll(".code-actions").forEach((el) => el.remove());
    return holder.querySelector(".doc")!.innerHTML;
  } finally {
    holder.remove();
  }
}

/** Wrap rendered HTML into a self-contained document with inlined CSS. */
export function buildStandaloneHtml(bodyHtml: string, autoPrint = false): string {
  const printScript = autoPrint
    ? `<script>window.addEventListener("load", () => window.print());</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Markdown export</title>
<link rel="stylesheet" href="${KATEX_CDN}" crossorigin="anonymous">
<style>${hljsCss}
${appCss}</style>
${printScript}
</head>
<body>
<main id="content" data-theme="light" data-font="sans">
<article class="doc">${bodyHtml}</article>
</main>
</body>
</html>`;
}

export async function exportHtml(rawText: string): Promise<void> {
  const path = await save({
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!path) return;
  const theme = (document.getElementById("content")?.dataset.theme as Theme) || "light";
  const body = await renderDocumentHtml(rawText, theme);
  await invoke("save_text_file", { path, contents: buildStandaloneHtml(body) });
}

function isMac(): boolean {
  return /Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Browser fallback: `window.print()` is a no-op in macOS WKWebView and there is
 * no native PDF API on Windows/Linux webviews yet, so we stage the document as a
 * temp HTML file and open it in the default browser with print auto-triggered.
 */
async function exportPdfViaBrowser(rawText: string): Promise<void> {
  const theme = (document.getElementById("content")?.dataset.theme as Theme) || "light";
  const body = await renderDocumentHtml(rawText, theme);
  const path = await invoke<string>("write_temp_file", {
    filename: "markdown-export.html",
    contents: buildStandaloneHtml(body, true),
  });
  await openPath(path);
}

/**
 * macOS: capture the live webview to PDF via WKWebView.createPDF. We add a
 * `.exporting` class first so the chrome (toolbar/tabs) is hidden and the body
 * grows to the full document height — `createPDF` renders *screen* media, so the
 * `@media print` block does NOT apply and this class is what produces a clean
 * capture. Other platforms fall back to the browser approach.
 */
export async function exportPdf(rawText: string): Promise<void> {
  if (!isMac()) {
    await exportPdfViaBrowser(rawText);
    return;
  }
  const dest = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!dest) return;

  // Capture on the white A4 canvas with light code (clean on paper), then restore.
  const currentTheme = (document.getElementById("content")?.dataset.theme as Theme) || "light";
  applyCodeTheme("light");
  document.body.classList.add("exporting");
  try {
    await nextFrame();
    await nextFrame();
    await invoke("export_pdf_native", { dest });
  } catch (e) {
    if (String(e).includes("unsupported_platform")) {
      await exportPdfViaBrowser(rawText);
      return;
    }
    throw e;
  } finally {
    document.body.classList.remove("exporting");
    applyCodeTheme(currentTheme);
  }
}
