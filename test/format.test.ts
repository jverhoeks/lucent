import { describe, it, expect } from "vitest";
import { detectFormat, dataLangOf, basename, siblingIndex } from "../src/format";

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

describe("basename", () => {
  it("returns the final segment for unix and windows paths", () => {
    expect(basename("/a/b/c.md")).toBe("c.md");
    expect(basename("C:\\docs\\d.md")).toBe("d.md");
    expect(basename("plain.md")).toBe("plain.md");
  });
});

describe("siblingIndex", () => {
  const sibs = ["/docs/a.md", "/docs/b.json", "/docs/c.log"];

  it("finds an exact path match", () => {
    expect(siblingIndex(sibs, "/docs/b.json")).toBe(1);
  });
  it("falls back to basename when the path is non-canonical", () => {
    // e.g. drag-and-drop yields /private/var/... vs canonical /var/...
    expect(siblingIndex(sibs, "/symlinked/docs/c.log")).toBe(2);
  });
  it("returns -1 when no sibling matches", () => {
    expect(siblingIndex(sibs, "/docs/missing.txt")).toBe(-1);
  });
});
