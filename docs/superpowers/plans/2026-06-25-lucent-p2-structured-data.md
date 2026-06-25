# Lucent P2 — Structured-Data Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** View JSON / YAML / TOML / INI as a unified, colorized, collapsible tree
(rendered mode), with raw mode showing syntax-highlighted source — both fully
searchable, including matches inside collapsed branches.

**Architecture:** A format-agnostic parser turns all four formats into one
`DataValue` model. A `TreeView` renders only expanded nodes into the DOM and
exposes expand/collapse + path navigation. A `data` renderer (registered in P1's
registry) drives rendered mode; raw mode of a `data` file shows highlight.js
source. A `TreeSearchProvider` (implementing P1's `SearchProvider`) searches the
parsed model so collapsed matches are found, and reveals a match by expanding its
ancestors. Provider selection moves into `main.ts`'s `rebindSearch()`.

**Tech Stack:** TypeScript + Vite, Vitest (jsdom), highlight.js (already present).
New deps: `js-yaml`, `smol-toml`, `ini` (all permissive).

## Global Constraints

- **Read-only viewer.** No editing.
- **New deps allowed in P2, permissive only:** `js-yaml` (MIT), `smol-toml`
  (BSD-3-Clause — permissive, same family as the already-used highlight.js),
  `ini` (ISC), `@types/js-yaml` (dev). No others.
- **Builds on P1 (now in `main`).** Reuse, do not duplicate: `SearchController` /
  `SearchProvider` / `Match` (`src/search/`), the renderer registry
  (`src/renderers/registry.ts`, `getRenderer`), `detectFormat`/`dataLangOf`
  (`src/format.ts`), `Tab.format`/`forcedFormat`, `manager.getActiveFormat()`,
  `manager.getActiveMode()`, `rebindSearch()` in `main.ts`.
- **No `innerHTML` for file-derived strings.** The tree builds DOM via
  `createElement`/`textContent`; only highlight.js output (raw mode) uses the
  existing `pre.hljs` mechanism.
- **`renderTree(value, container)` takes an already-parsed value, not text** — so
  P3's embedded-JSON decoder can reuse it.
- **Search is model-based.** `TreeSearchProvider` finds matches in the parsed
  `DataValue` (all nodes, expanded or not); `reveal` expands ancestors first.
- **`npm run build` is part of every task's verification** (vitest does not
  type-check; P1 had a build-only error slip through).
- **Size cap:** above a node/byte cap, skip the tree and fall back to raw + a
  notice. Streaming is NOT used (that is logs/P3).
- Commit after each task with the message shown in its final step.
- Spec: `docs/superpowers/specs/2026-06-25-lucent-multi-format-design.md`.

## File Structure

```
src/
├─ types.ts                  # + DataScalarType, DataValue, DataNode, DataParseResult
├─ data/
│  ├─ parse.ts               # NEW: parseData(text, lang) -> DataParseResult
│  └─ tree.ts                # NEW: TreeView class + renderTree(value, container, opts)
├─ search/
│  └─ tree-provider.ts       # NEW: TreeSearchProvider implements SearchProvider
├─ renderers/
│  ├─ data.ts                # NEW: data renderer (rendered = tree); registers in registry
│  └─ registry.ts            # MOD: register "data"
├─ tabs.ts                   # MOD: raw mode of data files = highlighted source; expose getActiveRenderer-ish hook for copy-rich
├─ main.ts                   # MOD: rebindSearch picks provider by format/mode; copy-rich via active rendered DOM
└─ styles.css                # MOD: tree styles (rows, toggles, type colors, light/dark)
test/
├─ data-parse.test.ts        # NEW
├─ tree.test.ts              # NEW
└─ tree-provider.test.ts     # NEW
examples/
├─ data-sample.yaml          # NEW (sibling of existing data-sample.json)
├─ data-sample.toml          # NEW
└─ data-sample.ini           # NEW
```

---

## Task 1: Dependencies + data value-model types

**Files:**
- Modify: `package.json` (deps), `src/types.ts`

**Interfaces:**
- Produces: `DataScalarType`, `DataValue`, `DataNode`, `DataParseResult` — consumed by every later task.

- [ ] **Step 1: Install deps**

```bash
npm install js-yaml smol-toml ini
npm install -D @types/js-yaml
```

- [ ] **Step 2: Confirm licenses are permissive**

