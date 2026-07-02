import { renderMarkdown, renderMath, hasMath, runPostRender } from "../render";
import type { Renderer, RenderCtx } from "../types";

export const markdownRenderer: Renderer = {
  format: "markdown",
  async render(source: string, container: HTMLElement, ctx: RenderCtx, path?: string): Promise<void> {
    const article = document.createElement("article");
    article.className = "doc";
    // Base paint — math, if any, shows as raw TeX. The async lifecycle
    // upgrades math via katex and runs Mermaid via the post-render pass.
    article.innerHTML = await renderMarkdown(source);
    if (ctx.isCurrent && !ctx.isCurrent()) return;
    // Hide mermaid source blocks before they paint — runPostRender reveals them
    // as inlined SVGs once the async mermaid render finishes.
    for (const pre of article.querySelectorAll<HTMLElement>("pre.mermaid")) {
      pre.style.visibility = "hidden";
    }
    const images = resolveLocalImages(article, path, ctx);
    container.replaceChildren(article);
    await images;
    return finishRender(article, source, container, ctx, path);
  },
};

/** Swap in katex-rendered math (lazy import), then run the Mermaid post-render.
 *  Returned promise drives the caller's scroll-settle lifecycle. */
async function finishRender(
  article: HTMLElement,
  source: string,
  container: HTMLElement,
  ctx: RenderCtx,
  path?: string,
): Promise<void> {
  if (hasMath(source)) {
    try {
      const html = await renderMath(source);
      // Only repaint if this article is still on screen — a tab switch during
      // the lazy katex load must not clobber the newer tab's content.
      if ((!ctx.isCurrent || ctx.isCurrent()) && article.isConnected) {
        article.innerHTML = html;
        await resolveLocalImages(article, path, ctx);
      }
    } catch {
      // katex chunk failed to load — keep the readable base paint (raw TeX)
      // rather than letting the failure blank the document.
    }
  }
  if (ctx.isCurrent && !ctx.isCurrent()) return;
  await runPostRender(container, ctx.theme);
}

function isRelativeImage(src: string): boolean {
  return src !== "" && !src.startsWith("/") && !src.startsWith("#") &&
    !src.startsWith("//") && !/^[a-z][a-z\d+.-]*:/i.test(src);
}

/** Replace relative Markdown image paths with data URLs provided by the native
 * platform. Missing images keep their alt text and never fail the render. */
export async function resolveLocalImages(
  article: HTMLElement,
  path: string | undefined,
  ctx: RenderCtx,
): Promise<void> {
  if (!path || !ctx.resolveLocalImage) return;
  const jobs = Array.from(article.querySelectorAll<HTMLImageElement>("img[src]"))
    .map(async (image) => {
      const src = image.getAttribute("src") ?? "";
      if (!isRelativeImage(src)) return;
      image.removeAttribute("src");
      const cleanPath = src.split("#", 1)[0].split("?", 1)[0];
      let decoded = cleanPath;
      try { decoded = decodeURIComponent(cleanPath); } catch { /* use literal path */ }
      const url = await ctx.resolveLocalImage!(path, decoded);
      if (url && (!ctx.isCurrent || ctx.isCurrent())) image.src = url;
    });
  await Promise.all(jobs);
}
