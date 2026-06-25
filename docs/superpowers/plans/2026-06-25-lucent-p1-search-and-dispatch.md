# Lucent P1 — Format Dispatch + Modes + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-document search (case toggle, regex, next/prev, count, highlight)
to Lucent and introduce the format-dispatch + generalized raw/rendered seam that
P2 (structured data) and P3 (logs) plug into — shipping a working app where the
current Markdown/text viewer is fully searchable.

**Architecture:** A format-agnostic **search controller** drives pluggable
**search providers**; P1 ships the `DomSearchProvider` (operates over the rendered
DOM, used by Markdown rendered view and raw text). A **renderer registry** keyed
by `Format` replaces the hard-coded markdown path in `tabs.ts`; P1 implements the
`markdown` and `text` renderers. Format is detected by extension with a
**"View as…"** override.

**Tech Stack:** TypeScript + Vite, Vitest (jsdom), existing markdown-it pipeline.
No new runtime dependencies in P1.

## Global Constraints

- **Read-only viewer.** No editing.
- **No new heavy deps.** P1 adds no npm/crate dependencies.
- **Behavior-preserving refactor.** After the dispatch refactor, Markdown viewing,
  tabs, watch-reload, export, copy, and themes must behave exactly as before.
- **Search is additive and client-side.** P1 search runs entirely in the frontend
  over the rendered DOM; no Rust changes.
- **Shared types** live in `src/types.ts`; keep names identical to the spec
  (`Format`, `Mode`, `SearchQuery`, `Match`, `SearchProvider`).
- **`Format` enum is defined in full now** (`"markdown" | "data" | "log" | "text"`)
  but P1 only maps/renders `markdown` and `text`; `data`/`log` detection and
  renderers arrive in P2/P3.
- Commit after each task with the message shown in its final step.
- Spec: `docs/superpowers/specs/2026-06-25-lucent-multi-format-design.md`.

## File Structure

```
src/
├─ types.ts                 # + Format, Mode, SearchQuery, Match, SearchProvider, Renderer
├─ format.ts                # NEW: detectFormat(path) -> Format
├─ search/
│  ├─ controller.ts         # NEW: SearchController (query/case/regex/index/nav)
│  ├─ dom-provider.ts       # NEW: DomSearchProvider (DOM text-node matching)
│  └─ bar.ts                # NEW: search bar DOM controller + keybindings
├─ renderers/
│  ├─ registry.ts           # NEW: Renderer registry + types
│  ├─ markdown.ts           # NEW: wraps existing render.ts as a Renderer
│  └─ text.ts               # NEW: plain-text raw renderer
├─ render.ts                # unchanged (markdown.ts delegates to it)
├─ tabs.ts                  # MOD: dispatch via registry; Tab gains format/forcedFormat
├─ main.ts                  # MOD: wire search bar + "View as…"; refresh search on repaint
└─ styles.css               # MOD: search bar + <mark> highlight styles
test/
├─ search-controller.test.ts   # NEW
├─ dom-provider.test.ts        # NEW
└─ format.test.ts              # NEW
index.html                     # MOD: search button + "View as…" select + search bar markup
```

---

## Task 1: Shared search/renderer types

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `Format`, `Mode`, `DataLang`, `SearchQuery`, `Match`, `SearchProvider`,
  `Renderer`, `RenderCtx` — consumed by every later task.

- [ ] **Step 1: Add the types** — append to `src/types.ts`

```ts
export type Format = "markdown" | "data" | "log" | "text";
export type Mode = "rendered" | "raw";
export type DataLang = "json" | "yaml" | "toml" | "ini";

export interface SearchQuery {
  text: string;
  caseSensitive: boolean;
  regex: boolean;
}

/** A single search hit; `id` is its 0-based position in document order. */
export interface Match {
  id: number;
}

export interface SearchProvider {
  /** Recompute all matches for `query`, in document order. Empty text -> []. */
  find(query: SearchQuery): Match[];
  /** Reveal + emphasize match `id`; de-emphasize all others. */
  reveal(id: number): void;
  /** Remove all highlight decorations. */
  clear(): void;
}

export interface RenderCtx {
  theme: Theme;
}

export interface Renderer {
  format: Format;
  /** Render `source` into `container` (rendered mode). */
  render(source: string, container: HTMLElement, ctx: RenderCtx): void | Promise<void>;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: compiles (types only; no usages yet).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add search + renderer shared types"
```

