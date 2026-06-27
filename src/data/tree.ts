import type { DataValue, DataNode } from "../types";
import { visibleRange } from "../logs/virtual-log-view";

interface FlatNode { path: string; key: string; value: DataValue; }

/** A row in the currently-visible (expansion-respecting) list, for virtual mode. */
interface VisRow {
  path: string;
  key: string;
  value: DataValue;
  depth: number;
  container: boolean;
  open: boolean;
  childCount: number;
}

const DEFAULT_EXPAND_CAP = 5000;
/** Above this many TOTAL model nodes the tree switches from the nested DOM
 *  renderer to a virtualized window. Total (not visible) count is the gate
 *  because it bounds the visible count — a small-total file can never blow up
 *  even via expandAll, so it safely keeps the battle-tested nested path. Tests
 *  pass a tiny `virtualizeThreshold` to exercise the virtual path on fixtures. */
const VIRTUALIZE_THRESHOLD = 200;
/** Indent per depth level (px) for the flat virtual rows (nesting is lost when
 *  flattened, so indentation is expressed as padding instead of nested divs). */
const INDENT = 16;
const BASE_PAD = 4;
const OVERSCAN = 8;
/** Used until a real row can be measured (e.g. built while tab is display:none). */
const FALLBACK_ROW_H = 24;

export class TreeView {
  private expanded = new Set<string>();
  private flat: FlatNode[] = [];

  // ─── virtual-mode state (unused in nested mode) ──────────────────────────────
  private virtual = false;
  private vis: VisRow[] = [];
  private sizer: HTMLElement | null = null;
  private win: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private rowH = FALLBACK_ROW_H;
  private measured = false;
  private rafId: number | null = null;
  private currentPath: string | null = null;
  private readonly onScroll = () => this.scheduleRender();
  /** Pool of recycled row elements (S9: DOM pooling). */
  private rowPool: HTMLElement[] = [];

  constructor(
    private rootValue: DataValue,
    private container: HTMLElement,
    private opts: { defaultDepth?: number; expandCap?: number; virtualizeThreshold?: number } = {}
  ) {
    this.flat = [];
    // Lightweight count — no FlatNode allocation, just walks the tree shape.
    const total = countNodes(rootValue);
    this.virtual = total > (opts.virtualizeThreshold ?? VIRTUALIZE_THRESHOLD);

    // Seed expansion to the default depth using a tree walk.
    const depth = opts.defaultDepth ?? 1;
    this.seedExpansion(rootValue, depth);
    if (isContainer(rootValue)) this.expanded.add("root");

    if (this.virtual) this.initVirtual();
    else this.repaint();
  }

  /** Every node in tree order, model-based (independent of expansion/DOM).
   *  Lazily built on first call (search triggers this; initial render does not
   *  need the full flat list). */
  nodes(): FlatNode[] {
    if (this.flat.length === 0) this.buildFlat();
    return this.flat.filter((n) => n.path !== "root");
  }

  expandAll(): void {
    // Virtualization removes the DOM cost of full expansion, so the cap (which
    // exists only to bound the nested DOM) does not apply in virtual mode.
    if (!this.virtual) {
      const cap = this.opts.expandCap ?? DEFAULT_EXPAND_CAP;
      if (countNodes(this.rootValue) > cap) return;
    }
    this.expandAllWalk(this.rootValue);
    this.refresh();
  }

  collapseAll(): void {
    this.expanded.clear();
    this.expanded.add("root");
    this.refresh();
  }

  expandToPath(path: string): void {
    for (const p of ancestorPaths(path)) this.expanded.add(p);
    this.refresh();
  }

  rowElement(path: string): HTMLElement | null {
    return this.container.querySelector<HTMLElement>(`[data-path="${cssEscape(path)}"]`);
  }

