import type { Theme } from "./types";

export interface EditorAPI {
  getValue(): string;
  setValue(text: string): void;
  destroy(): void;
  onUpdate(cb: (text: string) => void): void;
  getScrollTop(): number;
  setScrollTop(top: number): void;
}

export async function createEditor(
  parent: HTMLElement,
  content: string,
  theme: Theme,
): Promise<EditorAPI> {
  const { EditorView, basicSetup } = await import("codemirror");
  const { markdown } = await import("@codemirror/lang-markdown");
  const { EditorState } = await import("@codemirror/state");

  const listeners: Array<(text: string) => void> = [];

  const extensions = [
    basicSetup,
    markdown(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString();
        for (const cb of listeners) cb(text);
      }
    }),
  ];

  if (theme === "dark") {
    const { oneDark } = await import("@codemirror/theme-one-dark");
    extensions.push(oneDark);
  }

  const state = EditorState.create({ doc: content, extensions });
  const view = new EditorView({ state, parent });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (text: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    destroy: () => view.destroy(),
    onUpdate: (cb) => { listeners.push(cb); },
    getScrollTop: () => view.scrollDOM.scrollTop,
    setScrollTop: (top: number) => { view.scrollDOM.scrollTop = top; },
  };
}
