import hljsLight from "highlight.js/styles/github.css?inline";
import hljsDark from "highlight.js/styles/github-dark.css?inline";
import type { Theme } from "./types";
import { iconMarkup } from "./icons";

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
  const resolved = theme === "system"
    ? (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  hljsStyleEl.textContent = resolved === "dark" ? hljsDark : hljsLight;
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
    const rejectPending = (message: string) => {
      const error = new Error(message);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    worker.onerror = (event) => rejectPending(event.message || "Render worker failed");
    worker.onmessageerror = () => rejectPending("Render worker returned an invalid message");
  }

  return new Promise<string>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, source: text, renderWithMath });
  });
}

// Bounded cache of rendered HTML, keyed by (math flag + source). Pre-warming
// adjacent tabs on idle (TabManager.prewarmAdjacent) populates this so a tab
// switch can skip the worker round-trip and paint from cache. Keyed by the full
// source, so an edit or external change to a file produces a new key — a stale
// render is never served. Bounded (LRU by insertion order) to cap memory when
// many/large docs are open. Promises are cached so concurrent identical
// requests share one render; a rejection is evicted so a retry re-renders.
const RENDER_CACHE_MAX = 16;
const renderCache = new Map<string, Promise<string>>();

function renderCached(text: string, renderWithMath: boolean): Promise<string> {
  const key = (renderWithMath ? "m\0" : "b\0") + text;
  const hit = renderCache.get(key);
  if (hit) {
    renderCache.delete(key); // refresh LRU recency
    renderCache.set(key, hit);
    return hit;
  }
  const p = renderVia(text, renderWithMath);
  p.catch(() => renderCache.delete(key));
  renderCache.set(key, p);
  while (renderCache.size > RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    renderCache.delete(oldest);
  }
  return p;
}

/** Base render — NO math. Math syntax is left as raw text. Returns the cached
 *  promise directly so concurrent identical requests share one render. */
export function renderMarkdown(text: string): Promise<string> {
  return renderCached(text, false);
}

/** Warm the render cache for `text` off the critical path (e.g. adjacent tabs
 *  during idle time) so a later switch paints instantly. Never rejects —
 *  a failed pre-warm is simply not cached, and the real render surfaces it. */
export function prewarmMarkdown(text: string): void {
  void renderMarkdown(text).catch(() => {});
}

/** Render Markdown WITH math (lazy katex import in the Worker). */
export async function renderMath(text: string): Promise<string> {
  injectKatexCss();
  return renderCached(text, true);
}

let mermaidConfiguredTheme: Theme | null = null;

/**
 * DOM post-render pass: turn `pre.mermaid` blocks into SVG diagrams. Runs after
 * the rendered HTML is in the DOM. On a parse error mermaid annotates the block
 * inline rather than throwing, so one bad diagram doesn't break the document.
 */
