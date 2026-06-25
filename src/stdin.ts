import { listen } from "@tauri-apps/api/event";
import type { TabManager } from "./tabs";

/** Stream batched stdin lines (emitted by the Rust reader) into the stdin tab. */
export function initStdin(manager: TabManager): void {
  void listen<string[]>("stdin-lines", (e) => {
    if (e.payload.length) manager.appendStdin(e.payload);
  });
}
