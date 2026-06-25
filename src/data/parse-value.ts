import type { DataValue, DataNode, DataScalarType } from "../types";

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

/** Convert any parsed JS value (object, array, scalar, null) into the DataValue model.
 *  Used by the data parser and the log renderer's embedded-JSON decoder. */
export function parseValueToModel(v: unknown): DataValue {
  return toValue(v, "root");
}
