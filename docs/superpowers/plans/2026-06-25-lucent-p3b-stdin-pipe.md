# Lucent P3.2a — `tail -f | lucent` (stdin pipe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Lucent is launched from a shell with piped stdin
(`tail -f app.log | lucent`, `kubectl logs -f … | lucent`, `journalctl -f | lucent`),
stream the piped lines into a live **"stdin" log tab** (level-colored, follow-on),
updating as new lines arrive.

**Architecture:** The Rust entrypoint detects a **non-TTY stdin** and spawns a
background reader thread; a small flush loop **batches** lines (coalescing bursts)
and emits `stdin-lines` events via the Tauri `AppHandle`. The frontend listens,
lazily creates a **synthetic log tab** (`<stdin>`, not a disk file, not watched),
appends batches to its content, and (in follow mode) auto-scrolls. Lines are kept
in a bounded ring buffer so an endless stream can't grow memory without limit.

**Tech Stack:** Rust (std threads + `std::io::IsTerminal` + Tauri `Emitter`),
TypeScript/Vite frontend, Vitest. Reuses the P3 log renderer + tail/follow.

## Global Constraints

- **Read-only viewer.** No editing.
- **No new dependencies** (std-only on the Rust side; `std::io::IsTerminal` is stable).
- **Builds on P1–P3 (in `main`).** Reuse: the `log` renderer + `Tab.follow` +
  tail behavior; `TabManager`; the `listen`/event wiring in `main.ts`. Do not
  duplicate the log rendering or follow logic.
