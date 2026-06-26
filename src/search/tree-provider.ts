import type { SearchProvider, SearchQuery, Match } from "../types";
import type { TreeView } from "../data/tree";

interface TreeHit { path: string; }

export class TreeSearchProvider implements SearchProvider {
  private hits: TreeHit[] = [];
  constructor(private tree: TreeView) {}

  private matcher(q: SearchQuery): (s: string) => boolean {
    if (q.regex) {
      const re = new RegExp(q.text, q.caseSensitive ? "" : "i");
      return (s) => re.test(s);
    }
    if (q.caseSensitive) return (s) => s.includes(q.text);
    const lc = q.text.toLowerCase();
    return (s) => s.toLowerCase().includes(lc);
  }

  find(q: SearchQuery): Match[] {
    this.clear(); // clears prior markers and resets this.hits
    if (!q.text) return [];
    const test = this.matcher(q);
    for (const n of this.tree.nodes()) {
      const keyHit = test(n.key);
      const valHit = n.value.kind === "scalar" && test(n.value.text);
      if (keyHit || valHit) this.hits.push({ path: n.path });
    }
    return this.hits.map((_, i) => ({ id: i }));
  }

  reveal(id: number): void {
    const hit = this.hits[id];
    if (!hit) return;
    // The TreeView owns the reveal sequence (expand ancestors, scroll the virtual
    // window so the row is materialized, mark it) so this provider stays unaware
    // of whether the tree is nested or virtualized.
    this.tree.revealPath(hit.path);
  }

  clear(): void {
    this.tree.clearCurrent();
    this.hits = [];
  }
}
