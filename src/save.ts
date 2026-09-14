import { basename } from "./format";
import type { PlatformAdapter } from "./platform/types";
import { rememberRecentFile } from "./recent";

export function downloadFile(content: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function textMime(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "md" || extension === "markdown") return "text/markdown";
  if (extension === "json") return "application/json";
  if (extension === "yaml" || extension === "yml") return "text/yaml";
  if (extension === "html" || extension === "htm") return "text/html";
  return "text/plain";
}

/** Save As orchestration shared by scratch documents and existing files. */
export async function saveTextAsFile(
  adapter: PlatformAdapter,
  path: string,
  content: string,
): Promise<string | null> {
  const defaultPath = path.startsWith("<scratch:") ? "Pasted.md" : basename(path) || "document.txt";
  const downloads = adapter.capabilities?.downloads ?? adapter.platform === "web";
  if (downloads) {
    downloadFile(content, defaultPath, textMime(defaultPath));
    return defaultPath;
  }
  const destination = await adapter.saveDialog({
    defaultPath,
    filters: [
      { name: "Markdown", extensions: ["md", "markdown"] },
      { name: "Text", extensions: ["txt", "log", "text"] },
      { name: "Data", extensions: ["json", "yaml", "yml", "toml", "ini"] },
    ],
  });
  if (!destination) return null;
  await adapter.saveTextFile(destination, content);
  if (adapter.capabilities?.watching ?? adapter.platform === "tauri") {
    await adapter.watchFile(destination);
  }
  rememberRecentFile(destination);
  return destination;
}
