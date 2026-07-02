# S14 / #90 — Incremental Markdown re-render — evaluation & design

**Date:** 2026-07-02
**Status:** Evaluation + design. **The literal ask (re-render only appended lines) is the wrong shape.** A DOM-reconciliation approach serves the real use case; recommended *if* live-editing diagram-heavy docs is a priority, otherwise defer. **Held at the brainstorming approval gate — no implementation yet.**

## The issue, and its internal tension

> Like log tracking but for Markdown. If a file grows, only re-render the new lines. Currently re-renders entire document. Critical for tweaking docs in an external editor while watching the preview.

Two different scenarios are conflated:

1. **Append-only growth** ("like log tracking") — a file that only ever gets content appended.
2. **Tweaking in an external editor** (the "critical" one) — arbitrary edits anywhere in the file, then save.

"Re-render only the new lines" solves (1) but **not** (2): an edit in the middle of a doc is not an append, so an append-only fast path never triggers for the primary use case.

## Current behaviour and measured reality

Live reload path: `adapter.onFileChanged` (debounced 200 ms, `main.ts:683`) → `manager.updateContent` → full repaint → worker render → `content.replaceChildren(article)` → `runPostRender` (re-runs mermaid on **every** `pre.mermaid` and katex on **every** math block).

Full `renderMarkdown` cost (single-threaded fallback; production runs in a Worker off the main thread): ~150 ms at 200 KB, ~2 s at 1 MB. Since #178, identical content is cache-served, but an edited file is new content → full render.

**So the parse is not the bottleneck for the live-edit case** — it's off the main thread. The visible jank on each save is main-thread: tearing down and rebuilding the entire article via `replaceChildren`, **re-running every mermaid/katex block** (flicker + cost even for diagrams that didn't change), and disturbing scroll.

## Why append-only incremental is not worth building

Even scoped to scenario (1), correct append-incremental is guard-heavy:

- **Document-global constructs.** Appending `[^1]: …` (footnote def) or `[id]: url` (link-ref def) changes the rendering of *earlier* references. Must detect these in the appended chunk and fall back to a full render.
- **Block boundaries.** The append point is often not a block boundary — appended text can continue the previous paragraph, list, or an unclosed code fence. Safe re-parse must restart at the last block boundary of the old content, which itself requires parsing.
- **Narrow payoff.** Markdown files appended to in real time are rare, and the render is already off-thread + cached.

High correctness surface, niche benefit, doesn't serve the primary use case. **Reject this shape.**

## Recommended approach (if we build anything): DOM reconciliation

Instead of re-rendering *less*, render the full HTML as today (cheap, off-thread, cached) but **patch the DOM instead of replacing it**. Diff the newly rendered article against the mounted one and mutate only the nodes that actually changed (a `morphdom` / `idiomorph`-style keyed reconcile, ~2–3 KB).

Benefits — and note they target scenario (2), the "critical" one:

- **Unchanged mermaid/katex blocks persist** — no re-render flicker, no wasted work on diagrams that didn't change. This is the biggest win.
- **Scroll position is preserved naturally** — untouched nodes stay put.
- **Serves arbitrary edits**, not just appends — an edit to paragraph 3 patches paragraph 3 and leaves the rest (including diagrams) intact.

Design sketch:

- Render to a detached `article` (existing worker path).
- Reconcile `content`'s current article → new article with a morph pass. Preserve `pre.mermaid` blocks that already hold an `<svg>` when their source (`data-*` / text) is unchanged, so `runPostRender` skips them.
- Make `runPostRender` **idempotent / incremental**: only render mermaid blocks not yet decorated and math not yet upgraded (partly true today — `decorateMermaid` is idempotent; extend to skip already-rendered SVGs).
- Keep the current `replaceChildren` path as the fallback when the DOM shape diverges too far (e.g. renderer change, format switch).

### Risks / effort

- Reconciling highlight.js code tables and katex-upgraded math without visual churn needs care (keyed matching on stable attributes like `data-src`, heading slugs).
- The mermaid post-render pass must become "render only new/changed diagrams" to realise the win.
- Needs solid tests: edit-in-middle preserves untouched diagrams; append adds nodes; reference-def edit still updates earlier refs (full-correctness via re-render + morph, since we always render the whole doc).
- Medium–high effort; a dependency (`morphdom`/`idiomorph`) or a small hand-rolled reconciler.

## Alternatives

- **C. Do nothing.** For typical docs (<200 KB, few diagrams) the current full re-render is off-thread + cached and adequate; the flicker only bites on diagram-heavy or very large docs.

## Recommendation

**Do not build append-only incremental.** If smooth live-preview for diagram-heavy / large docs is a real priority, build **DOM reconciliation (approach B)** — it targets the actual "tweaking in an editor" use case and eliminates the mermaid/katex re-render flicker. Otherwise **defer (C)**; the measured pain for ordinary documents is low. Either way this is a distinct, test-heavy change that should go through its own plan after approval — **not** started from this evaluation.
