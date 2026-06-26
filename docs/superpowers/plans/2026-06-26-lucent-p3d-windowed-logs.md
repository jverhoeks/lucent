# Lucent P3.2c — Windowed/Streamed Huge Log Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open arbitrarily large `.log` files responsively — the Rust backend
builds a line-offset index and serves windows of lines on demand; the frontend
renders only the visible rows (virtual scroll); search runs over the backend
index. Removes the in-memory size limit for files. (Piped stdin keeps its bounded
ring buffer — a stream isn't seekable.)

**Architecture:** A file above a size threshold opens in **windowed mode**: Rust
`log_open` scans it once into a line-offset index (kept in managed state),
`log_window(start,count)` reads those lines, `log_search` scans for matches and
returns line numbers; file growth extends the index and emits `log-grew`. The
frontend `VirtualLogView` renders a fixed-row-height window positioned over a
full-height sizer, fetching windows as you scroll; a `LogSearchProvider` drives
search/reveal over the index. Small files keep today's full-DOM incremental log
view unchanged.

**Tech Stack:** Rust (std fs/io + Tauri state/events), TypeScript/Vite, Vitest.
No new deps. Reuses `detectLevel` + `extractJson` for per-row rendering, and the
P1 `SearchController`/`SearchProvider` interface.

## Global Constraints

- **Read-only viewer.** No new dependencies. No `innerHTML` for log content.
- **Threshold:** files whose byte size > `WINDOW_THRESHOLD` (5 MB) open windowed;
  at/under it, the existing full-DOM incremental log path is used **unchanged**.
- **Builds on P3.1 + P3.2 (in `main`).** Reuse `detectLevel`, `extractJson`,
  `parseValueToModel`/`renderTree` for a rendered row; the `SearchController` +
  provider interface; the `Tab.follow` + tail concepts. Markdown/data/text/small-log
  paths must be untouched.
- **Wrap mode is best-effort on windowed logs:** exact virtualization when
  unwrapped (uniform row height); when wrapped, the scrollbar is approximate.
- **`npm run build` + `cargo build` are part of verification; `cargo test` covers
  the Rust index/search logic.**
- Commit after each task with the message shown in its final step.
- Spec: `docs/superpowers/specs/2026-06-25-lucent-multi-format-design.md`.

## File Structure

```
src-tauri/src/
├─ logindex.rs        # NEW: LineIndex (offsets, window, search) + log_open/log_window/log_search commands + open-index state
├─ lib.rs             # MOD: manage LogIndexState; register the 3 commands
└─ watcher.rs         # MOD (small): on growth of a windowed log, extend index + emit `log-grew {path,lineCount}`
src/
├─ logs/virtual-log-view.ts   # NEW: VirtualLogView (windowed virtual scroll, wrap toggle)
├─ search/log-provider.ts     # NEW: LogSearchProvider (over the backend index)
├─ tabs.ts                     # MOD: windowed-log tabs (open via log_open; VirtualLogView; size threshold)
├─ main.ts                     # MOD: openPath chooses windowed vs in-memory by file size; rebindSearch → LogSearchProvider for windowed logs; log-grew listener
└─ styles.css                  # MOD: .vlog sizer/window/row styles + wrap toggle
test/
├─ (rust) logindex tests inline
└─ log-provider.test.ts        # NEW: provider over a fake window/search backend
```

---

## Task 1: Rust `LineIndex` + window/search commands (TDD)

**Files:** Create `src-tauri/src/logindex.rs`; modify `src-tauri/src/lib.rs`.

**Interfaces:** Produces `LineIndex` with `build(path)`, `line_count()`,
`window(start, count) -> Vec<String>`, `search(query, case_sensitive, regex) -> Vec<usize>`,
`extend()` (re-scan appended bytes). Commands `log_open(path)->usize`,
`log_window(path,start,count)->Vec<String>`, `log_search(path,query,case,regex)->Vec<usize>`
over a `LogIndexState = Mutex<HashMap<String, LineIndex>>`.

- [ ] **Step 1: Write the failing tests** — in `src-tauri/src/logindex.rs` `#[cfg(test)]`

```rust
#[cfg(test)]
mod tests {
    use super::*;
    fn tmp(name: &str, body: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(name);
        std::fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn indexes_windows_and_counts() {
        let p = tmp("li_a.log", "l0\nl1\nl2\nl3\n");
        let idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.line_count(), 4);
        assert_eq!(idx.window(1, 2), vec!["l1".to_string(), "l2".to_string()]);
        assert_eq!(idx.window(3, 10), vec!["l3".to_string()]); // clamps past end
    }

    #[test]
    fn search_returns_line_numbers() {
        let p = tmp("li_b.log", "alpha\nBETA\ngamma beta\n");
        let idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.search("beta", false, false), vec![1, 2]); // case-insensitive
        assert_eq!(idx.search("beta", true, false), vec![2]);     // case-sensitive
        assert_eq!(idx.search("a.*a", false, true), vec![0, 2]);  // regex
    }

    #[test]
    fn extend_picks_up_appended_lines() {
        let p = tmp("li_c.log", "one\n");
        let mut idx = LineIndex::build(p.to_string_lossy().as_ref()).unwrap();
        assert_eq!(idx.line_count(), 1);
        std::fs::write(&p, "one\ntwo\nthree\n").unwrap();
        idx.extend().unwrap();
        assert_eq!(idx.line_count(), 3);
        assert_eq!(idx.window(1, 2), vec!["two".to_string(), "three".to_string()]);
    }
}
```

- [ ] **Step 2: Run to verify failure** — `cd src-tauri && cargo test logindex` → FAIL.

- [ ] **Step 3: Implement** — `src-tauri/src/logindex.rs`

Implement `LineIndex` holding the file `path`, a `Vec<u64>` of line-start byte
offsets, and the indexed byte length. `build` scans the file once recording the
offset after each `\n`. `line_count` = number of lines. `window(start,count)`
seeks to `offsets[start]`, reads forward `count` lines (lenient UTF-8 via
`from_utf8_lossy`, strip `\r?\n`), clamps to the end. `search(q,case,regex)`
streams the file line by line and collects 0-based indices of matches using the
**`regex` crate** (approved dep): build ONE `regex::Regex` via
`RegexBuilder::new(&pattern).case_insensitive(!case_sensitive).build()`, where
`pattern = if regex { query.clone() } else { regex::escape(&query) }` — so literal
search is just an escaped pattern (one code path covers literal + regex + case).
An invalid pattern returns an empty `Vec` (the frontend already validates regex;
this is a non-panicking fallback). `extend()` re-opens, scans from the last indexed byte length for new
`\n`s, appends offsets. Then:

```rust
use std::collections::HashMap;
use std::sync::Mutex;
pub struct LogIndexState(pub Mutex<HashMap<String, LineIndex>>);
impl Default for LogIndexState { fn default() -> Self { Self(Mutex::new(HashMap::new())) } }

#[tauri::command]
pub fn log_open(path: String, state: tauri::State<LogIndexState>) -> Result<usize, AppError> { /* build + insert; return line_count */ }
#[tauri::command]
pub fn log_window(path: String, start: usize, count: usize, state: tauri::State<LogIndexState>) -> Result<Vec<String>, AppError> { /* window */ }
#[tauri::command]
pub fn log_search(path: String, query: String, case_sensitive: bool, regex: bool, state: tauri::State<LogIndexState>) -> Result<Vec<usize>, AppError> { /* search */ }
```

- [ ] **Step 4: Add the regex dep + a `file_size` command + wire into lib.rs** —
  `cd src-tauri && cargo add regex` (Apache-2.0/MIT). Add a tiny
  `#[tauri::command] pub fn file_size(path: String) -> Result<u64, AppError>`
  (`std::fs::metadata(&path).map(|m| m.len())` — does NOT read content; used by the
  frontend to choose windowed vs in-memory). Then in `lib.rs`: `mod logindex;`,
  `.manage(logindex::LogIndexState::default())`, add `log_open`/`log_window`/
  `log_search`/`file_size` to `generate_handler!`.

- [ ] **Step 5: Run tests** — `cargo test` green (incl. 3 new); `cargo build` clean.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: Rust line-index + log_open/log_window/log_search for huge logs"`

---

## Task 2: `VirtualLogView` — windowed virtual scroll (TDD where feasible)

**Files:** Create `src/logs/virtual-log-view.ts`; modify `src/styles.css`.

**Interfaces:** `class VirtualLogView` constructed with
`(container, lineCount, fetchWindow: (start,count)=>Promise<string[]>, opts?)`;
methods `setLineCount(n)` (file grew), `scrollToLine(i)`, `setWrap(on)`,
`destroy()`. Internally: a `.vlog-sizer` of height `lineCount × ROW_H` and a
positioned `.vlog-window` holding the current rows; on scroll, compute the visible
range, fetch the window (cached), and render rows (reusing the per-row DOM:
`detectLevel` class, gutter, msg, `{ }` expander).

- [ ] **Step 1: Write the failing test** — `test/virtual-log-view.test.ts`
  (jsdom note: layout/scroll metrics are 0 in jsdom, so test the **windowing math**
  via an extracted pure helper rather than real scrolling):

```ts
import { describe, it, expect } from "vitest";
import { visibleRange } from "../src/logs/virtual-log-view";

describe("visibleRange", () => {
  it("computes [start,count] with overscan, clamped to the file", () => {
    // ROW_H=20, viewport=200 → 10 rows visible; overscan=5
    expect(visibleRange({ scrollTop: 0, viewportH: 200, rowH: 20, lineCount: 1000, overscan: 5 }))
      .toEqual({ start: 0, count: 20 }); // 0..(10+2*5)
    const r = visibleRange({ scrollTop: 2000, viewportH: 200, rowH: 20, lineCount: 1000, overscan: 5 });
    expect(r.start).toBe(95); // floor(2000/20) - 5
    expect(r.start + r.count).toBeLessThanOrEqual(1000);
  });
  it("never returns a negative start or exceeds lineCount", () => {
    expect(visibleRange({ scrollTop: 0, viewportH: 100, rowH: 20, lineCount: 3, overscan: 5 }))
      .toEqual({ start: 0, count: 3 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` FAIL.

- [ ] **Step 3: Implement** — `src/logs/virtual-log-view.ts`

Export the pure `visibleRange({scrollTop,viewportH,rowH,lineCount,overscan})`
helper (the math the test pins). Then `VirtualLogView`:
- DOM: `container` (the scroll element) gets a `.vlog-sizer` (height
  `lineCount*ROW_H`) and inside it an absolutely-positioned `.vlog-window`.
- `ROW_H` constant (e.g. 20px; keep in sync with CSS `.vlog-row { height: 20px }`).
- On `container` scroll (rAF-throttled): `const {start,count} = visibleRange(...)`;
  if changed, `await fetchWindow(start,count)` then render those rows into
  `.vlog-window` (reuse the per-row builder from the log renderer — extract a
  shared `renderLogRow(text, lineNo)` into `src/renderers/log.ts` and import it),
  and set `window.style.transform = translateY(start*ROW_H)`.
- Cache the last rendered range to avoid refetch/rerender churn.
- `setLineCount(n)`: update sizer height; if following bottom, scroll to end.
- `scrollToLine(i)`: `container.scrollTop = i*ROW_H` (centered-ish), then the
  scroll handler fetches+renders.
- `setWrap(on)`: toggle a `.wrap` class on `.vlog-window` (CSS switches
  `white-space`); document that scroll precision is best-effort when wrapped.
- `destroy()`: remove listeners.

- [ ] **Step 4: Styles** — `.vlog` (relative, full height, overflow auto),
  `.vlog-sizer` (position relative; height set inline), `.vlog-window`
  (position absolute; top 0; left/right 0), `.vlog-row` (height ROW_H,
  white-space pre, overflow hidden), `.vlog-window.wrap .vlog-row` (height auto;
  white-space pre-wrap). Reuse the existing `.lvl-*` colors.

- [ ] **Step 5: Tests + build** — `npm test` PASS (2 new); `npm run build` clean.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: VirtualLogView windowed virtual-scroll renderer + wrap toggle"`

---

## Task 3: `LogSearchProvider` + integration (TDD for the provider)

**Files:** Create `src/search/log-provider.ts`, `test/log-provider.test.ts`;
modify `src/tabs.ts`, `src/main.ts`.

**Interfaces:** `class LogSearchProvider implements SearchProvider` constructed with
`(view: VirtualLogView, search: (q)=>Promise<number[]>)`. `find` runs the backend
search (returns ordered line numbers); `reveal(id)` scrolls the view to that line
+ marks it; `clear` removes marks.

- [ ] **Step 1: Write the failing test** — `test/log-provider.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { LogSearchProvider } from "../src/search/log-provider";

function fakeView() {
  return {
    scrolled: [] as number[],
    scrollToLine(i: number) { this.scrolled.push(i); },
    rowEl(_i: number) { return null as HTMLElement | null; },
  };
}

describe("LogSearchProvider", () => {
  it("resolves matches async and notifies once per new query (no re-search loop)", async () => {
    const view = fakeView();
    const search = vi.fn(async (_q) => [2, 5, 9]);
    const onUpdate = vi.fn();
    const p = new LogSearchProvider(view as any, search, onUpdate);
    const q = { text: "x", caseSensitive: false, regex: false };
    expect(p.find(q)).toEqual([]);              // async pending → empty for now
    await Promise.resolve(); await Promise.resolve();
    expect(onUpdate).toHaveBeenCalledTimes(1);  // results arrived → notified
    expect(p.find(q).length).toBe(3);           // re-find returns the cache
    expect(search).toHaveBeenCalledTimes(1);    // SAME query → not re-run (no loop)
  });

  it("reveal scrolls the view to the matched line number", async () => {
    const view = fakeView();
    const p = new LogSearchProvider(view as any, async () => [7, 42], () => {});
    p.find({ text: "x", caseSensitive: false, regex: false });
    await Promise.resolve(); await Promise.resolve();
    p.reveal(1);
    expect(view.scrolled.at(-1)).toBe(42);
  });

  it("empty query clears without searching", () => {
    const search = vi.fn();
    const p = new LogSearchProvider(fakeView() as any, search as any, () => {});
    expect(p.find({ text: "", caseSensitive: false, regex: false })).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` FAIL (no module).

- [ ] **Step 3: Implement** — `src/search/log-provider.ts`

```ts
import type { SearchProvider, SearchQuery, Match } from "../types";

interface ScrollTarget {
  scrollToLine(line: number): void;
  rowEl(line: number): HTMLElement | null;
}

/** Search a windowed log over the backend index. `find` is synchronous per the
 *  SearchProvider contract, but the backend search is async — so find() kicks the
 *  search for a NEW query and returns the cached results; when results arrive it
 *  calls onUpdate() (wired to controller.refresh()), and the controller's
 *  re-find() returns the now-populated cache. Same query key → no re-search,
 *  so there is no refresh→find→search loop. */
export class LogSearchProvider implements SearchProvider {
  private lineNos: number[] = [];
  private lastKey: string | null = null;
  constructor(
    private view: ScrollTarget,
    private runSearch: (q: SearchQuery) => Promise<number[]>,
    private onUpdate: () => void,
  ) {}

  find(q: SearchQuery): Match[] {
    if (!q.text) { this.lastKey = null; this.lineNos = []; return []; }
    const key = `${q.caseSensitive}|${q.regex}|${q.text}`;
    if (key === this.lastKey) return this.lineNos.map((_, i) => ({ id: i })); // cached
    this.lastKey = key;
    this.lineNos = [];
    void this.runSearch(q).then((nums) => {
      if (this.lastKey !== key) return; // a newer query superseded this one
      this.lineNos = nums;
      this.onUpdate();
    });
    return []; // pending; populated on the onUpdate-triggered re-find
  }

  reveal(id: number): void {
    const line = this.lineNos[id];
    if (line === undefined) return;
    this.clearCurrent();
    this.view.scrollToLine(line);
    this.view.rowEl(line)?.classList.add("search-current");
  }

  private clearCurrent(): void {
    for (const ln of this.lineNos) this.view.rowEl(ln)?.classList.remove("search-current");
  }
  clear(): void { this.clearCurrent(); this.lineNos = []; this.lastKey = null; }
}
```

  `VirtualLogView` must expose `rowEl(line): HTMLElement | null` — the rendered row
  for `line` if it's currently within the window, else null (highlight is applied
  after `scrollToLine` brings it into the window).

