import { EditorState, type Extension } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  LanguageDescription,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { marlouesTheme } from "./codemirror-theme";

/**
 * Resolves a language identifier to a CodeMirror language support extension.
 *
 * - `markdown` is loaded directly via @codemirror/lang-markdown (no lazy import).
 * - Any other language name is matched against the @codemirror/language-data
 *   descriptors and loaded on demand via its async loader.
 *
 * Returns null when no matching language is found, so callers can fall back to
 * plain text rendering.
 */
export async function loadLanguageExtension(
  language: string,
): Promise<Extension | null> {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "markdown" || normalized === "md") {
    return markdown({
      codeLanguages: languages as unknown as LanguageDescription[],
    });
  }

  const descriptor = languages.find((desc) => {
    const aliases = (desc.alias ?? []).map((a) => a.toLowerCase());
    return (
      desc.name.toLowerCase() === normalized ||
      aliases.includes(normalized) ||
      (desc.extensions ?? []).includes(normalized.replace(/^\./, ""))
    );
  });

  if (!descriptor) return null;
  try {
    const support = await descriptor.load();
    return support;
  } catch {
    return null;
  }
}

/**
 * Markdown language support loaded synchronously. Useful for read-only preview
 * contexts where lazy loading is unnecessary.
 */
export function markdownExtension(): Extension {
  return markdown({
    codeLanguages: languages as unknown as LanguageDescription[],
  });
}

/**
 * Core editor extensions shared by every marloues CodeMirror instance.
 *
 * Reader-first design: only read-friendly features are included. There is no
 * autocomplete, lint, or snippet support. The set is virtual-scroll friendly
 * (no line wrapping by default) and keeps the editor lightweight.
 */
export function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightSpecialChars(),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.lineWrapping,
    marlouesTheme,
  ];
}

/**
 * Builds an EditorState from a document string plus optional extra extensions.
 * The base extensions are always applied first; caller extensions are appended
 * so they can override or extend behavior.
 */
export function createEditorState(
  doc: string,
  extensions: Extension[] = [],
): EditorState {
  return EditorState.create({
    doc,
    extensions: [...baseExtensions(), ...extensions],
  });
}

/** Convenience re-export for markdown language meta (used by theme/components). */
export { markdownLanguage, languages as languageDescriptions };
