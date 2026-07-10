import type { DataLang, Format } from "./types";

export type PasteGuess = {
  format: Format;
  extension: string;
  title: string;
  forcedLang?: DataLang;
};

/** Classify pasted clipboard text for a new scratch tab. Prefer explicit
 *  structure over loose single-line patterns so prose and test output are not
 *  mis-tagged as YAML, INI, or logs. */
export function guessPasteScratch(text: string): PasteGuess {
  const trimmed = text.trim();
  if (!trimmed) {
    return { format: "text", extension: "txt", title: "Pasted.txt" };
  }

  if (
    /^```mermaid\b/i.test(trimmed)
    || /^(graph|flowchart)\s+(TD|TB|LR|RL|BT)\b/im.test(trimmed)
    || /^sequenceDiagram\b/im.test(trimmed)
    || /^classDiagram\b/im.test(trimmed)
    || /^stateDiagram(?:-v2)?\b/im.test(trimmed)
    || /^erDiagram\b/im.test(trimmed)
    || /^journey\b/im.test(trimmed)
    || /^gantt\b/im.test(trimmed)
    || /^pie\s+title\b/im.test(trimmed)
    || /^mindmap\b/im.test(trimmed)
    || /^timeline\b/im.test(trimmed)
  ) {
    return { format: "markdown", extension: "md", title: "Pasted diagram.md" };
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return { format: "data", extension: "json", title: "Pasted.json", forcedLang: "json" };
  }

  const lines = trimmed.split(/\r?\n/);

  const looksMarkdown = lines.some((line) =>
    /^#{1,6}\s/.test(line)
    || /^```/.test(line)
    || /^\s*[-*+]\s+\S/.test(line)
    || /^\s*\d+\.\s+\S/.test(line),
  );
  if (looksMarkdown) {
    return { format: "markdown", extension: "md", title: "Pasted.md" };
  }

  const logLikeLines = lines.filter((line) =>
    /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d/.test(line)
    || /^\s*\[(?:ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\]/i.test(line)
    || /^\s*(?:ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\s/i.test(line),
  );
  if (lines.length >= 3 && logLikeLines.length >= 2) {
    return { format: "log", extension: "log", title: "Pasted.log" };
  }

  if (trimmed.startsWith("---\n")) {
    return { format: "data", extension: "yaml", title: "Pasted.yaml", forcedLang: "yaml" };
  }

  const yamlKeyLines = lines.filter((line) =>
    !/^\d{4}-\d\d-\d\d/.test(line)
    && /^\s*[\w.-]+\s*:\s*\S/.test(line)
    && !/:\/\//.test(line),
  );
  if (yamlKeyLines.length >= 2 && yamlKeyLines.length >= lines.length * 0.4) {
    return { format: "data", extension: "yaml", title: "Pasted.yaml", forcedLang: "yaml" };
  }

  const hasTomlSection = lines.some((line) => /^\s*\[[^\]\n]+\]\s*$/.test(line));
  const hasTomlAssign = lines.some((line) => /^\s*[\w.-]+\s*=\s*\S/.test(line));
  if (hasTomlSection && hasTomlAssign) {
    return { format: "data", extension: "toml", title: "Pasted.toml", forcedLang: "toml" };
  }

  const hasIniSection = lines.some((line) => /^\s*\[[^\]\n]+\]\s*$/.test(line));
  const hasIniAssign = lines.some((line) => /^\s*[\w.-]+\s*=\s*\S/.test(line));
  if (hasIniSection || (hasIniAssign && !yamlKeyLines.length)) {
    return { format: "data", extension: "ini", title: "Pasted.ini", forcedLang: "ini" };
  }

  return { format: "text", extension: "txt", title: "Pasted.txt" };
}