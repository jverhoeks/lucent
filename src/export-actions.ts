import {
  copyMermaidDrawio,
  copyMermaidExcalidraw,
  copyMermaidLucid,
  copyMermaidPng,
  copyMermaidSvg,
  copyMermaidWhiteboard,
  mermaidPngBytes,
  mermaidSvgMarkup,
} from "./mermaid-export";
import { buildStandaloneHtml, exportPdf } from "./export";
import { svgToDrawioXml, svgsToDrawioFile } from "./export-drawio";
import { basename } from "./format";
import { downloadFile } from "./save";
import type { PlatformAdapter } from "./platform/types";
import type { DataLang, Format, StyleSettings } from "./types";
import type { TabManager } from "./tabs";

const DOWNLOAD_OPTIONS: Record<string, string> = {
  md: "Markdown (.md)", html: "HTML (.html)", pdf: "PDF (.pdf)",
  json: "JSON (.json)", yaml: "YAML (.yaml)", toml: "TOML (.toml)", ini: "INI (.ini)",
};

export function refreshDownloadOptions(
  select: HTMLSelectElement,
  hasDocument: boolean,
  format: Format | undefined,
): void {
  const previous = select.value;
  select.replaceChildren(new Option("Download as…", ""));
  if (hasDocument) {
    if (format === "markdown") select.add(new Option(DOWNLOAD_OPTIONS.md, "md"));
    select.add(new Option(DOWNLOAD_OPTIONS.html, "html"));
    select.add(new Option(DOWNLOAD_OPTIONS.pdf, "pdf"));
    if (format === "data") {
      for (const value of ["json", "yaml", "toml", "ini"]) {
        select.add(new Option(DOWNLOAD_OPTIONS[value], value));
      }
    }
  }
  select.value = Array.from(select.options).some((option) => option.value === previous) ? previous : "";
}

export class ExportActions {
  constructor(private readonly options: {
    adapter: PlatformAdapter;
    manager: TabManager;
    content: HTMLElement;
    downloadsFiles: boolean;
    getTheme: () => StyleSettings["theme"];
    showBanner: (message: string) => void;
  }) {}

  private diagramBaseName(): string {
    const path = this.options.manager.getActivePath();
    return path ? basename(path).replace(/\.[^.]+$/, "") || "diagram" : "diagram";
  }

  private async downloadMermaid(
    svg: SVGSVGElement,
    kind: "svg" | "png" | "dio" | "luc",
  ): Promise<boolean> {
    const { adapter, downloadsFiles } = this.options;
    const filename = kind === "dio" || kind === "luc"
      ? `${this.diagramBaseName()}.drawio`
      : `${this.diagramBaseName()}.${kind}`;
    if (kind === "png") {
      const bytes = await mermaidPngBytes(svg);
      if (downloadsFiles) downloadFile(bytes, filename, "image/png");
      else {
        const path = await adapter.saveDialog({ defaultPath: filename, filters: [{ name: "PNG image", extensions: ["png"] }] });
        if (!path) return false;
        await adapter.saveBinaryFile(path, bytes);
      }
      return true;
    }
    const content = kind === "svg" ? mermaidSvgMarkup(svg) : svgToDrawioXml(svg);
    const mime = kind === "svg" ? "image/svg+xml" : "application/xml";
    if (downloadsFiles) downloadFile(content, filename, mime);
    else {
      const path = await adapter.saveDialog({
        defaultPath: filename,
        filters: kind === "svg"
          ? [{ name: "SVG image", extensions: ["svg"] }]
          : [{ name: kind === "luc" ? "Lucid/draw.io XML" : "draw.io XML", extensions: ["drawio", "xml"] }],
      });
      if (!path) return false;
      await adapter.saveTextFile(path, content);
    }
    return true;
  }

