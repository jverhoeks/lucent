import { describe, it, expect } from "vitest";
import { searchLogLines } from "../src/logs/log-search";

const lines = ["INFO start", "WARN disk low", "ERROR boom", "info again", "DEBUG x42"];

describe("searchLogLines (in-memory log scan)", () => {
  it("returns 0-based line numbers of matches, in order", () => {
    expect(searchLogLines(lines, { text: "o", caseSensitive: false, regex: false }))
      .toEqual([0, 1, 2, 3]); // start, disk low, boom, info again — all contain 'o'
  });
  it("is case-insensitive by default, case-sensitive when asked", () => {
    expect(searchLogLines(lines, { text: "info", caseSensitive: false, regex: false })).toEqual([0, 3]);
    expect(searchLogLines(lines, { text: "info", caseSensitive: true, regex: false })).toEqual([3]);
  });
  it("supports regex", () => {
    expect(searchLogLines(lines, { text: "x\\d+", caseSensitive: false, regex: true })).toEqual([4]);
  });
  it("returns [] for empty query", () => {
    expect(searchLogLines(lines, { text: "", caseSensitive: false, regex: false })).toEqual([]);
  });
});
