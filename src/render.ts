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
import hljsLight from "highlight.js/styles/github.css?inline";
import hljsDark from "highlight.js/styles/github-dark.css?inline";
import type { Theme } from "./types";

let hljsStyleEl: HTMLStyleElement | null = null;

/** Swap the highlight.js color theme to match the app theme (dark code in dark mode). */
export function applyCodeTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (!hljsStyleEl) {
    hljsStyleEl = document.createElement("style");
    hljsStyleEl.id = "hljs-theme";
    document.head.appendChild(hljsStyleEl);
  }
  hljsStyleEl.textContent = theme === "dark" ? hljsDark : hljsLight;
}

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
  // Sanitize the language token: it lands in a class attribute and is passed to
  // highlight.js. Restrict to a safe set (covers c++, c#, f#, objective-c, etc.)
  // so a crafted fence info string can't break out and inject HTML.
  lang = lang.replace(/[^\w+#.-]/g, "");
  return { lang, filename };
}

/**
 * Split highlight.js output into one self-contained HTML string per source
 * line, re-balancing `<span>`s that straddle a newline (e.g. block comments) so
 * each line can live in its own table cell. This is what lets line numbers and
 * code lines align exactly and be highlighted per-line.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let cur = "";
  const re = /(<span[^>]*>)|(<\/span>)|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      open.push(m[1]);
      cur += m[1];
    } else if (m[2]) {
      open.pop();
      cur += "</span>";
    } else {
      const parts = m[3].split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          cur += "</span>".repeat(open.length);
          lines.push(cur);
          cur = open.join("");
        }
        cur += parts[i];
      }
    }
  }
  lines.push(cur);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
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
  // with a header (filename/language, line-number toggle, copy, save) and a
  // per-line table so numbers align and are individually clickable.
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const code = token.content;
    const { lang, filename } = parseInfo(token.info);

    if (lang === "mermaid") {
      return `<pre class="mermaid">${md.utils.escapeHtml(code)}</pre>`;
    }

    const label = filename || lang;
    const labelHtml = `<span class="code-label">${md.utils.escapeHtml(label)}</span>`;
    const actions =
      `<span class="code-actions">` +
      `<button class="code-lines" type="button" title="Toggle line numbers" aria-label="Toggle line numbers" aria-pressed="false">123</button>` +
      `<button class="code-copy" type="button" title="Copy source" aria-label="Copy source">📋</button>` +
      `<button class="code-save" type="button" title="Save source to file" aria-label="Save source">💾</button>` +
      `</span>`;
    const header = `<div class="code-header">${labelHtml}${actions}</div>`;

    const rows = splitHighlightedLines(highlightInner(code, lang))
      .map(
        (line, i) =>
          `<tr><td class="ln" data-line="${i + 1}">${i + 1}</td><td class="cc">${
            line || " "
          }</td></tr>`
      )
      .join("");
    const langClass = lang ? ` language-${lang}` : "";
    return `<div class="code-block" data-lang="${md.utils.escapeHtml(
      lang
    )}" data-filename="${md.utils.escapeHtml(filename)}" data-src="${md.utils.escapeHtml(
      code
    )}">${header}<pre class="hljs${langClass}"><table class="ctab"><tbody>${rows}</tbody></table></pre></div>\n`;
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
