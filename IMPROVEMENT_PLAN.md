# Lucent improvement plan

Reviewed: 2026-09-14

## Direction

Focus the next release on dependable editing, saving, and recovery. The app already has substantial format support, virtualization, export options, and tests; improving these existing workflows should come before adding HTML rendering or more export targets.

This began as a source review and is now also the implementation tracker. Reliability fixes completed on 2026-09-14 are checked below. Native/browser usability and performance audits remain explicitly open. The older `codebase-review.md` is historical: several of its findings have already been addressed, so it should not be used as an unchecked backlog.

## Verification baseline

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npx vite build` | Passed; warnings about ineffective dynamic imports, a chunk over 500 kB, and `__dirname` compatibility |
| `npm test` | 323 passed across all 44 test files under the locally installed Node v25.9.0; Node 22 is now the declared and CI runtime |
| Local test failure | Resolved by using deterministic jsdom storage in test setup; the prior failures came from Node 25's experimental global storage |
| `cargo test` | 27 passed; `cargo clippy --all-targets -- -D warnings` also passed |

## Phase 1 — Protect user work

### 1. Make browser Save produce a durable result — P1, small/medium

**Evidence:** `src/main.ts` sends ordinary Save for an opened file to `adapter.saveTextFile`. In `src/platform/web.ts`, that method only updates `fileStore` when no write handle exists. The standard file input does not register a write handle. Save As already uses a download. Code-block Save also uses the adapter's in-memory text-save path.

- [x] Route ordinary browser Save through a real writable handle when available, otherwise download the current content.
- [x] Apply the same durable-save behavior to code-block exports and other text-save callers.
- [x] Distinguish “download started” from “saved to original file”; preserve dirty state on failures and cancellation.
- [x] Check subsequent Save after a scratch document has been downloaded and renamed internally.

**Done when:** open → edit → Save produces an updated file or download; code-block Save downloads its source; failed writes leave the draft intact. Add integration coverage for these paths, beyond the existing Save As tests.

### 2. Make desktop writes resilient — P1, medium

**Evidence:** `save_text_file` and `save_binary_file` in `src-tauri/src/commands.rs` use `std::fs::write` directly. Existing files can be truncated before a failed write completes. This is a code-level risk, not a reproduced data-loss incident.

- [x] Implement temporary-file writes in the destination directory followed by replacement, with cleanup on failure.
- [x] Define permissions, symlink, and platform-specific replacement behavior explicitly in the save implementation.
- [x] Recheck the disk version before saving an edited document; stale writes return a conflict error.
- [x] Verify that the app's own successful saves do not produce misleading conflict notifications.

**Done when:** simulated write/replacement failures preserve the original; concurrent disk changes prompt an explicit decision; macOS, Windows, and Linux replacement behavior is checked.

### 3. Recover drafts for existing files — P1, medium

**Evidence:** `TabManager.snapshotSession` and `src/session.ts` preserve content and dirty state only for scratch paths. Unsaved changes to disk-backed documents are excluded. `saveSession` writes to localStorage without handling storage failures; `persistSession` calls it before the unload dirty check.

- [x] Persist recoverable drafts for edited existing files, including the original disk revision needed for conflict detection.
- [x] Keep recovery distinct from overwriting the source file; changed originals use the existing restore/discard conflict UI.
- [x] Catch quota/storage failures and surface recovery unavailability without interrupting close protection.
- [x] Bound each session snapshot to 4 MiB.
- [x] Register a native Tauri close-request handler in addition to `beforeunload`.

**Done when:** a forced restart recovers scratch and existing-file drafts; changed/missing originals are handled clearly; unavailable storage does not break the UI or close guard.

## Phase 2 — Fix correctness and establish a dependable baseline

### 4. Stabilize test setup and runtime selection — P1, small

**Evidence:** local test results above; `vitest.config.ts` uses jsdom without storage setup, package.json has no Node engine declaration, and CI uses moving `lts/*`.

- [x] Reproduce and isolate the storage failure to Node 25's experimental global `localStorage`.
- [x] Declare Node 22, add `.nvmrc`, and pin CI to it.
- [x] Explicitly initialize deterministic test storage.
- [x] Include frontend typecheck, unit tests, desktop build, web build, and backend tests in CI; all corresponding local checks pass.

**Done when:** a documented clean setup passes the full suite without storage warnings; any remaining failures have individual explanations.

### 5. Unify preview updates and reject stale async results — P1, medium

**Evidence:** `TabManager.updateContent` has a separate clean-editor update branch: it sets the editor value, then updates Markdown via asynchronous rendering and direct `innerHTML`, with no document/revision check in that branch. It returns without an explicit structured-data preview refresh. Whether editor callbacks compensate for all cases needs reproduction.

- [x] Cover external changes while editing structured data and rapid Markdown tab switches.
- [x] Use one preview refresh path for typing, disk reload, and conflict resolution.
- [x] Associate asynchronous results with a tab and repaint revision; discard obsolete results.
- [x] Ensure programmatic editor updates do not incorrectly mark clean disk content dirty.

**Done when:** external edits refresh the correct preview for each editable format; delayed rendering cannot paint another tab; clean reloads remain clean.

### 6. Make asynchronous log search recoverable — P2, small/medium

**Evidence:** `src/search/log-provider.ts` calls `runSearch(...).then(...)` without rejection handling and caches by query alone. A rejected request leaves the same key cached, preventing a same-query retry. Cache invalidation during log growth/rotation needs end-to-end verification.

- [x] Handle rejected searches with an actionable error and retry path.
- [x] Include request revision in cache invalidation and reject obsolete request results.
- [x] Reopen the backend log index and rebind search after append, truncation, and rotation events so unchanged queries see the current revision.

**Done when:** injected backend failures do not cause unhandled rejections; retry succeeds; match counts and navigation follow current log content.

## Phase 3 — Improve daily use and scale

### 7. Preserve browser folder structure — P2, medium

**Evidence:** browser directory collection returns `File` objects, then imports using `file.name`; directory context is lost. `resolveSibling` concatenates strings without normalizing `./` or `../`, and `localImageUrl` always returns null.

- [x] Preserve relative paths from directory entries and normalize document-relative links within the imported set.
- [x] Resolve imported image assets using managed object URLs and release them when the imported set closes.
- [x] Add error callbacks to directory file reads so an unreadable entry cannot leave collection pending forever.

**Done when:** an imported folder with nested documents, duplicate basenames, and local images navigates correctly; unreadable children produce a summary while other files open.

### 8. Measure large-file behavior before optimizing — P2, medium

**Evidence:** desktop `read_file` copies a memory mapping into a complete UTF-8 string; ordinary file watchers reread on each relevant event before the frontend debounce. The build also reports ineffective dynamic imports for tree, parsing, and export modules. These are candidates for measurement, not proof of poor user-perceived performance.

- [x] Add a repeatable large-file benchmark for Markdown render, JSON model construction, log search, and process peak RSS, with recorded latency budgets.
- [x] Coalesce repeated filesystem events before expensive reads and replace memory mapping with owned reads so concurrent truncation returns an ordinary error.
- [x] Add Escape cancellation, progress updates, and 1,000-file/100 MiB practical limits for large folder imports.
- [x] Measure production bundle sizes, remove ineffective export/render imports, and retain data/tree lazy boundaries after eager imports increased the entry chunk.

**Done when:** a repeatable benchmark and explicit budgets exist; changes demonstrate improvement against those budgets without losing scroll or follow behavior.

### 9. Complete a keyboard and native workflow audit — P2, medium

- [x] Exercise file opening, editing, conflicts, search, tree navigation, quick switch, and exports using only the keyboard.
- [x] Check focus restoration, error announcements, toolbar discoverability, and narrow-window layouts in each theme.
- [x] Add a small real-browser smoke suite covering open/edit/save, folder import, and preview updates.
- [ ] Maintain native smoke checks for close/quit, file watching, clipboard, PDF handoff, and updates on supported platforms.

**Done when:** concrete usability findings are recorded and fixed; the most important workflows have repeatable checks beyond jsdom. This is an audit task, not a claim that all listed interactions are currently broken.

## Phase 4 — Reduce the cost of future changes

- [x] Extract save orchestration from `src/main.ts` into `src/save.ts`.
- [x] Extract recovery orchestration, preview lifecycle, and export actions from `src/main.ts` and `src/tabs.ts`, incrementally after behavior is covered.
- [x] Make platform capabilities explicit: persistent write, download, watching, and local asset resolution drive workflow behavior.
- [x] Update documentation with verified desktop/web differences and recovery guarantees.
- [x] Reconcile the historical review with an explicit resolved/open status notice and point current work to this plan.

**Done when:** the reliability fixes remain covered, desktop/web behavior is explicit, and feature-specific changes no longer require touching unrelated orchestration.

## Suggested delivery order

1. Stabilize the test baseline and fix browser Save.
2. Add resilient desktop saving and draft recovery.
3. Fix preview lifecycle and log-search failure handling.
4. Improve folder imports and complete browser/native usability checks.
5. Profile performance and refactor the measured problem areas.

Keep each change independently reviewable. Defer new format support until saving and recovery meet the acceptance criteria above.
