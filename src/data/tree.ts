import type { DataValue, DataNode, DataScalarType } from "../types";
import { visibleRange } from "../logs/virtual-log-view";

interface FlatNode { path: string; key: string; value: DataValue; }

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
const VIRTUALIZE_THRESHOLD = 200;
const INDENT = 16;
const BASE_PAD = 4;
const OVERSCAN = 8;
const FALLBACK_ROW_H = 24;

export class TreeView {
  private expanded = new Set<string>();
  private flat: FlatNode[] = [];

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
  private rowPool: HTMLElement[] = [];

  // ─── editable mode ──────────────────────────────────────────────────────────
  private editMode: boolean;
  private onEdit: ((value: DataValue) => void) | null;

  constructor(
    private rootValue: DataValue,
    private container: HTMLElement,
    private opts: { defaultDepth?: number; expandCap?: number; virtualizeThreshold?: number; editable?: boolean; onEdit?: (value: DataValue) => void } = {}
  ) {
    this.editMode = opts.editable ?? false;
    this.onEdit = opts.onEdit ?? null;
    this.flat = [];
    const total = countNodes(rootValue);
    this.virtual = total > (opts.virtualizeThreshold ?? VIRTUALIZE_THRESHOLD);

    const depth = opts.defaultDepth ?? 1;
    this.seedExpansion(rootValue, depth);
    if (isContainer(rootValue)) this.expanded.add("root");

    if (this.virtual) this.initVirtual();
    else this.repaint();
  }

  nodes(): FlatNode[] {
    if (this.flat.length === 0) this.buildFlat();
    return this.flat.filter((n) => n.path !== "root");
  }

