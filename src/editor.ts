import type { Theme } from "./types";
import type { Extension } from "@codemirror/state";

export interface EditorAPI {
  getValue(): string;
  setValue(text: string): void;
  destroy(): void;
  onUpdate(cb: (text: string) => void): void;
  onScroll(cb: (scrollTop: number) => void): void;
  getScrollTop(): number;
  setScrollTop(top: number): void;
  getScrollDOM(): HTMLElement;
  getScrollHeight(): number;
  getClientHeight(): number;
}

export type EditorLang = "markdown" | "json" | "yaml";

async function langExtension(lang: EditorLang): Promise<Extension> {
  switch (lang) {
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "yaml": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return yaml();
    }
    default:
    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
  }
}

export async function createEditor(
  parent: HTMLElement,
  content: string,
  theme: Theme,
  lang?: EditorLang,
): Promise<EditorAPI> {
  const { EditorView, basicSetup } = await import("codemirror");
  const { EditorState } = await import("@codemirror/state");

  const listeners: Array<(text: string) => void> = [];
  const scrollListeners: Array<(scrollTop: number) => void> = [];

  const extensions = [
    basicSetup,
    await langExtension(lang ?? "markdown"),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString();
        for (const cb of listeners) cb(text);
      }
    }),
  ];

  const resolvedTheme = theme === "system"
    ? (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  if (resolvedTheme === "dark") {
    const { oneDark } = await import("@codemirror/theme-one-dark");
    extensions.push(oneDark);
  }

  const state = EditorState.create({ doc: content, extensions });
  const view = new EditorView({ state, parent });

  view.scrollDOM.addEventListener("scroll", () => {
    for (const cb of scrollListeners) cb(view.scrollDOM.scrollTop);
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (text: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    destroy: () => view.destroy(),
    onUpdate: (cb) => { listeners.push(cb); },
    onScroll: (cb) => { scrollListeners.push(cb); },
    getScrollTop: () => view.scrollDOM.scrollTop,
    setScrollTop: (top: number) => { view.scrollDOM.scrollTop = top; },
    getScrollDOM: () => view.scrollDOM,
    getScrollHeight: () => view.scrollDOM.scrollHeight,
    getClientHeight: () => view.scrollDOM.clientHeight,
  };
}
