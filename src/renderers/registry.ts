import type { Format, Renderer } from "../types";
import { markdownRenderer } from "./markdown";
import { textRenderer } from "./text";

// P2 registers "data"; P3 registers "log". Until then they fall back to text.
const REGISTRY: Partial<Record<Format, Renderer>> = {
  markdown: markdownRenderer,
  text: textRenderer,
};

export function getRenderer(format: Format): Renderer {
  return REGISTRY[format] ?? textRenderer;
}
