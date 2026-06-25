import { describe, it, expect, beforeEach } from "vitest";
import { TabManager, STDIN_PATH } from "../src/tabs";
import { DEFAULT_SETTINGS } from "../src/types";

function mk() {
  const tabbar = document.createElement("nav");
  const content = document.createElement("main");
  document.body.append(tabbar, content);
  const mgr = new TabManager(tabbar, content, DEFAULT_SETTINGS, {
    onChange: () => {}, onTabClosed: () => {}, onCloseAll: () => {},
  });
  return { mgr, content };
}

describe("TabManager stdin tab", () => {
  beforeEach(() => document.body.replaceChildren());

  it("opens a single <stdin> log tab in follow mode and appends lines", () => {
    const { mgr } = mk();
    mgr.openStdin();
    mgr.appendStdin(["INFO a", "ERROR b"]);
    mgr.appendStdin(["WARN c"]);
    expect(mgr.count()).toBe(1);
    expect(mgr.getActivePath()).toBe(STDIN_PATH);
    expect(mgr.getActiveFormat()).toBe("log");
    expect(mgr.isFollowing()).toBe(true);
    expect(mgr.getActiveRawText().split("\n")).toEqual(["INFO a", "ERROR b", "WARN c"]);
  });

  it("reuses the same stdin tab across appends (no duplicates)", () => {
    const { mgr } = mk();
    mgr.appendStdin(["one"]); // appendStdin opens the tab if absent
    mgr.appendStdin(["two"]);
    expect(mgr.count()).toBe(1);
  });

  it("ring-caps the stdin buffer to the most recent lines", () => {
    const { mgr } = mk();
    const many = Array.from({ length: 10_050 }, (_, i) => `line ${i}`);
    mgr.appendStdin(many);
    const lines = mgr.getActiveRawText().split("\n");
    expect(lines.length).toBe(10_000);
    expect(lines[lines.length - 1]).toBe("line 10049"); // newest kept
    expect(lines[0]).toBe("line 50"); // oldest dropped
  });
});
