import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parse as parseIni, stringify as stringifyIni } from "ini";
import type { DataParseResult, DataLang, DataValue, StructuredComment } from "../types";
import { parseValueToModel } from "./parse-value";
import { extractStructuredComments, restoreStructuredComments, stripJsonComments } from "./comments";

export function parseData(text: string, lang: DataLang): DataParseResult {
  const comments = extractStructuredComments(text, lang);
  try {
    let parsed: unknown;
    switch (lang) {
      case "json":
        parsed = JSON.parse(stripJsonComments(text));
        break;
      case "yaml":
        parsed = parseYaml(text);
        break;
      case "toml":
        parsed = parseToml(text);
        break;
      case "ini":
        parsed = parseIni(text);
        break;
      default:
        throw new Error(`unsupported data language: ${lang}`);
    }
    return { ok: true, value: parseValueToModel(parsed), comments };
  } catch (e) {
    return { ok: false, comments, error: { message: (e as Error).message } };
  }
}

/** Convert a DataValue model back to a plain JS value for serialization. */
function modelToValue(v: DataValue): unknown {
  if (v.kind === "scalar") {
    if (v.type === "number") return Number(v.text);
    if (v.type === "boolean") return v.text === "true";
    if (v.type === "null") return null;
    return v.text;
  }
  if (v.kind === "object") {
    const obj: Record<string, unknown> = {};
    for (const entry of v.entries) {
      obj[entry.key] = modelToValue(entry.value);
    }
    return obj;
  }
  if (v.kind === "array") {
    return v.items.map((item) => modelToValue(item.value));
  }
  return undefined;
}

/** Serialize a DataValue back to a string in the given format. */
export function serializeData(
  value: DataValue,
  lang: DataLang,
  comments: StructuredComment[] = [],
): string {
  const raw = modelToValue(value);
  let output: string;
  switch (lang) {
    case "json":
      output = JSON.stringify(raw, null, 2) + "\n";
      break;
    case "yaml":
      output = stringifyYaml(raw, { indent: 2, lineWidth: 120 });
      break;
    case "toml":
      output = stringifyToml(raw as Record<string, unknown>) + "\n";
      break;
    case "ini":
      output = stringifyIni(raw as Record<string, unknown>) + "\n";
      break;
    default:
      throw new Error(`unsupported data language: ${lang}`);
  }
  return restoreStructuredComments(output, comments, lang);
}
