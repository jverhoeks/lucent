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

/**
 * `window.print()` is a no-op in macOS WKWebView, so we stage the rendered
 * document as a temp HTML file (with an auto-print script) and open it in the
 * user's default browser, where Print → "Save as PDF" works reliably.
 */
export async function exportPdf(html: string): Promise<void> {
  const path = await invoke<string>("write_temp_file", {
    filename: "markdown-export.html",
    contents: buildStandaloneHtml(html, true),
  });
  await openPath(path);
}
