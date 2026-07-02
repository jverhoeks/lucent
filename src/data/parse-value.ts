import type { DataValue, DataNode, DataScalarType } from "../types";

/** Convert an arbitrary parsed JS value into the DataValue model. Node paths
 *  are not materialised here — TreeView derives them while walking (see the
 *  `childPath` helper in tree.ts). */
function toValue(v: unknown): DataValue {
  if (v === null || v === undefined) return { kind: "scalar", type: "null", text: "null" };
  if (Array.isArray(v)) {
    return {
      kind: "array",
      items: v.map((item, i): DataNode => ({ key: String(i), value: toValue(item) })),
    };
  }
  if (typeof v === "object") {
    return {
      kind: "object",
      entries: Object.entries(v as Record<string, unknown>).map(([k, val]): DataNode => ({
        key: k,
        value: toValue(val),
      })),
    };
  }
  const type: DataScalarType =
    typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
  return { kind: "scalar", type, text: String(v) };
}

/** Convert any parsed JS value (object, array, scalar, null) into the DataValue model.
 *  Used by the data parser and the log renderer's embedded-JSON decoder. */
export function parseValueToModel(v: unknown): DataValue {
  return toValue(v);
}
