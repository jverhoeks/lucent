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

/** Max candidate offsets to verify when detecting a front-eviction shift before
 *  giving up and doing a full rebuild — bounds findDrop to ~O(n). */
const MAX_DROP_CHECKS = 32;

export class LogView {
  private wrap: HTMLElement;
  private lines: string[] = [];
  /** Rendered DOM per line, parallel to `lines`, so we can drop/renumber the
   *  front without tearing down the whole list. `gutter` is cached for renumber. */
  private nodes: { row: HTMLElement; panel: HTMLElement | null; gutter: HTMLElement | null }[] = [];

  constructor(container: HTMLElement) {
    container.replaceChildren();
    this.wrap = document.createElement("div");
    this.wrap.className = "log";
    container.appendChild(this.wrap);
  }

  lineCount(): number {
    return this.lines.length;
  }

  /**
   * Reconcile the rendered rows to `next`:
   *  - append-only (current is a prefix of next) → render just the new tail;
   *  - front-eviction (ring buffer at cap: `next` is `lines` shifted left by
   *    `drop`, plus a new tail) → remove the first `drop` rows, renumber the
   *    survivors' gutters, append the tail — no full teardown;
   *  - otherwise → full rebuild.
   * The eviction path is what keeps a piped stdin at the 10k line cap from
   * rebuilding every row on every new line.
   */
  setLines(next: string[]): void {
    if (isPrefixOf(this.lines, next)) {
      this.appendFrom(this.lines.length, next);
      this.lines = next.slice();
      return;
    }

    const drop = this.findDrop(next);
    if (drop > 0) {
      this.dropFront(drop);
      this.lines = this.lines.slice(drop);
      this.renumberGutters(); // survivors shifted down by `drop`
      this.appendFrom(this.lines.length, next);
      this.lines = next.slice();
      return;
    }

    // Genuine replacement — full rebuild (also the safe fallback when no cheap
    // shift was found, so we never display rows out of sync with `lines`).
    this.wrap.replaceChildren();
    this.nodes = [];
    this.lines = [];
    this.appendFrom(0, next);
    this.lines = next.slice();
  }

  /** Render lines [from, next.length) and append their rows to the DOM. */
  private appendFrom(from: number, next: string[]): void {
    for (let i = from; i < next.length; i++) {
      const { row, panel } = renderLogRow(next[i], i);
      if (panel) this.wrap.append(row, panel);
      else this.wrap.append(row);
      this.nodes.push({ row, panel, gutter: row.querySelector(".log-gutter") });
    }
  }

  /** Smallest `drop` (1..) such that `lines[drop:]` is a prefix of `next`, or 0
   *  if none is found cheaply (caller falls back to a full rebuild). */
  private findDrop(next: string[]): number {
    const cur = this.lines;
    if (next.length === 0 || cur.length === 0) return 0;
    const first = next[0];
    let checks = 0;
    for (let d = 1; d < cur.length; d++) {
      if (cur[d] !== first) continue;
      if (++checks > MAX_DROP_CHECKS) return 0;
      const overlap = cur.length - d;
      if (overlap > next.length) continue;
      let ok = true;
      for (let i = 0; i < overlap; i++) {
        if (cur[d + i] !== next[i]) { ok = false; break; }
      }
      if (ok) return d;
    }
    return 0;
  }

  /** Remove the first `drop` rows (and their JSON panels) from the DOM. */
  private dropFront(drop: number): void {
    for (let k = 0; k < drop; k++) {
      this.nodes[k].row.remove();
      this.nodes[k].panel?.remove();
    }
    this.nodes.splice(0, drop);
  }

  /** Rewrite surviving rows' gutter numbers (1-based) after a front drop. */
  private renumberGutters(): void {
    for (let i = 0; i < this.nodes.length; i++) {
      const g = this.nodes[i].gutter;
      if (g) g.textContent = String(i + 1);
    }
  }
}

/** True when `a` is a prefix of `b` (append-only streaming case). */
function isPrefixOf(a: string[], b: string[]): boolean {
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
