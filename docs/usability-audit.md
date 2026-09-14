# Keyboard and browser usability audit

Reviewed: 2026-09-14

The repeatable browser smoke test exercises a nested folder import with a relative image, edit and live preview, browser download Save, keyboard search, quick switch, focus restoration, all three reading themes, and a 390 px viewport. Unit tests cover tab keyboard navigation, search navigation, conflict actions, structured-tree editing, and export selection.

The audit found and fixed these issues:

- A fresh browser session did not render its welcome screen. `TabManager` now renders the empty state during construction.
- Search and quick switch lost the user's focus when dismissed. Both now restore it; diagnostics also supports Escape and returns focus to its toolbar button.
- Save/import errors and search result changes were visible but not announced. Their status regions now use polite live announcements.
- Editable structured-data scalar rows worked only with a pointer. They can now be reached with Tab and opened with Enter or Space; tree expand and delete controls have descriptive labels.
- Quick switch now exposes combobox/listbox relationships and its active option to assistive technology.

The narrow layout has no page-level horizontal overflow at 390 px in light, sepia, or dark mode in the Chrome smoke run.

Native close/quit, filesystem watching, clipboard integration, PDF handoff, and updater checks still require packaged builds on each supported operating system. They are not covered by the browser audit.
