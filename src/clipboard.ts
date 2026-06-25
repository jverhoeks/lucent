export async function copyAsMarkdown(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function copyAsRichText(html: string): Promise<void> {
  const plain = html.replace(/<[^>]+>/g, ""); // crude fallback text
  const item = new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([plain], { type: "text/plain" }),
  });
  await navigator.clipboard.write([item]);
}
