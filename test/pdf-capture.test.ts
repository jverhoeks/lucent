import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportPdf } from "../src/export";
import type { PlatformAdapter } from "../src/platform/types";

// Read from disk rather than importing `styles.css?inline`: vitest resolves CSS
// imports to an empty string unless `css` is enabled, and this suite is about
// what the stylesheet actually says.
const appCss = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

/** Declarations of every top-level rule with exactly this selector. */
function rule(selector: string): string {
  const stripped = appCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const norm = (text: string) => text.trim().replace(/\s+/g, " ");
  const bodies = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => norm(m[1]) === norm(selector))
    .map((m) => m[2]);
  expect(bodies.length, `missing rule: ${selector}`).toBeGreaterThan(0);
  return bodies.join("\n");
}

/** The app shell, mirroring index.html closely enough for the capture rules. */
function buildShell(): void {
  document.documentElement.className = "";
  document.head.innerHTML = `<style>${appCss}</style>`;
  document.body.className = "";
  document.body.innerHTML = `
    <header id="toolbar"><button id="btn-open"></button></header>
    <div id="tabstrip"><nav id="tabbar"></nav></div>
    <div id="searchbar"></div>
    <div id="workspace">
      <aside id="outline"><nav></nav></aside>
      <main id="content" data-font="sans" data-theme="light"><article class="doc"><h1>Doc</h1></article></main>
    </div>
    <div id="banner"></div>`;
}

function stubAdapter(platform: "tauri" | "web"): PlatformAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    platform,
    calls,
    saveDialog: async () => {
      calls.push("saveDialog");
      return "/tmp/out.pdf";
    },
    writeTempFile: async (name: string) => {
      calls.push("writeTempFile");
      return `/tmp/${name}`;
    },
    openPath: async () => {
      calls.push("openPath");
    },
  } as unknown as PlatformAdapter & { calls: string[] };
}

describe("native PDF capture stylesheet", () => {
  beforeEach(buildShell);

  // Regression guard: these rules were dropped once in the web/app split
  // (f0f9c31) and the PDF then captured a one-page screenshot of the window,
  // toolbar included. `createPDF` renders screen media, so this class — not
  // `@media print` — is what makes the capture a document.
  it("hides the app chrome while exporting", () => {
    for (const id of ["toolbar", "tabstrip", "searchbar", "outline", "banner"]) {
      expect(getComputedStyle(document.getElementById(id)!).display).not.toBe("none");
    }

    document.documentElement.classList.add("exporting");
    document.body.classList.add("exporting");

    for (const id of ["toolbar", "tabstrip", "searchbar", "outline", "banner"]) {
      expect(getComputedStyle(document.getElementById(id)!).display, id).toBe("none");
    }
  });

  // jsdom has no layout engine and only resolves `display` from a stylesheet,
  // so the geometry half of the contract is asserted against the CSS text. What
  // this guards is precisely the failure that already happened twice: the rules
  // being dropped. Real geometry is verified in a browser / against the exported
  // PDF, not here.
  it("hands the scroll back to the document root so every page is captured", () => {
    // An inner scroll container clips the document to the viewport, which is
    // what turned the export into a single-page window screenshot.
    expect(rule("html.exporting, body.exporting")).toMatch(/height: auto/);
    expect(rule("html.exporting, body.exporting")).toMatch(/overflow: visible/);
    expect(rule("body.exporting #workspace")).toMatch(/overflow: visible/);
    expect(rule("body.exporting #content")).toMatch(/overflow: visible/);
    expect(rule("body.exporting #content")).toMatch(/height: auto/);
  });

  it("lays the document out on a fixed A4-width canvas", () => {
    // 210mm at 96dpi, so window size and zoom don't change the page geometry.
    expect(rule("body.exporting")).toMatch(/width: 794px/);
    expect(rule("body.exporting #content")).toMatch(/width: 794px/);
  });
});

describe("browser print fallback stylesheet", () => {
  // Used by the standalone-HTML export (buildStandaloneHtml inlines this CSS)
  // and by the non-macOS "open in the browser and print" path. Dropped in the
  // same commit as the capture rules.
  it("hides the chrome and unclamps the document for print", () => {
    const print = appCss.slice(appCss.indexOf("@media print"));
    expect(print).toContain("#toolbar");
    expect(print).toContain("#outline");
    expect(print).toMatch(/display: none/);
    expect(print).toMatch(/overflow: visible/);
  });
});

describe("exportPdf", () => {
  beforeEach(() => {
    buildShell();
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("captures the live webview on tauri and always cleans up the class", async () => {
    const adapter = stubAdapter("tauri");
    let classesDuringCapture = "";
    invoke.mockImplementation(() => {
      classesDuringCapture = `${document.documentElement.className}|${document.body.className}`;
      return Promise.resolve();
    });

    await exportPdf("# hi", adapter);

    expect(invoke).toHaveBeenCalledWith("export_pdf_native", { dest: "/tmp/out.pdf" });
    // Both elements need the class: <html> is what unclamps the root scroll.
    expect(classesDuringCapture).toBe("exporting|exporting");
    expect(document.documentElement.classList.contains("exporting")).toBe(false);
    expect(document.body.classList.contains("exporting")).toBe(false);
  });

  it("removes the class again when the native capture fails", async () => {
    const adapter = stubAdapter("tauri");
    invoke.mockRejectedValue(new Error("boom"));

    await expect(exportPdf("# hi", adapter)).rejects.toThrow("boom");

    expect(document.documentElement.classList.contains("exporting")).toBe(false);
    expect(document.body.classList.contains("exporting")).toBe(false);
  });

  it("takes the browser path in split-edit mode, which the class can't linearize", async () => {
    const adapter = stubAdapter("tauri");
    document.getElementById("content")!.classList.add("editing");

    await exportPdf("# hi", adapter);

    expect(invoke).not.toHaveBeenCalled();
    expect(adapter.calls).toEqual(["writeTempFile", "openPath"]);
  });

  it("takes the browser path off tauri", async () => {
    const adapter = stubAdapter("web");

    await exportPdf("# hi", adapter);

    expect(invoke).not.toHaveBeenCalled();
    expect(adapter.calls).toEqual(["writeTempFile", "openPath"]);
  });
});
