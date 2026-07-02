import { describe, it, expect } from "vitest";
import { dataRenderer, SIZE_CAP_BYTES } from "../src/renderers/data";

describe("dataRenderer", () => {
  it("renders a tree with expand/collapse controls for valid JSON", () => {
    const c = document.createElement("div");
    dataRenderer.render('{"a":1,"b":[1,2,3]}', c, { theme: "light", dataLang: "json" });
    expect(c.querySelector(".tree")).toBeTruthy();
    expect(c.querySelector(".tree-toolbar")).toBeTruthy();
    expect(c.querySelector(".raw")).toBeNull();
  });

  it("falls back to raw text (not a parse error) above the size cap", () => {
    const c = document.createElement("div");
    // Length over the cap short-circuits before parseData, so the content need
    // not be valid JSON — the cap guards the synchronous parse, not the DOM.
    const huge = "a".repeat(SIZE_CAP_BYTES + 1);
    dataRenderer.render(huge, c, { theme: "light", dataLang: "json" });
    const notice = c.querySelector(".tree-notice");
    expect(notice?.textContent).toContain("too large");
    expect(c.querySelector(".raw")).toBeTruthy();
    expect(c.querySelector(".tree")).toBeNull();
  });

  it("still builds a tree just under the cap", () => {
    const c = document.createElement("div");
    // Pad a valid JSON doc with whitespace to sit just below the cap without a
    // costly large parse (whitespace is cheap for JSON.parse).
    const pad = " ".repeat(SIZE_CAP_BYTES - 100);
    dataRenderer.render(`${pad}{"k":"v"}`, c, { theme: "light", dataLang: "json" });
    expect(c.querySelector(".tree")).toBeTruthy();
    expect(c.querySelector(".tree-notice")).toBeNull();
  });

  it("shows raw text with a clear message for an unrecognised format", () => {
    const c = document.createElement("div");
    dataRenderer.render("some text", c, { theme: "light" });
    expect(c.querySelector(".tree-notice")?.textContent).toContain("Could not detect");
    expect(c.querySelector(".raw")).toBeTruthy();
  });
});
