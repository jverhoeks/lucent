import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parse as parseIni, stringify as stringifyIni } from "ini";
import type { DataParseResult, DataLang, DataValue } from "../types";
import { parseValueToModel } from "./parse-value";

export function parseData(text: string, lang: DataLang): DataParseResult {
  try {
    let parsed: unknown;
    switch (lang) {
      case "json":
        parsed = JSON.parse(text);
        break;
      case "yaml":
        parsed = loadYaml(text);
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
    return { ok: true, value: parseValueToModel(parsed) };
  } catch (e) {
    return { ok: false, error: { message: (e as Error).message } };
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
export function serializeData(value: DataValue, lang: DataLang): string {
  const raw = modelToValue(value);
  switch (lang) {
    case "json":
      return JSON.stringify(raw, null, 2) + "\n";
    case "yaml":
      return dumpYaml(raw, { indent: 2, lineWidth: 120, noRefs: true });
    case "toml":
      return stringifyToml(raw as Record<string, unknown>) + "\n";
    case "ini":
      return stringifyIni(raw as Record<string, unknown>) + "\n";
    default:
      throw new Error(`unsupported data language: ${lang}`);
  }
}
