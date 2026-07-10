import { describe, it, expect } from "vitest";
import { guessPasteScratch } from "../src/paste-guess";

describe("guessPasteScratch", () => {
  it("keeps markdown with headings instead of misclassifying yaml keys", () => {
    const text = "# Notes\n\nversion: 2\n";
    expect(guessPasteScratch(text).format).toBe("markdown");
  });

  it("does not treat vitest output as a log file", () => {
    const text = [
      " RUN  v4.1.9 /project",
      " ✓ test/example.test.ts (2 tests) 12ms",
      " Test Files  1 passed (1)",
    ].join("\n");
    expect(guessPasteScratch(text).format).toBe("text");
  });

  it("detects yaml with multiple key lines", () => {
    const text = "name: lucent\nversion: 2\nenabled: true\n";
    expect(guessPasteScratch(text)).toMatchObject({
      format: "data",
      extension: "yaml",
      forcedLang: "yaml",
    });
  });

  it("detects json objects and arrays", () => {
    expect(guessPasteScratch('{"a":1}').forcedLang).toBe("json");
    expect(guessPasteScratch("[1,2]").forcedLang).toBe("json");
  });

  it("detects structured logs with timestamps or level prefixes", () => {
    const text = [
      "2026-07-10T12:00:00 INFO started",
      "2026-07-10T12:00:01 WARN slow",
      "2026-07-10T12:00:02 ERROR failed",
    ].join("\n");
    expect(guessPasteScratch(text).format).toBe("log");
  });

  it("falls back to plain text for a single arbitrary line", () => {
    expect(guessPasteScratch("hello world").format).toBe("text");
  });
});