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

  it("opens a single <stdin> log tab in follow mode from a snapshot", () => {
    const { mgr } = mk();
    // The Rust buffer is cumulative, so each snapshot is the full content.
    mgr.setStdin(["INFO a", "ERROR b"]);
    mgr.setStdin(["INFO a", "ERROR b", "WARN c"]);
    expect(mgr.count()).toBe(1);
    expect(mgr.getActivePath()).toBe(STDIN_PATH);
    expect(mgr.getActiveFormat()).toBe("log");
    expect(mgr.isFollowing()).toBe(true);
    expect(mgr.getActiveRawText().split("\n")).toEqual(["INFO a", "ERROR b", "WARN c"]);
  });

  it("reuses the same stdin tab across snapshots (no duplicates)", () => {
    const { mgr } = mk();
    mgr.setStdin(["one"]); // creates the tab on first non-empty snapshot
    mgr.setStdin(["one", "two"]);
    expect(mgr.count()).toBe(1);
  });

  it("ignores an empty snapshot when no stdin tab exists yet", () => {
    const { mgr } = mk();
    mgr.setStdin([]);
    expect(mgr.count()).toBe(0);
  });
});
