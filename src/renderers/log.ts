import { detectLevel } from "../logs/level";
import { extractJson } from "../logs/embedded-json";
import { renderTree } from "../data/tree";
import { parseValueToModel } from "../data/parse-value";
import type { Renderer, RenderCtx } from "../types";

let currentLogView: LogView | null = null;
/** The LogView from the most recent log render (single active doc), for incremental updates. */
export function getCurrentLogView(): LogView | null {
  return currentLogView;
}

export class LogView {
  private wrap: HTMLElement;
  private lines: string[] = [];

  constructor(container: HTMLElement) {
    container.replaceChildren();
    this.wrap = document.createElement("div");
    this.wrap.className = "log";
    container.appendChild(this.wrap);
  }

  lineCount(): number {
    return this.lines.length;
  }

  /** Reconcile the rendered rows to `next`: append the tail when `next` extends
   *  the current lines (streaming append); otherwise rebuild from scratch. */
  setLines(next: string[]): void {
    const isPrefix =
      this.lines.length <= next.length && this.lines.every((l, i) => l === next[i]);
    if (!isPrefix) {
      this.wrap.replaceChildren();
      this.lines = [];
    }
    for (let i = this.lines.length; i < next.length; i++) {
      this.renderRow(next[i], i);
    }
    this.lines = next.slice();
  }

  private renderRow(text: string, index: number): void {
    const row = document.createElement("div");
    row.className = `log-line lvl-${detectLevel(text)}`;

    const gutter = document.createElement("span");
    gutter.className = "log-gutter";
    gutter.textContent = String(index + 1);

    const msg = document.createElement("span");
    msg.className = "log-msg";
    msg.textContent = text;

    row.append(gutter, msg);

    const found = extractJson(text);
    if (found) {
      const toggle = document.createElement("button");
      toggle.className = "log-json-toggle";
      toggle.textContent = "{ }";
      toggle.title = "Decode embedded JSON";
      const panel = document.createElement("div");
      panel.className = "log-json";
      panel.hidden = true;
      toggle.addEventListener("click", () => {
        if (!panel.dataset.rendered) {
          renderTree(parseValueToModel(found.value), panel, { defaultDepth: 2 });
          panel.dataset.rendered = "1";
        }
        panel.hidden = !panel.hidden;
        toggle.classList.toggle("open", !panel.hidden);
      });
      msg.append(" ");
      row.append(toggle);
      this.wrap.append(row, panel);
    } else {
      this.wrap.append(row);
    }
  }
}

/** Split source into lines, dropping a single trailing empty line from a final newline. */
function toLines(source: string): string[] {
  const lines = source.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export const logRenderer: Renderer = {
  format: "log",
  render(source: string, container: HTMLElement, _ctx: RenderCtx) {
    const view = new LogView(container);
    view.setLines(toLines(source));
    currentLogView = view;
  },
};

export function renderLog(source: string, container: HTMLElement, _ctx: RenderCtx): LogView {
  const view = new LogView(container);
  view.setLines(toLines(source));
  currentLogView = view;
  return view;
}
