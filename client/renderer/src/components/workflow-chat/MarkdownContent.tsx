import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.min.css";
import { WorkflowCodeBlock } from "./CodeBlock";

function WorkflowHorizontalRule() {
  return (
    <hr
      aria-hidden="true"
      className="mx-0 my-2 h-0 w-full border-0 border-t border-dashed border-line/60 bg-transparent"
    />
  );
}

function WorkflowMarkdownLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  if (href?.startsWith("#")) {
    return (
      <a {...props} href={href}>
        {children}
      </a>
    );
  }

  if (isHttpUrl(href)) {
    return (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return <span>{children}</span>;
}

function isHttpUrl(rawUrl: string | undefined): rawUrl is string {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function WorkflowMarkdownContent({ content }: { content: string }) {
  return (
    <div
      className="prose prose-sm max-w-none text-text-normal
      prose-p:my-2.5 prose-p:leading-[1.72]
      prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-text-strong
      prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0
      prose-ul:my-2.5 prose-ul:pl-5
      prose-ol:my-2.5 prose-ol:pl-5
      prose-li:my-1
      prose-a:text-accent prose-a:no-underline hover:prose-a:underline
      prose-strong:text-text-strong
      prose-code:rounded-md prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[12px] prose-code:text-text-normal
      prose-code:before:content-none prose-code:after:content-none
      prose-pre:text-text-normal prose-hr:my-0 prose-hr:border-0"
      data-kind="workflow-markdown-content"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: WorkflowCodeBlock,
          hr: WorkflowHorizontalRule,
          a: WorkflowMarkdownLink,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
