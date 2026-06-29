import { StyleSettings, DEFAULT_SETTINGS } from "./types";

const KEY = "mdv.settings";

const THEMES = new Set<StyleSettings["theme"]>(["system", "light", "sepia", "dark"]);
const FONTS = new Set<StyleSettings["fontFamily"]>(["sans", "serif", "mono"]);

/** Coerce one parsed (untrusted) object into a valid StyleSettings, falling back
 *  to the default for any field that is missing or out of range. Stored values
 *  are localStorage-only, but a corrupt-but-parseable blob (wrong enum, NaN
 *  size) would otherwise flow straight into CSS vars and break the view. */
function sanitize(raw: unknown): StyleSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  return {
    fontFamily: FONTS.has(o.fontFamily as StyleSettings["fontFamily"])
      ? (o.fontFamily as StyleSettings["fontFamily"]) : DEFAULT_SETTINGS.fontFamily,
    theme: THEMES.has(o.theme as StyleSettings["theme"])
      ? (o.theme as StyleSettings["theme"]) : DEFAULT_SETTINGS.theme,
    fontSizePx: num(o.fontSizePx, 10, 32, DEFAULT_SETTINGS.fontSizePx),
    maxWidthCh: num(o.maxWidthCh, 40, 160, DEFAULT_SETTINGS.maxWidthCh),
  };
}

export function loadSettings(): StyleSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: StyleSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
