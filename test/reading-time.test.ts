import { describe, it, expect } from "vitest";
import { countWords, readingTimeMinutes, readingTimeLabel } from "../src/reading-time";

describe("countWords", () => {
  it("counts whitespace-delimited words", () => {
    expect(countWords("one two three")).toBe(3);
  });
  it("collapses runs of whitespace and trims", () => {
    expect(countWords("  a\n\nb\t c  ")).toBe(3);
  });
  it("is 0 for empty or whitespace-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });
});

describe("readingTimeMinutes", () => {
  it("is 0 for no words", () => {
    expect(readingTimeMinutes("")).toBe(0);
  });
  it("clamps any non-empty text to at least 1 minute", () => {
    expect(readingTimeMinutes("hello")).toBe(1);
  });
  it("rounds at ~200 wpm", () => {
    expect(readingTimeMinutes(Array(400).fill("w").join(" "))).toBe(2); // 400/200
    expect(readingTimeMinutes(Array(500).fill("w").join(" "))).toBe(3); // 500/200 -> 2.5 -> 3
  });
});

describe("readingTimeLabel", () => {
  it("formats a human label", () => {
    expect(readingTimeLabel(Array(600).fill("w").join(" "))).toBe("3 min read");
  });
  it("is empty for nothing to read", () => {
    expect(readingTimeLabel("")).toBe("");
  });
});
