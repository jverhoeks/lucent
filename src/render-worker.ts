/// <reference lib="webworker" />

import { renderMarkdown, renderMath } from "./render-core";

interface RenderRequest {
  id: number;
  source: string;
  renderWithMath: boolean;
}

interface RenderResponse {
  id: number;
  html?: string;
  error?: string;
}

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const { id, source, renderWithMath } = e.data;
  (async () => {
    try {
      const html = renderWithMath
        ? await renderMath(source)
        : await renderMarkdown(source);
      (self as unknown as Worker).postMessage({ id, html } satisfies RenderResponse);
    } catch (err) {
      (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies RenderResponse);
    }
  })();
};
