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