  expandAll(): void {
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

  revealPath(path: string): HTMLElement | null {
    this.clearCurrent();
    this.expandToPath(path);
    this.currentPath = path;
    if (this.virtual) {
      const idx = this.vis.findIndex((v) => v.path === path);
      if (idx < 0) return null;
      this.scrollIndexIntoView(idx);
      this.renderAround(idx);
    }
    const row = this.rowElement(path);
    if (row) {
      row.classList.add("search-current");
      if (!this.virtual) row.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
    return row;
  }

  clearCurrent(): void {
    if (this.currentPath) this.rowElement(this.currentPath)?.classList.remove("search-current");
    this.currentPath = null;
  }

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

  private buildFlat(): void {
    const walk = (value: DataValue, key: string, path: string): void => {
      this.flat.push({ path, key, value });
      if (value.kind === "object") for (const e of value.entries) walk(e.value, e.key, e.path);
      else if (value.kind === "array") for (const e of value.items) walk(e.value, e.key, e.path);
    };
    walk(this.rootValue, "root", "root");
  }

  // ─── nested mode ─────────────────────────────────────────────────────────────

  private repaint(): void {
    this.container.replaceChildren();
    const rootChildren =
      this.rootValue.kind === "object" ? this.rootValue.entries
      : this.rootValue.kind === "array" ? this.rootValue.items
      : null;
    if (rootChildren) {
      for (const node of rootChildren) this.renderNode(node, this.container);
      if (this.editMode) this.renderContainerAppend(this.rootValue, this.container);
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

      if (this.editMode) {
        this.addDeleteBtn(row, node.path);
      }

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
        if (this.editMode) this.renderContainerAppend(node.value, childWrap);
        parent.appendChild(childWrap);
      }
    } else {
      parent.appendChild(this.scalarRow(node.key, node.path, node.value));
    }
  }

  /** Render an "Add" button at the bottom of a container's children. */
  private renderContainerAppend(value: DataValue, parent: HTMLElement): void {
    const addBtn = document.createElement("button");
    addBtn.className = "tree-add-btn";
    addBtn.textContent = value.kind === "object" ? "+ Add key" : "+ Add item";
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const parentPath = parent.closest<HTMLElement>("[data-path]")?.dataset.path ?? "root";

      let key = "";
      if (value.kind === "object") {
        const input = prompt("Key name:");
        if (!input?.trim()) return;
        key = input.trim();
      }

      const typeInput = prompt(`Value type for ${key || "new item"}: (t)ext / (a)rray / (m)ap`)?.[0]?.toLowerCase() || "t";
      let newValue: DataValue;
      if (typeInput === "a") {
        newValue = { kind: "array", items: [] };
      } else if (typeInput === "m") {
        newValue = { kind: "object", entries: [] };
      } else {
        newValue = { kind: "scalar", type: "string", text: "" };
      }

      if (value.kind === "object") {
        const fullPath = parentPath === "root" ? key : `${parentPath}.${key}`;
        value.entries.push({ key, path: fullPath, value: newValue });
      } else if (value.kind === "array") {
        const idx = value.items.length;
        const fullPath = `${parentPath}[${idx}]`;
        value.items.push({ key: String(idx), path: fullPath, value: newValue });
      }
      this.fireEdit();
      this.refresh();
    });
    parent.appendChild(addBtn);
  }

  /** Add a delete button to a container row. */
  private addDeleteBtn(row: HTMLElement, path: string): void {
    const del = document.createElement("button");
    del.className = "tree-del-btn";
    del.textContent = "×";
    del.title = "Delete";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      this.deleteNode(path);
    });
    row.appendChild(del);
  }

  /** Delete a node from the tree by its path. Rebuilds view. */
  private deleteNode(path: string): void {
    if (path === "root") return;
    const parentPath = ancestorPaths(path).slice(-2)[0] ?? "";
    const key = path.split(".").pop() ?? path.split("[").pop() ?? "";
    const parent = findNode(this.rootValue, parentPath);
    if (!parent) return;
    const pv = parent.value;

    if (pv.kind === "array") {
      const idx = parseInt(key.replace(/\]$/, ""), 10);
      if (!isNaN(idx)) pv.items.splice(idx, 1);
      pv.items.forEach((item, i) => {
        item.key = String(i);
        item.path = parentPath ? `${parentPath}[${i}]` : `[${i}]`;
      });
    } else if (pv.kind === "object") {
      const cleanKey = key.replace(/^\./, "");
      const idx = pv.entries.findIndex((e) => e.key === cleanKey);
      if (idx >= 0) pv.entries.splice(idx, 1);
    }
    this.fireEdit();
    this.refresh();
  }

  /** Notify the parent that the data model changed. */
  private fireEdit(): void {
    this.onEdit?.(this.rootValue);
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
    const scalar = value as { kind: "scalar"; type: DataScalarType; text: string };
    valEl.className = `tree-value type-${scalar.type}`;
    valEl.textContent = scalar.type === "string" ? `"${scalar.text}"` : scalar.text;
    row.appendChild(valEl);

    if (this.editMode) {
      // Allow inline editing on click
      row.style.cursor = "pointer";
      row.addEventListener("click", (e) => {
        // Only trigger on the value area, not the delete btn
        if ((e.target as HTMLElement).closest(".tree-del-btn")) return;
        this.startInlineEdit(row, path, scalar);
      });
    }

    return row;
  }

  /** Replace the value display with an input for inline editing. */
  private startInlineEdit(row: HTMLElement, path: string, scalar: { kind: "scalar"; type: DataScalarType; text: string }): void {
    if (row.classList.contains("tree-editing")) return;
    row.classList.add("tree-editing");

    const valEl = row.querySelector(".tree-value") as HTMLElement | null;
    if (!valEl) return;

    const input = document.createElement("input");
    input.className = "tree-edit-input";
    input.type = scalar.type === "number" ? "number" : "text";
    input.value = scalar.text;
    input.style.width = `${Math.max(60, scalar.text.length * 8 + 16)}px`;

    valEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const newText = input.value;
      const node = findNodeByPath(this.rootValue, path);
      if (node && node.value.kind === "scalar") {
        if (newText !== node.value.text) {
          node.value.text = newText;
          if (node.value.type === "number") node.value.type = newText.trim() === "" || isNaN(Number(newText)) ? "string" : "number";
          else if (node.value.type === "boolean") node.value.type = (newText === "true" || newText === "false") ? "boolean" : "string";
          this.fireEdit();
        }
      }
      row.classList.remove("tree-editing");
      this.refresh();
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { input.blur(); }
      if (e.key === "Escape") { row.classList.remove("tree-editing"); this.refresh(); }
    });
  }

  // ─── virtual mode ─────────────────────────────────────────────────────────────

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
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.renderVisible();
    });
  }

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

  private renderVisible(): void {
    if (!this.scroller) return;
    if (!this.container.isConnected) { this.destroy(); return; }
    const viewportH = this.scroller.clientHeight || 600;
    const eff = Math.max(0, this.scroller.getBoundingClientRect().top - this.container.getBoundingClientRect().top);
    const r = visibleRange({ scrollTop: eff, viewportH, rowH: this.rowH, lineCount: this.vis.length, overscan: OVERSCAN });
    this.paintWindow(r.start, r.count);
  }

  private renderAround(idx: number): void {
    const viewportH = this.scroller?.clientHeight || 600;
    const span = Math.ceil(viewportH / this.rowH) + 2 * OVERSCAN;
    const start = Math.max(0, idx - OVERSCAN);
    this.paintWindow(start, Math.min(span, this.vis.length - start));
  }

  private paintWindow(start: number, count: number): void {
    const win = this.win;
    if (!win) return;
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
    if (this.currentPath) {
      win.querySelector<HTMLElement>(`[data-path="${cssEscape(this.currentPath)}"]`)?.classList.add("search-current");
    }
  }

  private fillRow(row: HTMLElement, v: VisRow): void {
    row.textContent = "";
    row.removeAttribute("style");
    row.dataset.path = v.path;
    row.style.paddingLeft = `${v.depth * INDENT + BASE_PAD}px`;
    if (v.container) {
      row.className = "tree-row tree-branch";

      if (this.editMode) {
        this.addDeleteBtn(row, v.path);
      }

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
      const scalar = v.value as { kind: "scalar"; type: DataScalarType; text: string };
      valEl.className = `tree-value type-${scalar.type}`;
      valEl.textContent = scalar.type === "string" ? `"${scalar.text}"` : scalar.text;
      row.appendChild(valEl);

      if (this.editMode) {
        row.style.cursor = "pointer";
        row.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".tree-del-btn")) return;
          this.startInlineEdit(row, v.path, scalar);
        });
      }
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
  const out: string[] = [];
  let cur = "";
  for (const tok of path.split(/(?=[.[])/)) { cur += tok; out.push(cur.replace(/^\./, "")); }
  return out.filter(Boolean);
}

