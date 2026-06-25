import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import appCss from "./styles.css?inline";
import hljsCss from "highlight.js/styles/github.css?inline";
import { Viewer } from "./viewer";

/** Wrap rendered HTML into a self-contained document with inlined CSS. */
export function buildStandaloneHtml(bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Markdown export</title>
<style>${hljsCss}
${appCss}</style>
</head>
<body>
<main id="content" data-theme="light" data-font="sans">
<article class="doc">${bodyHtml}</article>
</main>
</body>
</html>`;
}

export async function exportHtml(viewer: Viewer): Promise<void> {
  const path = await save({
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!path) return;
  await invoke("save_text_file", {
    path,
    contents: buildStandaloneHtml(viewer.getRenderedHtml()),
  });
}

export function exportPdf(): void {
  // The @media print stylesheet drives layout; the OS dialog offers "Save as PDF".
  window.print();
}
