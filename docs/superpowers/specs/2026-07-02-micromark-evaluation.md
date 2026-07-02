# S17 / #98 — Evaluate micromark as a markdown-it replacement

**Date:** 2026-07-02
**Status:** Evaluation complete — **recommendation: decline (keep markdown-it); close #98 as won't-fix.**

## The proposal (from the issue)

> micromark is the modern, modular, tree-shakeable successor. Smaller baseline and
> only pay for what you use. Could reduce markdown parser from ~50KB to ~10KB gzipped.

## What we actually run today

`src/render-core.ts` builds a markdown-it instance with:

- **Core:** `html: false` (no raw-HTML passthrough — a security boundary), `linkify: true`, `typographer: true` (smart quotes / dashes).
- **7 plugins:** `markdown-it-task-lists`, `markdown-it-footnote`, `markdown-it-emoji` (full), `markdown-it-deflist`, `markdown-it-anchor` (with `permalink.headerLink()`), `@vscode/markdown-it-katex` (lazy, math only), and `markdown-it-container` × 3 (`note` / `warning` / `tip` callouts).
- **A large custom `fence` renderer rule** — the most coupled piece. It parses the info string (`lang`, `title="..."`, `lang:file` forms), special-cases `mermaid` → `<pre class="mermaid">`, and for every other fence emits a `.code-block` wrapper carrying `data-lang` / `data-filename` / `data-src`, a header with copy/save/line-number buttons, and a **per-line `<table>`** built via `splitHighlightedLines()` for line-number alignment.

### Downstream consumers depend on the exact HTML

A parser swap is not just a parser swap — this output is contract:

- `tabs.ts` copy-as-rich-text unwraps `a.header-anchor` and flattens `.code-block` tables back to `<pre><code>` using `data-src`.
- The render cache, search (DOM provider), and HTML/PDF export all operate on this DOM.
- `pre.mermaid` blocks are the handshake with the mermaid post-render pass.
- ~20 assertions in `test/render.test.ts` pin the HTML (code headers, `data-line`, `data-src`, sanitized fence info, katex absence in base render, mermaid wrapping, etc.).

## Why "micromark" is really "migrate to unified/remark/rehype"

micromark is a low-level tokenizer. It does **not** produce HTML with the features above on its own. Feature parity means adopting the unified stack:

| Today (markdown-it) | Equivalent |
|---|---|
| core + linkify + typographer | `remark-parse` + `remark-gfm` + `remark-smartypants` |
| task-lists | `remark-gfm` |
| footnote | `remark-gfm` |
| emoji | `remark-gemoji` |
| deflist | `remark-definition-list` (less maintained than the markdown-it one) |
| anchor + headerLink | `rehype-slug` + `rehype-autolink-headings` |
| katex | `remark-math` + `rehype-katex` |
| container (note/warning/tip) | `remark-directive` + a custom directive handler |
| **custom fence renderer** | **a custom `rehype` plugin walking `hast`** — full rewrite |
| `html: false` sanitization | `rehype-sanitize` (must be configured to allow our own structure) |

That's **9+ packages plus two custom plugins**, versus markdown-it + 7 small plugins today.

## The bundle premise does not hold

Measured on the current `dist/` build:

- markdown-it + all plugins compile into the **`render-core` (161 KB) and `render-worker` (161 KB)** chunks — **not** the main app chunk (`main`, 245 KB).
- **The parser runs in a Web Worker** (`render-worker.ts`), loaded lazily on first render. It is off the main thread and off the initial critical path, so shrinking it does **not** speed up page load — the metric the issue implies.
- Feature-parity via remark/rehype (parser + mdast→hast + 9 plugins + sanitize + katex + highlight) is **comparable or larger** than markdown-it + plugins. The "~10KB" figure is micromark-core alone, which renders none of our features.

## Cost / benefit

**Cost:** rewrite the fence renderer as a hast plugin; re-implement containers via directives; re-wire slug/autolink, math, gfm, smartypants; configure `rehype-sanitize` to preserve our DOM; and re-verify every HTML-coupled consumer (copy-rich, export, search, cache, ~20 tests). High effort, high regression surface.

**Benefit:** none on page-load (worker chunk, not critical path); parse latency is already off the main thread; no user-visible feature gain. A marginal worker-chunk size change at best, plausibly negative.

## Recommendation

**Decline. Close #98 as won't-fix (or "not planned").** markdown-it is well-suited here: mature plugins cover our features, the custom fence renderer is straightforward against its `renderer.rules` API, and it already runs in a Worker so speed is not a UX constraint. Revisit only if a concrete, measured problem appears that markdown-it genuinely cannot solve (e.g. a required CommonMark-spec edge case, or proven worker-parse latency on realistic documents) — not for a bundle win that the architecture already neutralises.
