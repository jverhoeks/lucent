import helpMarkdown from "../docs/help.md?raw";

/** Virtual tab path for the built-in Help document. */
export const HELP_TAB_PATH = "<help>";

export const HELP_TAB_TITLE = "Help";

/** Bundled user guide (rendered Markdown). */
export const HELP_MARKDOWN = helpMarkdown;

export function isHelpPath(path: string | undefined): boolean {
  return path === HELP_TAB_PATH;
}

/** Example links in Help use `example:relative/path`. */
export const EXAMPLE_LINK_PREFIX = "example:";

export function parseExampleLink(href: string): string | null {
  if (!href.startsWith(EXAMPLE_LINK_PREFIX)) return null;
  const rel = href.slice(EXAMPLE_LINK_PREFIX.length).replace(/^\/+/, "");
  if (!rel || rel.includes("..")) return null;
  return rel;
}