Run: `npm view js-yaml license; npm view smol-toml license; npm view ini license`
Expected: js-yaml `MIT`, smol-toml `BSD-3-Clause`, ini `ISC` — all permissive and
accepted (BSD-3-Clause matches highlight.js, already shipped). Only STOP if a
copyleft/non-permissive license (e.g. GPL/AGPL) appears.

- [ ] **Step 3: Add the value-model types** — append to `src/types.ts`

```ts
export type DataScalarType = "string" | "number" | "boolean" | "null";

/** A parsed structured value: a scalar leaf, or an object/array of child nodes. */
export type DataValue =
  | { kind: "scalar"; type: DataScalarType; text: string }
  | { kind: "object"; entries: DataNode[] }
  | { kind: "array"; items: DataNode[] };

/** One keyed child within an object (key = property) or array (key = index). */
export interface DataNode {
  key: string;
  path: string; // unique, e.g. `root`, `root.a`, `root.a[2].b`
  value: DataValue;
}

export interface DataParseResult {
  ok: boolean;
  value?: DataValue;
  error?: { message: string; line?: number };
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles (types only; deps resolve).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add data-tree deps (js-yaml/smol-toml/ini) and value-model types"
```

---

## Task 2: `parseData` (TDD)

**Files:**
- Create: `src/data/parse.ts`, `test/data-parse.test.ts`

**Interfaces:**
- Consumes: `DataValue`, `DataNode`, `DataParseResult`, `DataScalarType`, `DataLang`.
- Produces: `parseData(text: string, lang: DataLang): DataParseResult`.

- [ ] **Step 1: Write the failing test** — `test/data-parse.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseData } from "../src/data/parse";

describe("parseData", () => {
  it("parses JSON into the value model", () => {
    const r = parseData('{"a":1,"b":[true,null,"x"]}', "json");
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      kind: "object",
      entries: [
        { key: "a", path: "root.a", value: { kind: "scalar", type: "number", text: "1" } },
        {
          key: "b",
          path: "root.b",
          value: {
            kind: "array",
            items: [
              { key: "0", path: "root.b[0]", value: { kind: "scalar", type: "boolean", text: "true" } },
              { key: "1", path: "root.b[1]", value: { kind: "scalar", type: "null", text: "null" } },
              { key: "2", path: "root.b[2]", value: { kind: "scalar", type: "string", text: "x" } },
            ],
          },
        },
      ],
    });
  });

  it("parses YAML", () => {
    const r = parseData("a: 1\nb:\n  - x\n  - y", "yaml");
    expect(r.ok).toBe(true);
    expect(r.value?.kind).toBe("object");
  });

  it("parses TOML", () => {
    const r = parseData('title = "hi"\n[owner]\nname = "me"', "toml");
    expect(r.ok).toBe(true);
    expect(r.value?.kind).toBe("object");
  });

  it("parses INI", () => {
    const r = parseData("a=1\n[sec]\nb=2", "ini");
    expect(r.ok).toBe(true);
    expect(r.value?.kind).toBe("object");
  });

  it("returns an error result on invalid JSON (no throw)", () => {
    const r = parseData("{not json", "json");
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` — FAIL (cannot resolve `../src/data/parse`).

- [ ] **Step 3: Implement** — `src/data/parse.ts`

```ts
import { load as loadYaml } from "js-yaml";
import { parse as parseToml } from "smol-toml";
import { parse as parseIni } from "ini";
import type { DataValue, DataNode, DataParseResult, DataScalarType, DataLang } from "../types";

/** Convert an arbitrary parsed JS value into the DataValue model. */
function toValue(v: unknown, path: string): DataValue {
  if (v === null || v === undefined) return { kind: "scalar", type: "null", text: "null" };
  if (Array.isArray(v)) {
    return {
      kind: "array",
      items: v.map((item, i) => childNode(String(i), `${path}[${i}]`, item)),
    };
  }
  if (typeof v === "object") {
    return {
      kind: "object",
      entries: Object.entries(v as Record<string, unknown>).map(([k, val]) =>
        childNode(k, `${path}.${k}`, val)
      ),
    };
  }
  const type: DataScalarType =
    typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
  return { kind: "scalar", type, text: String(v) };
}

function childNode(key: string, path: string, v: unknown): DataNode {
  return { key, path, value: toValue(v, path) };
}

export function parseData(text: string, lang: DataLang): DataParseResult {
  try {
    let parsed: unknown;
    switch (lang) {
      case "json":
        parsed = JSON.parse(text);
        break;
      case "yaml":
        parsed = loadYaml(text); // safe by default (no custom types)
        break;
      case "toml":
        parsed = parseToml(text);
        break;
      case "ini":
        parsed = parseIni(text);
        break;
    }
    return { ok: true, value: toValue(parsed, "root") };
  } catch (e) {
    return { ok: false, error: { message: (e as Error).message } };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` — PASS (5 new). Then `npm run build` — clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: parseData — JSON/YAML/TOML/INI into a unified value model"
