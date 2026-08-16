import {
  memo,
  useMemo,
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

const FOOTNOTE_REFERENCE_PATTERN = /\[\^[\w-]{1,200}\](?!:)/;
const FOOTNOTE_DEFINITION_PATTERN = /\[\^[\w-]{1,200}\]:/;

/**
 * 增量拆分：把流式 markdown 切成「已稳定块 + 增长中的尾部」。
 *
 * 稳定边界 = 最后一个空行（块分隔符）之后：
 * - 原文以空行结尾 → 全部稳定；
 * - 最后一块是闭合代码块（围栏完整）→ 全部稳定；
 * - 否则最后一个空行之后的内容是增长中的尾部（可能还在变）。
 *
 * 返回值语义：
 * - `settledBlocks`：内容已稳定的块，渲染结果可被 memo 完全复用；
 * - `pending`：增长中的最后一块原文（为空表示全部稳定）；
 * - `pendingIsCode`：pending 是未闭合代码块（应纯文本渲染，零解析零高亮）。
 */
export function splitIncrementalMarkdown(
  markdown: string,
): { settledBlocks: string[]; pending: string; pendingIsCode: boolean } {
  if (!markdown) {
    return { settledBlocks: [], pending: "", pendingIsCode: false };
  }

  // Footnote references and definitions can affect distant parts of the tree.
  // Keep those documents together so ReactMarkdown can resolve them correctly.
  if (
    FOOTNOTE_REFERENCE_PATTERN.test(markdown) ||
    FOOTNOTE_DEFINITION_PATTERN.test(markdown)
  ) {
    return { settledBlocks: [markdown], pending: "", pendingIsCode: false };
  }

  // 原文以空行结尾：最后一个块已被空行分隔，全部稳定。
  if (/(\r?\n)[ \t]*(\r?\n)[ \t]*$/.test(markdown)) {
    return {
      settledBlocks: parseProgressiveMarkdownBlocks(markdown),
      pending: "",
      pendingIsCode: false,
    };
  }

  // 最后一块是闭合代码块（围栏完整）：整个文档已稳定。
  if (!hasUnclosedCodeFence(markdown)) {
    const lastToken = Lexer.lex(markdown, { gfm: true }).filter(
      (token) => token.type !== "space",
    ).at(-1);
    if (lastToken?.type === "code") {
      return {
        settledBlocks: parseProgressiveMarkdownBlocks(markdown),
        pending: "",
        pendingIsCode: false,
      };
    }
  }

  // 最后一个空行（块分隔符）的结束位置 = 稳定边界。
  let lastBlankEnd = 0;
  const blankRe = /(\r?\n)[ \t]*(\r?\n)/g;
  while (blankRe.exec(markdown) !== null) {
    lastBlankEnd = blankRe.lastIndex;
  }

  const settledText = markdown.slice(0, lastBlankEnd);
  const pending = markdown.slice(lastBlankEnd);
  return {
    settledBlocks: settledText
      ? parseProgressiveMarkdownBlocks(settledText)
      : [],
    pending,
    pendingIsCode: hasUnclosedCodeFence(pending),
  };
}

/** 增长中的未闭合代码块：纯文本渲染（零 ReactMarkdown 解析、零高亮）。 */
const PendingCodeBlock = memo(function PendingCodeBlock({ text }: { text: string }) {
  const lang = /^\s{0,3}(?:`{3,}|~{3,})\s*([^\s`~]*)/.exec(text)?.[1] ?? "";
  const body = text.split(/\r?\n/).slice(1).join("\n");
  return (
    <div className="workflow-code-block" data-kind="workflow-code-block">
      <div className="workflow-code-block-header">
        <span className="workflow-code-block-language">{lang || "text"}</span>
      </div>
      <pre className="workflow-code-block-body">{body}</pre>
    </div>
  );
});

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
  const { settledBlocks, pending, pendingIsCode } = useMemo(
    () =>
      streaming
        ? splitIncrementalMarkdown(displayContent)
        : {
            settledBlocks: parseProgressiveMarkdownBlocks(displayContent),
            pending: "",
            pendingIsCode: false,
          },
    [displayContent, streaming],
  );

  return (
    <div className="workflow-markdown" data-kind="workflow-markdown-content">
      {settledBlocks.map((block, index) => (
        <MarkdownBlock
          key={index}
          content={block}
          highlightCode
        />
      ))}
      {pending ? (
        pendingIsCode ? (
          <PendingCodeBlock text={pending} />
        ) : (
          <MarkdownBlock content={pending} highlightCode={false} />
        )
      ) : null}
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
  // content 直接渲染（无缓冲/节流）：主进程已按 ~100ms 合并推送快照，
  // 流式文本随快照渐进更新。之前用 setTimeout 节流会导致 timer 回调被高频
  // 渲染饿死（渲染永远排在 timer 前），流式文本只显示开头、完成时一次性出现。
  return <MarkdownDocument content={content} streaming={streaming} />;
});
