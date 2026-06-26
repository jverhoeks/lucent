# Lucent P3.2b — Incremental Log Rendering + Tail-Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make streaming logs (piped stdin + disk-file follow) fast by **appending
only new lines** instead of re-rendering the whole buffer each update, and fix the
Tail toggle so turning follow **off freezes the scroll position** while lines keep
buffering.

**Architecture:** The log renderer becomes a stateful `LogView` that remembers the
lines it has rendered. `setLines(next)` diffs against the rendered lines: if the
current lines are a prefix of `next` (the common streaming case — pure append), it
appends rows only for the new tail; otherwise (front dropped by the ring cap, or a
different document) it does a full rebuild. `TabManager` holds the active
`LogView` and, on a streaming update of the active log tab, calls `setLines`
incrementally and handles scroll (follow → bottom, not-following → leave in place).

**Tech Stack:** TypeScript/Vite, Vitest (jsdom). No new deps. Folds into PR #5.

## Global Constraints

- **Read-only viewer.** No editing. No new dependencies.
- **Builds on P3 + P3.2a (this branch).** Reuse the existing per-line rendering
  (level class, gutter, message, `{ }` embedded-JSON expander via `renderTree`) —
  move it into `LogView`, do not duplicate or change its output. No `innerHTML`
  for log text (createElement/textContent only).
- **Correctness over micro-opt:** the prefix-diff must never drop or duplicate
  lines; on any divergence it falls back to a full rebuild.
- **`npm run build` + `npm test` are part of verification.**
- Commit after each task with the message shown in its final step.

## File Structure

```
src/renderers/log.ts   # MOD: LogView class (renderLog + incremental setLines); getCurrentLogView()
src/tabs.ts            # MOD: setStdin/updateContent use LogView.setLines for active log tabs; tail-freeze scroll
test/log-view.test.ts  # NEW: incremental append + full-rebuild-on-divergence (jsdom)
```

---

## Task 1: `LogView` — stateful incremental log rendering (TDD)

**Files:** Modify `src/renderers/log.ts`; create `test/log-view.test.ts`.

**Interfaces:** Produces `class LogView` with `setLines(lines: string[]): void` and
`lineCount(): number`; `renderLog(source, container, ctx): LogView`;
`getCurrentLogView(): LogView | null`. `logRenderer.render` creates + stores a
`LogView` (so the existing registry dispatch is unchanged).

- [ ] **Step 1: Write the failing test** — `test/log-view.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderLog } from "../src/renderers/log";

function mk() {
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

describe("LogView incremental rendering", () => {
  beforeEach(() => document.body.replaceChildren());

  it("renders one row per line with level classes", () => {
    const c = mk();
    renderLog("INFO a\nERROR b", c, { theme: "light" });
    expect(c.querySelectorAll(".log-line").length).toBe(2);
    expect(c.querySelector(".log-line.lvl-error")).toBeTruthy();
  });

  it("appends ONLY new rows when lines are extended (no rebuild)", () => {
    const c = mk();
    const v = renderLog("a\nb", c, { theme: "light" });
    const firstRow = c.querySelector(".log-line"); // identity check: must survive
    v.setLines(["a", "b", "c", "d"]);
    expect(c.querySelectorAll(".log-line").length).toBe(4);
    expect(c.querySelector(".log-line")).toBe(firstRow); // original node reused, not rebuilt
  });

  it("full-rebuilds when the front diverges (e.g. ring-cap dropped oldest)", () => {
    const c = mk();
    const v = renderLog("a\nb\nc", c, { theme: "light" });
    v.setLines(["b", "c", "d"]); // 'a' dropped from front → not a prefix
    const texts = [...c.querySelectorAll(".log-msg")].map((e) => e.textContent);
    expect(texts).toEqual(["b", "c", "d"]);
  });

  it("lineCount tracks rendered lines", () => {
    const c = mk();
    const v = renderLog("a\nb", c, { theme: "light" });
    v.setLines(["a", "b", "c"]);
    expect(v.lineCount()).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` FAIL (no `renderLog`/`LogView`).

- [ ] **Step 3: Implement** — refactor `src/renderers/log.ts`

Move the existing per-line DOM construction (the `lines.forEach((text, i) => { … })`
body — level class, gutter, msg, the `{ }` expander that lazily renders
`renderTree(parseValueToModel(found.value), …)`) into a private
`LogView.renderRow(text: string, index: number)` that appends to `this.wrap`,
**unchanged** from today's output. Then:

