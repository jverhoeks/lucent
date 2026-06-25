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
});
