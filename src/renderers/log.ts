import { detectLevel } from "../logs/level";
import { extractJson } from "../logs/embedded-json";
import { renderTree } from "../data/tree";
import { parseValueToModel } from "../data/parse-value";
import type { Renderer, RenderCtx } from "../types";

export const logRenderer: Renderer = {
  format: "log",
  render(source: string, container: HTMLElement, _ctx: RenderCtx) {
    container.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "log";
    const lines = source.split("\n");
    // Drop a single trailing empty line from a final newline.
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

    lines.forEach((text, i) => {
      const row = document.createElement("div");
      row.className = `log-line lvl-${detectLevel(text)}`;

      const gutter = document.createElement("span");
      gutter.className = "log-gutter";
      gutter.textContent = String(i + 1);

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
        wrap.append(row, panel);
      } else {
        wrap.append(row);
      }
    });
    container.append(wrap);
  },
};
