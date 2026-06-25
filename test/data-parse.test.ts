import { describe, it, expect } from "vitest";
import { parseData } from "../src/data/parse";

describe("parseData", () => {
  it("parses JSON into the value model", () => {
    const r = parseData('{"a":1,"b":[true,null,"x"]}', "json");
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      kind: "object",
      entries: [
        { key: "a", path: "root.a", value: { kind: "scalar", type: "number", text: "1" } },
        {
          key: "b",
          path: "root.b",
          value: {
            kind: "array",
            items: [
              { key: "0", path: "root.b[0]", value: { kind: "scalar", type: "boolean", text: "true" } },
              { key: "1", path: "root.b[1]", value: { kind: "scalar", type: "null", text: "null" } },
              { key: "2", path: "root.b[2]", value: { kind: "scalar", type: "string", text: "x" } },
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

  it("returns an error result on invalid JSON (no throw)", () => {
    const r = parseData("{not json", "json");
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBeTruthy();
  });
});
