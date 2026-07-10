import type { DataLang, StructuredComment } from "../types";

/** Locate the first comment marker outside quoted strings. */
function markerIndex(
  line: string,
  markers: string[],
  isMarker?: (line: string, index: number) => boolean,
): number {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (ch === "'" && line[i + 1] === "'") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (markers.includes(ch) && (isMarker?.(line, i) ?? true)) return i;
  }
  return -1;
}

function tomlMarkerIndex(
  line: string,
  state: { multiline: '"""' | "'''" | null },
): number {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    if (state.multiline) {
      if (line.startsWith(state.multiline, i)) {
        i += 2;
        state.multiline = null;
      }
      continue;
    }
    if (!quote && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
      state.multiline = line.slice(i, i + 3) as '"""' | "'''";
      i += 2;
      continue;
    }
    const ch = line[i];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
    } else if (quote === "'") {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return i;
  }
  return -1;
}

function parsePreservedComment(
  text: string,
  line: number,
  inline: boolean,
  inPreservedHeader: boolean,
): StructuredComment {
  const preserved = inPreservedHeader
    ? text.match(/^\[line (\d+)(, inline)?\]\s?(.*)$/)
    : null;
  return preserved ? {
    text: preserved[3],
    line: Number(preserved[1]),
    inline: !!preserved[2],
  } : { text, line, inline };
}

function normalizeBlockComment(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function extractJsonComments(source: string): StructuredComment[] {
  const comments: StructuredComment[] = [];
  let quote: '"' | null = null;
  let escaped = false;
  let line = 1;
  let lineHasCode = false;
  let inPreservedHeader = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "\n") {
      line++;
      lineHasCode = false;
      continue;
    }

    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"') {
      quote = ch;
      lineHasCode = true;
      continue;
    }

    if (ch === "/" && next === "/") {
      const startLine = line;
      const textStart = i + 2;
      let j = textStart;
      while (j < source.length && source[j] !== "\n") j++;
      const text = source.slice(textStart, j).trim();
      if (text === "Comments preserved from the source document") {
        inPreservedHeader = true;
      } else {
        comments.push(parsePreservedComment(text, startLine, lineHasCode, inPreservedHeader));
      }
      i = j - 1;
      lineHasCode = false;
      continue;
    }

    if (ch === "/" && next === "*") {
      const startLine = line;
      const inline = lineHasCode;
      const textStart = i + 2;
      let j = textStart;
      while (j < source.length && !(source[j] === "*" && source[j + 1] === "/")) {
        if (source[j] === "\n") line++;
        j++;
      }
      const text = normalizeBlockComment(source.slice(textStart, j));
      if (text) comments.push(parsePreservedComment(text, startLine, inline, inPreservedHeader));
      i = j + 1;
      lineHasCode = false;
      continue;
    }

    if (!/\s/.test(ch)) lineHasCode = true;
  }

  return comments;
}

/** Remove JSONC-style comments while preserving line breaks so parse errors
 * still land near the original source line. */
export function stripJsonComments(source: string): string {
  let out = "";
  let quote: '"' | null = null;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      if (i < source.length) out += source[i];
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < source.length) out += "  ";
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Extract JSON/YAML/TOML/INI comments without treating markers inside strings
 * as comments. YAML block-scalar bodies are skipped because # is data there. */
