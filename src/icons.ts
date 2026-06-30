/** Monochrome (Lucide-style) icon set for the toolbar chrome. Paths are stroke-
 *  based and inherit `currentColor`, so a single sprite adapts to every theme and
 *  the accent on active state. Defined once here (one source of truth) and injected
 *  as an SVG <symbol> sprite at startup; buttons reference symbols via <use>. */

export const SPRITE_ID = "lucent-icon-sprite";

/** symbol id → inner markup (viewBox 0 0 24 24). Keep ids in sync with the
 *  `<use href="#…">` references in index.html / web.html. */
export const ICON_PATHS: Record<string, string> = {
  "ic-folder":
    '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  "ic-skip": '<path d="M5 4v16l11-8z"/><path d="M19 5v14"/>',
  "ic-pencil":
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  "ic-check": '<path d="M20 6 9 17l-5-5"/>',
  "ic-save":
    '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  "ic-eye":
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  "ic-code": '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  "ic-tail": '<path d="M12 3v13"/><path d="m6 11 6 6 6-6"/><path d="M5 21h14"/>',
  "ic-search": '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  "ic-copy":
    '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2"/>',
  "ic-richtext":
    '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  "ic-filecode":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="m10 13-2 2 2 2"/><path d="m14 13 2 2-2 2"/>',
  "ic-printer":
    '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  "ic-download":
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  "ic-type": '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  "ic-image":
    '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
};

/** Inline <svg><use> markup for one icon. Used by code that builds buttons as
 *  HTML strings (e.g. render-core code-block actions, the web download button). */
export function iconMarkup(iconId: string): string {
  return `<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><use href="#${iconId}"></use></svg>`;
}

/** Inject the <symbol> sprite once into `doc`. Idempotent. */
export function injectSprite(doc: Document = document): void {
  if (doc.getElementById(SPRITE_ID)) return;
  const symbols = Object.entries(ICON_PATHS)
    .map(([id, path]) => `<symbol id="${id}" viewBox="0 0 24 24">${path}</symbol>`)
    .join("");
  const wrap = doc.createElement("div");
  // SVG inside an HTML container parses in the correct namespace via the HTML parser.
  wrap.innerHTML = `<svg id="${SPRITE_ID}" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${symbols}</svg>`;
  const sprite = wrap.firstElementChild;
  if (sprite) doc.body.prepend(sprite);
}

/** Point a button's <use> at a different symbol and update its accessible
 *  name + tooltip. Used for stateful buttons that flip meaning (Edit↔Done,
 *  Rendered↔Raw). Keeps the <svg> intact — never blanks the button. */
export function setButtonIcon(btn: HTMLElement, iconId: string, label: string): void {
  const use = btn.querySelector("use");
  if (use) use.setAttribute("href", `#${iconId}`);
  btn.setAttribute("aria-label", label);
  btn.setAttribute("data-tip", label);
}
