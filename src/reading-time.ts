/** Rough reading-time estimate for Markdown source.
 *
 *  Words are counted as whitespace-delimited runs — Markdown punctuation and
 *  code fences ride along. This is a reader-facing estimate, not an analysis,
 *  so the small inaccuracy is fine and keeps the function trivial. */

const WORDS_PER_MINUTE = 200;

/** Whitespace-delimited word count (0 for blank/whitespace-only input). */
export function countWords(source: string): number {
  const trimmed = source.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** Estimated minutes to read `source`, rounded and clamped to ≥1 for any
 *  non-empty text (0 only when there are no words at all). */
export function readingTimeMinutes(source: string): number {
  const words = countWords(source);
  return words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Human label such as "3 min read"; empty string when there is nothing to read. */
export function readingTimeLabel(source: string): string {
  const minutes = readingTimeMinutes(source);
  return minutes === 0 ? "" : `${minutes} min read`;
}
