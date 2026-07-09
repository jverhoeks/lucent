export async function copyAsMarkdown(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

const INLINE_TAGS = new Set([
  "A", "ABBR", "B", "CODE", "DEL", "EM", "I", "IMG", "KBD", "MARK",
  "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "U",
]);

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT",
  "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5",
  "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
  "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

/** Protect a regular space immediately following inline formatting. Some HTML
 * clipboard consumers discard that boundary text node after sanitizing tags,
 * producing `boldnext`. A non-breaking space survives the round trip; only the
 * boundary character changes, so normal wrapping elsewhere is unaffected. */
export function stabilizeInlineSpaces(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (!/^ /.test(node.data) || node.parentElement?.closest("pre")) continue;
    const previous = node.previousSibling;
    if (previous instanceof Element && INLINE_TAGS.has(previous.tagName)) {
      node.data = "\u00a0" + node.data.slice(1);
    }
  }
  return root.innerHTML;
}

function plainTextFromHtml(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  root.querySelectorAll("*").forEach((el) => {
    if (!BLOCK_TAGS.has(el.tagName)) return;
    if (el.firstChild) el.insertBefore(document.createTextNode("\n"), el.firstChild);
    el.appendChild(document.createTextNode("\n"));
  });
  return (root.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export async function copyAsRichText(html: string): Promise<void> {
  const stableHtml = stabilizeInlineSpaces(html);
  const plain = plainTextFromHtml(stableHtml);
  const item = new ClipboardItem({
    "text/html": new Blob([stableHtml], { type: "text/html" }),
    "text/plain": new Blob([plain], { type: "text/plain" }),
  });
  await navigator.clipboard.write([item]);
}
