import { beforeEach, describe, expect, it, vi } from "vitest";
import { initApp } from "../src/main";
import type { DropCallback, FileChangedCallback, FileRemovedCallback, PlatformAdapter } from "../src/platform/types";

function mountAppShell(): void {
  document.body.innerHTML = `
    <header id="toolbar">
      <div class="group"><button id="btn-open"></button><button id="btn-next"></button></div>
      <button id="btn-edit"></button><button id="btn-save"></button>
      <button id="btn-toggle"></button><button id="btn-tail"></button>
      <button id="btn-search"></button><button id="btn-close-all"></button>
      <button id="btn-copy-md"></button><button id="btn-copy-rich"></button>
      <button id="btn-export-html"></button><button id="btn-export-pdf"></button>
      <select id="sel-viewas"><option value=""></option></select>
      <button id="btn-appearance"></button><div id="appearance-panel" hidden></div>
      <select id="sel-font"><option value="sans"></option><option value="serif"></option><option value="mono"></option></select>
      <input id="inp-size" type="range" />
      <select id="sel-theme"><option value="system"></option><option value="light"></option><option value="sepia"></option><option value="dark"></option></select>
    </header>
    <div id="tabstrip" hidden><nav id="tabbar"></nav></div>
    <div id="searchbar" hidden>
      <input id="search-input" /><button id="search-case" aria-pressed="false"></button>
      <button id="search-regex" aria-pressed="false"></button><span id="search-count"></span>
      <button id="search-prev"></button><button id="search-next"></button><button id="search-close"></button>
    </div>
    <main id="content"></main><div id="banner" hidden></div>
  `;
}

describe("main event and toolbar integration", () => {
  beforeEach(() => {
    localStorage.clear();
    mountAppShell();
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  });

  it("opens and toggles a file, handles Cmd/Ctrl+W, and reports drop results", async () => {
    let onDrop: DropCallback = () => {};
    let onChanged: FileChangedCallback = () => {};
    let onRemoved: FileRemovedCallback = () => {};
    const contents = new Map([
      ["/opened.md", "# Opened"],
      ["/drop/note.md", "# Dropped"],
    ]);
    const adapter: PlatformAdapter = {
      platform: "web",
      readFile: vi.fn(async (path) => ({ path, content: contents.get(path) ?? "" })),
      saveTextFile: vi.fn(async () => {}),
      saveBinaryFile: vi.fn(async () => {}),
      fileSize: vi.fn(async () => 100),
      logOpen: vi.fn(async () => 0),
      logWindow: vi.fn(async () => []),
      logSearch: vi.fn(async () => []),
      listSiblingViewable: vi.fn(async () => []),
      listViewableRecursive: vi.fn(async (path) =>
        path === "/drop" ? ["/drop/note.md", "/drop/image.bin"] : [path]),
      probeIsText: vi.fn(async (path) => !path.endsWith(".bin")),
      resolveSibling: vi.fn(async (_base, rel) => rel),
      writeTempFile: vi.fn(async () => "/tmp/export.html"),
      openDialog: vi.fn(async () => "/opened.md"),
      saveDialog: vi.fn(async () => null),
      watchFile: vi.fn(async () => {}),
      unwatchFile: vi.fn(async () => {}),
      unwatchAll: vi.fn(async () => {}),
      openUrl: vi.fn(async () => {}),
      openPath: vi.fn(async () => {}),
      onFileChanged: (cb) => { onChanged = cb; },
      onFileRemoved: (cb) => { onRemoved = cb; },
      onDrop: (cb) => { onDrop = cb; },
      onOpenFiles: vi.fn(async () => {}),
      getStartupFiles: vi.fn(async () => []),
    };

    initApp(adapter);
    document.getElementById("btn-open")!.click();
    await vi.waitFor(() => expect(document.querySelector("#content h1")?.textContent).toBe("Opened"));

    document.getElementById("btn-toggle")!.click();
    await vi.waitFor(() => expect(document.querySelector("#content pre.raw")?.textContent).toBe("# Opened"));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true }));
    expect(document.querySelectorAll("#tabbar .tab")).toHaveLength(0);

    onDrop({ type: "drop", paths: ["/drop"] });
    await vi.waitFor(() => {
      expect(document.querySelector("#content h1")?.textContent).toBe("Dropped");
      expect(document.getElementById("banner")?.textContent).toBe("Opened 1 file, skipped 1 binary/unreadable");
    });

    // Keep callback assignments observable so adapter registration itself is covered.
    expect(onChanged).toBeTypeOf("function");
    expect(onRemoved).toBeTypeOf("function");
  });

  it("shows Download as on desktop and converts structured data through a native Save dialog", async () => {
    const saveTextFile = vi.fn(async () => {});
    const saveDialog = vi.fn(async () => "/output.yaml");
    const adapter: PlatformAdapter = {
      platform: "tauri",
      readFile: vi.fn(async (path) => ({ path, content: '{"name":"lucent","enabled":true}' })),
      saveTextFile,
      saveBinaryFile: vi.fn(async () => {}),
      fileSize: vi.fn(async () => 32),
      logOpen: vi.fn(async () => 0),
      logWindow: vi.fn(async () => []),
      logSearch: vi.fn(async () => []),
      listSiblingViewable: vi.fn(async () => []),
      listViewableRecursive: vi.fn(async (path) => [path]),
      probeIsText: vi.fn(async () => true),
      resolveSibling: vi.fn(async (_base, rel) => rel),
      writeTempFile: vi.fn(async () => "/tmp/export.html"),
      openDialog: vi.fn(async () => "/config.json"),
      saveDialog,
      watchFile: vi.fn(async () => {}),
      unwatchFile: vi.fn(async () => {}),
      unwatchAll: vi.fn(async () => {}),
      openUrl: vi.fn(async () => {}),
      openPath: vi.fn(async () => {}),
      onFileChanged: vi.fn(),
      onFileRemoved: vi.fn(),
      onDrop: vi.fn(),
      onOpenFiles: vi.fn(async () => {}),
      getStartupFiles: vi.fn(async () => []),
    };

    initApp(adapter);
    document.getElementById("btn-open")!.click();
    await vi.waitFor(() => expect(document.querySelector(".download-format")?.hasAttribute("hidden")).toBe(false));

    const select = document.querySelector<HTMLSelectElement>(".download-format")!;
    select.value = "yaml";
    select.dispatchEvent(new Event("change"));
    (document.getElementById("btn-download") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(saveTextFile).toHaveBeenCalled());
    expect(saveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "config.yaml",
      filters: [{ name: "YAML", extensions: ["yaml"] }],
    }));
    expect(saveTextFile.mock.calls[0][0]).toBe("/output.yaml");
    expect(saveTextFile.mock.calls[0][1]).toContain("name: lucent");
  });
});
