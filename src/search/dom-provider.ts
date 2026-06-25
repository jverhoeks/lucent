import type { SearchProvider, SearchQuery, Match } from "../types";

interface Hit { mark: HTMLElement; }

/**
 * Searches the visible text of a DOM subtree. Each hit is wrapped in
 * <mark class="search-hit">; the current hit also gets "search-current".
 * Matching is per text node (a hit never spans element boundaries).
 */
export class DomSearchProvider implements SearchProvider {
  private hits: Hit[] = [];
  constructor(private root: HTMLElement) {}

  private buildRegExp(q: SearchQuery): RegExp {
    const flags = q.caseSensitive ? "g" : "gi";
    const body = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(body, flags);
  }

  find(q: SearchQuery): Match[] {
    this.clear();
    if (!q.text) return [];
    const re = this.buildRegExp(q);

    // Collect text nodes first (live mutation while walking is unsafe).
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest("mark.search-hit")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const textNodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);

    for (const node of textNodes) {
      const text = node.nodeValue ?? "";
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      const ranges: Array<[number, number]> = [];
      while ((m = re.exec(text)) !== null) {
        if (m[0] === "") { re.lastIndex++; continue; } // zero-width guard
        ranges.push([m.index, m.index + m[0].length]);
      }
      if (!ranges.length) continue;
      // Split the node, wrapping each matched range in a <mark>.
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const [s, e] of ranges) {
        if (s > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, s)));
        const mark = document.createElement("mark");
        mark.className = "search-hit";
        mark.textContent = text.slice(s, e);
        frag.appendChild(mark);
        this.hits.push({ mark });
        cursor = e;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      node.parentNode?.replaceChild(frag, node);
    }
    return this.hits.map((_, i) => ({ id: i }));
  }

  reveal(id: number): void {
    this.hits.forEach((h, i) => h.mark.classList.toggle("search-current", i === id));
    if (this.hits[id]?.mark.scrollIntoView) {
      this.hits[id].mark.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  clear(): void {
    for (const { mark } of this.hits) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize(); // merge adjacent text nodes back together
    }
    this.hits = [];
  }
}