- [ ] **Step 4: Run tests** — `npm test` PASS (3 new); `npm run build` clean.

- [ ] **Step 5: Integration** — `src/main.ts` + `src/tabs.ts`:
  - In `openPath`, get the file size via the `file_size(path)` command (Task 1;
    `fs::metadata().len()` — must NOT read content): if a
    `.log` (or View-as log) and size > `WINDOW_THRESHOLD`, open it **windowed**:
    `await invoke("log_open", {path})` → lineCount; create a tab marked
    `windowed: true`; `repaint` for such a tab builds a `VirtualLogView`
    (fetchWindow = `(s,c)=>invoke("log_window",{path,start:s,count:c})`).
  - `rebindSearch`: when the active tab is a windowed log, use
    `new LogSearchProvider(view, q => invoke("log_search", {path, query:q.text, caseSensitive:q.caseSensitive, regex:q.regex}), () => search.refresh())`
    (the 3rd arg wires async results back to the `SearchController` — `search` is
    the controller instance in `main.ts`).
  - `log-grew` event listener → `view.setLineCount(n)` (tail growth).
  - Small logs (≤ threshold) and stdin are completely unchanged.

- [ ] **Step 6: Build + tests + manual** — `npm run build` + `cargo build` clean;
  `npm test` + `cargo test` green. Manual: generate a big log
  (`seq 1 2000000 | sed 's/^/INFO line /' > /tmp/big.log`), open it → scrolls
  smoothly, only visible rows in the DOM; `Cmd/Ctrl+F` finds matches across the
  whole file and jumps to them; appending to the file grows the view.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: LogSearchProvider + windowed-log integration (open huge logs, search over index)"`

