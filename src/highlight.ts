// Shared highlight.js instance. The full distribution registers ~190 languages
// (~970KB / ~310KB gzip — by far the heaviest eager dependency); `lib/common`
// ships only the ~36 most common ones. That still covers every structured-data
// raw-view format — json, yaml, ini, and `toml` (which resolves through ini's
// alias, so getLanguage("toml") is truthy) — plus the languages that realistically
// appear in Markdown code fences. Any language outside the common set falls back
// to escaped plain text, which is exactly the existing behavior when
// getLanguage() returns undefined (see render.ts highlightInner / tabs.ts raw view).
//
// Exporting a single shared instance is load-bearing: if any module imported
// "highlight.js" directly, the full build would be pulled back into the bundle.
import hljs from "highlight.js/lib/common";

export default hljs;
