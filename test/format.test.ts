import { describe, it, expect } from "vitest";
import { detectFormat, dataLangOf } from "../src/format";

describe("detectFormat", () => {
  it("maps markdown extensions", () => {
    expect(detectFormat("/a/b.md")).toBe("markdown");
    expect(detectFormat("README.MARKDOWN")).toBe("markdown");
  });
  it("maps data extensions (reserved for P2)", () => {
    for (const p of ["x.json", "x.yaml", "x.yml", "x.toml", "x.ini"]) {
      expect(detectFormat(p)).toBe("data");
    }
  });
  it("maps .log to log (reserved for P3)", () => {
    expect(detectFormat("app.log")).toBe("log");
  });
  it("falls back to text", () => {
    expect(detectFormat("notes.txt")).toBe("text");
    expect(detectFormat("Makefile")).toBe("text");
  });
  it("reports data language", () => {
    expect(dataLangOf("x.yml")).toBe("yaml");
    expect(dataLangOf("x.json")).toBe("json");
    expect(dataLangOf("x.md")).toBeNull();
  });
});
