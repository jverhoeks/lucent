import { describe, it, expect } from "vitest";
import { parseData, serializeData } from "../src/data/parse";

describe("parseData", () => {
  it("parses JSON into the value model", () => {
    const r = parseData('{"a":1,"b":[true,null,"x"]}', "json");
    expect(r.ok).toBe(true);
    // Node paths are not stored on the model (TreeView derives them on the fly).
    expect(r.value).toEqual({
      kind: "object",
      entries: [
        { key: "a", value: { kind: "scalar", type: "number", text: "1" } },
        {
          key: "b",
          value: {
            kind: "array",
            items: [
              { key: "0", value: { kind: "scalar", type: "boolean", text: "true" } },
              { key: "1", value: { kind: "scalar", type: "null", text: "null" } },
              { key: "2", value: { kind: "scalar", type: "string", text: "x" } },
            ],
          },
        },
      ],
    });
  });

  it("parses YAML", () => {
    const r = parseData("a: 1\nb:\n  - x\n  - y", "yaml");
    expect(r.ok).toBe(true);
    expect(r.value?.kind).toBe("object");
  });

  it("parses TOML", () => {
    const r = parseData('title = "hi"\n[owner]\nname = "me"', "toml");
    expect(r.ok).toBe(true);
    expect(r.value?.kind).toBe("object");
  });

  it("parses INI", () => {
    const r = parseData("a=1\n[sec]\nb=2", "ini");
    expect(r.ok).toBe(true);
    expect(r.value?.kind).toBe("object");
  });

  it("round-trips YAML through parse and serialize, preserving scalar types", () => {
    const src = "title: hi\nowner:\n  name: me\ntags:\n  - a\n  - b\nn: 3.14\nok: false\nempty: null\n";
    const parsed = parseData(src, "yaml");
    expect(parsed.ok).toBe(true);
    const out = serializeData(parsed.value!, "yaml");
    // Re-parsing the serialized output yields the same value model.
    expect(parseData(out, "yaml")).toEqual(parsed);
  });

  it("returns an error result on invalid JSON (no throw)", () => {
    const r = parseData("{not json", "json");
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBeTruthy();
  });
});