export function extractStructuredComments(source: string, lang: DataLang): StructuredComment[] {
  if (lang === "json") return extractJsonComments(source);
  const markers = lang === "ini" ? ["#", ";"] : ["#"];
  const comments: StructuredComment[] = [];
  const lines = source.split(/\r?\n/);
  let yamlBlockIndent: number | null = null;
  const tomlState: { multiline: '"""' | "'''" | null } = { multiline: null };
  let inPreservedHeader = false;
  const yamlCommentMarker = (line: string, marker: number): boolean =>
    marker === 0 || /\s/.test(line[marker - 1]);

  lines.forEach((line, index) => {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (lang === "yaml" && yamlBlockIndent !== null) {
      if (!line.trim() || indent > yamlBlockIndent) return;
      yamlBlockIndent = null;
    }

    const marker = lang === "toml"
      ? tomlMarkerIndex(line, tomlState)
      : markerIndex(line, markers, lang === "yaml" ? yamlCommentMarker : undefined);
    if (marker >= 0) {
      const text = line.slice(marker + 1).trim();
      if (text !== "Comments preserved from the source document") {
        comments.push(parsePreservedComment(
          text,
          index + 1,
          line.slice(0, marker).trim().length > 0,
          inPreservedHeader,
        ));
      } else {
        inPreservedHeader = true;
      }
    } else if (inPreservedHeader && line.trim() !== "") {
      inPreservedHeader = false;
    }

    if (lang === "yaml") {
      const code = marker >= 0 ? line.slice(0, marker) : line;
      if (/[:\-]\s*[|>][+\-]?\d*\s*$/.test(code.trimEnd())) yamlBlockIndent = indent;
    }
  });
  return comments;
}

/** Preserve comments in a supported target as a source-ordered header. Their
 * original line is included because cross-format serialization changes paths
 * and layout, making exact inline placement unsafe. */
export function prependStructuredComments(
  output: string,
  comments: StructuredComment[],
  target: DataLang,
): string {
  if (!comments.length) return output;
  const marker = target === "json" ? "//" : target === "ini" ? ";" : "#";
  const header = [
    `${marker} Comments preserved from the source document`,
    ...comments.map((comment) =>
      `${marker} [line ${comment.line}${comment.inline ? ", inline" : ""}] ${comment.text}`.trimEnd(),
    ),
  ].join("\n");
  return `${header}\n${output}`;
}

function lineCommentMarker(target: DataLang): string {
  return target === "json" ? "//" : target === "ini" ? ";" : "#";
}

/** Reinsert comments into a same-format serialization. Full-line comments go
 * before their original line; inline comments are appended to that line. When a
 * structural edit changes line counts, positions are clamped to the output. */
export function restoreStructuredComments(
  output: string,
  comments: StructuredComment[],
  target: DataLang,
): string {
  if (!comments.length) return output;
  const marker = lineCommentMarker(target);
  const trailingNewline = output.endsWith("\n");
  const lines = output.replace(/\n$/, "").split("\n");
  const sorted = [...comments].sort((a, b) => a.line - b.line || Number(a.inline) - Number(b.inline));
  let offset = 0;

  for (const comment of sorted) {
    const text = `${marker} ${comment.text}`.trimEnd();
    if (comment.inline) {
      const index = Math.max(0, Math.min(lines.length - 1, comment.line - 1 + offset));
      lines[index] = `${lines[index].trimEnd()} ${text}`;
    } else {
      const index = Math.max(0, Math.min(lines.length, comment.line - 1 + offset));
      lines.splice(index, 0, text);
      offset++;
    }
  }

  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

/** Visible comment list shared by rendered and edit-preview trees. */
export function renderStructuredComments(
  comments: StructuredComment[] | undefined,
  container: HTMLElement,
): void {
  if (!comments?.length) return;
  const section = document.createElement("section");
  section.className = "data-comments";
  section.setAttribute("aria-label", "Source comments");
  const title = document.createElement("div");
  title.className = "data-comments-title";
  title.textContent = `Comments (${comments.length})`;
  section.appendChild(title);
  for (const comment of comments) {
    const row = document.createElement("div");
    row.className = "data-comment";
    const line = document.createElement("span");
    line.className = "data-comment-line";
    line.textContent = `L${comment.line}${comment.inline ? " inline" : ""}`;
    const text = document.createElement("span");
    text.className = "data-comment-text";
    text.textContent = comment.text;
    row.append(line, text);
    section.appendChild(row);
  }
  container.appendChild(section);
}
