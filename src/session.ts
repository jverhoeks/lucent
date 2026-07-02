import type { DataLang, Format } from "./types";

const KEY = "lucent.session.v1";
const FORMATS = new Set<Format>(["markdown", "text", "data", "log"]);
const LANGS = new Set<DataLang>(["json", "yaml", "toml", "ini"]);

export interface SessionTab {
  path: string;
  forcedFormat?: Format;
  forcedLang?: DataLang;
  mode: "rendered" | "raw";
  scrollTop: number;
  follow?: boolean;
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
      seen.add(tab.path);
      tabs.push({
        path: tab.path,
        forcedFormat: FORMATS.has(tab.forcedFormat as Format) ? tab.forcedFormat as Format : undefined,
        forcedLang: LANGS.has(tab.forcedLang as DataLang) ? tab.forcedLang as DataLang : undefined,
        mode: tab.mode === "raw" ? "raw" : "rendered",
        scrollTop: typeof tab.scrollTop === "number" && Number.isFinite(tab.scrollTop)
          ? Math.max(0, tab.scrollTop) : 0,
        follow: typeof tab.follow === "boolean" ? tab.follow : undefined,
      });
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
