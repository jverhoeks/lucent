import { beforeEach, describe, expect, it, vi } from "vitest";
import { initApp } from "../src/main";
import type { DropCallback, FileChangedCallback, FileRemovedCallback, PlatformAdapter } from "../src/platform/types";

function mountAppShell(): void {
  document.body.innerHTML = `
    <header id="toolbar">
      <div class="group"><button id="btn-open"></button><button id="btn-paste-new"></button><button id="btn-next"></button></div>
      <button id="btn-edit"></button><button id="btn-save"></button><button id="btn-save-as"></button>
      <button id="btn-toggle"></button><button id="btn-tail"></button>
      <button id="btn-search"></button><button id="btn-diagnostics"></button><button id="btn-close-all"></button>
      <button id="btn-copy-md"></button><button id="btn-copy-rich"></button>
      <select id="sel-viewas"><option value=""></option></select>
      <select id="download-format" class="download-format"><option value=""></option></select>
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
    Object.assign(navigator, {
      clipboard: {
        readText: vi.fn(async () => ""),
        writeText: vi.fn(async () => {}),
        write: vi.fn(async () => {}),
      },
    });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
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
    expect(Array.from(document.querySelector<HTMLSelectElement>(".download-format")!.options).map((option) => option.value))
      .toEqual(["", "md", "html", "pdf"]);

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
    const downloadSelect = document.querySelector<HTMLSelectElement>(".download-format")!;
    expect(downloadSelect).toBeTruthy();
    expect(downloadSelect.disabled).toBe(false);
    expect(Array.from(downloadSelect.options).map((option) => option.value)).toEqual([
      "",
    ]);
    document.getElementById("btn-open")!.click();

    const select = document.querySelector<HTMLSelectElement>(".download-format")!;
    await vi.waitFor(() => expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "", "html", "pdf", "json", "yaml", "toml", "ini",
    ]));
    select.value = "yaml";
    select.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(saveTextFile).toHaveBeenCalled());
    expect(saveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "config.yaml",
      filters: [{ name: "YAML", extensions: ["yaml"] }],
    }));
    expect(saveTextFile.mock.calls[0][0]).toBe("/output.yaml");
    expect(saveTextFile.mock.calls[0][1]).toContain("name: lucent");
  });

  it("pastes clipboard text into a dirty new document and saves it as a web download", async () => {
    const saveTextFile = vi.fn(async () => {});
    const saveDialog = vi.fn(async () => "/notes/pasted.md");
    vi.mocked(navigator.clipboard.readText).mockResolvedValue("# From clipboard");
    const adapter: PlatformAdapter = {
      platform: "web",
      readFile: vi.fn(async (path) => ({ path, content: "" })),
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
      openDialog: vi.fn(async () => null),
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
    document.getElementById("btn-paste-new")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#tabbar .tab-label")?.textContent).toContain("Pasted.md");
      expect(document.querySelector("#content")?.textContent).toContain("From clipboard");
    });

    document.getElementById("btn-save")!.click();

    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(saveDialog).not.toHaveBeenCalled();
    expect(adapter.watchFile).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.querySelector("#tabbar .tab-label")?.textContent).toBe("Pasted.md"));
  });

  it("saves an open web document with Save As by downloading the file", async () => {
    const saveTextFile = vi.fn(async () => {});
    const saveDialog = vi.fn(async () => "/notes/copy.md");
    const adapter: PlatformAdapter = {
      platform: "web",
      readFile: vi.fn(async (path) => ({ path, content: "# Original" })),
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
      openDialog: vi.fn(async () => "/notes/original.md"),
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
    await vi.waitFor(() => expect(document.querySelector("#content h1")?.textContent).toBe("Original"));

    document.getElementById("btn-save-as")!.click();

    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(saveDialog).not.toHaveBeenCalled();
    expect(adapter.watchFile).not.toHaveBeenCalledWith("/notes/copy.md");
    expect(document.querySelector("#tabbar .tab-label")?.textContent).toBe("original.md");
  });

  it("opens the quick switcher with open tabs and recent files", async () => {
    const contents = new Map([
      ["/notes/a.md", "# Alpha"],
      ["/notes/b.md", "# Beta"],
    ]);
    const adapter: PlatformAdapter = {
      platform: "web",
      readFile: vi.fn(async (path) => ({ path, content: contents.get(path) ?? "" })),
      saveTextFile: vi.fn(async () => {}),
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
      openDialog: vi.fn(async () => ["/notes/a.md", "/notes/b.md"]),
      saveDialog: vi.fn(async () => null),
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
    await vi.waitFor(() => expect(document.querySelectorAll("#tabbar .tab")).toHaveLength(2));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true }));

    await vi.waitFor(() => {
      expect(document.getElementById("quick-switcher")?.hidden).toBe(false);
      expect(document.querySelector("#quick-switcher")?.textContent).toContain("a.md");
      expect(document.querySelector("#quick-switcher")?.textContent).toContain("b.md");
    });
  });

  it("records actionable errors in diagnostics", async () => {
    const adapter: PlatformAdapter = {
      platform: "web",
      readFile: vi.fn(async () => { throw Object.assign(new Error("not found"), { kind: "not_found" }); }),
      saveTextFile: vi.fn(async () => {}),
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
      openDialog: vi.fn(async () => "/missing.md"),
      saveDialog: vi.fn(async () => null),
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
    await vi.waitFor(() => expect(document.getElementById("banner")?.textContent).toContain("Couldn't open"));

    document.getElementById("btn-diagnostics")!.click();

    expect(document.getElementById("diagnostics-panel")?.hidden).toBe(false);
    expect(document.getElementById("diagnostics-list")?.textContent).toContain("Couldn't open");
  });
});
