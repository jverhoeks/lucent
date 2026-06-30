import type { FilePayload } from "../types";
import type {
  PlatformAdapter,
  FileChangedCallback,
  FileRemovedCallback,
  DropCallback,
  OpenFilesCallback,
  OpenDialogOptions,
  SaveDialogOptions,
} from "./types";

/** In-memory file system for the web version. Keyed by path. */
const fileStore = new Map<string, { content: string; lastModified: number }>();

/** Registered file handles for File System Access API-based writes. */
const fileHandles = new Map<string, FileSystemFileHandle>();

let nextTempId = 1;

function tmpPath(): string {
  return `/tmp/${nextTempId++}`;
}

const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".mdown", ".mkd",
  ".txt", ".text", ".log",
  ".json", ".yaml", ".yml", ".toml", ".ini",
  ".csv", ".tsv", ".xml", ".html", ".htm",
  ".css", ".js", ".ts", ".jsx", ".tsx",
  ".py", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp",
  ".sh", ".bash", ".zsh", ".fish",
  ".env", ".gitignore", ".dockerfile", ".cfg", ".conf",
]);

function isTextPath(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

async function readBlobAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/** Recursively collect files from a dropped FileList (handles directories). */
async function collectFiles(items: DataTransferItem[]): Promise<File[]> {
  const files: File[] = [];
  const queue = [...items];
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.webkitGetAsEntry) {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve) =>
            (entry as FileSystemFileEntry).file(resolve),
          );
          files.push(file);
        } else if (entry.isDirectory) {
          const reader = (entry as FileSystemDirectoryEntry).createReader();
          const entries = await new Promise<FileSystemEntry[]>((resolve) =>
            reader.readEntries(resolve),
          );
          for (const e of entries) {
            queue.push({ webkitGetAsEntry: () => e } as DataTransferItem);
          }
        }
      }
    } else if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

function fileNameToPath(name: string): string {
  return `/opened/${name}`;
}

export const webAdapter: PlatformAdapter = {
  platform: "web",

  async readFile(path: string): Promise<FilePayload> {
    const entry = fileStore.get(path);
    if (!entry) throw Object.assign(new Error("File not found"), { kind: "not_found" });
    return { path, content: entry.content };
  },

  async saveTextFile(path: string, contents: string): Promise<void> {
    const handle = fileHandles.get(path);
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
    }
    fileStore.set(path, { content: contents, lastModified: Date.now() });
  },

  async fileSize(path: string): Promise<number> {
    const entry = fileStore.get(path);
    if (!entry) throw Object.assign(new Error("File not found"), { kind: "not_found" });
    return new Blob([entry.content]).size;
  },

  async listSiblingViewable(_path: string): Promise<string[]> {
    return Array.from(fileStore.keys()).filter((p) => isTextPath(p));
  },

  async listViewableRecursive(path: string): Promise<string[]> {
    if (fileStore.has(path)) {
      return isTextPath(path) ? [path] : [];
    }
    return Array.from(fileStore.keys()).filter((p) => isTextPath(p));
  },

  async probeIsText(path: string, _maxBytes: number): Promise<boolean> {
    return isTextPath(path);
  },

  async resolveSibling(base: string, rel: string): Promise<string> {
    const dir = base.substring(0, base.lastIndexOf("/") + 1);
    const resolved = dir + rel;
    if (fileStore.has(resolved)) return resolved;
    throw Object.assign(new Error(`File not found: ${resolved}`), { kind: "not_found" });
  },

  async writeTempFile(_filename: string, contents: string): Promise<string> {
    const path = tmpPath();
    fileStore.set(path, { content: contents, lastModified: Date.now() });
    return path;
  },

  async openDialog(options?: OpenDialogOptions): Promise<string | string[] | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = options?.multiple ?? false;
      input.addEventListener("change", async () => {
        const files = input.files;
        if (!files || files.length === 0) {
          resolve(null);
          return;
        }
        const paths: string[] = [];
        for (const file of files) {
          try {
            const text = await readBlobAsText(file);
            const path = fileNameToPath(file.name);
            fileStore.set(path, { content: text, lastModified: file.lastModified });
            paths.push(path);
          } catch (err) {
            console.warn("Skipping unreadable file:", file.name, err);
          }
        }
        resolve(options?.multiple ? paths : (paths[0] ?? null));
      });
      // Reset so the same file can be re-selected
      input.value = "";
      input.click();
    });
  },

  async saveDialog(options?: SaveDialogOptions): Promise<string | null> {
    const path = options?.defaultPath ?? "untitled.md";
    fileStore.set(path, { content: "", lastModified: Date.now() });
    return path;
  },

  async watchFile(_path: string): Promise<void> {
    // Web version doesn't support file watching; polling is handled elsewhere.
  },

  async unwatchFile(_path: string): Promise<void> {
    // no-op
  },

  async unwatchAll(): Promise<void> {
    // no-op
  },

  async openUrl(url: string): Promise<void> {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  onFileChanged(_cb: FileChangedCallback): void {
    // File watching not available in web version
  },

  onFileRemoved(_cb: FileRemovedCallback): void {
    // no-op
  },

  onDrop(cb: DropCallback): void {
    let dragCounter = 0;
    document.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) {
        cb({ type: "enter", paths: [] });
      }
    });
    document.addEventListener("dragover", (e) => {
      e.preventDefault();
      cb({ type: "over", paths: [] });
    });
    document.addEventListener("dragleave", () => {
      dragCounter--;
      if (dragCounter === 0) {
        cb({ type: "leave", paths: [] });
      }
    });
    document.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragCounter = 0;
      const items = Array.from(e.dataTransfer?.items ?? []);
      const files = await collectFiles(items);
      const paths: string[] = [];
      for (const file of files) {
        if (!isTextPath(file.name)) continue;
        const text = await readBlobAsText(file);
        const path = fileNameToPath(file.name);
        fileStore.set(path, { content: text, lastModified: file.lastModified });

        // Try to persist a write handle
        try {
          const handle = await (file as any).handle as FileSystemFileHandle | undefined;
          if (handle) fileHandles.set(path, handle);
        } catch { /* no write handle available */ }

        paths.push(path);
      }
      cb({ type: "drop", paths });
    });
  },

  // The browser has no OS-level file associations, so nothing ever fires here.
  async onOpenFiles(_cb: OpenFilesCallback): Promise<void> {},

  async getStartupFiles(): Promise<string[]> {
    return [];
  },

  async exportPdf(_html: string): Promise<void> {
    window.print();
  },
};
