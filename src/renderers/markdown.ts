import { renderMarkdown, runPostRender } from "../render";
import type { Renderer, RenderCtx } from "../types";

export const markdownRenderer: Renderer = {
  format: "markdown",
  render(source: string, container: HTMLElement, ctx: RenderCtx) {
    container.innerHTML = `<article class="doc">${renderMarkdown(source)}</article>`;
    void runPostRender(container, ctx.theme);
  },
};
