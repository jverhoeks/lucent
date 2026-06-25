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
