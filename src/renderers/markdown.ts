import { renderMarkdown, renderMath, hasMath, runPostRender } from "../render";
import type { Renderer, RenderCtx, Theme } from "../types";

export const markdownRenderer: Renderer = {
  format: "markdown",
  render(source: string, container: HTMLElement, ctx: RenderCtx): Promise<void> {
    // Synchronous base paint (math, if any, shows as raw text) so the document
    // is on screen instantly, then the lifecycle resolves the math + Mermaid.
    const article = document.createElement("article");
    article.className = "doc";
    article.innerHTML = renderMarkdown(source);
    container.replaceChildren(article);
    return finishRender(article, source, container, ctx.theme);
  },
};

/** Swap in katex-rendered math (lazy import), then run the Mermaid post-render.
 *  Returned promise drives the caller's scroll-settle lifecycle. */
async function finishRender(
  article: HTMLElement,
  source: string,
  container: HTMLElement,
  theme: Theme,
): Promise<void> {
  if (hasMath(source)) {
    try {
      const html = await renderMath(source);
      // Only repaint if this article is still on screen — a tab switch during
      // the lazy katex load must not clobber the newer tab's content.
      if (article.isConnected) article.innerHTML = html;
    } catch {
      // katex chunk failed to load — keep the readable base paint (raw TeX)
      // rather than letting the failure blank the document.
    }
  }
  await runPostRender(container, theme);
}
