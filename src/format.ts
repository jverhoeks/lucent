import type { Format, DataLang } from "./types";

function ext(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

const MARKDOWN = new Set(["md", "markdown", "mdown", "mkd"]);
const DATA: Record<string, DataLang> = {
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini",
};

export function detectFormat(path: string): Format {
  const e = ext(path);
  if (MARKDOWN.has(e)) return "markdown";
  if (e in DATA) return "data";
  if (e === "log") return "log";
  return "text";
}

export function dataLangOf(path: string): DataLang | null {
  return DATA[ext(path)] ?? null;
}

/** Final path segment, handling both `/` and `\` separators. */
export function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * Locate `current` within `siblings`. Tries an exact match first, then falls
 * back to matching by basename — the sibling list is one directory, so file
 * names are unique there, and this rescues the case where `current` is a
 * non-canonical path (e.g. opened via drag-and-drop) that doesn't string-equal
 * the canonical paths Rust returns. Returns -1 when not found.
 */
export function siblingIndex(siblings: string[], current: string): number {
  const exact = siblings.indexOf(current);
  if (exact >= 0) return exact;
  const base = basename(current);
  return siblings.findIndex((s) => basename(s) === base);
}
