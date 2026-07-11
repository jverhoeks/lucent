import { describe, it, expect } from "vitest";
import {
  HELP_MARKDOWN,
  HELP_TAB_PATH,
  HELP_TAB_TITLE,
  isHelpPath,
  parseExampleLink,
} from "../src/help";

describe("help", () => {
  it("identifies the help tab path", () => {
    expect(isHelpPath(HELP_TAB_PATH)).toBe(true);
    expect(isHelpPath("<scratch:1>")).toBe(false);
  });

  it("parses example links", () => {
    expect(parseExampleLink("example:01-basics.md")).toBe("01-basics.md");
    expect(parseExampleLink("example:data-sample.json")).toBe("data-sample.json");
    expect(parseExampleLink("example:../secret.md")).toBeNull();
    expect(parseExampleLink("https://example.com")).toBeNull();
  });

  it("bundles non-empty help markdown", () => {
    expect(HELP_MARKDOWN.length).toBeGreaterThan(500);
    expect(HELP_MARKDOWN).toContain("Keyboard shortcuts");
    expect(HELP_MARKDOWN).toContain("example:01-basics.md");
    expect(HELP_TAB_TITLE).toBe("Help");
  });
});