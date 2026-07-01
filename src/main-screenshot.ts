// Dev-only entry point for capturing documentation screenshots in a headless
// browser. It boots the REAL app (initApp + the real render pipeline and
// toolbar) but seeds content through a tiny adapter so nothing has to be
// dragged in. Not shipped: no HTML in the vite build inputs references it.
//
// Usage: `npm run dev`, then point Chrome at http://localhost:1420/screenshot.html
// (optionally ?doc=tour|data|logs). Capture once window.__ready === true.
import { webAdapter } from "./platform/web";
import type { PlatformAdapter } from "./platform/types";
import type { FilePayload } from "./types";
import { initApp } from "./main";

const params = new URLSearchParams(location.search);
const which = params.get("doc") ?? "tour";

const TOUR = `# Lucent

A **clear, fast** viewer for Markdown, structured data, and logs — with an
opt-in editor. Here's a little of everything at once.

::: tip
Hover the diagram below: copy or download it as SVG / PNG, or copy it as
*editable shapes* into Whiteboard, draw.io, or Excalidraw.
:::

## Deploy decision

\`\`\`mermaid
flowchart TD
    A([Change is ready]) --> B{Deploy today?}
    B -->|It's Friday| C[Wait for Monday]
    B -->|Any other day| D[Ship it]
    D --> E([Watch the dashboards])
    C --> E
\`\`\`

## A little code

\`\`\`python
def greet(name: str) -> str:
    """Return a friendly greeting."""
    return f"Hello, {name}!"
\`\`\`

## And some math

The Gaussian integral: $\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$.

| Format | Rendered as |
| ------ | ----------- |
| Markdown | rich document |
| JSON / YAML / TOML | collapsible tree |
| Logs | leveled, searchable |
`;

const DATA = `{
  "service": "lucent",
  "version": "0.3.0",
  "features": ["markdown", "mermaid", "data-tree", "logs", "editor"],
  "export": { "images": ["svg", "png"], "shapes": ["whiteboard", "drawio", "excalidraw"] },
  "private": true
}
`;

const LOGS = `2026-07-01T09:12:03Z INFO  server started on :1420
2026-07-01T09:12:04Z DEBUG loaded 12 renderers
2026-07-01T09:12:07Z WARN  slow render 812ms {"file":"kitchen-sink.md","blocks":42}
2026-07-01T09:12:09Z ERROR failed to parse diagram {"line":18,"kind":"sequence"}
2026-07-01T09:12:11Z INFO  request {"method":"GET","path":"/","ms":3}
`;

const DOCS: Record<string, { path: string; content: string }> = {
  tour: { path: "/opened/tour.md", content: TOUR },
  data: { path: "/opened/data-sample.json", content: DATA },
  logs: { path: "/opened/service.log", content: LOGS },
};

const doc = DOCS[which] ?? DOCS.tour;
const store = new Map<string, string>([[doc.path, doc.content]]);

const screenshotAdapter: PlatformAdapter = {
  ...webAdapter,
  async readFile(path: string): Promise<FilePayload> {
    const content = store.get(path);
    if (content === undefined) return webAdapter.readFile(path);
    return { path, content };
  },
  async fileSize(path: string): Promise<number> {
    const content = store.get(path);
    if (content === undefined) return webAdapter.fileSize(path);
    return new Blob([content]).size;
  },
  async probeIsText(path: string, maxBytes: number): Promise<boolean> {
    if (store.has(path)) return true;
    return webAdapter.probeIsText(path, maxBytes);
  },
  async listSiblingViewable(path: string): Promise<string[]> {
    return store.has(path) ? Array.from(store.keys()) : webAdapter.listSiblingViewable(path);
  },
  async listViewableRecursive(path: string): Promise<string[]> {
    return store.has(path) ? [path] : webAdapter.listViewableRecursive(path);
  },
  async getStartupFiles(): Promise<string[]> {
    return [doc.path];
  },
};

// Force the hover-only Mermaid toolbar visible so it shows up in a static capture.
const style = document.createElement("style");
// Also hide the web-only "Download as…" control and force the desktop-only
// Next / export buttons visible, so the capture reads as the shipped desktop
// app rather than a mixed web/desktop toolbar that can't actually exist.
style.textContent = `
  .mermaid-actions { opacity: 1 !important; }
  #banner { display: none !important; }
  .download-format, #btn-download { display: none !important; }
  #btn-next, #btn-export-html, #btn-export-pdf { display: inline-flex !important; }
`;
document.head.appendChild(style);

initApp(screenshotAdapter);

// Signal readiness once every mermaid block has produced an <svg> (diagrams and
// KaTeX render asynchronously). A headless capture should poll for window.__ready.
declare global {
  interface Window { __ready?: boolean }
}
function markReadyWhenRendered(): void {
  const start = Date.now();
  const tick = () => {
    const blocks = Array.from(document.querySelectorAll(".mermaid"));
    const allRendered = blocks.length > 0 && blocks.every((b) => b.querySelector("svg"));
    // No mermaid at all (data/log docs) → ready after content mounts.
    const hasContent = !!document.querySelector("#content .doc, #content .data-tree, #content .log-view, #content > *");
    if ((blocks.length === 0 && hasContent) || allRendered || Date.now() - start > 8000) {
      window.__ready = true;
      return;
    }
    setTimeout(tick, 100);
  };
  setTimeout(tick, 200);
}
markReadyWhenRendered();
