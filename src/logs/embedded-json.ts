/** Find a balanced {...} or [...] beginning at index i, respecting JSON string
 *  literals + escapes. Returns the substring, or null if unbalanced. */
function findBalanced(s: string, i: number): string | null {
  const open = s[i];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return null;
}

/** Find and parse JSON embedded in a log line — raw (`{...}`/`[...]`, ignoring
 *  unrelated brackets like `[service]`) or escaped inside a quoted string
 *  (`"{\"k\":1}"`, including doubled backslashes from Windows paths). Returns the
 *  matched source text and parsed value, or null. */
export function extractJson(line: string): { text: string; value: unknown } | null {
  // Raw: the first balanced {/[ slice that parses (skips non-JSON [tag]s).
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "{" || line[i] === "[") {
      const cand = findBalanced(line, i);
      if (cand) {
        try { return { text: cand, value: JSON.parse(cand) }; } catch { /* keep scanning */ }
      }
    }
  }
  // Escaped: a quoted "..." segment IS a JSON string literal, so JSON.parse of
  // the whole segment unescapes it correctly (handles \", \\, Windows paths,
  // \uXXXX — all of JSON's escapes), and parsing that inner string yields the
  // embedded value. This is more robust than hand-rolled \"/\\ replacement.
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (!/[{[]/.test(m[1])) continue;
    try {
      const inner = JSON.parse(m[0]); // m[0] is the quoted segment incl. its quotes
      if (typeof inner !== "string") continue;
      const value = JSON.parse(inner);
      if (value && typeof value === "object") return { text: m[0], value };
    } catch { /* not this segment */ }
  }
  return null;
}
