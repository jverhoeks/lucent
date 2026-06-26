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

/**
 * Build the DOM for a single log row. Does NOT append to any parent — the
 * caller is responsible for placement (including the sibling `panel` when
 * present). The gutter shows `lineNo + 1` (1-based), matching the original
 * `renderRow` behaviour when called with the 0-based index.
 *
 * Returns `{ row, panel }` where `panel` is the lazy-JSON expander sibling
 * (hidden by default) or `null` when the line has no embedded JSON.
 */
export function renderLogRow(
  text: string,
  lineNo: number,
): { row: HTMLElement; panel: HTMLElement | null } {
  const row = document.createElement("div");
  row.className = `log-line lvl-${detectLevel(text)}`;
  row.dataset.line = String(lineNo);

  const gutter = document.createElement("span");
  gutter.className = "log-gutter";
  gutter.textContent = String(lineNo + 1);

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
    return { row, panel };
  }
  return { row, panel: null };
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
      const { row, panel } = renderLogRow(next[i], i);
      if (panel) {
        this.wrap.append(row, panel);
      } else {
        this.wrap.append(row);
      }
    }
    this.lines = next.slice();
  }
}

/** Split source into lines, dropping a single trailing empty line from a final
 *  newline. Shared with TabManager's incremental log path so both agree on the
 *  line set (otherwise a trailing `\n` yields a phantom row + endless rebuilds). */
export function toLines(source: string): string[] {
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
