import { load as loadYaml } from "js-yaml";
import { parse as parseToml } from "smol-toml";
import { parse as parseIni } from "ini";
import type { DataValue, DataNode, DataParseResult, DataScalarType, DataLang } from "../types";

/** Convert an arbitrary parsed JS value into the DataValue model. */
function toValue(v: unknown, path: string): DataValue {
  if (v === null || v === undefined) return { kind: "scalar", type: "null", text: "null" };
  if (Array.isArray(v)) {
    return {
      kind: "array",
      items: v.map((item, i) => childNode(String(i), `${path}[${i}]`, item)),
    };
  }
  if (typeof v === "object") {
    return {
      kind: "object",
      entries: Object.entries(v as Record<string, unknown>).map(([k, val]) =>
        childNode(k, `${path}.${k}`, val)
      ),
    };
  }
  const type: DataScalarType =
    typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
  return { kind: "scalar", type, text: String(v) };
}

function childNode(key: string, path: string, v: unknown): DataNode {
  return { key, path, value: toValue(v, path) };
}

export function parseData(text: string, lang: DataLang): DataParseResult {
  try {
    let parsed: unknown;
    switch (lang) {
      case "json":
        parsed = JSON.parse(text);
        break;
      case "yaml":
        parsed = loadYaml(text); // safe by default (no custom types)
        break;
      case "toml":
        parsed = parseToml(text);
        break;
      case "ini":
        parsed = parseIni(text);
        break;
    }
    return { ok: true, value: toValue(parsed, "root") };
  } catch (e) {
    return { ok: false, error: { message: (e as Error).message } };
  }
}