```ts
import { detectLevel } from "../logs/level";
import { extractJson } from "../logs/embedded-json";
import { renderTree } from "../data/tree";
import { parseValueToModel } from "../data/parse-value";
import type { Renderer, RenderCtx } from "../types";

let currentLogView: LogView | null = null;
/** The LogView from the most recent log render (single active doc), for incremental updates. */
export function getCurrentLogView(): LogView | null {
  return currentLogView;
}

export class LogView {
  private wrap: HTMLElement;
  private lines: string[] = [];

  constructor(container: HTMLElement) {
    container.replaceChildren();
    this.wrap = document.createElement("div");
    this.wrap.className = "log";
    container.appendChild(this.wrap);
  }

  lineCount(): number {
    return this.lines.length;
  }

  /** Reconcile the rendered rows to `next`: append the tail when `next` extends
   *  the current lines (streaming append); otherwise rebuild from scratch. */
  setLines(next: string[]): void {
    const isPrefix =
      this.lines.length <= next.length && this.lines.every((l, i) => l === next[i]);
    if (!isPrefix) {
      this.wrap.replaceChildren();
      this.lines = [];
    }
    for (let i = this.lines.length; i < next.length; i++) {
      this.renderRow(next[i], i);
    }
    this.lines = next.slice();
  }

  private renderRow(text: string, index: number): void {
    // … MOVED VERBATIM from the old render() per-line block: build
    //   <div class="log-line lvl-${detectLevel(text)}"> with a .log-gutter
    //   (index + 1), a .log-msg (textContent = text), and — when
    //   extractJson(text) is non-null — a `{ }` toggle + lazy <div class="log-json">
    //   panel that renderTree(parseValueToModel(found.value), panel, {defaultDepth:2})
    //   on first open. Append row (and panel) to this.wrap.
  }
}

/** Split source into lines, dropping a single trailing empty line from a final newline. */
function toLines(source: string): string[] {
  const lines = source.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export const logRenderer: Renderer = {
  format: "log",
  render(source: string, container: HTMLElement, _ctx: RenderCtx) {
    const view = new LogView(container);
    view.setLines(toLines(source));
    currentLogView = view;
  },
};

export function renderLog(source: string, container: HTMLElement, _ctx: RenderCtx): LogView {
  const view = new LogView(container);
  view.setLines(toLines(source));
  currentLogView = view;
  return view;
}
```

- [ ] **Step 4: Run tests to verify they pass** — `npm test` PASS (4 new + all prior); `npm run build` clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: incremental LogView — append new log lines instead of full re-render"`

---

## Task 2: TabManager — incremental streaming updates + tail-freeze

**Files:** Modify `src/tabs.ts`.

**Interfaces:** Consumes `getCurrentLogView` from the log renderer.

- [ ] **Step 1: Use incremental updates for the active log tab** — `src/tabs.ts`

Import `getCurrentLogView` from `./renderers/log`. Add a private helper that, for
the **active** tab when it is a rendered log AND a current `LogView` exists,
applies lines incrementally and handles scroll; otherwise falls back to `repaint`:

```ts
/** Stream `lines` into the active rendered-log view incrementally; preserves the
 *  user's scroll when not following, pins to bottom when following. Returns true
 *  if it handled the update incrementally. */
private streamLogUpdate(lines: string[]): boolean {
  const t = this.active();
  if (!t || effectiveFormat(t) !== "log" || t.mode !== "rendered") return false;
  const view = getCurrentLogView();
  if (!view) return false;
  const atBottom = t.follow;
  const prev = this.content.scrollTop;
  view.setLines(lines);
  if (atBottom) this.content.scrollTop = this.content.scrollHeight; // follow: newest
  else this.content.scrollTop = prev;                                // frozen: stay put
  return true;
}
```

- [ ] **Step 2: Route `setStdin` through it** — replace `setStdin`'s active-tab
  branch so it updates `t.content` then, if the tab is active, tries
  `streamLogUpdate(lines)` and only falls back to `repaint(false)` if that returns
  false:

```ts
setStdin(lines: string[]): void {
  let i = this.tabs.findIndex((t) => t.path === STDIN_PATH);
  if (i < 0) {
    if (lines.length === 0) return;
    this.openStdin();
    i = this.tabs.findIndex((t) => t.path === STDIN_PATH);
  }
  this.tabs[i].content = lines.join("\n");
  if (i === this.activeIndex && !this.streamLogUpdate(lines)) this.repaint(false);
}
```

- [ ] **Step 3: Route disk-log follow through it too** — in `updateContent`, when
  the changed tab is the active rendered log, try the incremental path:

```ts
updateContent(path: string, content: string): void {
  const i = this.tabs.findIndex((t) => t.path === path);
  if (i < 0) return;
  this.tabs[i].content = content;
  if (i !== this.activeIndex) return;
  const t = this.tabs[i];
  const lines = content === "" ? [] : content.split("\n");
  if (!(effectiveFormat(t) === "log" && t.mode === "rendered" && this.streamLogUpdate(lines))) {
    this.repaint(false);
  }
}
```

  (Non-log tabs and raw mode keep the existing `repaint(false)` behavior exactly.)

- [ ] **Step 4: Build + tests + manual**

Run `npm run build` (clean) and `npm test` (green). Then `npm run build && (cd src-tauri && cargo build)` and:
- `( for i in $(seq 1 500); do echo "[t$i] INFO line $i"; done; sleep 60 ) | ./src-tauri/target/debug/lucent`
  → fast 500-line burst renders quickly and stays smooth (no full re-render per batch).
- Toggle **⤓ Tail** off, scroll up while a slow producer streams → the view **stays put** (frozen) and new lines accumulate below; toggle on → snaps to newest.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: stream log updates incrementally; Tail-off freezes scroll while buffering"`

---

## Verification (P3.2b end-to-end)

- **Automated:** `npm test` (log-view + all prior) green; `npm run build` + `cargo build` clean.
- **Manual:** large/fast streams stay responsive; Tail-off freezes the scroll
  position while the buffer keeps growing; Tail-on snaps to newest.
- **Reuse confirmed:** `renderRow` output is unchanged from the P3.1 log renderer
  (same level colors + `{ }` JSON decode); only the update path changed.

## Notes for later P3.2 slices

- **Windowing (P3.2c):** even incremental append keeps all ≤10k rows in the DOM;
  true virtualization (only visible rows) + Rust line-index comes next, with
  `LogSearchProvider`.
- The disk-tail incremental path assumes file growth is append-only; a rewritten
  file (non-prefix) correctly falls back to a full rebuild via `setLines`.