- **stdin is read ONLY when it is not a TTY.** Launched normally from a terminal
  (`lucent` with no pipe) → stdin IS a tty → do NOT touch it (never consume the
  user's terminal). Launched as a macOS `.app` (double-click) → stdin is not a
  pipe → the reader sees EOF/no data → no stdin tab. Only a real pipe produces a tab.
- **Bounded memory:** the stdin tab keeps at most `STDIN_MAX_LINES` (10_000) lines
  in a ring buffer; oldest lines drop. (Windowing for truly huge streams is P3.2c.)
- **`npm run build` + `cargo build` are part of verification.**
- Commit after each task with the message shown in its final step.
- Spec: `docs/superpowers/specs/2026-06-25-lucent-multi-format-design.md` (Input sources).

## File Structure

```
src-tauri/src/
├─ stdin.rs                 # NEW: non-TTY detection + reader/flush threads → emit "stdin-lines"
└─ lib.rs                   # MOD: call stdin::spawn_reader(app handle) in setup()
src/
├─ stdin.ts                 # NEW: wire "stdin-lines" listener → TabManager stdin tab
├─ tabs.ts                  # MOD: synthetic stdin tab support (openStdin / appendStdin; ring cap)
└─ main.ts                  # MOD: initStdin(manager) on startup
test/
└─ stdin-tab.test.ts        # NEW: TabManager stdin-tab append + ring-cap (jsdom)
```

---

## Task 1: Rust — detect piped stdin and stream batched lines

**Files:** Create `src-tauri/src/stdin.rs`; modify `src-tauri/src/lib.rs`.

**Interfaces:** Produces `pub fn spawn_reader(app: tauri::AppHandle)` — if stdin is
not a TTY, spawns threads that read stdin lines and emit `stdin-lines`
(`Vec<String>`) events in coalesced batches; no-op if stdin is a TTY.

- [ ] **Step 1: Implement** — `src-tauri/src/stdin.rs`

```rust
use std::io::{BufRead, IsTerminal};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// If stdin is piped (not a TTY), stream its lines to the frontend as batched
/// `stdin-lines` events. No-op when stdin is a terminal (don't consume it) — so
/// `lucent` with no pipe, and the macOS .app double-click, are unaffected.
pub fn spawn_reader(app: AppHandle) {
    if std::io::stdin().is_terminal() {
        return;
    }
    let (tx, rx) = mpsc::channel::<String>();

    // Reader thread: blocking line reads off stdin, forwarded to the channel.
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break; // receiver gone
                    }
                }
                Err(_) => break, // non-UTF8 / closed
            }
        }
    });

    // Flush thread: coalesce bursts into one event every ~50ms (or per idle gap),
    // so a fast producer doesn't trigger an IPC event per line.
    std::thread::spawn(move || {
        loop {
            // Block for the first line of a batch; exit when the reader is done.
            let first = match rx.recv() {
                Ok(l) => l,
                Err(_) => break,
            };
            let mut batch = vec![first];
            // Drain whatever else is immediately available, then a short settle.
            while let Ok(l) = rx.try_recv() {
                batch.push(l);
            }
            std::thread::sleep(Duration::from_millis(50));
            while let Ok(l) = rx.try_recv() {
                batch.push(l);
            }
            let _ = app.emit("stdin-lines", batch);
        }
    });
}
```

- [ ] **Step 2: Wire into setup** — `src-tauri/src/lib.rs`

Add `mod stdin;` near the other `mod` lines. In the `.setup(|app| { … })` closure
(where `StartupFiles` is managed), add:

```rust
            stdin::spawn_reader(app.handle().clone());
```

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build && cd ..`
Expected: compiles. (`is_terminal()` requires Rust ≥ 1.70 — already used elsewhere / available.)

- [ ] **Step 4: Capability check** — confirm the frontend is allowed to `listen`
  for the `stdin-lines` event. The app already uses `core:event:default` (it
  listens for `file-changed`); `stdin-lines` is a normal app event, no new
  capability needed. Verify `src-tauri/capabilities/default.json` has the event
  permission already present (it does for P1) — no change expected.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: stream piped (non-TTY) stdin as batched stdin-lines events"
```

---

## Task 2: TabManager — synthetic stdin tab (TDD)

**Files:** Modify `src/tabs.ts`; create `test/stdin-tab.test.ts`.

**Interfaces:** Produces `TabManager.openStdin()` (create/activate the `<stdin>`
log tab) and `TabManager.appendStdin(lines: string[])` (append to it, ring-capped,
repaint if active). `STDIN_PATH = "<stdin>"` sentinel.

- [ ] **Step 1: Write the failing test** — `test/stdin-tab.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { TabManager, STDIN_PATH } from "../src/tabs";
import { DEFAULT_SETTINGS } from "../src/types";

function mk() {
  const tabbar = document.createElement("nav");
  const content = document.createElement("main");
  document.body.append(tabbar, content);
  const mgr = new TabManager(tabbar, content, DEFAULT_SETTINGS, {
    onChange: () => {}, onTabClosed: () => {}, onCloseAll: () => {},
  });
  return { mgr, content };
}

describe("TabManager stdin tab", () => {
  beforeEach(() => document.body.replaceChildren());

  it("opens a single <stdin> log tab in follow mode and appends lines", () => {
    const { mgr } = mk();
    mgr.openStdin();
    mgr.appendStdin(["INFO a", "ERROR b"]);
    mgr.appendStdin(["WARN c"]);
    expect(mgr.count()).toBe(1);
    expect(mgr.getActivePath()).toBe(STDIN_PATH);
    expect(mgr.getActiveFormat()).toBe("log");
    expect(mgr.isFollowing()).toBe(true);
    expect(mgr.getActiveRawText().split("\n")).toEqual(["INFO a", "ERROR b", "WARN c"]);
  });

  it("reuses the same stdin tab across appends (no duplicates)", () => {
    const { mgr } = mk();
    mgr.appendStdin(["one"]); // appendStdin opens the tab if absent
    mgr.appendStdin(["two"]);
    expect(mgr.count()).toBe(1);
  });

  it("ring-caps the stdin buffer to the most recent lines", () => {
    const { mgr } = mk();
    const many = Array.from({ length: 10_050 }, (_, i) => `line ${i}`);
    mgr.appendStdin(many);
    const lines = mgr.getActiveRawText().split("\n");
    expect(lines.length).toBe(10_000);
    expect(lines[lines.length - 1]).toBe("line 10049"); // newest kept
    expect(lines[0]).toBe("line 50"); // oldest dropped
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` FAIL (no `openStdin`/`STDIN_PATH`).

- [ ] **Step 3: Implement** — `src/tabs.ts`

Add near the top (exported):

```ts
export const STDIN_PATH = "<stdin>";
const STDIN_MAX_LINES = 10_000;
```

Add methods to `TabManager` (the stdin tab is `format: "log"`, `forcedFormat: "log"`,
`mode: "rendered"`, `follow: true`; it has no disk file so it is never watched):

```ts
/** Create + activate the synthetic stdin log tab, or activate it if it exists. */
openStdin(): void {
  const existing = this.tabs.findIndex((t) => t.path === STDIN_PATH);
  if (existing >= 0) { this.activate(existing); return; }
  this.tabs.push({
    path: STDIN_PATH,
    title: "stdin",
    content: "",
    format: "log",
    forcedFormat: "log",
    mode: "rendered",
    follow: true,
    scrollTop: 0,
  });
  this.activate(this.tabs.length - 1);
}

/** Append streamed lines to the stdin tab (creating it on first call),
 *  ring-capped to the most recent STDIN_MAX_LINES. */
appendStdin(lines: string[]): void {
  let i = this.tabs.findIndex((t) => t.path === STDIN_PATH);
  if (i < 0) { this.openStdin(); i = this.tabs.findIndex((t) => t.path === STDIN_PATH); }
  const t = this.tabs[i];
  const existing = t.content === "" ? [] : t.content.split("\n");
  let merged = existing.concat(lines);
  if (merged.length > STDIN_MAX_LINES) merged = merged.slice(merged.length - STDIN_MAX_LINES);
  t.content = merged.join("\n");
  if (i === this.activeIndex) this.repaint(false);
}
```

> `repaint(false)` re-renders the active stdin tab; the existing follow-pin in
> `repaint` (log + `follow`) auto-scrolls to the newest line. Full re-render per
> batch is acceptable here (bounded to 10k lines) — incremental rendering is P3.2b.

- [ ] **Step 4: Run tests to verify they pass** — `npm test` PASS (3 new); `npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: synthetic <stdin> log tab with ring-capped line appends"
```

---

## Task 3: Frontend wiring + smoke

**Files:** Create `src/stdin.ts`; modify `src/main.ts`.

- [ ] **Step 1: Implement the listener** — `src/stdin.ts`

```ts
import { listen } from "@tauri-apps/api/event";
import type { TabManager } from "./tabs";

/** Stream batched stdin lines (emitted by the Rust reader) into the stdin tab. */
export function initStdin(manager: TabManager): void {
  void listen<string[]>("stdin-lines", (e) => {
    if (e.payload.length) manager.appendStdin(e.payload);
  });
}
```

- [ ] **Step 2: Wire into `main.ts`** — import and call `initStdin(manager)` once,
  near where the other `listen(...)` calls and the startup IIFE are set up:

```ts
import { initStdin } from "./stdin";
// …after `manager` is created:
initStdin(manager);
```

- [ ] **Step 3: Build** — `npm run build` clean; `cd src-tauri && cargo build` clean.

- [ ] **Step 4: Manual smoke** — `npm run tauri build` is not needed; for dev,
  stdin piping needs a real pipe into the binary, so test the built/dev binary
  directly:
  - `printf 'INFO one\nWARN two\nERROR three\n' | ./src-tauri/target/debug/lucent`
    (with the vite dev server running, or after `npm run tauri build` using the
    bundled binary) → a **stdin** tab opens showing the three lines, colored.
  - `( for i in $(seq 1 20); do echo "[t$i] INFO line $i"; sleep 0.3; done ) | ./src-tauri/target/debug/lucent`
    → lines stream in live and the view follows to the newest.
  - `lucent` with no pipe (from a terminal) → no stdin tab (terminal not consumed).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: wire piped stdin into a live log tab (tail -f | lucent)"
```

---

## Verification (P3.2a end-to-end)

- **Automated:** `npm test` (stdin-tab + all prior) and `cargo test` pass; both builds clean.
- **Manual:** piping into the binary opens a live, colored, following stdin tab;
  no pipe → no stdin tab; the stream respects the 10k-line ring cap.
- **Reuse confirmed:** the stdin tab is `format: "log"` so it renders via the P3
  log renderer (level colors + `{ }` JSON decode) and follows via `Tab.follow`.

## Notes for later P3.2 slices

- **Incremental rendering (P3.2b):** `appendStdin` currently full-repaints; switch
  to appending only the new line nodes once incremental log rendering lands —
  same optimization the disk-tail path needs.
- **Huge streams (P3.2c):** the 10k ring cap bounds memory; true windowing/virtual
  scroll comes with the windowing work.
- macOS `.app` launched by double-click has no pipe → no stdin tab (documented;
  expected). A `lucent` CLI wrapper is the intended entry for piping.
