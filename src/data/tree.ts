import type { DataValue, DataNode } from "../types";

interface FlatNode { path: string; key: string; value: DataValue; }

const DEFAULT_EXPAND_CAP = 5000;

export class TreeView {
  private expanded = new Set<string>();
  private flat: FlatNode[] = [];

  constructor(
    private rootValue: DataValue,
    private container: HTMLElement,
    private opts: { defaultDepth?: number; expandCap?: number } = {}
  ) {
    this.flat = [];
    this.collectFlat(rootValue, "root", "root", 0);
    // Seed expansion to the default depth.
    // defaultDepth: containers with pathDepth(path) < defaultDepth are auto-expanded.
    // e.g. defaultDepth: 1 expands only root level; defaultDepth: 2 expands root + first level of children.
    const depth = opts.defaultDepth ?? 1;
    for (const n of this.flat) {
      if (isContainer(n.value) && pathDepth(n.path) < depth) this.expanded.add(n.path);
    }
    if (isContainer(rootValue)) this.expanded.add("root");
    this.repaint();
  }

  /** Every node in tree order, model-based (independent of expansion). */
  nodes(): FlatNode[] {
    return this.flat.filter((n) => n.path !== "root");
  }

  expandAll(): void {
    const cap = this.opts.expandCap ?? DEFAULT_EXPAND_CAP;
    if (this.flat.length > cap) return; // guarded; caller shows a notice
    for (const n of this.flat) if (isContainer(n.value)) this.expanded.add(n.path);
    this.repaint();
  }

  collapseAll(): void {
    this.expanded.clear();
    this.expanded.add("root");
    this.repaint();
  }

  expandToPath(path: string): void {
    // Expand every ancestor container prefix of `path`.
    const parts = ancestorPaths(path);
    for (const p of parts) this.expanded.add(p);
    this.repaint();
  }

  rowElement(path: string): HTMLElement | null {
    return this.container.querySelector<HTMLElement>(`[data-path="${cssEscape(path)}"]`);
  }

  private toggle(path: string): void {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
    this.repaint();
  }

  private collectFlat(value: DataValue, key: string, path: string, _depth: number): void {
    this.flat.push({ path, key, value });
    if (value.kind === "object") for (const e of value.entries) this.collectFlat(e.value, e.key, e.path, _depth + 1);
    else if (value.kind === "array") for (const e of value.items) this.collectFlat(e.value, e.key, e.path, _depth + 1);
  }

  private repaint(): void {
    this.container.replaceChildren();
    const rootChildren =
      this.rootValue.kind === "object" ? this.rootValue.entries
      : this.rootValue.kind === "array" ? this.rootValue.items
      : null;
    if (rootChildren) {
      for (const node of rootChildren) this.renderNode(node, this.container);
    } else {
      // root is a scalar: render a single value row
      const row = this.scalarRow("", "root", this.rootValue);
      this.container.appendChild(row);
    }
  }

  private renderNode(node: DataNode, parent: HTMLElement): void {
    if (isContainer(node.value)) {
      const open = this.expanded.has(node.path);
      const row = document.createElement("div");
      row.className = "tree-row tree-branch";
      row.dataset.path = node.path;

      const toggle = document.createElement("button");
      toggle.className = "tree-toggle";
      toggle.textContent = open ? "−" : "+";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.addEventListener("click", () => this.toggle(node.path));

      const keyEl = document.createElement("span");
      keyEl.className = "tree-key";
      keyEl.textContent = node.key;

      const meta = document.createElement("span");
      meta.className = "tree-meta";
      const containerChildren: DataNode[] =
        node.value.kind === "array" ? node.value.items
        : node.value.kind === "object" ? node.value.entries
        : [];
      meta.textContent = node.value.kind === "array"
        ? `[${containerChildren.length}]`
        : `{${containerChildren.length}}`;

      row.append(toggle, keyEl, meta);
      parent.appendChild(row);

      if (open) {
        const childWrap = document.createElement("div");
        childWrap.className = "tree-children";
        for (const c of containerChildren) this.renderNode(c, childWrap);
        parent.appendChild(childWrap);
      }
    } else {
      parent.appendChild(this.scalarRow(node.key, node.path, node.value));
    }
  }

  private scalarRow(key: string, path: string, value: DataValue): HTMLElement {
    const row = document.createElement("div");
    row.className = "tree-row tree-leaf";
    row.dataset.path = path;
    if (key) {
      const keyEl = document.createElement("span");
      keyEl.className = "tree-key";
      keyEl.textContent = key;
      row.appendChild(keyEl);
    }
    const valEl = document.createElement("span");
    const scalar = value as { kind: "scalar"; type: string; text: string };
    valEl.className = `tree-value type-${scalar.type}`;
    valEl.textContent = scalar.type === "string" ? `"${scalar.text}"` : scalar.text;
    row.appendChild(valEl);
    return row;
  }
}

function isContainer(v: DataValue): boolean {
  return v.kind === "object" || v.kind === "array";
}
function pathDepth(path: string): number {
  return (path.match(/\.|\[/g) || []).length;
}
function ancestorPaths(path: string): string[] {
  // For "root.a[2].b" → ["root", "root.a", "root.a[2]", "root.a[2].b"].
  const out: string[] = [];
  let cur = "";
  for (const tok of path.split(/(?=[.[])/)) { cur += tok; out.push(cur.replace(/^\./, "")); }
  return out.filter(Boolean);
}
function cssEscape(s: string): string {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  // Fallback for the `[data-path="…"]` quoted-string context: backslash-escape
  // the quote and backslash, and escape control chars (newlines are illegal
  // unescaped inside a CSS string) so the selector stays valid for any key.
  return s.replace(/["\\]/g, "\\$&").replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

export function renderTree(
  root: DataValue,
  container: HTMLElement,
  opts?: { defaultDepth?: number; expandCap?: number }
): TreeView {
  return new TreeView(root, container, opts);
}
