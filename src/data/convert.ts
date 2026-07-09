import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parse as parseIni, stringify as stringifyIni } from "ini";
import type { DataLang } from "../types";
import { extractStructuredComments, prependStructuredComments, stripJsonComments } from "./comments";

/** Convert structured data while preserving comments where the target syntax
 * supports them. Standard JSON conversion is rejected when comments exist. */
export function convertStructuredData(source: string, from: DataLang, to: DataLang): string {
  if (from === to) return source;
  const comments = extractStructuredComments(source, from);
  let parsed: unknown;
  switch (from) {
    case "json": parsed = JSON.parse(stripJsonComments(source)); break;
    case "yaml": parsed = parseYaml(source); break;
    case "toml": parsed = parseToml(source); break;
    case "ini": parsed = parseIni(source); break;
  }

  let output: string;
  switch (to) {
    case "json": output = JSON.stringify(parsed, null, 2) + "\n"; break;
    case "yaml": output = stringifyYaml(parsed, { indent: 2, lineWidth: 120 }); break;
    case "toml": output = stringifyToml(parsed as Record<string, unknown>) + "\n"; break;
    case "ini": output = stringifyIni(parsed as Record<string, unknown>) + "\n"; break;
  }
  return prependStructuredComments(output, comments, to);
}
