import type { SearchQuery } from "../types";

/**
 * 0-based line numbers of `lines` matching `q`, in order. Synchronous in-memory
 * scan for large non-windowed logs (the windowed path runs the same search in
 * Rust). Mirrors the case/regex semantics of the other providers; assumes a
 * valid regex (SearchController validates the pattern before calling find()).
 */
export function searchLogLines(lines: string[], q: SearchQuery): number[] {
  if (!q.text) return [];
  const test = matcher(q);
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) if (test(lines[i])) out.push(i);
  return out;
}

function matcher(q: SearchQuery): (s: string) => boolean {
  if (q.regex) {
    const re = new RegExp(q.text, q.caseSensitive ? "" : "i");
    return (s) => re.test(s);
  }
  if (q.caseSensitive) return (s) => s.includes(q.text);
  const lc = q.text.toLowerCase();
  return (s) => s.toLowerCase().includes(lc);
}
