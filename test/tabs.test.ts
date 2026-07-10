import { describe, it, expect, beforeEach, vi } from "vitest";
import { TabManager } from "../src/tabs";
import { basename } from "../src/format";
import { DEFAULT_SETTINGS } from "../src/types";

function makeManager(
  onSave?: (path: string, content: string) => Promise<string | null | void>,
  onSaveAs?: (path: string, content: string) => Promise<string | null | void>,
) {
  const tabbar = document.createElement("nav");
  const content = document.createElement("main");
  document.body.append(tabbar, content);
  const closed: string[] = [];
  let closedAll = 0;
  const mgr = new TabManager(tabbar, content, DEFAULT_SETTINGS, {
    onChange: () => {},
    onTabClosed: (p) => closed.push(p),
    onCloseAll: () => closedAll++,
    onSave,
    onSaveAs,
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

  it("opens documents into tabs and tracks the active one", async () => {
    const { mgr, tabbar } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    await mgr.openOrActivate("/d/b.md", "# B");
    expect(mgr.count()).toBe(2);
    expect(mgr.getActivePath()).toBe("/d/b.md");
    expect(tabbar.querySelectorAll(".tab").length).toBe(2);
    expect(mgr.getActiveDisplayedHtml()).toMatch(/<h1[\s\S]*B/);
  });

  it("re-activates an already-open file instead of duplicating", async () => {
    const { mgr } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    await mgr.openOrActivate("/d/b.md", "# B");
    await mgr.openOrActivate("/d/a.md", "# A2");
    expect(mgr.count()).toBe(2);
    expect(mgr.getActivePath()).toBe("/d/a.md");
    expect(mgr.getActiveRawText()).toBe("# A2");
  });

  it("snapshots and restores serializable tab state", async () => {
    const { mgr, content } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    content.scrollTop = 37;
    const snapshot = mgr.snapshotSession();
    expect(snapshot.activePath).toBe("/d/a.md");
    expect(snapshot.tabs[0].scrollTop).toBe(37);

    await mgr.restoreSessionTab({
      path: "/d/a.md",
      forcedFormat: "text",
      mode: "raw",
      scrollTop: 19,
    });
    expect(mgr.getActiveMode()).toBe("raw");
    expect(content.scrollTop).toBe(19);
  });

  it("toggles between rendered and raw for the active tab", async () => {
    const { mgr, content } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    expect(content.querySelector(".doc")).not.toBeNull();
    await mgr.toggleMode();
    expect(content.querySelector("pre.raw")?.textContent).toBe("# A");
    await mgr.toggleMode();
    expect(content.querySelector(".doc")).not.toBeNull();
  });

  it("updates content only for an open path", () => {
    const { mgr } = makeManager();
    mgr.openOrActivate("/d/a.md", "# A");
    mgr.updateContent("/d/a.md", "# changed");
    expect(mgr.getActiveRawText()).toBe("# changed");
    mgr.updateContent("/d/not-open.md", "x");
    expect(mgr.getActiveRawText()).toBe("# changed");
  });

  it("closes a tab and notifies, then closes all", async () => {
    const { mgr, closed, closedAll } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    await mgr.openOrActivate("/d/b.md", "# B");
    mgr.closeTab(1);
    expect(mgr.count()).toBe(1);
    expect(closed).toEqual(["/d/b.md"]);
    expect(mgr.getActivePath()).toBe("/d/a.md");
    mgr.closeAll();
    expect(mgr.count()).toBe(0);
    expect(closedAll()).toBe(1);
    expect(mgr.getActivePath()).toBeUndefined();
  });

  it("closeActiveTab closes the active tab", async () => {
    const { mgr } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    await mgr.openOrActivate("/d/b.md", "# B");
    mgr.closeActiveTab();
    expect(mgr.count()).toBe(1);
    expect(mgr.getActivePath()).toBe("/d/a.md");
  });

  it("middle-click on a tab closes it", async () => {
    const { mgr, tabbar } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    await mgr.openOrActivate("/d/b.md", "# B");
    const tabs = tabbar.querySelectorAll(".tab");
    tabs[0].dispatchEvent(new MouseEvent("auxclick", { button: 1 }));
    expect(mgr.count()).toBe(1);
    expect(mgr.getActivePath()).toBe("/d/b.md");
  });

  it("replaceActive swaps the active document in place", async () => {
    const { mgr } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    await mgr.replaceActive("/d/c.md", "# C");
    expect(mgr.count()).toBe(1);
    expect(mgr.getActivePath()).toBe("/d/c.md");
    expect(mgr.getActiveDisplayedHtml()).toMatch(/<h1[\s\S]*C/);
  });

  it("does not close a dirty tab when discard is cancelled", async () => {
    const { mgr, content } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    mgr.toggleEdit();
    const textarea = content.querySelector(".split-textarea") as HTMLTextAreaElement;
    textarea.value = "# changed";
    textarea.dispatchEvent(new Event("input"));
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    mgr.closeActiveTab();

    expect(mgr.count()).toBe(1);
    expect(mgr.hasDirtyTabs()).toBe(true);
  });

  it("keeps a tab dirty when saving fails", async () => {
    const { mgr, content } = makeManager(async () => {
      throw new Error("disk full");
    });
    await mgr.openOrActivate("/d/a.md", "# A");
    mgr.toggleEdit();
    const textarea = content.querySelector(".split-textarea") as HTMLTextAreaElement;
    textarea.value = "# changed";
    textarea.dispatchEvent(new Event("input"));

    await expect(mgr.saveActive()).rejects.toThrow("disk full");
    expect(mgr.hasDirtyTabs()).toBe(true);
  });

  it("merges a saved scratch document into an already-open destination tab", async () => {
    const { mgr, closed } = makeManager(async () => "/d/a.md");
    await mgr.openOrActivate("/d/a.md", "# Existing");
    await mgr.openScratchMarkdown("# Pasted");

    await expect(mgr.saveActive()).resolves.toBe(true);

    expect(mgr.count()).toBe(1);
    expect(mgr.getActivePath()).toBe("/d/a.md");
    expect(mgr.getActiveRawText()).toBe("# Pasted");
    expect(mgr.hasDirtyTabs()).toBe(false);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatch(/^<scratch:/);
  });

  it("saves the active rendered tab to a chosen path", async () => {
    const saved: Array<[string, string]> = [];
    const { mgr } = makeManager(undefined, async (path, content) => {
      saved.push([path, content]);
      return "/d/copy.md";
    });
    await mgr.openOrActivate("/d/a.md", "# A");

    await expect(mgr.saveActiveAs()).resolves.toBe(true);

    expect(saved).toEqual([["/d/a.md", "# A"]]);
    expect(mgr.getActivePath()).toBe("/d/copy.md");
    expect(mgr.getActiveRawText()).toBe("# A");
  });

  it("snapshots dirty scratch draft content from the live editor", async () => {
    const { mgr, content } = makeManager();
    await mgr.openScratchMarkdown("# Original");
    const textarea = content.querySelector(".split-textarea") as HTMLTextAreaElement;
    textarea.value = "# Edited";
    textarea.dispatchEvent(new Event("input"));

    const snapshot = mgr.snapshotSession();

    expect(snapshot.activePath).toMatch(/^<scratch:/);
    expect(snapshot.tabs[0]).toMatchObject({
      title: "Pasted.md",
      content: "# Edited",
      format: "markdown",
      mode: "edit",
      editDirty: true,
    });
  });

  it("opens typed scratch drafts with matching title and render format", async () => {
    const { mgr } = makeManager();
    await mgr.openScratch("error one\nwarn two\ninfo three", {
      format: "log",
      extension: "log",
      title: "Pasted.log",
    });

    expect(mgr.getActivePath()).toMatch(/\.log>$/);
    expect(mgr.getActiveFormat()).toBe("log");
    expect(mgr.snapshotSession().tabs[0]).toMatchObject({
      title: "Pasted.log",
      format: "log",
      content: "error one\nwarn two\ninfo three",
    });
  });

  it("restores scratch draft tabs from a session snapshot", async () => {
    const { mgr, content } = makeManager();
    await mgr.restoreSessionTab({
      path: "<scratch:restored.md>",
      title: "Pasted.md",
      content: "# Restored",
      format: "markdown",
      mode: "edit",
      scrollTop: 0,
      editDirty: true,
    });

    expect(mgr.count()).toBe(1);
    expect(mgr.getActivePath()).toBe("<scratch:restored.md>");
    expect(content.querySelector<HTMLTextAreaElement>(".split-textarea")?.value).toBe("# Restored");
    expect(mgr.hasDirtyTabs()).toBe(true);
  });

  it("preserves structured comments when editing through the preview tree", async () => {
    const saved: string[] = [];
    const { mgr, content } = makeManager(async (_path, text) => { saved.push(text); });
    await mgr.openOrActivate("/d/config.yaml", "# config\nenabled: true # rollout\n");
    mgr.toggleEdit();

    await vi.waitFor(() => expect(content.querySelector(".data-comments")).toBeTruthy());
    const row = content.querySelector<HTMLElement>('[data-path="root.enabled"]')!;
    row.click();
    const input = row.querySelector<HTMLInputElement>(".tree-edit-input")!;
    input.value = "false";
    input.dispatchEvent(new FocusEvent("blur"));

    await expect(mgr.saveActive()).resolves.toBe(true);
    expect(saved[0]).toContain("# config");
    expect(saved[0]).toContain("enabled: false # rollout");
    expect(saved[0]).toContain("enabled: false");
  });

  it("preserves an inactive dirty draft when the file changes on disk", async () => {
    const { mgr, content } = makeManager();
    await mgr.openOrActivate("/d/a.md", "# A");
    mgr.toggleEdit();
    const textarea = content.querySelector(".split-textarea") as HTMLTextAreaElement;
    textarea.value = "# draft";
    textarea.dispatchEvent(new Event("input"));

    await mgr.openOrActivate("/d/b.md", "# B");
    mgr.updateContent("/d/a.md", "# changed on disk");
    await mgr.activate(0);

    expect(mgr.getActiveRawText()).toBe("# draft");
    expect(content.querySelector<HTMLElement>(".edit-conflict")?.hidden).toBe(false);
  });

  it("shows a diff for file-changed-on-disk conflicts", async () => {
    const { mgr, content } = makeManager();
    await mgr.openOrActivate("/d/a.md", "one\ntwo\n");
    mgr.toggleEdit();
    const textarea = content.querySelector(".split-textarea") as HTMLTextAreaElement;
    textarea.value = "one\nmine\n";
    textarea.dispatchEvent(new Event("input"));

    mgr.updateContent("/d/a.md", "one\ndisk\n");
    content.querySelector<HTMLButtonElement>(".conflict-diff")!.click();

    const diff = content.querySelector<HTMLElement>(".conflict-diff-view")!;
    expect(diff.hidden).toBe(false);
    expect(diff.textContent).toContain("- disk");
    expect(diff.textContent).toContain("+ mine");
  });
});
