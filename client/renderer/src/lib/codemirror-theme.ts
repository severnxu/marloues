import { EditorView } from "@codemirror/view";

/**
 * CodeMirror theme wired to marloues's CSS design tokens.
 *
 * marloues defines `--bg`, `--panel`, `--surface`, `--line`, `--border`,
 * `--text`, `--muted`, `--accent`, `--accent-soft` and `--mono` on
 * `:root` and overrides them per `[data-theme="light|warm"]`. Because these
 * variables are resolved at runtime by the browser, the editor automatically
 * follows the active theme (dark / light / warm) without reconfiguration.
 *
 * The theme intentionally uses `var(--…)` values everywhere so a single
 * extension works across all themes; no dark/light compartment switching is
 * required.
 */
export const marlouesTheme = EditorView.theme(
  {
    "&": {
      color: "var(--text)",
      backgroundColor: "transparent",
      height: "100%",
      fontSize: "var(--text-md)",
      fontFamily: "var(--mono)",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      fontFamily: "var(--mono)",
      padding: "var(--space-3)",
    },
    ".cm-content.cm-focused": {
      outline: "none",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent)",
    },
    ".cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--accent-soft)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--accent-soft)",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--muted)",
      border: "none",
      borderRight: "1px solid var(--line)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--text)",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--hover)",
    },
    ".cm-panels": {
      backgroundColor: "var(--panel)",
      color: "var(--text)",
      borderTop: "1px solid var(--line)",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid var(--line)",
    },
    ".cm-searchMatch": {
      backgroundColor: "var(--accent-soft)",
      outline: "1px solid var(--accent)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--accent)",
      color: "var(--bg)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--surface)",
      border: "1px solid var(--line)",
      color: "var(--muted)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--panel)",
      border: "1px solid var(--border)",
      color: "var(--text)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent-soft)",
      color: "var(--text)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 var(--space-2)",
      minWidth: "2.5rem",
    },
    "&.cm-editor.cm-focused": {
      outline: "none",
    },
  },
  { dark: false },
);
