import type { ReactElement, ReactNode } from "react";
import { WorkflowDetailCopyButton } from "../activity/DetailCopyButton";

export function WorkflowCodeBlock({ children }: { children?: ReactNode }) {
  const codeElement = Array.isArray(children)
    ? children.find(isCodeElement)
    : isCodeElement(children)
      ? children
      : null;
  const language = languageFromClass(codeElement?.props?.className);
  const text = textFromNode(codeElement?.props?.children ?? children);

  return (
    <div className="workflow-code-block" data-kind="workflow-code-block">
      <div className="workflow-code-block-header">
        <span className="workflow-code-block-language">
          {language || "text"}
        </span>
        <WorkflowDetailCopyButton value={text} label="复制代码" />
      </div>
      <pre className="workflow-code-block-body">{children}</pre>
    </div>
  );
}

function isCodeElement(
  value: ReactNode,
): value is ReactElement<{ className?: string; children?: ReactNode }> {
  return Boolean(
    value &&
    typeof value === "object" &&
    "props" in value &&
    (value as { type?: unknown }).type === "code",
  );
}

function languageFromClass(className?: string): string {
  const match = className?.match(/language-([\w-]+)/);
  return match?.[1] ?? "";
}

function textFromNode(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return value.map(textFromNode).join("");
  if (value && typeof value === "object" && "props" in value) {
    return textFromNode(
      (value as { props?: { children?: ReactNode } }).props?.children,
    );
  }
  return "";
}
