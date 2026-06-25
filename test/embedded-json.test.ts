import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { extractJson } from "../src/logs/embedded-json";

describe("extractJson", () => {
  it("ignores a preceding [tag] and extracts the raw JSON object", () => {
    const r = extractJson('2026 INFO [AppService] login {"userId":"u1","ok":true}');
    expect(r).not.toBeNull();
    expect((r!.value as any).userId).toBe("u1");
  });
  it("extracts a JSON array, skipping an earlier non-JSON [bracket]", () => {
    expect(extractJson("[Svc] tags [1,2,3]")!.value).toEqual([1, 2, 3]);
  });
  it("returns null when there is no parseable JSON", () => {
    expect(extractJson("plain line, no json")).toBeNull();
    expect(extractJson("ratio {incomplete")).toBeNull();
    expect(extractJson("WARN [x] nothing")).toBeNull();
  });
  it("decodes raw + escaped JSON (incl. Windows paths) from examples/structured.log", () => {
    const lines = readFileSync("examples/structured.log", "utf8").split("\n").filter(Boolean);
    const decoded = lines.map((l) => extractJson(l));
    expect(decoded.every((d) => d !== null)).toBe(true); // every line carries JSON
    const win = decoded.find((d) => d && typeof (d!.value as any).path === "string");
    expect((win!.value as any).path).toBe("C:\\ProgramData\\App\\config.json");
    const order = decoded.find((d) => d && (d!.value as any).order_id);
    expect((order!.value as any).total).toBe(149.99);
  });
});
