import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportPdf } from "../src/export";
import type { PlatformAdapter } from "../src/platform/types";

// Read from disk rather than importing `styles.css?inline`: vitest resolves CSS
// imports to an empty string unless `css` is enabled, and this suite is about
// what the stylesheet actually says. jsdom has no layout engine and never
// applies print media, so the print contract is asserted as text — what it
// guards is these rules being dropped, which already happened once (f0f9c31).
const appCss = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

const printCss = (() => {
  const at = appCss.indexOf("@media print {");
  expect(at, "no @media print block").toBeGreaterThan(-1);
  // Nested rules mean matching braces rather than stopping at the first `}`.
  let depth = 0;
  for (let i = appCss.indexOf("{", at); i < appCss.length; i++) {
    if (appCss[i] === "{") depth++;
    else if (appCss[i] === "}" && --depth === 0) return appCss.slice(at, i);
  }
  throw new Error("unterminated @media print block");
})();

/** Declarations of the rules inside @media print with exactly this selector. */
function printRule(selector: string): string {
  const stripped = printCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const norm = (text: string) => text.trim().replace(/\s+/g, " ");
  const bodies = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => norm(m[1]) === norm(selector))
    .map((m) => m[2]);
  expect(bodies.length, `missing print rule: ${selector}`).toBeGreaterThan(0);
  return bodies.join("\n");
}

/** The app shell, mirroring index.html closely enough for the export paths. */
function buildShell(): void {
  document.documentElement.className = "";
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

type StubAdapter = PlatformAdapter & { calls: string[]; written: string };

function stubAdapter(platform: "tauri" | "web"): StubAdapter {
  const stub = {
    platform,
    calls: [] as string[],
    written: "",
    saveDialog: async () => {
      stub.calls.push("saveDialog");
      return "/tmp/out.pdf";
    },
    writeTempFile: async (name: string, contents: string) => {
      stub.calls.push("writeTempFile");
      stub.written = contents;
      return `/tmp/${name}`;
    },
    openPath: async () => {
      stub.calls.push("openPath");
    },
  };
  return stub as unknown as StubAdapter;
}

describe("print stylesheet", () => {
  // The PDF export and the standalone HTML export both go through the browser's
  // print engine with this CSS inlined, so these rules are the single mechanism
  // that turns the app shell into a paginated document.
  it("hides the app chrome", () => {
    expect(
      printRule("#toolbar, #tabstrip, #searchbar, #outline, #banner, .popover"),
    ).toMatch(/display: none/);
  });

  it("hands the scroll back to the document root", () => {
    // An inner scroll container clips the document to the viewport, so only the
    // first screenful would reach the page.
    expect(printRule("html, body")).toMatch(/height: auto/);
    expect(printRule("html, body")).toMatch(/overflow: visible/);
    expect(printRule("#workspace")).toMatch(/display: block/);
    expect(printRule("#content")).toMatch(/overflow: visible/);
    expect(printRule("#content")).toMatch(/height: auto/);
  });

  it("wraps code and keeps blocks off page boundaries", () => {
    // A page has a hard right edge and no horizontal scroll to fall back on.
    expect(printRule(".doc pre, .doc code, .doc .code-block .ctab td.code")).toMatch(
      /white-space: pre-wrap/,
    );
    expect(
      printRule(
        ".doc .code-block, .doc table, .doc blockquote, .doc pre.mermaid, .doc .note, .doc .warning, .doc .tip",
      ),
    ).toMatch(/break-inside: avoid/);
    expect(printRule(".doc h1, .doc h2, .doc h3, .doc h4, .doc h5, .doc h6")).toMatch(
      /break-after: avoid/,
    );
  });
});

describe("exportPdf", () => {
  beforeEach(buildShell);

  // One path for every platform: the browser is what paginates. WebKit's in-app
  // routes are gone — `createPDF` produced a single document-tall page and
  // `NSPrintOperation` rendered blank pages from a Tauri webview.
  for (const platform of ["tauri", "web"] as const) {
    it(`stages the document and opens it for printing on ${platform}`, async () => {
      const adapter = stubAdapter(platform);

      await exportPdf("# hi", adapter);

      expect(adapter.calls).toEqual(["writeTempFile", "openPath"]);
      expect(adapter.written).toContain("window.print()");
      // No save dialog: the file lands wherever the browser's print sheet says.
      expect(adapter.calls).not.toContain("saveDialog");
    });
  }

  it("exports light even when reading in a dark theme", async () => {
    // A dark theme prints as slabs of ink.
    const adapter = stubAdapter("tauri");
    document.getElementById("content")!.dataset.theme = "dark";

    await exportPdf("# hi", adapter);

    expect(adapter.written).toContain('data-theme="light"');
    expect(adapter.written).not.toContain('data-theme="dark"');
  });

  it("does not restructure the DOM for the export", async () => {
    // Pagination comes from print media. The old screen-media capture needed an
    // `.exporting` class on <html>/<body>; this guards against it creeping back.
    const adapter = stubAdapter("tauri");

    await exportPdf("# hi", adapter);

    expect(`${document.documentElement.className}|${document.body.className}`).toBe("|");
  });
});