  /**
   * Expand ancestors of `path`, bring its row on-screen (scrolling the virtual
   * window so the row is materialized), mark it as the current search hit, and
   * return the row element (or null if the path isn't in the model). Shared by
   * both modes so the search provider never branches on virtualization.
   */
  revealPath(path: string): HTMLElement | null {
    this.clearCurrent();
    this.expandToPath(path); // refresh() re-renders; the row now exists (nested) or can be windowed (virtual)
    this.currentPath = path;

    if (this.virtual) {
      const idx = this.vis.findIndex((v) => v.path === path);
      if (idx < 0) return null;
      this.scrollIndexIntoView(idx);
      this.renderAround(idx); // paint a window containing idx regardless of measured scroll
    }
    const row = this.rowElement(path);
    if (row) {
      row.classList.add("search-current");
      if (!this.virtual) row.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
    return row;
  }

  /** Remove the current-hit marker. */
  clearCurrent(): void {
    if (this.currentPath) this.rowElement(this.currentPath)?.classList.remove("search-current");
    this.currentPath = null;
  }

  /** Release the scroll listener (virtual mode only). */
  destroy(): void {
    if (this.scroller) this.scroller.removeEventListener("scroll", this.onScroll);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.rowPool = [];
  }

  // ─── shared ──────────────────────────────────────────────────────────────────

  private refresh(): void {
    if (this.virtual) {
      this.computeVisible();
      if (this.sizer) this.sizer.style.height = `${this.vis.length * this.rowH}px`;
      this.renderVisible();
    } else {
      this.repaint();
    }
  }

  private toggle(path: string): void {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
    this.refresh();
  }

  /** Seed expansion: expand containers at depth < `maxDepth` (matching the
   *  original `pathDepth(n.path) < depth` logic) without allocating FlatNodes. */
  private seedExpansion(value: DataValue, maxDepth: number, currentDepth = 0): void {
    const children: DataNode[] =
      value.kind === "object" ? value.entries
      : value.kind === "array" ? value.items
      : [];
    for (const node of children) {
      if (isContainer(node.value) && currentDepth + 1 < maxDepth) this.expanded.add(node.path);
      this.seedExpansion(node.value, maxDepth, currentDepth + 1);
    }
  }

  /** Expand every container node (for expandAll). */
  private expandAllWalk(value: DataValue): void {
    if (value.kind === "object") {
      for (const e of value.entries) {
        this.expanded.add(e.path);
        this.expandAllWalk(e.value);
      }
    } else if (value.kind === "array") {
      for (const e of value.items) {
        this.expanded.add(e.path);
        this.expandAllWalk(e.value);
      }
    }
  }

  /** Build the flat list on demand (first call from search provider). */
  private buildFlat(): void {
    const walk = (value: DataValue, key: string, path: string): void => {
      this.flat.push({ path, key, value });
      if (value.kind === "object") for (const e of value.entries) walk(e.value, e.key, e.path);
      else if (value.kind === "array") for (const e of value.items) walk(e.value, e.key, e.path);
    };
    walk(this.rootValue, "root", "root");
  }

  // ─── nested mode (unchanged; common case for normal-sized files) ──────────────

  private repaint(): void {
    this.container.replaceChildren();
    const rootChildren =
      this.rootValue.kind === "object" ? this.rootValue.entries
      : this.rootValue.kind === "array" ? this.rootValue.items
      : null;
    if (rootChildren) {
      for (const node of rootChildren) this.renderNode(node, this.container);
    } else {
      this.container.appendChild(this.scalarRow("", "root", this.rootValue));
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

  // ─── virtual mode (large files) ───────────────────────────────────────────────

  private initVirtual(): void {
    this.container.replaceChildren();
    this.container.classList.add("tree-virtual");
    this.sizer = document.createElement("div");
    this.sizer.className = "tree-sizer";
    this.win = document.createElement("div");
    this.win.className = "tree-window";
    this.sizer.appendChild(this.win);
    this.container.appendChild(this.sizer);

    this.scroller = findScroller(this.container);
    this.scroller.addEventListener("scroll", this.onScroll, { passive: true });

    this.computeVisible();
    this.sizer.style.height = `${this.vis.length * this.rowH}px`;
    // Defer first paint to a frame so the row height can be measured once layout
    // exists (offsetHeight is 0 while the tab is display:none).
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.renderVisible();
    });
  }

  /** Walk the model respecting expansion → the ordered list of shown rows. */
  private computeVisible(): void {
    const out: VisRow[] = [];
    const walk = (children: DataNode[], depth: number): void => {
      for (const node of children) {
        const container = isContainer(node.value);
        const kids: DataNode[] =
          node.value.kind === "array" ? node.value.items
          : node.value.kind === "object" ? node.value.entries
          : [];
        const open = container && this.expanded.has(node.path);
        out.push({ path: node.path, key: node.key, value: node.value, depth, container, open, childCount: kids.length });
        if (open) walk(kids, depth + 1);
      }
    };
    const rootChildren =
      this.rootValue.kind === "object" ? this.rootValue.entries
      : this.rootValue.kind === "array" ? this.rootValue.items
      : null;
    if (rootChildren) walk(rootChildren, 0);
    else out.push({ path: "root", key: "", value: this.rootValue, depth: 0, container: false, open: false, childCount: 0 });
    this.vis = out;
  }

  /** Render the window implied by the current scroll position. */
  private renderVisible(): void {
    if (!this.scroller) return;
    // The tree was detached (e.g. switched to another tab, which repaints
    // #content) but our scroll listener still lives on the shared scroller —
    // self-clean on the next event so it can't leak or paint into dead DOM.
    if (!this.container.isConnected) { this.destroy(); return; }
    const viewportH = this.scroller.clientHeight || 600;
    // Distance the sizer's top has scrolled above the viewport top — works even
    // though the tree sits below a toolbar inside the shared #content scroller.
    const eff = Math.max(0, this.scroller.getBoundingClientRect().top - this.container.getBoundingClientRect().top);
    const r = visibleRange({ scrollTop: eff, viewportH, rowH: this.rowH, lineCount: this.vis.length, overscan: OVERSCAN });
    this.paintWindow(r.start, r.count);
  }

  /** Render a window centered on `idx` (used by reveal so the target is painted
   *  regardless of the measured scroll position). */
  private renderAround(idx: number): void {
    const viewportH = this.scroller?.clientHeight || 600;
    const span = Math.ceil(viewportH / this.rowH) + 2 * OVERSCAN;
    const start = Math.max(0, idx - OVERSCAN);
    this.paintWindow(start, Math.min(span, this.vis.length - start));
  }

  private paintWindow(start: number, count: number): void {
    const win = this.win;
    if (!win) return;
    // Return current window rows to the pool for reuse (S9).
    while (win.firstElementChild) {
      const el = win.firstElementChild as HTMLElement;
      el.remove();
      this.rowPool.push(el);
    }
    const frag = document.createDocumentFragment();
    for (let i = start; i < start + count; i++) {
      const row = this.rowPool.pop() ?? document.createElement("div");
      this.fillRow(row, this.vis[i]);
      frag.appendChild(row);
    }
    win.replaceChildren(frag);
    win.style.transform = `translateY(${start * this.rowH}px)`;

    // Measure the real row height once a row is on-screen, then correct the sizer
    // and repaint if our estimate was off (e.g. font-size differs from fallback).
    if (!this.measured && win.firstElementChild) {
      const h = (win.firstElementChild as HTMLElement).offsetHeight;
      if (h > 0) {
        this.measured = true;
        if (h !== this.rowH) {
          this.rowH = h;
          if (this.sizer) this.sizer.style.height = `${this.vis.length * this.rowH}px`;
          win.style.transform = `translateY(${start * this.rowH}px)`;
        }
      }
    }
    // Re-apply the current-hit marker (rows are freshly built each paint).
    if (this.currentPath) {
      win.querySelector<HTMLElement>(`[data-path="${cssEscape(this.currentPath)}"]`)?.classList.add("search-current");
    }
  }

  /** Populate an existing element as a tree row for virtual entry `v`. */
  private fillRow(row: HTMLElement, v: VisRow): void {
    row.textContent = "";
    row.removeAttribute("style");
    row.dataset.path = v.path;
    row.style.paddingLeft = `${v.depth * INDENT + BASE_PAD}px`;
    if (v.container) {
      row.className = "tree-row tree-branch";
      const toggle = document.createElement("button");
      toggle.className = "tree-toggle";
      toggle.textContent = v.open ? "−" : "+";
      toggle.setAttribute("aria-expanded", String(v.open));
      toggle.addEventListener("click", () => this.toggle(v.path));
      const keyEl = document.createElement("span");
      keyEl.className = "tree-key";
      keyEl.textContent = v.key;
      const meta = document.createElement("span");
      meta.className = "tree-meta";
      meta.textContent = v.value.kind === "array" ? `[${v.childCount}]` : `{${v.childCount}}`;
      row.append(toggle, keyEl, meta);
    } else {
      row.className = "tree-row tree-leaf";
      if (v.key) {
        const keyEl = document.createElement("span");
        keyEl.className = "tree-key";
        keyEl.textContent = v.key;
        row.appendChild(keyEl);
      }
      const valEl = document.createElement("span");
      const scalar = v.value as { kind: "scalar"; type: string; text: string };
      valEl.className = `tree-value type-${scalar.type}`;
      valEl.textContent = scalar.type === "string" ? `"${scalar.text}"` : scalar.text;
      row.appendChild(valEl);
    }
  }

  private scheduleRender(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.renderVisible();
    });
  }

  private scrollIndexIntoView(idx: number): void {
    if (!this.scroller) return;
    const wrapTop = this.container.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
    const target = wrapTop + idx * this.rowH - this.scroller.clientHeight / 2;
    this.scroller.scrollTop = Math.max(0, target);
  }
}

