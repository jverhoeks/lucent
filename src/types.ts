export interface FilePayload {
  path: string;
  content: string;
}

export type ErrorKind = "not_found" | "unreadable" | "not_utf8" | "io";

export interface AppError {
  kind: ErrorKind;
  message: string;
}

export type Theme = "light" | "sepia" | "dark";
export type FontFamily = "sans" | "serif" | "mono";

export interface StyleSettings {
  fontFamily: FontFamily;
  fontSizePx: number; // 14..22
  theme: Theme;
  maxWidthCh: number; // content width
}

export const DEFAULT_SETTINGS: StyleSettings = {
  fontFamily: "sans",
  fontSizePx: 17,
  theme: "light",
  maxWidthCh: 74,
};

export type Format = "markdown" | "data" | "log" | "text";
export type Mode = "rendered" | "raw";
export type DataLang = "json" | "yaml" | "toml" | "ini";

export interface SearchQuery {
  text: string;
  caseSensitive: boolean;
  regex: boolean;
}

/** A single search hit; `id` is its 0-based position in document order. */
export interface Match {
  id: number;
}

export interface SearchProvider {
  /** Recompute all matches for `query`, in document order. Empty text -> []. */
  find(query: SearchQuery): Match[];
  /** Reveal + emphasize match `id`; de-emphasize all others. */
  reveal(id: number): void;
  /** Remove all highlight decorations. */
  clear(): void;
}

export interface RenderCtx {
  theme: Theme;
  dataLang?: DataLang;
}

export interface Renderer {
  format: Format;
  /** Render `source` into `container` (rendered mode). */
  render(source: string, container: HTMLElement, ctx: RenderCtx, path?: string): void | Promise<void>;
}

export type DataScalarType = "string" | "number" | "boolean" | "null";

/** A parsed structured value: a scalar leaf, or an object/array of child nodes. */
export type DataValue =
  | { kind: "scalar"; type: DataScalarType; text: string }
  | { kind: "object"; entries: DataNode[] }
  | { kind: "array"; items: DataNode[] };

/** One keyed child within an object (key = property) or array (key = index). */
export interface DataNode {
  key: string;
  path: string; // unique, e.g. `root`, `root.a`, `root.a[2].b`
  value: DataValue;
}

export interface DataParseResult {
  ok: boolean;
  value?: DataValue;
  error?: { message: string; line?: number };
}