---

## Task 2: `format.ts` extension detection (TDD)

**Files:**
- Create: `src/format.ts`
- Create: `test/format.test.ts`

**Interfaces:**
- Consumes: `Format` (Task 1).
- Produces: `detectFormat(path: string): Format`, `dataLangOf(path: string): DataLang | null`.

- [ ] **Step 1: Write the failing test** — create `test/format.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { detectFormat, dataLangOf } from "../src/format";

describe("detectFormat", () => {
  it("maps markdown extensions", () => {
    expect(detectFormat("/a/b.md")).toBe("markdown");
    expect(detectFormat("README.MARKDOWN")).toBe("markdown");
  });
  it("maps data extensions (reserved for P2)", () => {
    for (const p of ["x.json", "x.yaml", "x.yml", "x.toml", "x.ini"]) {
      expect(detectFormat(p)).toBe("data");
    }
  });
  it("maps .log to log (reserved for P3)", () => {
    expect(detectFormat("app.log")).toBe("log");
  });
  it("falls back to text", () => {
    expect(detectFormat("notes.txt")).toBe("text");
    expect(detectFormat("Makefile")).toBe("text");
  });
  it("reports data language", () => {
    expect(dataLangOf("x.yml")).toBe("yaml");
    expect(dataLangOf("x.json")).toBe("json");
    expect(dataLangOf("x.md")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/format`.

- [ ] **Step 3: Implement** — create `src/format.ts`

```ts
import type { Format, DataLang } from "./types";

function ext(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

const MARKDOWN = new Set(["md", "markdown", "mdown", "mkd"]);
const DATA: Record<string, DataLang> = {
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini",
};

export function detectFormat(path: string): Format {
  const e = ext(path);
  if (MARKDOWN.has(e)) return "markdown";
  if (e in DATA) return "data";
  if (e === "log") return "log";
  return "text";
}

export function dataLangOf(path: string): DataLang | null {
  return DATA[ext(path)] ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests in `format.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: extension-based format detection"
```

---

## Task 3: `SearchController` (TDD)

**Files:**
- Create: `src/search/controller.ts`
- Create: `test/search-controller.test.ts`

**Interfaces:**
- Consumes: `SearchQuery`, `Match`, `SearchProvider` (Task 1).
- Produces: `class SearchController` with `setProvider`, `setQuery`, `next`,
  `prev`, `count`, `currentIndex`, `error`, and an `onState` callback.

- [ ] **Step 1: Write the failing test** — create `test/search-controller.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { SearchController } from "../src/search/controller";
import type { SearchProvider, SearchQuery, Match } from "../src/types";

/** Fake provider: matches are the indexes of a fixed token list that satisfy the query. */
function fakeProvider(tokens: string[]): SearchProvider & { revealed: number[] } {
  const revealed: number[] = [];
  return {
    revealed,
    find(q: SearchQuery): Match[] {
      if (!q.text) return [];
      const re = q.regex
        ? new RegExp(q.text, q.caseSensitive ? "" : "i")
        : null;
      return tokens
        .map((t, i) => ({ t, i }))
        .filter(({ t }) =>
          re
            ? re.test(t)
            : q.caseSensitive
            ? t.includes(q.text)
            : t.toLowerCase().includes(q.text.toLowerCase())
        )
        .map(({ i }) => ({ id: i }));
    },
    reveal(id: number) { revealed.push(id); },
    clear() {},
  };
}

