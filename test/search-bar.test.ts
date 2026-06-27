import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SearchBar } from "../src/search/bar";
import { SearchController } from "../src/search/controller";

function setupDom() {
  document.body.innerHTML = `
    <div id="searchbar" hidden role="search">
      <input id="search-input" type="text" placeholder="Find" aria-label="Find" />
      <button id="search-case" class="toggle" title="Match case" aria-pressed="false">Aa</button>
      <button id="search-regex" class="toggle" title="Regular expression" aria-pressed="false">.*</button>
      <span id="search-count" class="count">0/0</span>
      <button id="search-prev" title="Previous (Shift+Enter)" aria-label="Previous">▲</button>
      <button id="search-next" title="Next (Enter)" aria-label="Next">▼</button>
      <button id="search-close" title="Close (Esc)" aria-label="Close">✕</button>
    </div>`;
}

describe("SearchBar", () => {
  beforeEach(() => setupDom());
  afterEach(() => document.body.replaceChildren());

  it("starts hidden", () => {
    const ctrl = new SearchController();
    const bar = new SearchBar(ctrl);
    expect(bar.isOpen()).toBe(false);
  });

  it("open shows the bar and focuses the input", () => {
    const ctrl = new SearchController();
    const bar = new SearchBar(ctrl);
    bar.open();
    expect(bar.isOpen()).toBe(true);
    expect(document.activeElement).toBe(document.getElementById("search-input"));
  });

  it("close hides the bar", () => {
    const ctrl = new SearchController();
    const bar = new SearchBar(ctrl);
    bar.open();
    bar.close();
    expect(bar.isOpen()).toBe(false);
  });

  it("toggle switches visibility", () => {
    const ctrl = new SearchController();
    const bar = new SearchBar(ctrl);
    expect(bar.isOpen()).toBe(false);
    bar.toggle();
    expect(bar.isOpen()).toBe(true);
    bar.toggle();
    expect(bar.isOpen()).toBe(false);
  });

  it("Escape key closes the search bar", () => {
    const ctrl = new SearchController();
    const bar = new SearchBar(ctrl);
    bar.open();
    const input = document.getElementById("search-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bar.isOpen()).toBe(false);
  });

  it("Enter key triggers next match", () => {
    const ctrl = new SearchController();
    const bar = new SearchBar(ctrl);
    bar.open();
    const nextFn = vi.spyOn(ctrl, "next");
    const input = document.getElementById("search-input")!;
    input.value = "foo";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(nextFn).toHaveBeenCalled();
  });

  it("Shift+Enter triggers previous match", () => {
    const ctrl = new SearchController();
    const bar = new SearchBar(ctrl);
    bar.open();
    const prevFn = vi.spyOn(ctrl, "prev");
    const input = document.getElementById("search-input")!;
    input.value = "foo";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }));
    expect(prevFn).toHaveBeenCalled();
  });

  it("typing triggers a debounced query", async () => {
    vi.useFakeTimers();
    const ctrl = new SearchController();
    const bar = new SearchBar(ctrl);
    bar.open();
    const setQuery = vi.spyOn(ctrl, "setQuery");
    const input = document.getElementById("search-input")!;
    input.value = "test";
    input.dispatchEvent(new Event("input"));
    expect(setQuery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SearchBar.DEBOUNCE_MS + 10);
    expect(setQuery).toHaveBeenCalledWith({ text: "test", caseSensitive: false, regex: false });
    vi.useRealTimers();
  });
});