  private async downloadAllMermaidDrawio(): Promise<boolean> {
    const { adapter, content, downloadsFiles, showBanner } = this.options;
    const svgs = Array.from(content.querySelectorAll<SVGSVGElement>("pre.mermaid svg"));
    if (svgs.length === 0) {
      showBanner("No Mermaid diagrams to export");
      return false;
    }
    const xml = svgsToDrawioFile(svgs);
    const filename = `${this.diagramBaseName()}-diagrams.drawio`;
    if (downloadsFiles) downloadFile(xml, filename, "application/xml");
    else {
      const path = await adapter.saveDialog({
        defaultPath: filename,
        filters: [{ name: "draw.io XML", extensions: ["drawio", "xml"] }],
      });
      if (!path) return false;
      await adapter.saveTextFile(path, xml);
    }
    return true;
  }

  async runMermaid(block: HTMLElement | null, action: "copy" | "download", kind: string): Promise<boolean> {
    const svg = block?.querySelector("svg") as SVGSVGElement | null;
    if (kind === "src") {
      await navigator.clipboard.writeText(block?.dataset.mermaidSrc ?? "");
      return true;
    }
    if (kind === "edit") {
      const source = block?.dataset.mermaidSrc ?? "";
      if (!source) throw new Error("Mermaid source is unavailable");
      await this.options.manager.openScratch(`\`\`\`mermaid\n${source.replace(/\n$/, "")}\n\`\`\`\n`, {
        format: "markdown", extension: "md", title: "Mermaid diagram.md",
      });
      return true;
    }
    if (kind === "all") return this.downloadAllMermaidDrawio();
    if (svg && action === "download") {
      return this.downloadMermaid(svg, kind === "png" ? "png" : kind === "dio" ? "dio" : kind === "luc" ? "luc" : "svg");
    }
    if (!svg) throw new Error("Mermaid diagram is unavailable");
    if (kind === "wb") await copyMermaidWhiteboard(svg);
    else if (kind === "dio") await copyMermaidDrawio(svg);
    else if (kind === "luc") await copyMermaidLucid(svg);
    else if (kind === "exc") await copyMermaidExcalidraw(svg);
    else if (kind === "png") await copyMermaidPng(svg);
    else await copyMermaidSvg(svg);
    return true;
  }

  async downloadSelected(select: HTMLSelectElement): Promise<void> {
    const format = select.value;
    if (!format) return;
    const { adapter, downloadsFiles, manager, showBanner } = this.options;
    const source = manager.getActiveRawText();
    if (!source) return;
    const base = basename(manager.getActivePath() ?? "untitled").replace(/\.[^.]+$/, "") || "document";
    try {
      if (format === "pdf") {
        if (!downloadsFiles) await exportPdf(source, adapter);
        else {
          const html = buildStandaloneHtml(manager.getActiveDisplayedHtml(), true);
          const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
          window.open(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }
      } else {
        let output = source;
        let mime = "text/plain";
        if (format === "html") {
          const theme = this.options.getTheme();
          output = buildStandaloneHtml(manager.getActiveDisplayedHtml(), false, theme === "system" ? "light" : theme);
          mime = "text/html";
        } else if (format === "md") {
          if (manager.getActiveFormat() !== "markdown") throw new Error("Markdown output requires a Markdown source");
          mime = "text/markdown";
        } else {
          const from = manager.getActiveDataLang();
          if (!from) throw new Error("Structured output requires a JSON, YAML, TOML, or INI source");
          const { convertStructuredData } = await import("./data/convert");
          output = convertStructuredData(source, from, format as DataLang);
          mime = { json: "application/json", yaml: "text/yaml", toml: "text/toml", ini: "text/plain" }[format] ?? "text/plain";
        }
        if (downloadsFiles) downloadFile(output, `${base}.${format}`, mime);
        else {
          const destination = await adapter.saveDialog({
            defaultPath: `${base}.${format}`,
            filters: [{ name: format.toUpperCase(), extensions: [format] }],
          });
          if (destination) await adapter.saveTextFile(destination, output);
        }
      }
    } catch (error) {
      showBanner(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      select.value = "";
    }
  }
}
