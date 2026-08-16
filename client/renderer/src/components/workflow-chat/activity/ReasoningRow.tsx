import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";

type ReasoningItemModel = Extract<WorkflowTurnItem, { type: "reasoning" }>;

interface Props {
  item: ReasoningItemModel;
  defaultOpen?: boolean;
}

export function WorkflowReasoningRow({ item, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen, item.id]);

  const text =
    item.content
      ?.map((part) => part.text)
      .filter(Boolean)
      .join("\n\n") || item.summary;
  const hasDetail = Boolean(text?.trim());
  // 有内容就显示内容（host 快照里 settled 可能缺失，但思考文本已在 summary/content）；
  // 只有真正无内容且未完成时才显示"正在思考…"占位。
  const thinking = !item.settled && !hasDetail;
  const encrypted = item.encrypted && !text;

  if (encrypted) {
    return (
      <div className="workflow-think-row" data-kind="think-row">
        <div className="workflow-think-toggle is-static">
          <span className="workflow-think-icon">
            <Brain />
          </span>
          <span>思考内容已隐藏</span>
        </div>
      </div>
    );
  }

  if (thinking) {
    return (
      <div className="workflow-think-row" data-kind="think-row">
        <div className="workflow-think-toggle is-static">
          <span className="workflow-think-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>正在思考…</span>
        </div>
      </div>
    );
  }

  // settled — show brain icon + summary, expandable for full text
  const summary = item.summary?.trim();
  const interactive = hasDetail;

  return (
    <div
      className="workflow-think-row"
      data-kind="think-row"
      data-open={open ? "true" : "false"}
    >
      {interactive ? (
        <button
          type="button"
          className="workflow-think-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="workflow-think-icon">
            <Brain />
          </span>
          <span className="workflow-think-summary">
            {summary ? truncate(summary, 80) : "思考完成"}
          </span>
          <svg
            className="workflow-think-chev"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      ) : (
        <div className="workflow-think-toggle is-static">
          <span className="workflow-think-icon">
            <Brain />
          </span>
          <span>{summary ? truncate(summary, 80) : "思考完成"}</span>
        </div>
      )}
      {open && hasDetail ? (
        <div className="workflow-think-detail">
          <pre className="workflow-think-body">{text}</pre>
        </div>
      ) : null}
    </div>
  );
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
