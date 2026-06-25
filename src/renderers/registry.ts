import type { Format, Renderer } from "../types";
import { markdownRenderer } from "./markdown";
import { textRenderer } from "./text";
import { dataRenderer } from "./data";
import { logRenderer } from "./log";

const REGISTRY: Partial<Record<Format, Renderer>> = {
  markdown: markdownRenderer,
  text: textRenderer,
  data: dataRenderer,
  log: logRenderer,
};

export function getRenderer(format: Format): Renderer {
  return REGISTRY[format] ?? textRenderer;
}
