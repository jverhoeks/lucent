import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import { full as emoji } from "markdown-it-emoji";
import deflist from "markdown-it-deflist";
import anchor from "markdown-it-anchor";
import container from "markdown-it-container";
import katex from "@vscode/markdown-it-katex";
import mermaid from "mermaid";
import type { Theme } from "./types";

function createRenderer(): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: false, // no raw HTML passthrough (sanitization by exclusion)
    linkify: true,
    typographer: true,
    highlight(code: string, lang: string): string {
      // Mermaid fences are handed to the post-render pass as plain text.
      if (lang === "mermaid") {
        return `<pre class="mermaid">${md.utils.escapeHtml(code)}</pre>`;
      }
      if (lang && hljs.getLanguage(lang)) {
        try {
          const out = hljs.highlight(code, { language: lang }).value;
          return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`;
        } catch {
          /* fall through to escaped plain text */
        }
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
    },
  });

  md.use(taskLists, { enabled: true, label: true })
    .use(footnote)
    .use(emoji)
    .use(deflist)
    .use(anchor, { permalink: anchor.permalink.headerLink() })
    .use(katex)
    .use(container, "note")
    .use(container, "warning")
    .use(container, "tip");

  return md;
}

const renderer = createRenderer();

export function renderMarkdown(text: string): string {
  return renderer.render(text);
}

let mermaidConfiguredTheme: Theme | null = null;

/**
 * DOM post-render pass: turn `pre.mermaid` blocks into SVG diagrams. Runs after
 * the rendered HTML is in the DOM. On a parse error mermaid annotates the block
 * inline rather than throwing, so one bad diagram doesn't break the document.
 */
export async function runPostRender(container: HTMLElement, theme: Theme): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid"));
  if (nodes.length === 0) return;
  if (mermaidConfiguredTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
    });
    mermaidConfiguredTheme = theme;
  }
  try {
    await mermaid.run({ nodes });
  } catch {
    /* mermaid annotates failing blocks inline */
  }
}