function cssEscape(s: string): string {
  if (typeof window !== "undefined" && window.CSS && CSS.escape) return CSS.escape(s);
  return s.replace(/["\\]/g, "\\$&").replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

function findScroller(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === "auto" || oy === "scroll") return cur;
    cur = cur.parentElement;
  }
  return el;
}

/** Find a node by path string within a DataValue tree. */
function findNode(root: DataValue, path: string): DataNode | null {
  if (!path || path === "root") return null;
  const parts = path.split(/(?=[.[])/);
  let current: DataValue = root;
  for (const part of parts) {
    const key = part.replace(/^\./, "").replace(/\[(\d+)\]$/, "$1");
    if (current.kind === "object") {
      const found = current.entries.find((c) => c.key === key);
      if (!found) return null;
      current = found.value;
    } else if (current.kind === "array") {
      const idx = parseInt(key, 10);
      const found = current.items[idx];
      if (!found) return null;
      current = found.value;
    } else {
      return null;
    }
  }
  const lastKey = parts[parts.length - 1]?.replace(/^\./, "").replace(/\[(\d+)\]$/, "$1") ?? "";
  return { key: lastKey, path, value: current };
}

/** Find a DataNode by its path, returning the parent container node. */
function findNodeByPath(root: DataValue, path: string): DataNode | null {
  return findNode(root, path);
}

export function renderTree(
  root: DataValue,
  container: HTMLElement,
  opts?: { defaultDepth?: number; expandCap?: number; virtualizeThreshold?: number; editable?: boolean; onEdit?: (value: DataValue) => void }
): TreeView {
  return new TreeView(root, container, opts);
}
