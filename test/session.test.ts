import { beforeEach, describe, expect, it } from "vitest";
import { loadSession, saveSession } from "../src/session";

describe("session persistence", () => {
  beforeEach(() => localStorage.clear());

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
});
