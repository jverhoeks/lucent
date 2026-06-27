import { SearchController } from "./controller";
import type { SearchQuery } from "../types";

export class SearchBar {
  private el: HTMLElement;
  private input: HTMLInputElement;
  private caseBtn: HTMLButtonElement;
  private regexBtn: HTMLButtonElement;
  private count: HTMLElement;
  /** Pending trailing-debounce timer for typed input. */
  private debounceId: ReturnType<typeof setTimeout> | undefined;

  /** Trailing-debounce delay (ms) before a typed query runs the search. */
  static readonly DEBOUNCE_MS = 250;

  constructor(private controller: SearchController) {
    this.el = document.getElementById("searchbar")!;
    this.input = document.getElementById("search-input") as HTMLInputElement;
    this.caseBtn = document.getElementById("search-case") as HTMLButtonElement;
    this.regexBtn = document.getElementById("search-regex") as HTMLButtonElement;
    this.count = document.getElementById("search-count")!;

    const run = () => { this.cancelDebounce(); this.controller.setQuery(this.query()); };
    // Typing is debounced so we don't fire a search (a backend scan, for
    // windowed logs) on every keystroke. Toggles and Enter run immediately.
    this.input.addEventListener("input", () => {
      this.cancelDebounce();
      this.debounceId = setTimeout(run, SearchBar.DEBOUNCE_MS);
    });
    this.caseBtn.addEventListener("click", () => { this.toggleBtn(this.caseBtn); run(); });
    this.regexBtn.addEventListener("click", () => { this.toggleBtn(this.regexBtn); run(); });
    document.getElementById("search-next")!.addEventListener("click", () => this.controller.next());
    document.getElementById("search-prev")!.addEventListener("click", () => this.controller.prev());
    document.getElementById("search-close")!.addEventListener("click", () => this.close());

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Flush any pending debounce so Enter searches the latest text now.
        if (this.debounceId !== undefined) run();
        e.shiftKey ? this.controller.prev() : this.controller.next();
      }
      else if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });

    this.controller.onState(() => this.renderState());
  }

  private toggleBtn(b: HTMLButtonElement) {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("toggled", on);
  }

  private query(): SearchQuery {
    return {
      text: this.input.value,
      caseSensitive: this.caseBtn.getAttribute("aria-pressed") === "true",
      regex: this.regexBtn.getAttribute("aria-pressed") === "true",
    };
  }

  private renderState() {
    const n = this.controller.count();
    const i = this.controller.currentIndex();
    const err = this.controller.error();
    this.count.textContent = err ?? `${n ? i + 1 : 0}/${n}`;
    this.count.title = err ?? "";
    this.input.title = err ?? "";
    this.input.classList.toggle("error", !!err);
  }

  private cancelDebounce() {
    if (this.debounceId !== undefined) {
      clearTimeout(this.debounceId);
      this.debounceId = undefined;
    }
  }

  open() {
    this.el.hidden = false;
    this.input.focus();
    this.input.select();
    if (this.input.value) this.controller.setQuery(this.query());
  }
  close() {
    this.cancelDebounce();
    this.el.hidden = true;
    this.controller.close();
  }
  toggle() { this.el.hidden ? this.open() : this.close(); }
  isOpen() { return !this.el.hidden; }
}
