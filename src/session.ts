import type { DataLang, Format, Mode } from "./types";

const KEY = "lucent.session.v1";
const SCRATCH_PATH_PREFIX = "<scratch:";
const FORMATS = new Set<Format>(["markdown", "text", "data", "log"]);
const LANGS = new Set<DataLang>(["json", "yaml", "toml", "ini"]);

export interface SessionTab {
  path: string;
  title?: string;
  content?: string;
  format?: Format;
  forcedFormat?: Format;
  forcedLang?: DataLang;
  mode: Mode;
  scrollTop: number;
  follow?: boolean;
  editDirty?: boolean;
}

export interface SessionState {
  version: 1;
  tabs: SessionTab[];
  activePath?: string;
}

export function loadSession(): SessionState {
  const empty: SessionState = { version: 1, tabs: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, unknown> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tabs)) return empty;
    const seen = new Set<string>();
    const tabs: SessionTab[] = [];
    for (const value of parsed.tabs) {
      if (!value || typeof value !== "object") continue;
      const tab = value as Record<string, unknown>;
      if (typeof tab.path !== "string" || tab.path === "" || seen.has(tab.path)) continue;
      const scratch = tab.path.startsWith(SCRATCH_PATH_PREFIX);
      const mode = tab.mode === "raw" ? "raw" : tab.mode === "edit" && scratch ? "edit" : "rendered";
      seen.add(tab.path);
      const restored: SessionTab = {
        path: tab.path,
        mode,
        scrollTop: typeof tab.scrollTop === "number" && Number.isFinite(tab.scrollTop)
          ? Math.max(0, tab.scrollTop) : 0,
      };
      if (scratch && typeof tab.title === "string" && tab.title) restored.title = tab.title;
      if (scratch && typeof tab.content === "string") restored.content = tab.content;
      if (scratch && FORMATS.has(tab.format as Format)) restored.format = tab.format as Format;
      if (FORMATS.has(tab.forcedFormat as Format)) restored.forcedFormat = tab.forcedFormat as Format;
      if (LANGS.has(tab.forcedLang as DataLang)) restored.forcedLang = tab.forcedLang as DataLang;
      if (typeof tab.follow === "boolean") restored.follow = tab.follow;
      if (scratch && typeof tab.editDirty === "boolean") restored.editDirty = tab.editDirty;
      tabs.push(restored);
    }
    return {
      version: 1,
      tabs,
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : undefined,
    };
  } catch {
    return empty;
  }
}

export function saveSession(state: SessionState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}
