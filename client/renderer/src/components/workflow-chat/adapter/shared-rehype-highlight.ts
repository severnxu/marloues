import type { Element, ElementContent, Root } from "hast";
import { toText } from "hast-util-to-text";
import { common, createLowlight } from "lowlight";
import { visit } from "unist-util-visit";

const MAX_HIGHLIGHT_CHARS = 30_000;

// rehype-highlight creates and registers a lowlight instance every time its
// plugin is attached. Markdown is split into blocks in this app, so that cost
// was paid repeatedly on every session switch. Registration is immutable for
// our use case and can safely be shared for the renderer lifetime.
const sharedLowlight = createLowlight(common);

export function rehypeSharedHighlight() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element, _index, parent) => {
      if (
        node.tagName !== "code" ||
        parent?.type !== "element" ||
        parent.tagName !== "pre"
      ) {
        return;
      }

      const language = codeLanguage(node);
      if (!language || !sharedLowlight.registered(language)) return;

      const source = toText(node, { whitespace: "pre" });
      if (source.length > MAX_HIGHLIGHT_CHARS) return;

      const classNames = Array.isArray(node.properties.className)
        ? node.properties.className
        : [];
      if (!classNames.includes("hljs")) classNames.unshift("hljs");
      node.properties.className = classNames;

      const result = sharedLowlight.highlight(language, source);
      if (result.children.length > 0) {
        node.children = result.children as ElementContent[];
      }
    });
  };
}

function codeLanguage(node: Element): string | null {
  if (!Array.isArray(node.properties.className)) return null;
  for (const className of node.properties.className) {
    const value = String(className);
    if (value === "no-highlight" || value === "nohighlight") return null;
    if (value.startsWith("lang-")) return value.slice(5);
    if (value.startsWith("language-")) return value.slice(9);
  }
  return null;
}