```

---

## Task 3: `TreeView` + `renderTree` (TDD)

**Files:**
- Create: `src/data/tree.ts`, `test/tree.test.ts`

**Interfaces:**
- Consumes: `DataValue`, `DataNode`.
- Produces:
  - `renderTree(root: DataValue, container: HTMLElement, opts?: { defaultDepth?: number; expandCap?: number }): TreeView`
  - `class TreeView` with: `expandAll()`, `collapseAll()`, `expandToPath(path: string)`,
    `rowElement(path: string): HTMLElement | null`,
    `nodes(): Array<{ path: string; key: string; value: DataValue }>` (every node in tree order, regardless of expand state).

**Design notes:** The tree renders only expanded containers' children into the DOM
(collapsed children are not in the DOM). Each rendered row carries
`data-path`. `nodes()` walks the *model* (not the DOM) so search sees everything.
`expandToPath` expands every ancestor container of `path` and re-renders as needed.

- [ ] **Step 1: Write the failing test** — `test/tree.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderTree } from "../src/data/tree";
import type { DataValue } from "../src/types";

const sample: DataValue = {
  kind: "object",
  entries: [
    { key: "name", path: "root.name", value: { kind: "scalar", type: "string", text: "lucent" } },
    {
      key: "nested",
      path: "root.nested",
      value: {
        kind: "object",
        entries: [
          { key: "deep", path: "root.nested.deep", value: { kind: "scalar", type: "number", text: "42" } },
        ],
      },
    },
  ],
};

