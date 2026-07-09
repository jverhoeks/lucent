import { describe, expect, it } from "vitest";
import {
  extractStructuredComments,
  prependStructuredComments,
  stripJsonComments,
} from "../src/data/comments";
import { convertStructuredData } from "../src/data/convert";

describe("structured comments", () => {
  it("extracts YAML comments but ignores markers in strings and block scalars", () => {
    const source = [
      "# service settings",
      'url: "https://example.test/#fragment" # public endpoint',
      "script: |",
      "  # this is block content",
      "  echo ok",
      "enabled: true",
    ].join("\n");
    expect(extractStructuredComments(source, "yaml")).toEqual([
      { text: "service settings", line: 1, inline: false },
      { text: "public endpoint", line: 2, inline: true },
    ]);
  });

  it("does not treat YAML # characters inside plain scalar text as comments", () => {
    const source = "url: https://example.test/#fragment\nname: lucent # actual\n";
    expect(extractStructuredComments(source, "yaml")).toEqual([
      { text: "actual", line: 2, inline: true },
    ]);
    expect(() => convertStructuredData("url: https://example.test/#fragment\n", "yaml", "json"))
      .not.toThrow();
  });

  it("extracts TOML and INI comment syntaxes outside quoted values", () => {
    expect(extractStructuredComments('name = "#literal" # actual', "toml"))
      .toEqual([{ text: "actual", line: 1, inline: true }]);
    expect(extractStructuredComments("; heading\nname=value ; detail", "ini")).toEqual([
      { text: "heading", line: 1, inline: false },
      { text: "detail", line: 2, inline: true },
    ]);
  });

  it("extracts JSON line and block comments outside strings", () => {
    const source = [
      "// file heading",
      '{',
      '  "url": "https://example.test//literal", // endpoint',
      '  "enabled": true,',
      "  /*",
      "   * rollout note",
      "   * second line",
      "   */",
      '  "name": "lucent"',
      "}",
    ].join("\n");
    expect(extractStructuredComments(source, "json")).toEqual([
      { text: "file heading", line: 1, inline: false },
      { text: "endpoint", line: 3, inline: true },
      { text: "rollout note second line", line: 5, inline: false },
    ]);
    expect(JSON.parse(stripJsonComments(source))).toMatchObject({
      url: "https://example.test//literal",
      enabled: true,
      name: "lucent",
    });
  });

  it("preserves JSON comments when converting to another format", () => {
    const output = convertStructuredData("// owner\n{\"name\":\"lucent\"}\n", "json", "yaml");
    expect(output).toContain("# [line 1] owner");
    expect(output).toContain("name: lucent");
  });

  it("preserves comments in JSON output with nonstandard // headers", () => {
    const output = convertStructuredData("# owner\nname: lucent\n", "yaml", "json");
    expect(output).toContain("// [line 1] owner");
    expect(output).toContain('"name": "lucent"');
  });

  it("ignores comment markers inside TOML multiline strings", () => {
    const source = 'message = """\n# literal content\nstill text\n""" # actual\n';
    expect(extractStructuredComments(source, "toml"))
      .toEqual([{ text: "actual", line: 4, inline: true }]);
  });

  it("round-trips a preserved comment header without duplicating metadata", () => {
    const comments = [{ text: "why", line: 7, inline: true }];
    const output = prependStructuredComments("enabled = true\n", comments, "toml");
    expect(extractStructuredComments(output, "toml")).toEqual(comments);
  });

  it("only interprets [line N] metadata inside a preserved-comment header", () => {
    const source = "# [line 12] user-authored note\nname: lucent\n";
    expect(extractStructuredComments(source, "yaml")).toEqual([
      { text: "[line 12] user-authored note", line: 1, inline: false },
    ]);
  });

  it("preserves comments across supported conversions", () => {
    const output = convertStructuredData("# owner\nname: lucent\n", "yaml", "toml");
    expect(output).toContain("# [line 1] owner");
    expect(output).toContain('name = "lucent"');
  });

  it("returns the exact source for same-format downloads", () => {
    const source = "# keep placement\nname: lucent # inline\n";
    expect(convertStructuredData(source, "yaml", "yaml")).toBe(source);
  });
});
