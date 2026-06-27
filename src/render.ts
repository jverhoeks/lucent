import hljsLight from "highlight.js/styles/github.css?inline";
import hljsDark from "highlight.js/styles/github-dark.css?inline";
import type { Theme } from "./types";

// KaTeX fonts add ~2MB to the bundle when imported from node_modules.
// Load them from CDN on demand instead.
const KATEX_CDN = "https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css";
let katexCssInjected = false;

function injectKatexCss(): void {
  if (katexCssInjected || typeof document === "undefined") return;
  katexCssInjected = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = KATEX_CDN;
  link.crossOrigin = "anonymous";
  if (document.head) document.head.appendChild(link);
}

let hljsStyleEl: HTMLStyleElement | null = null;

/** Swap the highlight.js color theme to match the app theme (dark code in dark mode). */
export function applyCodeTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (!hljsStyleEl) {
    hljsStyleEl = document.createElement("style");
    hljsStyleEl.id = "hljs-theme";
    document.head.appendChild(hljsStyleEl);
  }
  hljsStyleEl.textContent = theme === "dark" ? hljsDark : hljsLight;
}

/** Remove the highlight.js style element (cleanup on destroy). */
export function removeCodeTheme(): void {
  if (hljsStyleEl) { hljsStyleEl.remove(); hljsStyleEl = null; }
}

/**
 * Split highlight.js output into one self-contained HTML string per source
 * line, re-balancing `<span>`s that straddle a newline.
 */
export function splitHighlightedLines(html: string): string[] {
  if (html === "") return [];
  const lines: string[] = [];
  const open: string[] = [];
  let cur = "";
  const re = /(<span[^>]*>)|(<\/span>)|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) { open.push(m[1]); cur += m[1]; }
    else if (m[2]) { open.pop(); cur += "</span>"; }
    else {
      const parts = m[3].split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) { cur += "</span>".repeat(open.length); lines.push(cur); cur = open.join(""); }
        cur += parts[i];
      }
    }
  }
  lines.push(cur);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * True when the source likely contains math the katex plugin would tokenize:
 * paired `$…$` / `$$…$$`, OR a bare `\begin{…}` environment.
 */
export function hasMath(text: string): boolean {
  return /\$[\s\S]*\$/.test(text) || /\\begin\s*\{/.test(text);
}

// ---- Web Worker rendering proxy ----
// The actual markdown / math rendering runs in a dedicated Worker so that
// heavy synchronous work (markdown-it + hljs + katex) never blocks the main
// thread.  When the rendering result arrives it is applied to the DOM.
//
// In environments without Worker support (Vitest / jsdom) we fall back to
// a dynamic import of render-core so existing tests keep working unchanged.

const pending = new Map<number, { resolve(html: string): void; reject(err: Error): void }>();
let nextId = 1;
let worker: Worker | null = null;
let fallback: typeof import("./render-core") | null = null;

async function renderVia(text: string, renderWithMath: boolean): Promise<string> {
  // jsdom / Node-based test runners don't have Worker — fall back to a direct
  // dynamic import of the rendering module (which is loaded once and cached).
  if (typeof Worker === "undefined") {
    if (!fallback) fallback = await import("./render-core");
    return renderWithMath ? fallback.renderMath(text) : fallback.renderMarkdown(text);
  }

  if (!worker) {
    worker = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; html?: string; error?: string }>) => {
      const { id, html, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(html!);
    };
  }

  return new Promise<string>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, source: text, renderWithMath });
  });
}

/** Base render — NO math. Math syntax is left as raw text. */
export async function renderMarkdown(text: string): Promise<string> {
  return renderVia(text, false);
}

/** Render Markdown WITH math (lazy katex import in the Worker). */
export async function renderMath(text: string): Promise<string> {
  injectKatexCss();
  return renderVia(text, true);
}

let mermaidConfiguredTheme: Theme | null = null;

/**
 * DOM post-render pass: turn `pre.mermaid` blocks into SVG diagrams. Runs after
 * the rendered HTML is in the DOM. On a parse error mermaid annotates the block
 * inline rather than throwing, so one bad diagram doesn't break the document.
 */
export async function runPostRender(container: HTMLElement, theme: Theme): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid"));
  if (nodes.length === 0) return;
  for (const n of nodes) n.style.visibility = "hidden";
  try {
    const { default: mermaid } = await import("mermaid");
    if (mermaidConfiguredTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: theme === "dark" ? "dark" : "default",
      });
      mermaidConfiguredTheme = theme;
    }
    await mermaid.run({ nodes });
  } catch {
    /* mermaid annotates failing blocks inline; also swallows a failed chunk load */
  } finally {
    for (const n of nodes) n.style.visibility = "";
  }
}
