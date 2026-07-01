/** Copy a rendered Mermaid diagram (the inlined <svg> mermaid produces) to the
 *  clipboard as SVG markup or a rasterized PNG.
 *
 *  WebKit (Tauri = WKWebView) constraints baked in here:
 *   - `image/svg+xml` is NOT a writable ClipboardItem type, so "copy as SVG"
 *     writes the markup as plain text (paste into an editor / save to a file).
 *   - `clipboard.write` must keep the originating click's user-gesture alive, so
 *     the PNG path hands a `Promise<Blob>` to ClipboardItem rather than awaiting
 *     the blob first and writing afterwards.
 *   - The Image source is a Blob URL, never `btoa(svg)` — base64 throws on the
 *     unicode that turns up in diagram labels. */

import { svgToWhiteboardHtml } from "./mermaid-whiteboard";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Intrinsic diagram size, preferring the viewBox (layout-independent) and
 *  falling back to the on-screen box. */
function intrinsicSize(svg: SVGSVGElement): { width: number; height: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return { width: vb.width, height: vb.height };
  const r = svg.getBoundingClientRect();
  return { width: r.width || 800, height: r.height || 600 };
}

/** Clone the live <svg>, guarantee the SVG namespace, and return standalone
 *  markup. `withSize` stamps explicit width/height (mermaid often sets only a
 *  `style="max-width"`, which leaves a rasterizing Image at zero size). */
function serialize(svg: SVGSVGElement, withSize = false): { markup: string; width: number; height: number } {
  const { width, height } = intrinsicSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", SVG_NS);
  if (withSize) {
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
  }
  return { markup: new XMLSerializer().serializeToString(clone), width, height };
}

/** Standalone SVG markup (XML prolog + namespaced root) — for clipboard text
 *  or a downloaded .svg file. */
export function mermaidSvgMarkup(svg: SVGSVGElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(svg).markup}`;
}

/** Copy the diagram as SVG markup (plain text). */
export async function copyMermaidSvg(svg: SVGSVGElement): Promise<void> {
  await navigator.clipboard.writeText(mermaidSvgMarkup(svg));
}

/** Rasterize the diagram to a PNG Blob at `scale`× the intrinsic size. */
function toPngBlob(svg: SVGSVGElement, scale: number): Promise<Blob> {
  const { markup, width, height } = serialize(svg, true);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png");
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("failed to load SVG for rasterization"));
    };
    img.src = url;
  });
}

/** Copy the diagram as a PNG image. Passes a pending Blob to ClipboardItem so
 *  WebKit keeps the click gesture alive across the async rasterization. */
export async function copyMermaidPng(svg: SVGSVGElement): Promise<void> {
  const blob = toPngBlob(svg, 2);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/** Rasterized PNG bytes — for writing a downloaded .png file. */
export async function mermaidPngBytes(svg: SVGSVGElement): Promise<Uint8Array> {
  const blob = await toPngBlob(svg, 2);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Copy the diagram as an Atlassian Whiteboard clipboard payload: native,
 *  editable shapes/connectors instead of a flat image. Written as `text/html`
 *  (writable in WKWebView, unlike `image/svg+xml`) — the whiteboard reads its
 *  `data-canvas-clipboard` attribute on paste. */
export async function copyMermaidWhiteboard(svg: SVGSVGElement): Promise<void> {
  const html = svgToWhiteboardHtml(svg);
  await navigator.clipboard.write([
    new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) }),
  ]);
}
