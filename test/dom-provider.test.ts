import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DomSearchProvider } from "../src/search/dom-provider";

describe("DomSearchProvider", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
    root.innerHTML = `<p>Foo bar foo</p><pre>FOO\nbaz</pre>`;
    document.body.appendChild(root);
  });
  afterEach(() => root.remove());

  it("finds case-insensitive matches in document order", () => {
    const p = new DomSearchProvider(root);
    const matches = p.find({ text: "foo", caseSensitive: false, regex: false });
    expect(matches.length).toBe(3); // Foo, foo, FOO
    expect(root.querySelectorAll("mark.search-hit").length).toBe(3);
  });

  it("respects case sensitivity", () => {
    const p = new DomSearchProvider(root);
    expect(p.find({ text: "FOO", caseSensitive: true, regex: false }).length).toBe(1);
  });

  it("supports regex", () => {
    const p = new DomSearchProvider(root);
    expect(p.find({ text: "ba[rz]", caseSensitive: false, regex: true }).length).toBe(2);
  });

  it("reveal marks the current hit and clear removes all marks", () => {
    const p = new DomSearchProvider(root);
    p.find({ text: "foo", caseSensitive: false, regex: false });
    p.reveal(1);
    expect(root.querySelectorAll("mark.search-current").length).toBe(1);
    p.clear();
    expect(root.querySelectorAll("mark").length).toBe(0);
    expect(root.textContent).toBe("Foo bar fooFOO\nbaz");
  });
});
