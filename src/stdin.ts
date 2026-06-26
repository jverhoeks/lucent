import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TabManager } from "./tabs";

/**
 * Stream piped stdin into the synthetic <stdin> log tab. The Rust side buffers
 * lines and emits a lightweight `stdin-changed` signal; we pull the full
 * snapshot via `stdin_lines` once on startup AND on each change. Pulling (rather
 * than relying on an event payload) means lines produced before this listener
 * registers are never lost — no event-before-listener race.
 */
export function initStdin(manager: TabManager): void {
  const refresh = async () => {
    const lines = await invoke<string[]>("stdin_lines");
    if (lines.length) manager.setStdin(lines);
  };
  const safeRefresh = () =>
    refresh().catch((e) => console.error("stdin refresh failed:", e));
  void listen("stdin-changed", safeRefresh).catch((e) =>
    console.error("stdin listen failed:", e));
  safeRefresh(); // catch anything buffered before we subscribed
}
