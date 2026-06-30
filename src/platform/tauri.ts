import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { FilePayload } from "../types";
import type {
  PlatformAdapter,
  OpenDialogOptions,
  SaveDialogOptions,
  FileChangedCallback,
  FileRemovedCallback,
  DropCallback,
  DropEvent,
  OpenFilesCallback,
} from "./types";

export const tauriAdapter: PlatformAdapter = {
  platform: "tauri",

  async readFile(path: string): Promise<FilePayload> {
    return invoke<FilePayload>("read_file", { path });
  },

  async saveTextFile(path: string, contents: string): Promise<void> {
    await invoke("save_text_file", { path, contents });
  },

  async fileSize(path: string): Promise<number> {
    return invoke<number>("file_size", { path });
  },

  async listSiblingViewable(path: string): Promise<string[]> {
    return invoke<string[]>("list_sibling_viewable", { path });
  },

  async listViewableRecursive(path: string): Promise<string[]> {
    return invoke<string[]>("list_viewable_recursive", { path });
  },

  async probeIsText(path: string, maxBytes: number): Promise<boolean> {
    return invoke<boolean>("probe_is_text", { path, maxBytes });
  },

  async resolveSibling(base: string, rel: string): Promise<string> {
    return invoke<string>("resolve_sibling", { base, rel });
  },

  async writeTempFile(filename: string, contents: string): Promise<string> {
    return invoke<string>("write_temp_file", { filename, contents });
  },

  async openDialog(options?: OpenDialogOptions): Promise<string | string[] | null> {
    const sel = await open({
      multiple: options?.multiple,
      filters: options?.filters as any,
    });
    if (Array.isArray(sel)) return sel;
    if (typeof sel === "string") return sel;
    return null;
  },

  async saveDialog(options?: SaveDialogOptions): Promise<string | null> {
    return save({
      defaultPath: options?.defaultPath,
      filters: options?.filters as any,
    });
  },

  async watchFile(path: string): Promise<void> {
    await invoke("watch_file", { path });
  },

  async unwatchFile(path: string): Promise<void> {
    await invoke("unwatch_file", { path });
  },

  async unwatchAll(): Promise<void> {
    await invoke("unwatch_all");
  },

  async openUrl(url: string): Promise<void> {
    await openUrl(url);
  },

  onFileChanged(cb: FileChangedCallback): void {
    listen<FilePayload>("file-changed", (e) => {
      cb(e.payload.path, e.payload.content);
    });
  },

  onFileRemoved(cb: FileRemovedCallback): void {
    listen<{ path: string }>("file-removed", (e) => {
      cb(e.payload.path);
    });
  },

  onDrop(cb: DropCallback): void {
    getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      cb({
        type: p.type as DropEvent["type"],
        paths: (p as any).paths ?? [],
      });
    });
  },

  async onOpenFiles(cb: OpenFilesCallback): Promise<void> {
    await listen<string[]>("open-files", (e) => {
      cb(e.payload);
    });
  },

  async getStartupFiles(): Promise<string[]> {
    return invoke<string[]>("get_startup_files");
  },

  async exportPdf(_html: string): Promise<void> {
    await invoke("export_pdf_native");
  },
};
