import type { DataLang, Format, Mode } from "./types";

const KEY = "lucent.session.v1";
const SCRATCH_PATH_PREFIX = "<scratch:";
const FORMATS = new Set<Format>(["markdown", "text", "data", "log"]);
const LANGS = new Set<DataLang>(["json", "yaml", "toml", "ini"]);
const MAX_SESSION_BYTES = 4 * 1024 * 1024;

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
  /** Disk contents the draft was based on, used to detect restart conflicts. */
  originalContent?: string;
  sourceMissing?: boolean;
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
      const recoverableDraft = tab.editDirty === true
        && typeof tab.content === "string"
        && (scratch || typeof tab.originalContent === "string" || tab.sourceMissing === true);
      const mode = tab.mode === "raw" ? "raw" : tab.mode === "edit" && recoverableDraft ? "edit" : "rendered";
      seen.add(tab.path);
      const restored: SessionTab = {
        path: tab.path,
        mode,
        scrollTop: typeof tab.scrollTop === "number" && Number.isFinite(tab.scrollTop)
          ? Math.max(0, tab.scrollTop) : 0,
      };
      if (scratch && typeof tab.title === "string" && tab.title) restored.title = tab.title;
      if (recoverableDraft) restored.content = tab.content as string;
      if (recoverableDraft && FORMATS.has(tab.format as Format)) restored.format = tab.format as Format;
      if (FORMATS.has(tab.forcedFormat as Format)) restored.forcedFormat = tab.forcedFormat as Format;
      if (LANGS.has(tab.forcedLang as DataLang)) restored.forcedLang = tab.forcedLang as DataLang;
      if (typeof tab.follow === "boolean") restored.follow = tab.follow;
      if (recoverableDraft) restored.editDirty = true;
      if (!scratch && recoverableDraft) restored.originalContent = tab.originalContent as string;
      if (!scratch && recoverableDraft && tab.sourceMissing === true) restored.sourceMissing = true;
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

export function saveSession(state: SessionState): boolean {
  try {
    const serialized = JSON.stringify(state);
    if (new Blob([serialized]).size > MAX_SESSION_BYTES) return false;
    localStorage.setItem(KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

interface SessionRestorer {
  restoreSessionTab(tab: SessionTab): void | Promise<void>;
  activatePath(path: string): void | Promise<void>;
}

/** Restore drafts without writing them back to disk. Existing paths are read
 * first so TabManager can present its normal conflict or missing-source UI. */
export async function restoreSessionTabs(
  manager: SessionRestorer,
  openExisting: (path: string) => Promise<void>,
): Promise<void> {
  const session = loadSession();
  for (const tab of session.tabs) {
    if (tab.path.startsWith(SCRATCH_PATH_PREFIX)) {
      await manager.restoreSessionTab(tab);
    } else {
      await openExisting(tab.path);
      await manager.restoreSessionTab(tab);
    }
  }
  if (session.activePath) await manager.activatePath(session.activePath);
}
