import { renderMarkdown } from "./render";
import { StyleSettings } from "./types";

export class Viewer {
  private container: HTMLElement;
  private source = "";
  private mode: "rendered" | "raw" = "rendered";

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setSource(text: string) {
    this.source = text;
    this.repaint();
  }

  getRawText(): string {
    return this.source;
  }

  getRenderedHtml(): string {
    return renderMarkdown(this.source);
  }

  getMode(): "rendered" | "raw" {
    return this.mode;
  }

  showRendered() {
    this.mode = "rendered";
    this.repaint();
  }

  showRaw() {
    this.mode = "raw";
    this.repaint();
  }

  toggle() {
    this.mode = this.mode === "rendered" ? "raw" : "rendered";
    this.repaint();
  }

  applyStyle(s: StyleSettings) {
    const el = this.container;
    el.dataset.theme = s.theme;
    el.dataset.font = s.fontFamily;
    el.style.setProperty("--font-size", `${s.fontSizePx}px`);
    el.style.setProperty("--max-width", `${s.maxWidthCh}ch`);
  }

  private repaint() {
    const scroll = this.container.scrollTop;
    if (this.mode === "rendered") {
      this.container.innerHTML = `<article class="doc">${renderMarkdown(
        this.source
      )}</article>`;
    } else {
      const pre = document.createElement("pre");
      pre.className = "raw";
      pre.textContent = this.source;
      this.container.replaceChildren(pre);
    }
    this.container.scrollTop = scroll; // preserve scroll across re-render
  }
}
