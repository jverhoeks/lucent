import appCss from "./styles.css?inline";
import hljsCss from "highlight.js/styles/github.css?inline";
import { renderMarkdown, renderMath, hasMath, runPostRender } from "./render";
import type { Theme } from "./types";
import type { PlatformAdapter } from "./platform/types";

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
export function buildStandaloneHtml(bodyHtml: string, autoPrint = false, theme: Theme = "light"): string {
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
<main id="content" data-theme="${theme}" data-font="sans">
<article class="doc">${bodyHtml}</article>
</main>
</body>
</html>`;
}

export async function exportHtml(rawText: string, adapter: PlatformAdapter): Promise<void> {
  const path = await adapter.saveDialog({
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!path) return;
  const theme = (document.getElementById("content")?.dataset.theme as Theme) || "light";
  const body = await renderDocumentHtml(rawText, theme);
  await adapter.saveTextFile(path, buildStandaloneHtml(body, false, theme));
}

/**
 * PDF export goes through the browser on every platform: stage the document as a
 * temp HTML file and open it in the default browser with printing triggered.
 *
 * The browser is what paginates — its print engine applies the `@media print`
 * rules in styles.css (inlined into the exported HTML) and lays the document out
 * on the user's paper size. macOS used to do this in-app with WebKit, first by
 * capturing the webview (`createPDF`, which yields one page as tall as the
 * document rather than pages) and then via `NSPrintOperation`, which paginates
 * correctly but renders nothing at all from a Tauri webview — every variant
 * produced blank pages or no file. Rather than keep a broken second path, all
 * platforms share this one.
 *
 * Always exported light: a dark reading theme prints as dark slabs of ink.
 */
export async function exportPdf(rawText: string, adapter: PlatformAdapter): Promise<void> {
  const body = await renderDocumentHtml(rawText, "light");
  const path = await adapter.writeTempFile(
    "markdown-export.html",
    buildStandaloneHtml(body, true, "light"),
  );
  await adapter.openPath(path);
}