---

## Task 4: Examples note + suite

- [ ] **Step 1:** Add a short `examples/README` note (or extend it) documenting that
  logs over ~5 MB open in windowed mode (no size cap; search runs server-side).
  Do NOT commit a giant fixture; the manual step generates one in `/tmp`.
- [ ] **Step 2: Smoke** (per Task 3 Step 6) + verify small logs/markdown/data/stdin
  are unchanged.
- [ ] **Step 3: Full suite** — `npm test && (cd src-tauri && cargo test)`; both builds clean.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "test: windowed-log smoke notes"`

---

## Verification (P3.2c end-to-end)

- **Automated:** `cargo test` (LineIndex window/search/extend) + `npm test`
  (visibleRange math, LogSearchProvider) green; both builds clean.
- **Manual:** a multi-million-line file opens instantly and scrolls smoothly with
  only visible rows in the DOM; whole-file search jumps to matches; tail growth
  extends the view; wrap toggle switches wrapping (best-effort scroll when wrapped).
- **Unchanged:** small logs (≤5 MB) keep the incremental full-DOM view; stdin keeps
  its ring buffer; markdown/data/text untouched.

## Notes for the final P3.2 slice (#2 — formats, next)

- Apache/syslog/Docker field extraction layers on top: a `LogFormat` detector +
  per-format parse feeding the level/columns; the windowed row renderer and the
  search index are the substrate it decorates.
- Windowed-file search has full regex parity (the `regex` crate), matching the
  in-memory search behavior.
