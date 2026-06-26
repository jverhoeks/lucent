import { renderMarkdown, runPostRender } from "../render";
import type { Renderer, RenderCtx } from "../types";

export const markdownRenderer: Renderer = {
  format: "markdown",
  render(source: string, container: HTMLElement, ctx: RenderCtx): Promise<void> {
    container.innerHTML = `<article class="doc">${renderMarkdown(source)}</article>`;
    // Return the post-render promise so the caller can await the full lifecycle
    // (Mermaid SVG swap) — e.g. to re-settle scroll once async DOM mutations land.
    return runPostRender(container, ctx.theme);
  },
};
