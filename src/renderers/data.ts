import { parseData } from "../data/parse";
import { renderTree, TreeView } from "../data/tree";
import { dataLangOf } from "../format";
import type { Renderer, RenderCtx } from "../types";

const SIZE_CAP_BYTES = 5_000_000; // above this, fall back to raw text

let currentTree: TreeView | null = null;
/** The tree from the most recent data render (single active doc), for search. */
export function getCurrentTree(): TreeView | null {
  return currentTree;
}

export const dataRenderer: Renderer = {
  format: "data",
  render(source: string, container: HTMLElement, _ctx: RenderCtx, path?: string) {
    currentTree = null;
    container.replaceChildren();

    const lang = (path && dataLangOf(path)) || "json";
    if (source.length > SIZE_CAP_BYTES) {
      container.appendChild(notice("File too large for tree view — showing raw text."));
      container.appendChild(rawPre(source));
      return;
    }
    const result = parseData(source, lang);
    if (!result.ok || !result.value) {
      container.appendChild(notice(`Parse error: ${result.error?.message ?? "unknown"} — showing raw text.`));
      container.appendChild(rawPre(source));
      return;
    }

    const toolbar = document.createElement("div");
    toolbar.className = "tree-toolbar";
    const wrap = document.createElement("div");
    wrap.className = "tree";
    const tree = renderTree(result.value, wrap, { defaultDepth: 2 });
    currentTree = tree;

    const expandAll = button("Expand all", () => tree.expandAll());
    const collapseAll = button("Collapse all", () => tree.collapseAll());
    toolbar.append(expandAll, collapseAll);
    container.append(toolbar, wrap);
  },
};

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tree-action";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
function notice(text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "tree-notice";
  d.textContent = text;
  return d;
}
function rawPre(source: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "raw";
  pre.textContent = source;
  return pre;
}
