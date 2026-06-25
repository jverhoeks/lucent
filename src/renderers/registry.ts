import type { Format, Renderer } from "../types";
import { markdownRenderer } from "./markdown";
import { textRenderer } from "./text";
import { dataRenderer } from "./data";

// P3 registers "log". Until then it falls back to text.
const REGISTRY: Partial<Record<Format, Renderer>> = {
  markdown: markdownRenderer,
  text: textRenderer,
  data: dataRenderer,
};

export function getRenderer(format: Format): Renderer {
  return REGISTRY[format] ?? textRenderer;
}
