import { describe, it, expect } from "vitest";
import hljs from "../src/highlight";

describe("shared highlight.js instance (lib/common)", () => {
  // The structured-data raw view highlights by these exact language ids. The
  // full→common switch must not drop any of them — `toml` in particular resolves
  // through the `ini` alias, not as a listed language, so it's the easy one to lose.
  it.each(["json", "yaml", "ini", "toml"])("still highlights the data format %s", (lang) => {
    expect(hljs.getLanguage(lang)).toBeTruthy();
    expect(hljs.highlight("a = 1", { language: lang }).value).toBeTypeOf("string");
  });

  it("highlights common code-fence languages", () => {
    for (const lang of ["javascript", "typescript", "python", "bash", "rust", "go"]) {
      expect(hljs.getLanguage(lang)).toBeTruthy();
    }
  });

  it("returns undefined for an unregistered language (graceful escaped fallback)", () => {
    // Callers treat undefined as 'no highlighting' and escape the source instead.
    expect(hljs.getLanguage("a-language-that-does-not-exist")).toBeUndefined();
  });
});