function resolveTheme(theme: Theme): Theme {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type MermaidKind = "svg" | "png" | "wb" | "dio" | "luc" | "exc" | "src" | "edit" | "all";

/** One action group. "Copy" offers SVG + PNG + Whiteboard + draw.io +
 *  Lucidchart + Excalidraw; "Download" offers SVG + PNG + draw.io/Lucid XML. */
function mermaidActionGroup(act: "copy" | "download", iconId: string, verb: string): string {
  const LABEL: Record<MermaidKind, string> = {
    svg: "SVG", png: "PNG", wb: "WB", dio: "DIO", luc: "LC", exc: "EX", src: "SRC", edit: "Edit", all: "All",
  };
  const TITLE: Record<MermaidKind, string> = {
    svg: `${verb} as SVG`,
    png: `${verb} as PNG`,
    wb: `${verb} to Whiteboard`,
    dio: `${verb} to draw.io`,
    luc: `${verb} for Lucidchart`,
    exc: `${verb} to Excalidraw`,
    src: "Copy Mermaid source",
    edit: "Edit Mermaid source in a new document",
    all: "Download all diagrams as draw.io XML",
  };
  const btn = (kind: MermaidKind) =>
    `<button class="mermaid-btn" type="button" data-act="${act}" data-kind="${kind}" ` +
    `title="${TITLE[kind]}" aria-label="${TITLE[kind]}">` +
    `<span class="mermaid-btn-label">${LABEL[kind]}</span></button>`;
  const extra = act === "copy"
    ? btn("src") + btn("edit") + btn("wb") + btn("dio") + btn("luc") + btn("exc")
    : btn("dio") + btn("luc") + btn("all");
  return (
    `<div class="mermaid-group" role="group" aria-label="${verb}">` +
    `<span class="mermaid-group-icon" title="${verb}" aria-hidden="true">${iconMarkup(iconId)}</span>` +
    btn("svg") +
    btn("png") +
    extra +
    `</div>`
  );
}

/**
 * Add a hover toolbar to a rendered mermaid block: a "Copy" group and a
 * "Download" group, each offering SVG + PNG. Only blocks that actually produced
 * an <svg> get a toolbar (a parse error leaves the mermaid-annotated source
 * instead). Idempotent — re-rendering won't stack bars. Click handling lives in
 * main.ts's `#content` delegation (`.mermaid-btn`).
 */
function decorateMermaid(node: HTMLElement): void {
  if (!node.querySelector("svg") || node.querySelector(".mermaid-actions")) return;
  const bar = document.createElement("div");
  bar.className = "mermaid-actions";
  bar.innerHTML =
    mermaidActionGroup("copy", "ic-copy", "Copy") +
    mermaidActionGroup("download", "ic-download", "Download");
  node.appendChild(bar);
}

// Cache of rendered mermaid SVG markup keyed by (resolved theme + source). A
// re-render (external file edit, tab switch) reuses diagrams whose source and
// theme are unchanged instead of re-running mermaid's expensive parse + layout —
// the only costly post-render step (katex/highlight are baked into the worker
// HTML). Theme is in the key, so a theme switch correctly re-renders every
// diagram. Bounded LRU by insertion order. Value is the SVG-only innerHTML,
// captured before decorateMermaid so a cache hit doesn't double-add the toolbar.
const MERMAID_CACHE_MAX = 64;
const mermaidSvgCache = new Map<string, string>();

function mermaidKey(resolvedTheme: Theme, source: string): string {
  return resolvedTheme + "\0" + source;
}

export async function runPostRender(container: HTMLElement, theme: Theme): Promise<void> {
  const resolved = resolveTheme(theme);
  const nodes = Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid"));
  if (nodes.length === 0) return;

  // Reuse cached SVGs for unchanged (source + theme) diagrams; collect the rest.
  // `seenThisPass` guards duplicate same-source blocks: only the first reuses the
  // cache, the rest go through mermaid.run so they get their own unique element
  // ids (injecting the same cached markup twice would collide `url(#id)` refs).
  const toRender: HTMLElement[] = [];
  const seenThisPass = new Set<string>();
  for (const n of nodes) {
    const source = n.textContent ?? "";
    const key = mermaidKey(resolved, source);
    const cached = mermaidSvgCache.get(key);
    if (cached && !seenThisPass.has(key)) {
      n.innerHTML = cached;
      if (source) n.dataset.mermaidSrc = source;
      n.setAttribute("data-processed", "true");
      n.style.visibility = ""; // reveal — markdown.ts hid it pre-paint
      seenThisPass.add(key);
      mermaidSvgCache.delete(key); // refresh LRU recency
      mermaidSvgCache.set(key, cached);
      decorateMermaid(n);
    } else {
      n.dataset.mermaidSrc = source; // stash: mermaid.run replaces textContent with the SVG
      toRender.push(n);
    }
  }
  if (toRender.length === 0) return; // fully served from cache — no mermaid import

  for (const n of toRender) n.style.visibility = "hidden";
  try {
    const { default: mermaid } = await import("mermaid");
    if (mermaidConfiguredTheme !== resolved) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: resolved === "dark" ? "dark" : "default",
        // Render labels as SVG <text>, not <foreignObject> XHTML. foreignObject
        // both renders blank when rasterized AND taints the canvas (blocking
        // toBlob), so PNG export needs pure-SVG labels. Must be TOP-LEVEL — the
        // `flowchart.htmlLabels` key alone leaves edge labels as foreignObject.
        htmlLabels: false,
        flowchart: { htmlLabels: false },
      });
      mermaidConfiguredTheme = resolved;
    }
    await mermaid.run({ nodes: toRender });
    for (const n of toRender) {
      const source = n.dataset.mermaidSrc ?? "";
      delete n.dataset.mermaidSrc;
      // Cache the SVG only when mermaid actually produced one — a parse error
      // leaves the annotated source, which must not be cached (so fixing the
      // diagram re-renders). Cache before decorate so hits get the toolbar fresh.
      if (n.querySelector("svg")) {
        const key = mermaidKey(resolved, source);
        mermaidSvgCache.set(key, n.innerHTML);
        while (mermaidSvgCache.size > MERMAID_CACHE_MAX) {
          const oldest = mermaidSvgCache.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          mermaidSvgCache.delete(oldest);
        }
      }
      if (source) n.dataset.mermaidSrc = source;
      decorateMermaid(n);
    }
  } catch {
    /* mermaid annotates failing blocks inline; also swallows a failed chunk load */
  } finally {
    for (const n of toRender) n.style.visibility = "";
  }
}
