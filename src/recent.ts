import { basename } from "./format";

const KEY = "lucent.recent.v1";
const MAX_RECENT = 20;

export interface RecentFile {
  path: string;
  title: string;
  openedAt: number;
}

function validRecent(value: unknown): RecentFile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.path !== "string" || row.path === "") return null;
  return {
    path: row.path,
    title: typeof row.title === "string" && row.title ? row.title : basename(row.path),
    openedAt: typeof row.openedAt === "number" && Number.isFinite(row.openedAt)
      ? row.openedAt
      : 0,
  };
}

export function loadRecentFiles(): RecentFile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const rows: RecentFile[] = [];
    for (const value of parsed) {
      const recent = validRecent(value);
      if (!recent || seen.has(recent.path)) continue;
      seen.add(recent.path);
      rows.push(recent);
    }
    return rows.sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function saveRecentFiles(files: RecentFile[]): void {
  localStorage.setItem(KEY, JSON.stringify(files.slice(0, MAX_RECENT)));
}

export function rememberRecentFile(path: string, now = Date.now()): RecentFile[] {
  const next = [
    { path, title: basename(path), openedAt: now },
    ...loadRecentFiles().filter((file) => file.path !== path),
  ].slice(0, MAX_RECENT);
  saveRecentFiles(next);
  return next;
}
