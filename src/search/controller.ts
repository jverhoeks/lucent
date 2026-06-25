import type { SearchProvider, SearchQuery, Match } from "../types";

/**
 * Format-agnostic search state machine. Owns the query, the ordered match list,
 * the current index, and navigation; delegates actual matching/highlighting to
 * a SearchProvider. Validates regex queries up-front so an invalid pattern is a
 * clean "0 matches + error", never a throw.
 */
export class SearchController {
  private provider: SearchProvider | null = null;
  private query: SearchQuery = { text: "", caseSensitive: false, regex: false };
  private matches: Match[] = [];
  private index = -1;
  private err: string | null = null;
  private listeners: Array<() => void> = [];

  onState(fn: () => void): void { this.listeners.push(fn); }
  private emit(): void { for (const fn of this.listeners) fn(); }

  setProvider(p: SearchProvider | null): void {
    this.provider?.clear();
    this.provider = p;
    this.run();
  }

  /** Re-run against the current query (e.g. after the view re-rendered). */
  refresh(): void { this.run(); }

  setQuery(q: SearchQuery): void {
    this.query = q;
    this.run();
  }

  private run(): void {
    this.err = null;
    this.provider?.clear();
    if (!this.provider || !this.query.text) {
      this.matches = [];
      this.index = -1;
      this.emit();
      return;
    }
    if (this.query.regex) {
      try {
        new RegExp(this.query.text);
      } catch (e) {
        this.err = (e as Error).message;
        this.matches = [];
        this.index = -1;
        this.emit();
        return;
      }
    }
    this.matches = this.provider.find(this.query);
    this.index = this.matches.length ? 0 : -1;
    if (this.index >= 0) this.provider.reveal(this.matches[this.index].id);
    this.emit();
  }

  private step(delta: number): void {
    if (!this.provider || this.matches.length === 0) return;
    this.index = (this.index + delta + this.matches.length) % this.matches.length;
    this.provider.reveal(this.matches[this.index].id);
    this.emit();
  }
  next(): void { this.step(1); }
  prev(): void { this.step(-1); }

  close(): void {
    this.provider?.clear();
    this.matches = [];
    this.index = -1;
    this.emit();
  }

  count(): number { return this.matches.length; }
  currentIndex(): number { return this.index; }
  error(): string | null { return this.err; }
}
