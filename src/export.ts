import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import appCss from "./styles.css?inline";
import hljsCss from "highlight.js/styles/github.css?inline";

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

export async function exportHtml(html: string): Promise<void> {
  const path = await save({
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!path) return;
  await invoke("save_text_file", {
    path,
    contents: buildStandaloneHtml(html),
  });
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
async function exportPdfViaBrowser(html: string): Promise<void> {
  const path = await invoke<string>("write_temp_file", {
    filename: "markdown-export.html",
    contents: buildStandaloneHtml(html, true),
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
export async function exportPdf(html: string): Promise<void> {
  if (!isMac()) {
    await exportPdfViaBrowser(html);
    return;
  }
  const dest = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!dest) return;

  document.body.classList.add("exporting");
  try {
    // Let layout commit before the native capture.
    await nextFrame();
    await nextFrame();
    await invoke("export_pdf_native", { dest });
  } catch (e) {
    document.body.classList.remove("exporting");
    if (String(e).includes("unsupported_platform")) {
      await exportPdfViaBrowser(html);
      return;
    }
    throw e;
  } finally {
    document.body.classList.remove("exporting");
  }
}
