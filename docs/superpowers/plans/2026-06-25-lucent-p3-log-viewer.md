# Lucent P3 (part 1) — Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `.log` files as a readable, **level-colored** per-line view
(ERROR/FATAL red, WARN orange, INFO normal, DEBUG/TRACE muted), with a
**tail/follow** toggle and inline **decoding of embedded/escaped JSON** (reusing
the P2 tree).

**Architecture:** A `log` renderer (registered in the existing renderer registry)
produces a per-line DOM with a level class per line; `.log` files default to the
rendered (colored) view, with raw = plain source. A **Tail** toolbar toggle
(shown for logs) auto-scrolls to newest on update. A small, tested `extractJson`
finds raw or escaped JSON in a line; a per-line expander renders it with the P2
`renderTree`. Search on a rendered log uses the existing `DomSearchProvider`
(the log is full-DOM in this part).

**Tech Stack:** TypeScript + Vite, Vitest (jsdom). Reuses P2 `renderTree`. No new
deps. No Rust changes in part 1.

## Global Constraints

- **Read-only viewer.** No editing.
- **No new dependencies.** No Rust changes in this part (streaming/stdin are
  deferred — see Deferred section).
- **Builds on P1+P2 (in `main`).** Reuse, do not duplicate: the renderer registry
  (`src/renderers/registry.ts`, `getRenderer`), `Renderer`/`RenderCtx`
  (`src/types.ts`), `renderTree` (`src/data/tree.ts`), the search controller +
  `DomSearchProvider`, `manager.getActiveFormat()`/`getActiveMode()`,
  `rebindSearch()` (its `else` branch already gives logs a `DomSearchProvider`).
- **No `innerHTML` for file-derived strings.** The log renderer builds DOM via
  `createElement`/`textContent`; decoded JSON goes through `renderTree` (which is
  already DOM-only). Highlighting/coloring is via CSS classes, not markup.
- **`npm run build` is part of every task's verification** (vitest doesn't type-check).
- Commit after each task with the message shown in its final step.
- Spec: `docs/superpowers/specs/2026-06-25-lucent-multi-format-design.md`.

## File Structure

```
src/
├─ logs/
│  ├─ level.ts              # NEW: detectLevel(line) -> LogLevel  (TDD)
│  └─ embedded-json.ts      # NEW: extractJson(line) -> {text,value} | null  (TDD)
├─ renderers/
│  ├─ log.ts                # NEW: log renderer (per-line, level class, JSON expanders)
│  └─ registry.ts           # MOD: register "log"
├─ data/parse-value.ts      # NEW: parseValueToModel(v) extracted from parse.ts (shared by log JSON decode)
├─ tabs.ts                  # MOD: log → rendered by default; Tab.follow; toggleFollow; scroll-to-bottom on repaint
├─ main.ts                  # MOD: Tail toggle button wiring (+ refreshToolbar)
├─ index.html              # MOD: #btn-tail toggle button
└─ styles.css               # MOD: .log-line + level colors (light/dark); expander; .log-gutter
test/
├─ log-level.test.ts        # NEW
└─ embedded-json.test.ts    # NEW
examples/
└─ sample.log               # already enriched (levels + raw/escaped JSON + docker line)
```

---

## Task 1: Level detection (TDD)

**Files:** Create `src/logs/level.ts`, `test/log-level.test.ts`.

**Interfaces:** Produces `type LogLevel = "error" | "warn" | "info" | "debug" | "none"` and `detectLevel(line: string): LogLevel`.

- [ ] **Step 1: Write the failing test** — `test/log-level.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { detectLevel } from "../src/logs/level";

describe("detectLevel", () => {
  it("flags error and fatal as error", () => {
    expect(detectLevel("[12:00] ERROR boom")).toBe("error");
    expect(detectLevel("FATAL out of memory")).toBe("error");
    expect(detectLevel("CRITICAL disk full")).toBe("error");
  });
  it("flags warnings", () => {
    expect(detectLevel("WARN high mem")).toBe("warn");
    expect(detectLevel("[x] WARNING slow")).toBe("warn");
  });
  it("flags info and debug/trace", () => {
    expect(detectLevel("INFO started")).toBe("info");
    expect(detectLevel("DEBUG route resolved")).toBe("debug");
    expect(detectLevel("TRACE webhook")).toBe("debug");
  });
  it("error wins when multiple levels appear", () => {
    expect(detectLevel("INFO retry after ERROR")).toBe("error");
  });
  it("returns none when no level token", () => {
    expect(detectLevel("just a plain line")).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` FAIL (cannot resolve module).

