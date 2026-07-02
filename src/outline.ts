export interface OutlineEntry {
  id: string;
  level: number;
  label: string;
}

export function extractOutline(article: Element): OutlineEntry[] {
  return Array.from(article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"))
    .filter((heading) => heading.id !== "" && (heading.textContent ?? "").trim() !== "")
    .map((heading) => ({
      id: heading.id,
      level: Number(heading.tagName.slice(1)),
      label: (heading.textContent ?? "").trim(),
    }));
}

export class DocumentOutline {
  private nav: HTMLElement;

  constructor(private root: HTMLElement, private content: HTMLElement) {
    this.nav = root.querySelector("nav") ?? root.appendChild(document.createElement("nav"));
  }

  refresh(enabled: boolean): void {
    const article = enabled ? this.content.querySelector(":scope > article.doc") : null;
    const entries = article ? extractOutline(article) : [];
    this.nav.replaceChildren(...entries.map((entry) => this.button(entry)));
    this.root.hidden = entries.length === 0;
  }

  private button(entry: OutlineEntry): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.level = String(entry.level);
    button.textContent = entry.label;
    button.title = entry.label;
    button.addEventListener("click", () => {
      const target = Array.from(this.content.querySelectorAll<HTMLElement>("[id]"))
        .find((element) => element.id === entry.id);
      target?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return button;
  }
}