describe("SearchController", () => {
  it("counts matches and reveals the first", () => {
    const p = fakeProvider(["Apple", "banana", "apricot"]);
    const c = new SearchController();
    c.setProvider(p);
    c.setQuery({ text: "ap", caseSensitive: false, regex: false });
    expect(c.count()).toBe(2);          // Apple, apricot
    expect(c.currentIndex()).toBe(0);
    expect(p.revealed.at(-1)).toBe(0);  // first match id
  });

  it("respects case sensitivity", () => {
    const p = fakeProvider(["Apple", "apricot"]);
    const c = new SearchController();
    c.setProvider(p);
    c.setQuery({ text: "Ap", caseSensitive: true, regex: false });
    expect(c.count()).toBe(1);          // only "Apple"
  });

  it("next/prev wrap around", () => {
    const p = fakeProvider(["a1", "a2", "a3"]);
    const c = new SearchController();
    c.setProvider(p);
    c.setQuery({ text: "a", caseSensitive: false, regex: false });
    c.next(); expect(c.currentIndex()).toBe(1);
    c.next(); expect(c.currentIndex()).toBe(2);
    c.next(); expect(c.currentIndex()).toBe(0); // wrap
    c.prev(); expect(c.currentIndex()).toBe(2); // wrap back
  });

  it("invalid regex yields zero matches and sets error", () => {
    const p = fakeProvider(["x"]);
    const c = new SearchController();
    c.setProvider(p);
    c.setQuery({ text: "(", caseSensitive: false, regex: true });
    expect(c.count()).toBe(0);
    expect(c.error()).toBeTruthy();
  });

  it("notifies on state change", () => {
    const p = fakeProvider(["a", "b"]);
    const c = new SearchController();
    const onState = vi.fn();
    c.onState(onState);
    c.setProvider(p);
    c.setQuery({ text: "a", caseSensitive: false, regex: false });
    expect(onState).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/search/controller`.

- [ ] **Step 3: Implement** — create `src/search/controller.ts`

```ts
import type { SearchProvider, SearchQuery, Match } from "../types";

/**
 * Format-agnostic search state machine. Owns the query, the ordered match list,
 * the current index, and navigation; delegates actual matching/highlighting to
 * a SearchProvider. Validates regex queries up-front so an invalid pattern is a
 * clean "0 matches + error", never a throw.
 */
export class SearchController {
  private provider: SearchProvider | null = null;
  private query: SearchQuery = { text: "", caseSensitive: false, regex: false };
  private matches: Match[] = [];
  private index = -1;
  private err: string | null = null;
  private listeners: Array<() => void> = [];

  onState(fn: () => void): void { this.listeners.push(fn); }
  private emit(): void { for (const fn of this.listeners) fn(); }

  setProvider(p: SearchProvider | null): void {
    this.provider?.clear();
    this.provider = p;
    this.run();
  }

  /** Re-run against the current query (e.g. after the view re-rendered). */
  refresh(): void { this.run(); }

  setQuery(q: SearchQuery): void {
    this.query = q;
    this.run();
  }

  private run(): void {
    this.err = null;
    this.provider?.clear();
    if (!this.provider || !this.query.text) {
      this.matches = [];
      this.index = -1;
      this.emit();
      return;
    }
    if (this.query.regex) {
      try {
        new RegExp(this.query.text);
      } catch (e) {
        this.err = (e as Error).message;
        this.matches = [];
        this.index = -1;
        this.emit();
        return;
      }
    }
    this.matches = this.provider.find(this.query);
    this.index = this.matches.length ? 0 : -1;
    if (this.index >= 0) this.provider.reveal(this.matches[this.index].id);
    this.emit();
  }

  private step(delta: number): void {
    if (!this.provider || this.matches.length === 0) return;
    this.index = (this.index + delta + this.matches.length) % this.matches.length;
    this.provider.reveal(this.matches[this.index].id);
    this.emit();
  }
  next(): void { this.step(1); }
  prev(): void { this.step(-1); }

  close(): void {
    this.provider?.clear();
    this.matches = [];
    this.index = -1;
    this.emit();
  }

  count(): number { return this.matches.length; }
  currentIndex(): number { return this.index; }
  error(): string | null { return this.err; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests in `search-controller.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: format-agnostic SearchController with regex validation"
```

---

## Task 4: `DomSearchProvider` (TDD)

**Files:**
- Create: `src/search/dom-provider.ts`
- Create: `test/dom-provider.test.ts`

**Interfaces:**
- Consumes: `SearchProvider`, `SearchQuery`, `Match` (Task 1).
- Produces: `class DomSearchProvider implements SearchProvider` constructed from a
  root `HTMLElement`. Wraps matches in `<mark class="search-hit">`, marks the
  current one with `search-current`, scrolls it into view on `reveal`.

**Notes:** P1 matches within a single text node (matches spanning element
boundaries are out of scope; rare in rendered prose). `clear()` unwraps all marks.

- [ ] **Step 1: Write the failing test** — create `test/dom-provider.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { DomSearchProvider } from "../src/search/dom-provider";

describe("DomSearchProvider", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
    root.innerHTML = `<p>Foo bar foo</p><pre>FOO\nbaz</pre>`;
    document.body.appendChild(root);
  });

  it("finds case-insensitive matches in document order", () => {
    const p = new DomSearchProvider(root);
    const matches = p.find({ text: "foo", caseSensitive: false, regex: false });
    expect(matches.length).toBe(3); // Foo, foo, FOO
    expect(root.querySelectorAll("mark.search-hit").length).toBe(3);
  });

  it("respects case sensitivity", () => {
    const p = new DomSearchProvider(root);
    expect(p.find({ text: "FOO", caseSensitive: true, regex: false }).length).toBe(1);
  });

  it("supports regex", () => {
    const p = new DomSearchProvider(root);
    expect(p.find({ text: "ba[rz]", caseSensitive: false, regex: true }).length).toBe(2);
  });

  it("reveal marks the current hit and clear removes all marks", () => {
    const p = new DomSearchProvider(root);
    p.find({ text: "foo", caseSensitive: false, regex: false });
    p.reveal(1);
    expect(root.querySelectorAll("mark.search-current").length).toBe(1);
    p.clear();
    expect(root.querySelectorAll("mark").length).toBe(0);
    expect(root.textContent).toBe("Foo bar fooFOO\nbaz");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/search/dom-provider`.

- [ ] **Step 3: Implement** — create `src/search/dom-provider.ts`

```ts
import type { SearchProvider, SearchQuery, Match } from "../types";

interface Hit { mark: HTMLElement; }

/**
 * Searches the visible text of a DOM subtree. Each hit is wrapped in
 * <mark class="search-hit">; the current hit also gets "search-current".
 * Matching is per text node (a hit never spans element boundaries).
 */
export class DomSearchProvider implements SearchProvider {
  private hits: Hit[] = [];
  constructor(private root: HTMLElement) {}

  private buildRegExp(q: SearchQuery): RegExp {
    const flags = q.caseSensitive ? "g" : "gi";
    const body = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(body, flags);
  }

  find(q: SearchQuery): Match[] {
    this.clear();
    if (!q.text) return [];
    const re = this.buildRegExp(q);

    // Collect text nodes first (live mutation while walking is unsafe).
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest("mark.search-hit")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const textNodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);

    for (const node of textNodes) {
      const text = node.nodeValue ?? "";
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      const ranges: Array<[number, number]> = [];
      while ((m = re.exec(text)) !== null) {
        if (m[0] === "") { re.lastIndex++; continue; } // zero-width guard
        ranges.push([m.index, m.index + m[0].length]);
      }
      if (!ranges.length) continue;
      // Split the node, wrapping each matched range in a <mark>.
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const [s, e] of ranges) {
        if (s > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, s)));
        const mark = document.createElement("mark");
        mark.className = "search-hit";
        mark.textContent = text.slice(s, e);
        frag.appendChild(mark);
        this.hits.push({ mark });
        cursor = e;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      node.parentNode?.replaceChild(frag, node);
    }
    return this.hits.map((_, i) => ({ id: i }));
  }

  reveal(id: number): void {
    this.hits.forEach((h, i) => h.mark.classList.toggle("search-current", i === id));
    this.hits[id]?.mark.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  clear(): void {
    for (const { mark } of this.hits) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize(); // merge adjacent text nodes back together
    }
    this.hits = [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 4 tests in `dom-provider.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: DomSearchProvider with per-text-node match wrapping"
```

---

## Task 5: Renderer registry + markdown/text renderers (behavior-preserving refactor)

**Files:**
- Create: `src/renderers/registry.ts`
- Create: `src/renderers/markdown.ts`
- Create: `src/renderers/text.ts`
- Modify: `src/tabs.ts`

**Interfaces:**
- Consumes: `Renderer`, `RenderCtx`, `Format` (Task 1); `detectFormat` (Task 2);
  `renderMarkdown`, `runPostRender` (`src/render.ts`).
- Produces: `getRenderer(format: Format): Renderer`; `Tab` gains `format` and
  `forcedFormat?`. `TabManager` resolves the effective format and dispatches.

- [ ] **Step 1: Markdown renderer** — create `src/renderers/markdown.ts`

```ts
import { renderMarkdown, runPostRender } from "../render";
import type { Renderer, RenderCtx } from "../types";

export const markdownRenderer: Renderer = {
  format: "markdown",
  render(source: string, container: HTMLElement, ctx: RenderCtx) {
    container.innerHTML = `<article class="doc">${renderMarkdown(source)}</article>`;
    void runPostRender(container, ctx.theme);
  },
};
```

- [ ] **Step 2: Text renderer** — create `src/renderers/text.ts`

```ts
import type { Renderer } from "../types";

/** Plain text: a single <pre> with the raw source (also used as the raw view). */
export const textRenderer: Renderer = {
  format: "text",
  render(source: string, container: HTMLElement) {
    const pre = document.createElement("pre");
    pre.className = "raw";
    pre.textContent = source;
    container.replaceChildren(pre);
  },
};
```

- [ ] **Step 3: Registry** — create `src/renderers/registry.ts`

```ts
import type { Format, Renderer } from "../types";
import { markdownRenderer } from "./markdown";
import { textRenderer } from "./text";

// P2 registers "data"; P3 registers "log". Until then they fall back to text.
const REGISTRY: Partial<Record<Format, Renderer>> = {
  markdown: markdownRenderer,
  text: textRenderer,
};

export function getRenderer(format: Format): Renderer {
  return REGISTRY[format] ?? textRenderer;
}
```

- [ ] **Step 4: Refactor `tabs.ts` to dispatch** — modify `src/tabs.ts`

Replace the `isMarkdownPath` import/usage and the body of `repaint` so rendering
goes through the registry. Concretely:

1. Update imports at the top (keep `renderMarkdown` — `getActiveRenderedHtml` still
   uses it for copy-as-rich; drop `runPostRender`, the markdown renderer owns it now):

```ts
import { renderMarkdown } from "./render";
import { detectFormat } from "./format";
import { getRenderer } from "./renderers/registry";
import { StyleSettings, Theme, Format } from "./types";
```

2. Extend the `Tab` interface:

```ts
export interface Tab {
  path: string;
  title: string;
  content: string;
  format: Format;          // detected format
  forcedFormat?: Format;   // "View as…" override
  mode: "rendered" | "raw";
  scrollTop: number;
}
```

3. Add an effective-format helper and replace `isMarkdownPath` usage in
   `openOrActivate` (initial mode: markdown renders, everything else opens raw):

```ts
/** The format actually used to render this tab (override beats detection). */
function effectiveFormat(t: Tab): Format {
  return t.forcedFormat ?? t.format;
}
```

In `openOrActivate`, build the new tab as:

```ts
const format = detectFormat(path);
this.tabs.push({
  path,
  title: basename(path),
  content,
  format,
  mode: format === "markdown" ? "rendered" : "raw",
  scrollTop: 0,
});
```

4. Replace `repaint`'s body with registry dispatch:

```ts
private repaint(restoreScroll: boolean): void {
  const t = this.active();
  if (!t) { this.content.replaceChildren(); return; }
  if (t.mode === "rendered") {
    getRenderer(effectiveFormat(t)).render(t.content, this.content, { theme: this.theme });
  } else {
    const pre = document.createElement("pre");
    pre.className = "raw";
    pre.textContent = t.content;
    this.content.replaceChildren(pre);
  }
  if (restoreScroll) this.content.scrollTop = t.scrollTop;
}
```

5. Add a method to set the forced format (used by "View as…") and a getter for the
   effective format:

```ts
getActiveFormat(): Format | undefined {
  const t = this.active();
  return t ? effectiveFormat(t) : undefined;
}

setActiveForcedFormat(format: Format): void {
  const t = this.active();
  if (!t) return;
  t.forcedFormat = format;
  t.mode = format === "markdown" ? "rendered" : "raw";
  this.repaint(false);
  this.hooks.onChange();
}
```

6. In `replaceActive`, also set `t.format = detectFormat(path)` and clear
   `t.forcedFormat`, and pick `t.mode` the same way as `openOrActivate`.

7. Remove the now-unused `isMarkdownPath` export if nothing else uses it
   (check `main.ts`/tests first; if referenced, keep it).

- [ ] **Step 5: Run the existing suite (regression)**

Run: `npm test`
Expected: PASS — all existing tests (tabs/render/settings/clipboard) plus the new
ones. Fix any `tabs.test.ts` expectations that referenced the old `Tab` shape by
adding `format` where a literal `Tab` is constructed.

- [ ] **Step 6: Build + manual smoke**

Run: `npm run build` then `npm run tauri dev`
Expected: Markdown still renders identically; opening a `.txt` shows raw text;
toggle, tabs, watch-reload, export, copy, themes all unchanged.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: dispatch rendering via format-keyed renderer registry"
```

---

## Task 6: Search bar UI + keybindings

**Files:**
- Modify: `index.html`
- Create: `src/search/bar.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `SearchController` (Task 3).
- Produces: `class SearchBar` — `open()`, `close()`, `toggle()`, and renders the
  controls; it owns the DOM input events and calls into a `SearchController`.

- [ ] **Step 1: Add markup** — modify `index.html`

Add a search button to the toolbar's first group (after the toggle button):

```html
<button id="btn-search" title="Find (Cmd/Ctrl+F)" aria-label="Find">🔍 Find</button>
```

Add a "View as…" select to the style group:

```html
<select id="sel-viewas" title="View as">
  <option value="">View as…</option>
  <option value="markdown">Markdown</option>
  <option value="text">Plain text</option>
</select>
```

Add the search bar markup just inside `#content`'s parent (before `<main id="content">`):

```html
<div id="searchbar" hidden role="search">
  <input id="search-input" type="text" placeholder="Find" aria-label="Find" />
  <button id="search-case" class="toggle" title="Match case" aria-pressed="false">Aa</button>
  <button id="search-regex" class="toggle" title="Regular expression" aria-pressed="false">.*</button>
  <span id="search-count" class="count">0/0</span>
  <button id="search-prev" title="Previous (Shift+Enter)" aria-label="Previous">▲</button>
  <button id="search-next" title="Next (Enter)" aria-label="Next">▼</button>
  <button id="search-close" title="Close (Esc)" aria-label="Close">✕</button>
</div>
```

- [ ] **Step 2: Implement the bar controller** — create `src/search/bar.ts`

```ts
import { SearchController } from "./controller";
import type { SearchQuery } from "../types";

export class SearchBar {
  private el: HTMLElement;
  private input: HTMLInputElement;
  private caseBtn: HTMLButtonElement;
  private regexBtn: HTMLButtonElement;
  private count: HTMLElement;

  constructor(private controller: SearchController) {
    this.el = document.getElementById("searchbar")!;
    this.input = document.getElementById("search-input") as HTMLInputElement;
    this.caseBtn = document.getElementById("search-case") as HTMLButtonElement;
    this.regexBtn = document.getElementById("search-regex") as HTMLButtonElement;
    this.count = document.getElementById("search-count")!;

    const run = () => this.controller.setQuery(this.query());
    this.input.addEventListener("input", run);
    this.caseBtn.addEventListener("click", () => { this.toggleBtn(this.caseBtn); run(); });
    this.regexBtn.addEventListener("click", () => { this.toggleBtn(this.regexBtn); run(); });
    document.getElementById("search-next")!.addEventListener("click", () => this.controller.next());
    document.getElementById("search-prev")!.addEventListener("click", () => this.controller.prev());
    document.getElementById("search-close")!.addEventListener("click", () => this.close());

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? this.controller.prev() : this.controller.next(); }
      else if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });

    this.controller.onState(() => this.renderState());
  }

  private toggleBtn(b: HTMLButtonElement) {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("toggled", on);
  }

  private query(): SearchQuery {
    return {
      text: this.input.value,
      caseSensitive: this.caseBtn.getAttribute("aria-pressed") === "true",
      regex: this.regexBtn.getAttribute("aria-pressed") === "true",
    };
  }

  private renderState() {
    const n = this.controller.count();
    const i = this.controller.currentIndex();
    this.count.textContent = this.controller.error() ? "err" : `${n ? i + 1 : 0}/${n}`;
    this.input.classList.toggle("error", !!this.controller.error());
  }

  open() {
    this.el.hidden = false;
    this.input.focus();
    this.input.select();
    if (this.input.value) this.controller.setQuery(this.query());
  }
  close() {
    this.el.hidden = true;
    this.controller.close();
  }
  toggle() { this.el.hidden ? this.open() : this.close(); }
  isOpen() { return !this.el.hidden; }
}
```

- [ ] **Step 3: Style the bar + highlights** — add to `src/styles.css`

Add: a fixed/absolute `#searchbar` pinned to the top-right of the content area
(flex row, small gap, themed background, subtle shadow); `.toggle.toggled`
reuses the existing toggled-button look; `#search-input.error { outline: 1px solid
red }`; `#search-count { font-variant-numeric: tabular-nums }`. Highlight styles:

```css
mark.search-hit { background: #fde68a; color: inherit; border-radius: 2px; }
mark.search-current { background: #f59e0b; }
#content[data-theme="dark"] mark.search-hit { background: #7c5b16; color: #fff; }
#content[data-theme="dark"] mark.search-current { background: #b8860b; }
@media print { #searchbar { display: none !important; } mark.search-hit, mark.search-current { background: transparent; } }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: search bar UI, keybindings, and highlight styles"
```

---

## Task 7: Wire search + "View as…" into `main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `SearchController`, `DomSearchProvider`, `SearchBar`, the `TabManager`
  dispatch additions (Task 5), `Format`.

- [ ] **Step 1: Construct the controller, provider binding, and bar** — in `main.ts`

After the `manager` is created, add:

```ts
import { SearchController } from "./search/controller";
import { DomSearchProvider } from "./search/dom-provider";
import { SearchBar } from "./search/bar";

const search = new SearchController();
const searchBar = new SearchBar(search);

/** Re-bind the search provider to the freshly-rendered content. */
function rebindSearch() {
  if (!searchBar.isOpen()) return;
  search.setProvider(new DomSearchProvider(content));
}
```

- [ ] **Step 2: Open/close wiring + global key** — in `main.ts`

```ts
btn("btn-search").addEventListener("click", () => {
  if (manager.count() === 0) return;
  searchBar.toggle();
  rebindSearch();
});

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    if (manager.count() === 0) return;
    searchBar.open();
    rebindSearch();
  }
});
```

Add `"btn-search"` to the toolbar id list in `refreshToolbar()` so it disables
when no document is open.

- [ ] **Step 3: Re-bind on content changes** — in `main.ts`

The view re-renders on tab activate, mode toggle, "View as…", "next file", and
disk reload. Ensure `rebindSearch()` runs after each. The simplest hook: call it
inside the manager's `onChange` callback and after `updateContent`. Update the
`TabManager` hooks object:

```ts
const manager = new TabManager(tabbar, content, settings, {
  onChange: () => { refreshToolbar(); rebindSearch(); },
  onTabClosed: (path) => void invoke("unwatch_file", { path }),
  onCloseAll: () => void invoke("unwatch_all"),
});
```

And in the `file-changed` listener, after `manager.updateContent(...)`, call
`rebindSearch()`.

- [ ] **Step 4: "View as…" wiring** — in `main.ts`

```ts
const selViewAs = document.getElementById("sel-viewas") as HTMLSelectElement;
selViewAs.addEventListener("change", () => {
  const v = selViewAs.value as Format | "";
  if (v) manager.setActiveForcedFormat(v);
  selViewAs.value = ""; // reset to the placeholder label
});
```

- [ ] **Step 5: Build + manual smoke**

Run: `npm run build` then `npm run tauri dev`
Expected:
- `Cmd/Ctrl+F` (and the Find button) opens the bar; typing highlights all matches
  and shows `1/N`; Enter/Shift+Enter cycle and scroll; `Aa` and `.*` change
  results live; invalid regex shows `err`; Esc closes and clears highlights.
- Search works in Markdown rendered view and in raw text (toggle / a `.txt`).
- "View as…" → Plain text shows a `.md` as raw source; → Markdown renders a
  `.txt` as markdown; search still works after switching.
- Re-running search after a disk reload re-highlights against new content.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: wire search controller/provider/bar and View-as into app"
```

---

## Task 8: Examples + smoke checklist

**Files:**
- Create: `examples/data-sample.json` (small nested JSON, for "View as…" + search demo)
- Create: `examples/sample.log` (a few lines incl. INFO/WARN/ERROR + a line with embedded JSON)

**Deliverable:** P1 features verified end-to-end; sample files ready for P2/P3.

- [ ] **Step 1: Add the sample files** with representative content (the JSON/log are
  not specially rendered yet in P1 — they open as raw text + search — but seed the
  later phases and let you exercise "View as…").

- [ ] **Step 2: Work the smoke checklist:**
  1. Open `examples/99-kitchen-sink.md`; `Cmd/Ctrl+F`; search "diagram" → count + highlights + cycle.
  2. Case toggle: search "RENDER" with `Aa` on vs off → counts differ.
  3. Regex: `\bcode\b` matches whole word; `(` shows `err`.
  4. Toggle to raw → search still works on the source `<pre>`.
  5. Open `examples/data-sample.json` → opens raw; "View as…" has no effect needed; search works.
  6. Open a `.md`, "View as…" → Plain text → shows raw markdown; search works; → Markdown → renders again.
  7. Edit the open file on disk → reload → re-search re-highlights.
  8. Print/PDF export → search bar and highlights absent (the `@media print` rule).

- [ ] **Step 3: Full automated suite**

Run: `npm test && (cd src-tauri && cargo test)`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: P1 sample files and search smoke checklist"
```

---

## Verification (P1 end-to-end)

- **Automated:** `npm test` (format, search controller, DOM provider, plus the
  unchanged render/tabs/settings/clipboard suites) and `cargo test` all pass.
- **Build:** `npm run build` and `cargo build` succeed.
- **Manual:** the Task 8 checklist passes in `npm run tauri dev`.
- **Seam in place for P2/P3:** `getRenderer(format)` dispatch, the `Renderer`
  interface, and the `SearchController` + `SearchProvider` interface exist and are
  exercised by `DomSearchProvider`; P2 adds a `data` renderer + `TreeSearchProvider`,
  P3 adds a `log` renderer + `LogSearchProvider`, with no controller changes.

## Notes for P2/P3 (not in scope now)

- P2 registers a `"data"` renderer in `registry.ts` and adds `TreeSearchProvider`;
  `main.ts`'s `rebindSearch()` will choose the provider by the active format/mode
  (DOM for markdown/text, tree for rendered data, log for rendered logs).
- P3 registers `"log"`, adds Rust streaming/tailing commands, the windowed
  viewport, and `LogSearchProvider`; the `rebindSearch()` provider-selection
  switch is the single integration point.
