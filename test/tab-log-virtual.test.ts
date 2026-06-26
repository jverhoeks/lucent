import { describe, it, expect, beforeEach } from "vitest";
import { TabManager, LOG_VIRTUALIZE_LINES } from "../src/tabs";
import { DEFAULT_SETTINGS } from "../src/types";

const hooks = { onChange() {}, onTabClosed() {}, onCloseAll() {} };

function mk() {
  const tabbar = document.createElement("div");
  const content = document.createElement("div");
  document.body.append(tabbar, content);
  const tm = new TabManager(tabbar, content, DEFAULT_SETTINGS, hooks);
  return { tm, content };
}

const bigLog = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

describe("TabManager log virtualization threshold", () => {
  beforeEach(() => document.body.replaceChildren());

  it("renders a small log via the full-DOM LogView", () => {
    const { tm, content } = mk();
    tm.openOrActivate("/small.log", "INFO one\nERROR two\nWARN three");
    expect(content.querySelector(".log")).toBeTruthy();      // LogView wrap
    expect(content.classList.contains("vlog")).toBe(false);  // not virtualized
    expect(tm.getActiveVirtualLogView()).toBeNull();
    expect(tm.getActiveLogLines()).toBeNull();
  });

  it("virtualizes a log above the line threshold", () => {
    const { tm, content } = mk();
    tm.openOrActivate("/big.log", bigLog(LOG_VIRTUALIZE_LINES + 1));
    expect(content.classList.contains("vlog")).toBe(true);   // VirtualLogView scaffolding
    expect(tm.getActiveVirtualLogView()).toBeTruthy();
    expect(tm.getActiveLogLines()?.length).toBe(LOG_VIRTUALIZE_LINES + 1);
  });

  it("drops the .vlog class and virtual state when switching back to a small log", () => {
    const { tm, content } = mk();
    tm.openOrActivate("/big.log", bigLog(LOG_VIRTUALIZE_LINES + 1));
    tm.openOrActivate("/small.log", "just one line of log");
    expect(content.classList.contains("vlog")).toBe(false); // class cleaned up
    expect(tm.getActiveVirtualLogView()).toBeNull();
    expect(tm.getActiveLogLines()).toBeNull();
    expect(content.querySelector(".log")).toBeTruthy();
  });
});
