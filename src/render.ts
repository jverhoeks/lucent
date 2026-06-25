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

/** Parse a fence info string into a language and an optional filename label.
 *  Supported: `lang`, `lang title="name"`, `lang title=name`, `lang:name`. */
function parseInfo(info: string): { lang: string; filename: string } {
  const trimmed = info.trim();
  const titleMatch = trimmed.match(/title="([^"]+)"/) || trimmed.match(/title=(\S+)/);
  let filename = titleMatch ? titleMatch[1] : "";
  let lang = trimmed.split(/\s+/)[0] || "";
  if (lang.includes(":")) {
    const [l, f] = lang.split(":");
    lang = l;
    if (!filename && f) filename = f;
  }
  return { lang, filename };
}

/** Right-aligned line-number text for the gutter (always emitted; shown via CSS). */
function lineGutter(code: string): string {
  const lines = code.replace(/\n$/, "").split("\n");
  return lines.map((_, i) => String(i + 1)).join("\n");
}

function createRenderer(): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: false, // no raw HTML passthrough (sanitization by exclusion)
    linkify: true,
    typographer: true,
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

  const highlightInner = (code: string, lang: string): string => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {
        /* fall through */
      }
    }
    return md.utils.escapeHtml(code);
  };

  // Custom fence: mermaid → post-render block; everything else → a code block
  // with a header (filename/language + copy button) and a line-number gutter.
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const code = token.content;
    const { lang, filename } = parseInfo(token.info);

    if (lang === "mermaid") {
      return `<pre class="mermaid">${md.utils.escapeHtml(code)}</pre>`;
    }

    const label = filename || lang;
    const labelHtml = `<span class="code-label">${md.utils.escapeHtml(label)}</span>`;
    const header = `<div class="code-header">${labelHtml}<button class="code-copy" type="button" title="Copy source" aria-label="Copy source">📋</button></div>`;
    const gutter = `<span class="ln-gutter" aria-hidden="true">${lineGutter(code)}</span>`;
    const langClass = lang ? ` class="language-${lang}"` : "";
    return `<div class="code-block">${header}<pre class="hljs">${gutter}<code${langClass}>${highlightInner(
      code,
      lang
    )}</code></pre></div>\n`;
  };

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
