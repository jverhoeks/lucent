# Performance checks

Run `npm run benchmark` on Node 22 after a production build. The benchmark uses
representative large Markdown, JSON, and log inputs and reports latency and
throughput. Record the Node version, machine, commit, and process peak RSS when
comparing changes.

The working budgets are:

| Operation | Input | Budget |
| --- | --- | ---: |
| Markdown render | about 1 MiB | p75 under 1,000 ms |
| JSON parse and tree-model build | about 3 MiB | p75 under 1,500 ms |
| In-memory log search | 250,000 lines | p75 under 500 ms |
| Benchmark process peak RSS | all fixtures and Vitest/jsdom | under 2 GiB |
| Initial web JavaScript | production build | largest entry chunk under 500 kB gzip |

These are regression budgets for a development machine, not promises for every
device. Browser performance checks should also confirm that typing, search,
scroll position, and log follow remain usable while work is in flight.

Baseline on 2026-09-14 (Apple Silicon, Node 25.9.0; the supported runtime is
Node 22): Markdown p75 208 ms, JSON p75 138 ms, log search p75 2.6 ms, and
process peak RSS 1,477 MiB (including Vitest/jsdom). The
web build's entry chunk was 51.5 kB gzip and its largest lazy chunk was 143.2 kB
gzip. All are inside the budgets; retaining the existing data/tree lazy import
boundaries produced a smaller entry chunk than eagerly importing them.
