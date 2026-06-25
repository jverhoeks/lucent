import MarkdownIt from "markdown-it";
import hljs from "highlight.js";

export type PluginEntry = { name: string; plugin: any; options?: any };

// Phase 2 will push entries here; Phase 1 ships empty.
export const plugins: PluginEntry[] = [];

export function createRenderer(): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: false, // no raw HTML passthrough (sanitization by exclusion)
    linkify: true,
    typographer: true,
    highlight(code: string, lang: string): string {
      if (lang && hljs.getLanguage(lang)) {
        try {
          const out = hljs.highlight(code, { language: lang }).value;
          return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`;
        } catch {
          /* fall through to escaped plain text */
        }
      }
      const escaped = md.utils.escapeHtml(code);
      return `<pre class="hljs"><code>${escaped}</code></pre>`;
    },
  });
  for (const { plugin, options } of plugins) md.use(plugin, options);
  return md;
}

const renderer = createRenderer();

export function renderMarkdown(text: string): string {
  return renderer.render(text);
}