- [ ] **Step 3: Implement** — `src/logs/level.ts`

```ts
export type LogLevel = "error" | "warn" | "info" | "debug" | "none";

/** Classify a log line by the highest-severity level token it contains. */
export function detectLevel(line: string): LogLevel {
  if (/\b(ERROR|FATAL|SEVERE|CRITICAL|PANIC)\b/i.test(line)) return "error";
  if (/\b(WARN|WARNING)\b/i.test(line)) return "warn";
  if (/\b(INFO|NOTICE)\b/i.test(line)) return "info";
  if (/\b(DEBUG|TRACE|VERBOSE)\b/i.test(line)) return "debug";
  return "none";
}
```

- [ ] **Step 4: Run tests to verify they pass** — `npm test` PASS (5 new); `npm run build` clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: log level detection heuristic"`

---

## Task 2: Embedded/escaped JSON extraction (TDD)

**Files:** Create `src/logs/embedded-json.ts`, `test/embedded-json.test.ts`.

**Interfaces:** Produces `extractJson(line: string): { text: string; value: unknown } | null` — finds the widest brace/bracket-delimited substring and returns its parsed value, trying the raw substring then an unescaped form (handles JSON logged as an escaped string).

- [ ] **Step 1: Write the failing test** — `test/embedded-json.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { extractJson } from "../src/logs/embedded-json";

describe("extractJson", () => {
  it("extracts a raw embedded JSON object", () => {
    const r = extractJson('request done {"method":"GET","status":200}');
    expect(r).not.toBeNull();
    expect((r!.value as any).status).toBe(200);
  });
  it("extracts escaped JSON from a quoted string", () => {
    const line = 'audit payload="{\\"event\\":\\"login\\",\\"ok\\":true}"';
    const r = extractJson(line);
    expect(r).not.toBeNull();
    expect((r!.value as any).event).toBe("login");
  });
  it("extracts a JSON array", () => {
    const r = extractJson('tags [1,2,3] done');
    expect((r!.value as any).length).toBe(3);
  });
  it("returns null when there is no JSON", () => {
    expect(extractJson("plain log line, no json")).toBeNull();
    expect(extractJson("ratio {incomplete")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` FAIL.

- [ ] **Step 3: Implement** — `src/logs/embedded-json.ts`

```ts
/** Try to find and parse a JSON object/array embedded in a log line — either
 *  raw (`{...}`) or escaped inside a quoted string (`"{\"k\":1}"`). Returns the
 *  matched source text and parsed value, or null if none parses. */
export function extractJson(line: string): { text: string; value: unknown } | null {
  const start = line.search(/[{[]/);
  if (start < 0) return null;
  const end = Math.max(line.lastIndexOf("}"), line.lastIndexOf("]"));
  if (end <= start) return null;
  const cand = line.slice(start, end + 1);

  // Try the raw substring first, then progressively-unescaped forms (logs often
  // embed JSON as an escaped string: \" → ", \\ → \). A couple of passes handle
  // single and double escaping without looping unboundedly.
  let current = cand;
  for (let pass = 0; pass < 3; pass++) {
    try {
      return { text: current, value: JSON.parse(current) };
    } catch {
      const next = current.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      if (next === current) break;
      current = next;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass** — `npm test` PASS (4 new); `npm run build` clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: extract raw/escaped embedded JSON from a log line"`

---

## Task 3: Log renderer + register + default-to-rendered + styles

**Files:** Create `src/renderers/log.ts`; modify `src/renderers/registry.ts`,
`src/tabs.ts`, `src/types.ts`, `src/styles.css`.

**Interfaces:** Produces `logRenderer: Renderer` (format `"log"`). Consumes
`detectLevel`, `extractJson`, `renderTree`.

- [ ] **Step 1: Log renderer** — `src/renderers/log.ts`

