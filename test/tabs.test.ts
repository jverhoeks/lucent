import { describe, it, expect, beforeEach } from "vitest";
import { TabManager, basename } from "../src/tabs";
import { DEFAULT_SETTINGS } from "../src/types";

function makeManager() {
  const tabbar = document.createElement("nav");
  const content = document.createElement("main");
  document.body.append(tabbar, content);
  const closed: string[] = [];
  let closedAll = 0;
  const mgr = new TabManager(tabbar, content, DEFAULT_SETTINGS, {
    onChange: () => {},
    onTabClosed: (p) => closed.push(p),
    onCloseAll: () => closedAll++,
  });
  return { mgr, tabbar, content, closed, closedAll: () => closedAll };
}

describe("basename", () => {
  it("handles unix and windows separators", () => {
    expect(basename("/a/b/c.md")).toBe("c.md");
    expect(basename("C:\\docs\\note.md")).toBe("note.md");
    expect(basename("plain.md")).toBe("plain.md");
  });
});

describe("TabManager", () => {
  beforeEach(() => document.body.replaceChildren());

  it("opens documents into tabs and tracks the active one", () => {
    const { mgr, tabbar } = makeManager();
    mgr.openOrActivate("/d/a.md", "# A");
    mgr.openOrActivate("/d/b.md", "# B");
    expect(mgr.count()).toBe(2);
    expect(mgr.getActivePath()).toBe("/d/b.md");
    expect(tabbar.querySelectorAll(".tab").length).toBe(2);
    expect(mgr.getActiveRenderedHtml()).toMatch(/<h1[\s\S]*B/);
  });

  it("re-activates an already-open file instead of duplicating", () => {
    const { mgr } = makeManager();
    mgr.openOrActivate("/d/a.md", "# A");
    mgr.openOrActivate("/d/b.md", "# B");
    mgr.openOrActivate("/d/a.md", "# A2");
    expect(mgr.count()).toBe(2);
    expect(mgr.getActivePath()).toBe("/d/a.md");
    expect(mgr.getActiveRawText()).toBe("# A2");
  });

  it("toggles between rendered and raw for the active tab", () => {
    const { mgr, content } = makeManager();
    mgr.openOrActivate("/d/a.md", "# A");
    expect(content.querySelector(".doc")).not.toBeNull();
    mgr.toggleMode();
    expect(content.querySelector("pre.raw")?.textContent).toBe("# A");
    mgr.toggleMode();
    expect(content.querySelector(".doc")).not.toBeNull();
  });

  it("updates content only for an open path", () => {
    const { mgr } = makeManager();
    mgr.openOrActivate("/d/a.md", "# A");
    mgr.updateContent("/d/a.md", "# changed");
    expect(mgr.getActiveRawText()).toBe("# changed");
    mgr.updateContent("/d/not-open.md", "x"); // no throw, no effect
    expect(mgr.getActiveRawText()).toBe("# changed");
  });

  it("closes a tab and notifies, then closes all", () => {
    const { mgr, closed, closedAll } = makeManager();
    mgr.openOrActivate("/d/a.md", "# A");
    mgr.openOrActivate("/d/b.md", "# B");
    mgr.closeTab(1);
    expect(mgr.count()).toBe(1);
    expect(closed).toEqual(["/d/b.md"]);
    expect(mgr.getActivePath()).toBe("/d/a.md");
    mgr.closeAll();
    expect(mgr.count()).toBe(0);
    expect(closedAll()).toBe(1);
    expect(mgr.getActivePath()).toBeUndefined();
  });

  it("replaceActive swaps the active document in place", () => {
    const { mgr } = makeManager();
    mgr.openOrActivate("/d/a.md", "# A");
    mgr.replaceActive("/d/c.md", "# C");
    expect(mgr.count()).toBe(1);
    expect(mgr.getActivePath()).toBe("/d/c.md");
    expect(mgr.getActiveRenderedHtml()).toMatch(/<h1[\s\S]*C/);
  });
});
