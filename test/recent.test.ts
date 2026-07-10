import { beforeEach, describe, expect, it } from "vitest";
import { loadRecentFiles, rememberRecentFile, saveRecentFiles } from "../src/recent";

describe("recent files", () => {
  beforeEach(() => localStorage.clear());

  it("stores most recent files first and deduplicates by path", () => {
    rememberRecentFile("/docs/a.md", 1);
    rememberRecentFile("/docs/b.md", 2);
    rememberRecentFile("/docs/a.md", 3);

    expect(loadRecentFiles().map((file) => file.path)).toEqual([
      "/docs/a.md",
      "/docs/b.md",
    ]);
    expect(loadRecentFiles()[0]).toMatchObject({ title: "a.md", openedAt: 3 });
  });

  it("sanitizes corrupt records", () => {
    saveRecentFiles([
      { path: "/docs/a.md", title: "a.md", openedAt: 2 },
      { path: "", title: "bad", openedAt: 9 },
    ] as any);
    localStorage.setItem("lucent.recent.v1", JSON.stringify([
      { path: "/docs/a.md", openedAt: 2 },
      { nope: true },
    ]));

    expect(loadRecentFiles()).toEqual([
      { path: "/docs/a.md", title: "a.md", openedAt: 2 },
    ]);
  });
});
