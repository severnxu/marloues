import {
  memo,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Lexer } from "marked";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remend from "remend";
import "highlight.js/styles/github.min.css";
import { WorkflowCodeBlock } from "./CodeBlock";
// Note: import directly from the adapter subdir to avoid a circular dep
// (the parent barrel re-exports this file's source module).
import { rehypeSharedHighlight } from "../adapter/shared-rehype-highlight";

const STREAM_RENDER_INTERVAL_MS = 50;
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_HIGHLIGHT_PLUGINS = [rehypeSharedHighlight];
const EMPTY_REHYPE_PLUGINS: [] = [];

function WorkflowHorizontalRule() {
  return <hr aria-hidden="true" className="workflow-markdown-divider" />;
}

const MARKDOWN_COMPONENTS = {
  pre: WorkflowCodeBlock,
  hr: WorkflowHorizontalRule,
};

function useBufferedStreamingContent(content: string, streaming: boolean) {
  const [renderedContent, setRenderedContent] = useState(content);
  const latestContentRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushAtRef = useRef(0);

  useEffect(() => {
    latestContentRef.current = content;

    if (!streaming) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastFlushAtRef.current = Date.now();
      setRenderedContent(content);
      return;
    }

    if (timerRef.current !== null) {
      return;
    }

    const elapsed = Date.now() - lastFlushAtRef.current;
    const delay = Math.max(0, STREAM_RENDER_INTERVAL_MS - elapsed);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastFlushAtRef.current = Date.now();
      const latestContent = latestContentRef.current;
      startTransition(() => {
        setRenderedContent(latestContent);
      });
    }, delay);
  }, [content, streaming]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return renderedContent;
}

const FOOTNOTE_REFERENCE_PATTERN = /\[\^[\w-]{1,200}\](?!:)/;
const FOOTNOTE_DEFINITION_PATTERN = /\[\^[\w-]{1,200}\]:/;

export function parseProgressiveMarkdownBlocks(markdown: string): string[] {
  if (!markdown) {
    return [];
  }

  // Footnote references and definitions can affect distant parts of the tree.
  // Keep those documents together so ReactMarkdown can resolve them correctly.
  if (
    FOOTNOTE_REFERENCE_PATTERN.test(markdown) ||
    FOOTNOTE_DEFINITION_PATTERN.test(markdown)
  ) {
    return [markdown];
  }

  return Lexer.lex(markdown, { gfm: true })
    .filter((token) => token.type !== "space")
    .map((token) => token.raw)
    .filter(Boolean);
}

export function hasUnclosedCodeFence(markdown: string): boolean {
  let openFence: { marker: string; length: number } | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!match) {
      continue;
    }

    const fence = match[1];
    if (!openFence) {
      openFence = { marker: fence[0], length: fence.length };
      continue;
    }

    const trailingText = line.slice(match[0].length);
    if (
      fence[0] === openFence.marker &&
      fence.length >= openFence.length &&
      /^[\t ]*$/.test(trailingText)
    ) {
      openFence = null;
    }
  }

  return openFence !== null;
}

const MarkdownBlock = memo(function MarkdownBlock({
  content,
  highlightCode,
}: {
  content: string;
  highlightCode: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={
        highlightCode ? REHYPE_HIGHLIGHT_PLUGINS : EMPTY_REHYPE_PLUGINS
      }
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
});

const MarkdownDocument = memo(function MarkdownDocument({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const displayContent = useMemo(
    () => (streaming ? remend(content, { linkMode: "text-only" }) : content),
    [content, streaming],
  );
  const blocks = useMemo(
    () => parseProgressiveMarkdownBlocks(displayContent),
    [displayContent],
  );
  const hasIncompleteCodeFence = streaming && hasUnclosedCodeFence(content);

  return (
    <div className="workflow-markdown" data-kind="workflow-markdown-content">
      {blocks.map((block, index) => (
        <MarkdownBlock
          key={index}
          content={block}
          highlightCode={!hasIncompleteCodeFence || index !== blocks.length - 1}
        />
      ))}
    </div>
  );
});

export const WorkflowMarkdownContent = memo(function WorkflowMarkdownContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const renderedContent = useBufferedStreamingContent(content, streaming);
  const effectiveContent = streaming ? renderedContent : content;

  return <MarkdownDocument content={effectiveContent} streaming={streaming} />;
});
