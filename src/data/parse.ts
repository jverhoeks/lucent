import { load as loadYaml } from "js-yaml";
import { parse as parseToml } from "smol-toml";
import { parse as parseIni } from "ini";
import type { DataParseResult, DataLang } from "../types";
import { parseValueToModel } from "./parse-value";

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
      default:
        // Defensive: a future DataLang variant added without a case here surfaces
        // as a clear error (caught below) instead of a silent null "success".
        throw new Error(`unsupported data language: ${lang}`);
    }
    return { ok: true, value: parseValueToModel(parsed) };
  } catch (e) {
    return { ok: false, error: { message: (e as Error).message } };
  }
}
