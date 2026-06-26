import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings } from "../src/settings";
import { DEFAULT_SETTINGS } from "../src/types";

describe("settings", () => {
  beforeEach(() => localStorage.clear());

  it("returns defaults when nothing stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("round-trips saved settings", () => {
    const s = { ...DEFAULT_SETTINGS, theme: "dark" as const, fontSizePx: 20 };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });
  it("falls back to defaults on corrupt storage", () => {
    localStorage.setItem("mdv.settings", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("rejects out-of-shape values per field (parseable but invalid)", () => {
    localStorage.setItem(
      "mdv.settings",
      JSON.stringify({ theme: "neon", fontFamily: "comic", fontSizePx: "big", maxWidthCh: NaN }),
    );
    // Every invalid field falls back to its default rather than flowing through.
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("clamps an out-of-range numeric size", () => {
    localStorage.setItem("mdv.settings", JSON.stringify({ fontSizePx: 9999 }));
    expect(loadSettings().fontSizePx).toBe(32); // clamped to the max
  });
  it("keeps valid fields and defaults the rest", () => {
    localStorage.setItem("mdv.settings", JSON.stringify({ theme: "dark", bogus: 1 }));
    const s = loadSettings();
    expect(s.theme).toBe("dark");
    expect(s.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
  });
});
