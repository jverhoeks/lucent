import type { Renderer } from "../types";

/** Plain text: a single <pre> with the raw source (also used as the raw view). */
export const textRenderer: Renderer = {
  format: "text",
  render(source: string, container: HTMLElement) {
    const pre = document.createElement("pre");
    pre.className = "raw";
    pre.textContent = source;
    container.replaceChildren(pre);
  },
};
