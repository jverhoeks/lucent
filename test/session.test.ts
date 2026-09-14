import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSession, restoreSessionTabs, saveSession } from "../src/session";

describe("session persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("round-trips tab order, active path, view override, and scroll", () => {
    saveSession({
      version: 1,
      activePath: "/docs/b.json",
      tabs: [
        { path: "/docs/a.md", mode: "rendered", scrollTop: 42 },
        { path: "/docs/b.json", forcedFormat: "data", forcedLang: "json", mode: "raw", scrollTop: 9 },
      ],
    });
    expect(loadSession()).toEqual({
      version: 1,
      activePath: "/docs/b.json",
      tabs: [
        { path: "/docs/a.md", mode: "rendered", scrollTop: 42 },
        { path: "/docs/b.json", forcedFormat: "data", forcedLang: "json", mode: "raw", scrollTop: 9 },
      ],
    });
  });

  it("sanitizes corrupt and duplicate records", () => {
    localStorage.setItem("lucent.session.v1", JSON.stringify({
      version: 1,
      tabs: [
        { path: "/a.md", mode: "edit", scrollTop: -10, forcedFormat: "bogus" },
        { path: "/a.md", mode: "raw", scrollTop: 5 },
        { nope: true },
      ],
    }));
    expect(loadSession().tabs).toEqual([
      { path: "/a.md", mode: "rendered", scrollTop: 0 },
    ]);
  });

  it("round-trips scratch draft content", () => {
    saveSession({
      version: 1,
      activePath: "<scratch:1.md>",
      tabs: [
        {
          path: "<scratch:1.md>",
          title: "Pasted.md",
          content: "# Draft",
          format: "markdown",
          mode: "edit",
          scrollTop: 12,
          editDirty: true,
        },
      ],
    });
    expect(loadSession()).toEqual({
      version: 1,
      activePath: "<scratch:1.md>",
      tabs: [
        {
          path: "<scratch:1.md>",
          title: "Pasted.md",
          content: "# Draft",
          format: "markdown",
          mode: "edit",
          scrollTop: 12,
          editDirty: true,
        },
      ],
    });
  });

  it("round-trips an existing-file draft and its disk base", () => {
    saveSession({
      version: 1,
      activePath: "/docs/note.md",
      tabs: [{
        path: "/docs/note.md",
        content: "# Unsaved",
        originalContent: "# On disk",
        format: "markdown",
        mode: "edit",
        scrollTop: 3,
        editDirty: true,
      }],
    });

    expect(loadSession().tabs[0]).toMatchObject({
      path: "/docs/note.md",
      content: "# Unsaved",
      originalContent: "# On disk",
      mode: "edit",
      editDirty: true,
    });
  });

  it("reports storage failures instead of throwing", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(saveSession({ version: 1, tabs: [] })).toBe(false);
  });

  it("restores disk tabs before drafts and then activates the saved tab", async () => {
    saveSession({
      version: 1,
      activePath: "/docs/note.md",
      tabs: [
        { path: "<scratch:1.md>", title: "Draft.md", content: "draft", format: "markdown", mode: "edit", scrollTop: 0, editDirty: true },
        { path: "/docs/note.md", mode: "rendered", scrollTop: 4 },
      ],
    });
    const calls: string[] = [];
    await restoreSessionTabs({
      restoreSessionTab: (tab) => { calls.push(`restore:${tab.path}`); },
      activatePath: (path) => { calls.push(`activate:${path}`); },
    }, async (path) => { calls.push(`open:${path}`); });
    expect(calls).toEqual([
      "restore:<scratch:1.md>",
      "open:/docs/note.md",
      "restore:/docs/note.md",
      "activate:/docs/note.md",
    ]);
  });
});