```ts
import { detectLevel } from "../logs/level";
import { extractJson } from "../logs/embedded-json";
import { renderTree } from "../data/tree";
import { parseValueToModel } from "../data/parse-value"; // see Step 2
import type { Renderer, RenderCtx } from "../types";

export const logRenderer: Renderer = {
  format: "log",
  render(source: string, container: HTMLElement, _ctx: RenderCtx) {
    container.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "log";
    const lines = source.split("\n");
    // Drop a single trailing empty line from a final newline.
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

    lines.forEach((text, i) => {
      const row = document.createElement("div");
      row.className = `log-line lvl-${detectLevel(text)}`;

      const gutter = document.createElement("span");
      gutter.className = "log-gutter";
      gutter.textContent = String(i + 1);

      const msg = document.createElement("span");
      msg.className = "log-msg";
      msg.textContent = text;

      row.append(gutter, msg);

      const found = extractJson(text);
      if (found) {
        const toggle = document.createElement("button");
        toggle.className = "log-json-toggle";
        toggle.textContent = "{ }";
        toggle.title = "Decode embedded JSON";
        const panel = document.createElement("div");
        panel.className = "log-json";
        panel.hidden = true;
        toggle.addEventListener("click", () => {
          if (!panel.dataset.rendered) {
            renderTree(parseValueToModel(found.value), panel, { defaultDepth: 2 });
            panel.dataset.rendered = "1";
          }
          panel.hidden = !panel.hidden;
          toggle.classList.toggle("open", !panel.hidden);
        });
        msg.append(" ");
        row.append(toggle);
        wrap.append(row, panel);
      } else {
        wrap.append(row);
      }
    });
    container.append(wrap);
  },
};
```

- [ ] **Step 2: A value→model helper for renderTree** — `renderTree` takes a
  `DataValue`, but `extractJson` returns a raw parsed value. Add
  `parseValueToModel(v: unknown): DataValue` to `src/data/parse-value.ts` by
  extracting the existing `toValue(v, "root")` logic from `src/data/parse.ts`
  into a shared, exported function (have `parse.ts` import it too — DRY, no
  duplicate recursion). Signature: `export function parseValueToModel(v: unknown): DataValue`.

- [ ] **Step 3: Register the log renderer** — `src/renderers/registry.ts`: add
  `import { logRenderer } from "./log";` and `log: logRenderer` to `REGISTRY`.

- [ ] **Step 4: Default `.log` to the rendered (colored) view** — in `src/tabs.ts`,
  change the initial-mode rule in `openOrActivate`, `replaceActive`, and
  `setActiveForcedFormat` from `(format === "text" || format === "log") ? "raw" : "rendered"`
  to `format === "text" ? "raw" : "rendered"` (so markdown + data + **log** →
  rendered; only plain text → raw).

- [ ] **Step 5: Styles** — `src/styles.css`: add `.log` (monospace, left-aligned,
  full width, no max-width), `.log-line` (flex row, `white-space: pre-wrap`,
  subtle row separation), `.log-gutter` (muted, right-aligned, fixed width,
  non-selectable), level colors:
  - `.lvl-error .log-msg { color: #d32f2f; font-weight: 600 }` (red)
  - `.lvl-warn .log-msg { color: #e67700 }` (orange)
  - `.lvl-info` normal; `.lvl-debug .log-msg { color: #888 }` (muted); `.lvl-none` normal.
  - `.log-json-toggle` (small inline button), `.log-json` (indented panel holding the tree).
  - `#content[data-theme="dark"]` overrides: error `#ff6b6b`, warn `#ffa94d`, debug `#999`.
  - `@media print`: keep colors, hide toggles.

- [ ] **Step 6: Verify** — `npm run build` clean, `npm test` green. Manual:
  `npm run tauri dev`, open `examples/sample.log` → colored lines (ERROR/FATAL
  red, WARN orange), `{ }` toggles on lines with JSON expand into a tree; toggle
  to raw → plain source; search (Cmd+F) highlights in the rendered log.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: log renderer — per-line level coloring + embedded-JSON decode; logs default to rendered"`

---

## Task 4: Tail/follow toggle

**Files:** Modify `index.html`, `src/main.ts`, `src/tabs.ts`.

**Interfaces:** `Tab.follow?: boolean`; `TabManager.toggleFollow()`,
`TabManager.isFollowing(): boolean`.

- [ ] **Step 1: Tail button markup** — `index.html`: add to a toolbar group
  `<button id="btn-tail" title="Tail / follow new lines" aria-pressed="false">⤓ Tail</button>`.