describe("renderTree / TreeView", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => root.remove());

  it("renders top-level rows with data-path", () => {
    renderTree(sample, root, { defaultDepth: 1 });
    expect(root.querySelector('[data-path="root.name"]')).toBeTruthy();
    expect(root.querySelector('[data-path="root.nested"]')).toBeTruthy();
  });

  it("nodes() enumerates every node regardless of expand state", () => {
    const tree = renderTree(sample, root, { defaultDepth: 1 });
    const paths = tree.nodes().map((n) => n.path);
    expect(paths).toContain("root.nested.deep"); // present in model even if collapsed
  });

  it("collapsed children are not in the DOM until expanded", () => {
    const tree = renderTree(sample, root, { defaultDepth: 1 });
    tree.collapseAll();
    expect(root.querySelector('[data-path="root.nested.deep"]')).toBeNull();
    tree.expandToPath("root.nested.deep");
    expect(root.querySelector('[data-path="root.nested.deep"]')).toBeTruthy();
  });

  it("rowElement returns the row for a path once visible", () => {
    const tree = renderTree(sample, root, { defaultDepth: 99 });
    expect(tree.rowElement("root.nested.deep")).toBeTruthy();
  });

  it("renders scalar values with a type class", () => {
    renderTree(sample, root, { defaultDepth: 99 });
    const v = root.querySelector('[data-path="root.name"] .tree-value');
    expect(v?.classList.contains("type-string")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` — FAIL (cannot resolve `../src/data/tree`).

- [ ] **Step 3: Implement** — `src/data/tree.ts`

```ts
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
      const count = node.value.kind === "object" ? node.value.entries.length : node.value.items.length;
      meta.textContent = node.value.kind === "array" ? `[${count}]` : `{${count}}`;

      row.append(toggle, keyEl, meta);
      parent.appendChild(row);

      if (open) {
        const childWrap = document.createElement("div");
        childWrap.className = "tree-children";
        const children = node.value.kind === "object" ? node.value.entries : node.value.items;
        for (const c of children) this.renderNode(c, childWrap);
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
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

export function renderTree(
  root: DataValue,
  container: HTMLElement,
  opts?: { defaultDepth?: number; expandCap?: number }
): TreeView {
  return new TreeView(root, container, opts);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` — PASS (5 new). Then `npm run build` — clean. If `ancestorPaths`
fails the collapsed-expand test, fix the tokenizer until `expandToPath` makes the
target row appear (the test is the oracle).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: TreeView — collapsible structured-data tree (renders only expanded nodes)"
```

---

## Task 4: `data` renderer + registry + raw highlighting + size cap

**Files:**
- Create: `src/renderers/data.ts`
- Modify: `src/renderers/registry.ts`, `src/tabs.ts`, `src/styles.css`

**Interfaces:**
- Consumes: `Renderer`, `RenderCtx`, `parseData`, `renderTree`/`TreeView`, `dataLangOf`.
- Produces: `dataRenderer: Renderer` (format `"data"`); exported
  `getCurrentTree(): TreeView | null` (the last tree rendered, for the search
  provider); registry registers `"data"`.

- [ ] **Step 1: Implement the data renderer** — `src/renderers/data.ts`

```ts
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
```

> **Renderer signature note:** P1's `Renderer.render(source, container, ctx)` has
> no `path`. Add an optional 4th param `path?: string` to the `Renderer` type in
> `src/types.ts` and pass `t.path` from `tabs.ts` `repaint()` so the data renderer
> can pick the language. Markdown/text renderers ignore it (optional param, no
> change needed to their bodies).

- [ ] **Step 2: Thread `path` through the Renderer interface** — `src/types.ts`

Change `render` in the `Renderer` interface to:

```ts
  render(source: string, container: HTMLElement, ctx: RenderCtx, path?: string): void | Promise<void>;
```

- [ ] **Step 3: Pass `path` from `tabs.ts` repaint + highlight raw `data`** — `src/tabs.ts`

In `repaint()`, the rendered branch becomes:

```ts
getRenderer(effectiveFormat(t)).render(t.content, this.content, { theme: this.theme }, t.path);
```

And the raw branch: when the effective format is `data`, render highlighted
source instead of a plain `<pre>`. Add at the top of `tabs.ts`:

```ts
import hljs from "highlight.js";
import { dataLangOf } from "./format";
```

Replace the raw branch of `repaint()` with:

```ts
} else {
  const pre = document.createElement("pre");
  pre.className = "raw";
  const lang = effectiveFormat(t) === "data" ? dataLangOf(t.path) : null;
  if (lang && hljs.getLanguage(lang)) {
    pre.classList.add("hljs");
    pre.innerHTML = hljs.highlight(t.content, { language: lang }).value; // hljs output is escaped/safe
  } else {
    pre.textContent = t.content;
  }
  this.content.replaceChildren(pre);
}
```

> `hljs.highlight(...).value` HTML-escapes the source and only emits its own
> `<span>` markup — safe to assign via `innerHTML` (this is the same trust model
> P1's code-block renderer already uses).

- [ ] **Step 4: Register the data renderer** — `src/renderers/registry.ts`

```ts
import { dataRenderer } from "./data";
// ...
const REGISTRY: Partial<Record<Format, Renderer>> = {
  markdown: markdownRenderer,
  text: textRenderer,
  data: dataRenderer,
};
```

- [ ] **Step 5: Tree styles** — `src/styles.css`

Add: `.tree` (monospace, line-height), `.tree-row` (flex, padding), `.tree-toggle`
(small square button, `+`/`−`), `.tree-key` (color), `.tree-meta` (muted count),
`.tree-value` with per-type colors `.type-string`/`.type-number`/`.type-boolean`/
`.type-null`, `.tree-children` (left indent + guide border), `.tree-toolbar` +
`.tree-action` buttons, `.tree-notice` (warning style). Provide light values and
`#content[data-theme="dark"]` overrides (follow the existing code-block dark
palette). Add a `.tree-row.search-current { background: ... }` highlight and keep
`@media print` neutralizing it.

- [ ] **Step 6: Build + tests + manual check**

Run: `npm run build` (clean) and `npm test` (all green). Then `npm run tauri dev`:
open `examples/data-sample.json` → it now renders as a tree (was raw in P1);
toggle to raw → highlighted JSON; "View as…" a `.txt` of JSON → tree.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: data renderer — JSON/YAML/TOML/INI tree, highlighted raw, size-cap fallback"
```

---

## Task 5: `TreeSearchProvider` (TDD)

**Files:**
- Create: `src/search/tree-provider.ts`, `test/tree-provider.test.ts`

**Interfaces:**
- Consumes: `SearchProvider`, `SearchQuery`, `Match` (P1), `TreeView` (Task 3).
- Produces: `class TreeSearchProvider implements SearchProvider` constructed from a `TreeView`.

**Behavior:** `find` searches every node's key and (scalar) text in the model
(tree order). `reveal(id)` calls `tree.expandToPath(path)`, then highlights and
scrolls the row. `clear` removes highlight classes. Count reflects all matches,
including those in collapsed branches.

- [ ] **Step 1: Write the failing test** — `test/tree-provider.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderTree } from "../src/data/tree";
import { TreeSearchProvider } from "../src/search/tree-provider";
import type { DataValue } from "../src/types";

const data: DataValue = {
  kind: "object",
  entries: [
    { key: "alpha", path: "root.alpha", value: { kind: "scalar", type: "string", text: "find-me" } },
    {
      key: "beta",
      path: "root.beta",
      value: {
        kind: "object",
        entries: [
          { key: "alpha2", path: "root.beta.alpha2", value: { kind: "scalar", type: "string", text: "deep find-me" } },
        ],
      },
    },
  ],
};

describe("TreeSearchProvider", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => root.remove());

  it("finds matches in keys and values across collapsed branches", () => {
    const tree = renderTree(data, root, { defaultDepth: 1 });
    tree.collapseAll();
    const p = new TreeSearchProvider(tree);
    // "alpha" matches key root.alpha AND key root.beta.alpha2 (collapsed)
    expect(p.find({ text: "alpha", caseSensitive: false, regex: false }).length).toBe(2);
    // "find-me" matches both scalar values
    expect(p.find({ text: "find-me", caseSensitive: false, regex: false }).length).toBe(2);
  });

  it("reveal expands ancestors so a collapsed match becomes visible", () => {
    const tree = renderTree(data, root, { defaultDepth: 1 });
    tree.collapseAll();
    const p = new TreeSearchProvider(tree);
    const matches = p.find({ text: "deep", caseSensitive: false, regex: false });
    expect(matches.length).toBe(1);
    p.reveal(matches[0].id);
    expect(root.querySelector('[data-path="root.beta.alpha2"]')?.classList.contains("search-current")).toBe(true);
  });

  it("respects case sensitivity and regex", () => {
    const tree = renderTree(data, root, { defaultDepth: 99 });
    const p = new TreeSearchProvider(tree);
    expect(p.find({ text: "ALPHA", caseSensitive: true, regex: false }).length).toBe(0);
    expect(p.find({ text: "alpha\\d", caseSensitive: false, regex: true }).length).toBe(1); // alpha2
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` FAIL (cannot resolve module).

- [ ] **Step 3: Implement** — `src/search/tree-provider.ts`

```ts
import type { SearchProvider, SearchQuery, Match } from "../types";
import type { TreeView } from "../data/tree";

interface TreeHit { path: string; }

export class TreeSearchProvider implements SearchProvider {
  private hits: TreeHit[] = [];
  constructor(private tree: TreeView) {}

  private matcher(q: SearchQuery): (s: string) => boolean {
    if (q.regex) {
      const re = new RegExp(q.text, q.caseSensitive ? "" : "i");
      return (s) => re.test(s);
    }
    if (q.caseSensitive) return (s) => s.includes(q.text);
    const lc = q.text.toLowerCase();
    return (s) => s.toLowerCase().includes(lc);
  }

  find(q: SearchQuery): Match[] {
    this.clear();
    if (!q.text) return [];
    const test = this.matcher(q);
    this.hits = [];
    for (const n of this.tree.nodes()) {
      const keyHit = test(n.key);
      const valHit = n.value.kind === "scalar" && test(n.value.text);
      if (keyHit || valHit) this.hits.push({ path: n.path });
    }
    return this.hits.map((_, i) => ({ id: i }));
  }

  reveal(id: number): void {
    const hit = this.hits[id];
    if (!hit) return;
    this.clearCurrent();               // drop the previous current marker
    this.tree.expandToPath(hit.path);  // expansion re-renders; row now exists
    const row = this.tree.rowElement(hit.path);
    if (row) {
      row.classList.add("search-current");
      row.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  }

  private clearCurrent(): void {
    for (const h of this.hits) this.tree.rowElement(h.path)?.classList.remove("search-current");
  }

  clear(): void {
    this.clearCurrent();
    this.hits = [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass** — `npm test` PASS (3 new), `npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: TreeSearchProvider — model-based search, reveal expands collapsed matches"
```

---

## Task 6: Provider selection + copy-rich through the active renderer

**Files:**
- Modify: `src/main.ts`, `src/tabs.ts`

**Interfaces:**
- Consumes: `TreeSearchProvider`, `getCurrentTree`, `DomSearchProvider`,
  `manager.getActiveFormat()`, `manager.getActiveMode()`.

- [ ] **Step 1: Select the provider by format + mode** — `src/main.ts`

Replace `rebindSearch()`:

```ts
import { TreeSearchProvider } from "./search/tree-provider";
import { getCurrentTree } from "./renderers/data";

function rebindSearch() {
  if (!searchBar.isOpen()) return;
  const fmt = manager.getActiveFormat();
  const mode = manager.getActiveMode();
  if (mode === "rendered" && fmt === "data") {
    const tree = getCurrentTree();
    search.setProvider(tree ? new TreeSearchProvider(tree) : new DomSearchProvider(content));
  } else {
    search.setProvider(new DomSearchProvider(content));
  }
}
```

- [ ] **Step 2: Copy-rich through the active rendered DOM** — `src/tabs.ts` + `src/main.ts`

P1's `getActiveRenderedHtml()` always runs `renderMarkdown`. Make copy-rich reflect
what is actually on screen. Add to `TabManager`:

```ts
/** The HTML currently displayed for the active doc (renderer-agnostic). */
getActiveDisplayedHtml(): string {
  return this.content.innerHTML;
}
```

In `main.ts`, change copy-rich to use it:

```ts
btn("btn-copy-rich").addEventListener("click", () => copyAsRichText(manager.getActiveDisplayedHtml()));
```

Leave `getActiveRenderedHtml()` (and HTML/PDF export, which still uses
`getActiveRawText()` → markdown pipeline) unchanged; renderer-aware *export* is a
later follow-up noted in the spec.

- [ ] **Step 3: Build + tests + manual check**

Run: `npm run build` (clean) and `npm test` (green). Then `npm run tauri dev`:
open `examples/data-sample.json`, `Cmd/Ctrl+F`, search a key only present in a
collapsed branch → count includes it, next/prev expands+scrolls to it and marks
the row; copy-rich on the tree pastes the tree HTML (not markdown).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: pick search provider by format/mode; copy-rich uses displayed HTML"
```

---

## Task 7: Example files + smoke + suite

**Files:**
- Create: `examples/data-sample.yaml`, `examples/data-sample.toml`, `examples/data-sample.ini`

- [ ] **Step 1: Add representative sample files** for YAML, TOML, INI (nested where
  the format allows), mirroring the existing `examples/data-sample.json`.

- [ ] **Step 2: Smoke checklist** (in `npm run tauri dev`):
  1. Open each of the 4 data files → tree renders, colored by type, collapsible.
  2. Toggle to raw → syntax-highlighted source; search works in raw too.
  3. Expand all / collapse all work; a huge synthetic file (> cap) shows the raw fallback notice.
  4. Search a value inside a collapsed branch → found, reveal expands + scrolls + highlights.
  5. A malformed JSON file → parse-error notice + raw fallback (no crash).
  6. Markdown/text search still works exactly as in P1 (no regression).

- [ ] **Step 3: Full automated suite**

Run: `npm test && (cd src-tauri && cargo test)` — all green. `npm run build` clean.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: P2 data sample files (yaml/toml/ini) and smoke checklist"
```

---

## Task 8: Reach data/log files — CLI args, Open dialog, "View as…", default-to-tree

**Why:** P2 built the data renderer but not the paths to reach it — `lucent x.json`
(CLI) and the Open dialog only surface markdown/text, and data files open in raw
mode. This task makes the feature reachable. (The CLI filter also gates P3 `.log`.)

**Files:**
- Modify: `src-tauri/src/commands.rs` (`is_viewable` + its test), `src-tauri/src/lib.rs` (`collect_startup_files`)
- Modify: `src/types.ts` (`RenderCtx.dataLang`), `src/tabs.ts` (`Tab.forcedLang`; `setActiveForcedFormat` gains optional lang; default-mode logic), `src/renderers/data.ts` (use `ctx.dataLang`)
- Modify: `index.html` (`#sel-viewas` options), `src/main.ts` (Open dialog filters; View-as handler)

- [ ] **Step 1 (Rust, TDD): widen `is_viewable`.** Extend `is_viewable` in
  `commands.rs` to also accept data extensions `json`, `yaml`, `yml`, `toml`,
  `ini` (in addition to the markdown family + `txt`/`log`/`text` it already
  accepts). Update/extend its unit test to assert `.json` and `.yaml` are
  viewable and `.png` is not. Run `cd src-tauri && cargo test`.

- [ ] **Step 2 (Rust): open any viewable file from the CLI.** In `lib.rs`
  `collect_startup_files`, change the filter `commands::is_markdown(p)` →
  `commands::is_viewable(p)` and update the doc comment. `cargo build`.

- [ ] **Step 3 (default data → tree).** In `tabs.ts`, the initial-mode choice
  (in `openOrActivate`, `replaceActive`, and the View-as setter) must open data
  files in **rendered** (tree) mode. Use:
  `mode = (format === "text" || format === "log") ? "raw" : "rendered"`
  (markdown + data → rendered; text/log → raw — log's rendered view lands in P3).

- [ ] **Step 4 (forced data lang for View-as).**
  - `types.ts`: add `dataLang?: DataLang` to `RenderCtx`.
  - `tabs.ts`: add `forcedLang?: DataLang` to `Tab`; `repaint` builds
    `{ theme: this.theme, dataLang: t.forcedLang }` as the ctx; extend
    `setActiveForcedFormat(format: Format, lang?: DataLang)` to also set
    `t.forcedLang = lang` and apply the Step-3 mode rule; clear `forcedLang` in
    `openOrActivate`/`replaceActive` resets.
  - `data.ts`: `const lang = ctx.dataLang ?? (path ? dataLangOf(path) : null);`
    (markdown/text renderers ignore `ctx.dataLang`).

- [ ] **Step 5 (Open dialog).** In `main.ts` `btn-open`, add a filter group
  `{ name: "Data", extensions: ["json", "yaml", "yml", "toml", "ini"] }`
  (keep Markdown + Text; `.log` already sits under Text).

- [ ] **Step 6 (View-as options).** In `index.html` `#sel-viewas`, add after the
  Plain-text option: `JSON`/`YAML`/`TOML`/`INI` with values `data:json`,
  `data:yaml`, `data:toml`, `data:ini`. In `main.ts`'s View-as `change` handler:
  if the value starts with `data:`, call `manager.setActiveForcedFormat("data", <lang>)`;
  else `manager.setActiveForcedFormat(value as Format)`; then reset the select to
  the placeholder. (onChange still drives `rebindSearch`.)

- [ ] **Step 7: verify.** `npm run build` clean, `npm test` green, `cargo test`
  green. Manual: `lucent examples/data-sample.json` opens the **tree**; the Open
  dialog lists data files; "View as… JSON" on a `.txt` containing JSON renders a
  tree; `examples/bad.yaml` shows the parse-error notice + raw.

- [ ] **Step 8: commit**

```bash
git add -A && git commit -m "feat: open data/log via CLI + dialog; View-as data formats; data defaults to tree"
```

---

## Verification (P2 end-to-end)

- **Automated:** `npm test` (data-parse, tree, tree-provider + all P1 suites) and
  `cargo test` pass; `npm run build` clean.
- **Manual:** Task 7 checklist passes; markdown/text behavior unchanged from P1.
- **Seam for P3:** `renderTree(value, container)` takes an already-parsed value, so
  P3's embedded-JSON decoder feeds a decoded log-line value straight in;
  `TreeSearchProvider` + the `rebindSearch` format/mode switch are the only
  integration points P3's `LogSearchProvider` extends.

## Notes for P3 (not in scope now)

- P3 registers `"log"`, adds Rust tailing/indexing + windowed viewport, embedded-
  JSON decode (reusing `renderTree`), and `LogSearchProvider`; `rebindSearch`
  gains a `log` branch.
- Renderer-aware **export** (HTML/PDF of a tree or log, not just markdown) remains
  a deferred follow-up.
- **Per-node copy (value / key-path)** from the spec is intentionally NOT in P2 —
  it adds per-row affordances that complicate the search-highlight DOM. Revisit as
  a small standalone follow-up once the tree + tree-search are settled.
