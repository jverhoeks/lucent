import { describe, it, expect, vi } from "vitest";
import { SearchController } from "../src/search/controller";
import type { SearchProvider, SearchQuery, Match } from "../src/types";

/** Fake provider: matches are the indexes of a fixed token list that satisfy the query. */
function fakeProvider(tokens: string[]): SearchProvider & { revealed: number[] } {
  const revealed: number[] = [];
  return {
    revealed,
    find(q: SearchQuery): Match[] {
      if (!q.text) return [];
      const re = q.regex
        ? new RegExp(q.text, q.caseSensitive ? "" : "i")
        : null;
      return tokens
        .map((t, i) => ({ t, i }))
        .filter(({ t }) =>
          re
            ? re.test(t)
            : q.caseSensitive
            ? t.includes(q.text)
            : t.toLowerCase().includes(q.text.toLowerCase())
        )
        .map(({ i }) => ({ id: i }));
    },
    reveal(id: number) { revealed.push(id); },
    clear() {},
  };
}

describe("SearchController", () => {
  it("counts matches and reveals the first", () => {
    const p = fakeProvider(["Apple", "banana", "apricot"]);
    const c = new SearchController();
    c.setProvider(p);
    c.setQuery({ text: "ap", caseSensitive: false, regex: false });
    expect(c.count()).toBe(2);          // Apple, apricot
    expect(c.currentIndex()).toBe(0);
    expect(p.revealed.at(-1)).toBe(0);  // first match id
  });

  it("respects case sensitivity", () => {
    const p = fakeProvider(["Apple", "apricot"]);
    const c = new SearchController();
    c.setProvider(p);
    c.setQuery({ text: "Ap", caseSensitive: true, regex: false });
    expect(c.count()).toBe(1);          // only "Apple"
  });

  it("next/prev wrap around", () => {
    const p = fakeProvider(["a1", "a2", "a3"]);
    const c = new SearchController();
    c.setProvider(p);
    c.setQuery({ text: "a", caseSensitive: false, regex: false });
    c.next(); expect(c.currentIndex()).toBe(1);
    c.next(); expect(c.currentIndex()).toBe(2);
    c.next(); expect(c.currentIndex()).toBe(0); // wrap
    c.prev(); expect(c.currentIndex()).toBe(2); // wrap back
  });

  it("invalid regex yields zero matches and sets error", () => {
    const p = fakeProvider(["x"]);
    const c = new SearchController();
    c.setProvider(p);
    c.setQuery({ text: "(", caseSensitive: false, regex: true });
    expect(c.count()).toBe(0);
    expect(c.error()).toBeTruthy();
  });

  it("notifies on state change", () => {
    const p = fakeProvider(["a", "b"]);
    const c = new SearchController();
    const onState = vi.fn();
    c.onState(onState);
    c.setProvider(p);
    c.setQuery({ text: "a", caseSensitive: false, regex: false });
    expect(onState).toHaveBeenCalled();
  });
});