function isContainer(v: DataValue): boolean {
  return v.kind === "object" || v.kind === "array";
}
/** Lightweight count of DataValue nodes (no FlatNode allocation). */
function countNodes(value: DataValue): number {
  let count = 0;
  const walk = (v: DataValue): void => {
    count++;
    if (v.kind === "object") for (const e of v.entries) walk(e.value);
    else if (v.kind === "array") for (const e of v.items) walk(e.value);
  };
  walk(value);
  return count;
}
function ancestorPaths(path: string): string[] {
  // For "root.a[2].b" → ["root", "root.a", "root.a[2]", "root.a[2].b"].
  const out: string[] = [];
  let cur = "";
  for (const tok of path.split(/(?=[.[])/)) { cur += tok; out.push(cur.replace(/^\./, "")); }
  return out.filter(Boolean);
}
function cssEscape(s: string): string {
  if (typeof window !== "undefined" && window.CSS && CSS.escape) return CSS.escape(s);
  // Fallback for the `[data-path="…"]` quoted-string context: backslash-escape
  // the quote and backslash, and escape control chars (newlines are illegal
  // unescaped inside a CSS string) so the selector stays valid for any key.
  return s.replace(/["\\]/g, "\\$&").replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

/** Nearest scrollable ancestor (overflow-y auto/scroll), falling back to the
 *  element itself. The tree positions rows relative to this viewport. */
function findScroller(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === "auto" || oy === "scroll") return cur;
    cur = cur.parentElement;
  }
  return el;
}

export function renderTree(
  root: DataValue,
  container: HTMLElement,
  opts?: { defaultDepth?: number; expandCap?: number; virtualizeThreshold?: number }
): TreeView {
  return new TreeView(root, container, opts);
}
