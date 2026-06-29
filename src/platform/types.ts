import type { FilePayload } from "../types";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  multiple?: boolean;
  filters?: FileFilter[];
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: FileFilter[];
}

export interface DropEvent {
  type: "enter" | "over" | "leave" | "drop";
  paths: string[];
}

export type FileChangedCallback = (path: string, content: string) => void;
export type FileRemovedCallback = (path: string) => void;
export type DropCallback = (event: DropEvent) => void;

export interface PlatformAdapter {
  readFile(path: string): Promise<FilePayload>;
  saveTextFile(path: string, contents: string): Promise<void>;
  fileSize(path: string): Promise<number>;
  listSiblingViewable(path: string): Promise<string[]>;
  listViewableRecursive(path: string): Promise<string[]>;
  probeIsText(path: string, maxBytes: number): Promise<boolean>;
  resolveSibling(base: string, rel: string): Promise<string>;
  writeTempFile(filename: string, contents: string): Promise<string>;
  openDialog(options?: OpenDialogOptions): Promise<string | string[] | null>;
  saveDialog(options?: SaveDialogOptions): Promise<string | null>;
  watchFile(path: string): Promise<void>;
  unwatchFile(path: string): Promise<void>;
  unwatchAll(): Promise<void>;
  openUrl(url: string): Promise<void>;
  onFileChanged(cb: FileChangedCallback): void;
  onFileRemoved(cb: FileRemovedCallback): void;
  onDrop(cb: DropCallback): void;
  getStartupFiles(): Promise<string[]>;
  exportPdf(html: string): Promise<void>;

  /** Unique platform name for diagnostics. */
  platform: "tauri" | "web";
}
