import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import { full as emoji } from "markdown-it-emoji";
import deflist from "markdown-it-deflist";
import anchor from "markdown-it-anchor";
import container from "markdown-it-container";
import { loadHighlight } from "./highlight-loader";

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
  lang = lang.replace(/[^\w+#.-]/g, "");
  return { lang, filename };
}

/**
 * Split highlight.js output into one self-contained HTML string per source
 * line, re-balancing `<span>`s that straddle a newline so each line can live
 * in its own table cell for line-number alignment.
 */
export function splitHighlightedLines(html: string): string[] {
  if (html === "") return [];
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

/**
 * True when the source likely contains math the katex plugin would tokenize:
 * paired `$…$` / `$$…$$`, OR a bare `\begin{…}` environment.
 */
export function hasMath(text: string): boolean {
  return /\$[\s\S]*\$/.test(text) || /\\begin\s*\{/.test(text);
}

type HLJS = {
  getLanguage: (lang: string) => unknown;
  highlight: (code: string, opts: { language: string }) => { value: string };
};

/** Build a configured markdown-it renderer. `katexPlugin` is applied only
 *  when rendering math (lazy-imported in getMathRenderer). */
function createRenderer(hljs: HLJS, katexPlugin?: unknown): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
  });

  md.use(taskLists, { enabled: true, label: true })
    .use(footnote)
    .use(emoji)
    .use(deflist)
    .use(anchor, { permalink: anchor.permalink.headerLink() });
  if (katexPlugin) md.use(katexPlugin as never);
  md.use(container, "note")
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

let baseRenderer: MarkdownIt | null = null;

async function getBaseRenderer(): Promise<MarkdownIt> {
  if (!baseRenderer) {
    baseRenderer = createRenderer(await loadHighlight());
  }
  return baseRenderer;
}

let mathRenderer: MarkdownIt | null = null;

async function getMathRenderer(): Promise<MarkdownIt> {
  if (!mathRenderer) {
    const [hljs, katexMod] = await Promise.all([
      loadHighlight(),
      import("@vscode/markdown-it-katex"),
    ]);
    mathRenderer = createRenderer(hljs, katexMod.default);
  }
  return mathRenderer;
}

/** Render Markdown (no math). */
export async function renderMarkdown(text: string): Promise<string> {
  const md = await getBaseRenderer();
  return md.render(text);
}

/** Render Markdown WITH math (lazy katex import). */
export async function renderMath(text: string): Promise<string> {
  const md = await getMathRenderer();
  return md.render(text);
}
