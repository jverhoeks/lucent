import { StyleSettings, DEFAULT_SETTINGS } from "./types";

const KEY = "mdv.settings";

export function loadSettings(): StyleSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: StyleSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