- [ ] **Step 2: Follow state + scroll** — `src/tabs.ts`:
  - Add `follow?: boolean` to `Tab`.
  - Add:
    ```ts
    isFollowing(): boolean { return !!this.active()?.follow; }
    toggleFollow(): void {
      const t = this.active();
      if (!t) return;
      t.follow = !t.follow;
      if (t.follow) this.content.scrollTop = this.content.scrollHeight;
      this.hooks.onChange();
    }
    ```
  - In `repaint()`, after rendering, if the active tab is a log in follow mode,
    pin to bottom: at the end add
    `if (t.follow && effectiveFormat(t) === "log") this.content.scrollTop = this.content.scrollHeight;`
    (place after the `restoreScroll` block; follow wins over scroll restore).

- [ ] **Step 3: Wire the button** — `src/main.ts`:
  - `btn("btn-tail").addEventListener("click", () => manager.toggleFollow());`
  - In `refreshToolbar()`: add `"btn-tail"` to the enable/disable id list, and
    reflect state — show it as enabled only for logs and pressed when following:
    ```ts
    const tail = btn("btn-tail");
    const isLog = manager.getActiveFormat() === "log";
    tail.hidden = !isLog;
    tail.classList.toggle("toggled", manager.isFollowing());
    tail.setAttribute("aria-pressed", String(manager.isFollowing()));
    ```
  - The existing `file-changed` listener already calls `manager.updateContent` →
    `repaint`, so when following, new disk lines auto-scroll to bottom. No extra
    wiring needed.

- [ ] **Step 4: Verify** — `npm run build` clean, `npm test` green. Manual:
  open `examples/sample.log`, click **⤓ Tail** (highlights), then append a line
  to the file on disk (`echo "[..] ERROR new" >> examples/sample.log`) → view
  auto-scrolls to the new line; toggle off → no auto-scroll.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: tail/follow toggle for logs (auto-scroll to newest)"`

---

## Task 5: Examples + smoke + suite

**Files:** Optionally add `examples/access.log` (Apache combined) and
`examples/syslog.log` (RFC3164) as extra demos; `sample.log` already covers
levels + raw/escaped JSON + a Docker line.

- [ ] **Step 1:** Add `examples/access.log` (a few Apache combined-format lines,
  incl. a 500 status) and `examples/syslog.log` (a few syslog lines incl. an
  `err`/`warning` priority) — generic level detection will still color obvious
  tokens; full format-specific parsing is deferred.

- [ ] **Step 2: Smoke** (in `npm run tauri dev`):
  1. Open `sample.log` → ERROR/FATAL red, WARN orange, DEBUG/TRACE muted.
  2. `{ }` on the embedded-JSON line and the escaped-JSON line → both expand to a tree.
  3. Tail toggle + append a line on disk → auto-scrolls.
  4. Raw toggle → plain left-aligned source; search works in both views.
  5. Open via CLI (`lucent examples/sample.log`) and Next cycles to it.

- [ ] **Step 3: Full suite** — `npm test && (cd src-tauri && cargo test)` green; `npm run build` clean.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "test: P3 log examples (apache/syslog) + smoke checklist"`

---

## Verification (P3 part 1 end-to-end)

- **Automated:** `npm test` (log-level, embedded-json + all prior suites) and
  `cargo test` pass; `npm run build` clean.
- **Manual:** Task 5 checklist passes.
- **Reuse confirmed:** the log renderer feeds `extractJson` output through the P2
  `renderTree` (via `parseValueToModel`), and rendered-log search uses the
  existing `DomSearchProvider` (no new provider needed at this scale).

## Deferred to P3 part 2 (not in scope now — call out explicitly)

- **Huge-file windowing + Rust streaming:** a line-index/tailer in Rust and a
  virtualized viewport so multi-GB logs stay responsive; with it, a
  `LogSearchProvider` over the backend index replaces the full-DOM
  `DomSearchProvider`. (This part renders the whole log into the DOM — fine for
  everyday logs; add a size cap + notice like the data renderer if needed.)
- **`tail -f file | lucent` (stdin pipe):** non-TTY stdin read on a background
  thread in the Rust entrypoint, streamed to a synthetic log tab.
- **Format-specific parsing:** Apache (access/error), syslog (RFC 3164/5424), and
  Docker (json-file driver) field extraction (timestamp/level/source) beyond the
  generic token heuristic; a `LogFormat` detector.
- **"Decode all JSON" global toggle** and the carry-over data follow-ups (tree
  path-tokenization for keys with `.`/`[`; highlight-all-hits in the tree).
