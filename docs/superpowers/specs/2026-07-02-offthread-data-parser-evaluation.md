# Off-thread / streaming data parser — evaluation

**Date:** 2026-07-02
**Status:** Evaluation complete — **recommendation: do NOT build an off-thread/streaming parser.** The bounded win already shipped (#179, 10 MB cap). One genuinely useful follow-up identified: drop stored per-node path strings.

## Motivation

After #179 raised the data-tree parse cap to 10 MB, the open question was whether an off-thread (Web Worker) or streaming parser could remove the cap entirely so arbitrarily large JSON/YAML/TOML/INI files render as a tree without freezing the UI. The synchronous `parseData` (JSON.parse + `parseValueToModel`) is the only main-thread blocking step.

## Measurements (Node/V8, representative nested JSON)

| Step | 5 MB | 20 MB |
|---|---|---|
| `JSON.parse` (raw JS value) | 37 ms | 119 ms |
| build `DataValue` model (`parseValueToModel`) | **170 ms** | **653 ms** |
| `structuredClone(model)` — full round-trip | 638 ms | 3560 ms |
| build model **without** per-node path strings | 69 ms | 162 ms |

Two facts dominate: the **model build**, not JSON.parse, is the cost; and **cloning the model is far more expensive than building it**.

## Why off-thread parsing is counterproductive

A worker would `JSON.parse` + build the model off the main thread, then hand the `DataValue` back via `postMessage` — which uses the **structured clone** algorithm. That splits across threads: the worker serializes, the **main thread deserializes**. Even on the charitable half (deserialize ≈ half the 638 ms round-trip, and deserialize/allocation is usually the pricier half), the main thread still pays **~350–450 ms just to *receive* the result at 5 MB — versus ~207 ms to parse and build it directly**. At 20 MB the gap is far worse.

So moving parsing to a worker **increases** main-thread work (you trade a 207 ms build for a larger deserialize) while adding worker plumbing, an async boundary, and error paths. The `DataValue` model is a large pointer-graph of small objects — exactly the worst case for structured clone. **Off-thread parsing is refuted by measurement.**

Streaming (incremental main-thread parse with `requestIdleCallback` yielding) would need a streaming JSON parser (a new dependency), doesn't help the non-JSON formats, and only spreads the same total work across frames while adding significant complexity. Not worth it.

## Why lazy / on-demand model construction also fails

The tempting alternative is to `JSON.parse` eagerly (cheap) but build `DataValue` nodes only for the subtrees the user expands. It fails its own use case:

- `TreeSearchProvider` (`src/search/tree-provider.ts:24`) iterates `tree.nodes()`, which calls `buildFlat()` and materialises the **entire** tree.
- `expandAll()` walks the whole tree (`expandAllWalk`).

Both are exactly what a user does with a large structured file (search it, expand it). Lazy construction would not remove the freeze — it would **relocate it to first-search / first-expand-all**, i.e. mid-interaction, which is a worse moment than a one-time hitch at open (where a brief pause is expected). Net negative.

## Conclusion

The bounded, correct win already shipped in **#179**: cap at 10 MB (a ~350 ms one-time parse) with the DOM already virtualised; larger files fall back to raw text rather than freezing. Files above 10 MB of *structured* data viewed as an interactive tree are rare, and every architectural escalation (worker, streaming, lazy) either backfires on measurement or relocates the cost to a worse moment. **Close this item; do not pursue an off-thread/streaming parser.**

## Recommended bounded follow-up (optional, worth doing)

Per-node **path strings are ~50–60% of the model-build cost** (5 MB: 128 → 69 ms; 20 MB: 422 → 162 ms when omitted). `parseValueToModel` allocates a `path` string on every `DataNode` (O(depth) each). `TreeView` already walks parent→child when building its flat view, so it can **compute paths on demand** instead of reading a stored field — the path is only consumed as `FlatNode.path` (search, `expandToPath`, row lookup, expansion `Set`).

Dropping the stored `path` from the `DataValue` model would roughly halve the build cost, plausibly enough to raise the cap to ~20 MB within the same ~350 ms budget — **with no new architecture and none of the lazy-tree complexity above.** Caveats: it's a change to the shared `DataValue`/`DataNode` type (also produced by the logs embedded-JSON decoder), so every `node.path` reader must move to the computed path. Bounded and low-risk, but a distinct change — offered as the real alternative to declining outright, pending approval.
