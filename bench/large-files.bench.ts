import { afterAll, bench, describe } from "vitest";
import { parseData } from "../src/data/parse";
import { searchLogLines } from "../src/logs/log-search";
import { renderMarkdown } from "../src/render";

const markdown = Array.from(
  { length: 12_000 },
  (_, index) => `## Section ${index}\n\nParagraph with **bold**, [link](./next.md), and \`code\`.\n`,
).join("\n");
const json = JSON.stringify(Array.from(
  { length: 60_000 },
  (_, index) => ({ id: index, name: `record-${index}`, enabled: index % 2 === 0 }),
));
const logLines = Array.from(
  { length: 250_000 },
  (_, index) => `${new Date(1_700_000_000_000 + index * 1000).toISOString()} ${index % 997 === 0 ? "ERROR" : "INFO"} event=${index}`,
);
let markdownRevision = 0;

afterAll(() => {
  const runtime = globalThis as typeof globalThis & {
    process?: { resourceUsage(): { maxRSS: number } };
  };
  const maxRss = runtime.process?.resourceUsage().maxRSS;
  if (maxRss !== undefined) console.info(`Benchmark process max RSS: ${(maxRss / 1024).toFixed(1)} MiB`);
});

describe("representative large files", () => {
  bench("render ~1 MiB Markdown", async () => {
    // Vary the source so the render cache does not turn this into a Map lookup.
    await renderMarkdown(`${markdown}\n<!-- benchmark ${markdownRevision++} -->`);
  }, { iterations: 5, time: 0 });

  bench("parse ~3 MiB JSON into the tree model", () => {
    parseData(json, "json");
  }, { iterations: 5, time: 0 });

  bench("search 250k log lines", () => {
    searchLogLines(logLines, { text: "ERROR", caseSensitive: true, regex: false });
  }, { iterations: 5, time: 0 });
});
