// Shared lazy highlight.js loader — ensures a single dynamic import point
// so both the Markdown renderer and the raw/data mode view share the same
// chunk and module instance, even when they are loaded from separate code
// paths (S2).

let promise: Promise<typeof import("./highlight").default> | null = null;

export function loadHighlight(): Promise<typeof import("./highlight").default> {
  if (!promise) {
    promise = import("./highlight").then((m) => m.default);
  }
  return promise;
}
