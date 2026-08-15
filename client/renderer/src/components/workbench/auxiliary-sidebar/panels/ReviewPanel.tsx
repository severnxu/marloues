import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, FileText, ShieldCheck } from "lucide-react";
import { PatchDiff } from "@pierre/diffs/react";
import type { TimelineItem } from "@shared/types";
import { useThemeStore } from "@/stores/theme-store";
import type { ReviewTarget } from "@/stores/inspector-store";
import {
  DIFF_VIEW_SCROLL_CSS,
  normalizePatchForDiffs,
} from "@/components/diff";
import { buildReviewPlanItems } from "./review-plan";

export function ReviewPanel({
  reviewTarget,
  timeline,
}: {
  reviewTarget: ReviewTarget | null;
  timeline: TimelineItem[];
}) {
  const diffThemeType = useThemeStore((state) =>
    state.isDark ? "dark" : "light",
  );
  const diffHostRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const planItems = buildReviewPlanItems(timeline);

  const diffsPatch = reviewTarget
    ? normalizePatchForDiffs(reviewTarget.rawDiff, reviewTarget.path)
    : "";

  // PatchDiff 渲染在 shadow DOM 中，需要手动注入滚动条样式。
  useEffect(() => {
    if (!diffsPatch) return;
    const host = diffHostRef.current;
    if (!host) return;

    let disposed = false;
    let attempts = 0;
    let intervalId: number | undefined;

    const install = () => {
      if (disposed) return true;
      const shadowRoot = host.querySelector("diffs-container")?.shadowRoot;
      if (!shadowRoot) return false;
      let style = shadowRoot.querySelector<HTMLStyleElement>(
        "style[data-marloues-diff-scrollbar]",
      );
      if (!style) {
        style = document.createElement("style");
        style.setAttribute("data-marloues-diff-scrollbar", "");
        shadowRoot.appendChild(style);
      }
      style.textContent = DIFF_VIEW_SCROLL_CSS;
      return true;
    };

    if (!install()) {
      intervalId = window.setInterval(() => {
        attempts += 1;
        if (install() || attempts > 20) {
          if (intervalId !== undefined) window.clearInterval(intervalId);
        }
      }, 50);
    }

    return () => {
      disposed = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [diffsPatch, diffThemeType]);

  if (!reviewTarget) {
    if (planItems.length) {
      return (
        <ol className="plan-list">
          {planItems.map((item, index) => (
            <li
              key={item.id}
              className={
                item.state === "done"
                  ? "is-done"
                  : item.state === "active"
                    ? "is-active"
                    : undefined
              }
            >
              <span>{index + 1}</span>
              <div>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </div>
            </li>
          ))}
        </ol>
      );
    }
    return (
      <div className="tab-panel-content scrollbar-thin">
        <div className="tab-panel-empty-state">
          <ShieldCheck size={28} />
          <strong>暂无审核内容</strong>
          <p>点击对话中文件卡片上的"审核"按钮，文件 diff 会显示在这里。</p>
        </div>
      </div>
    );
  }

  const copyDiff = async () => {
    try {
      await navigator.clipboard?.writeText(reviewTarget.rawDiff);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="tab-panel-content scrollbar-thin review-panel">
      <div className="review-panel-head">
        <FileText size={14} />
        <div className="review-panel-title">
          <strong>{reviewTarget.path.split(/[\\/]/).pop()}</strong>
          <span>{reviewTarget.path}</span>
        </div>
        <button
          type="button"
          className="review-panel-copy"
          onClick={() => void copyDiff()}
          title={copied ? "已复制" : "复制差异"}
        >
          {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <div
        ref={diffHostRef}
        className="workflow-patch-card-body"
        data-kind="diffs-view"
      >
        {diffsPatch ? (
          <PatchDiff
            patch={diffsPatch}
            className="workflow-patch-diff-view"
            disableWorkerPool
            options={{
              themeType: diffThemeType,
              diffStyle: "unified",
              diffIndicators: "bars",
              lineDiffType: "word-alt",
              overflow: "scroll",
              stickyHeader: true,
              hunkSeparators: "line-info",
              unsafeCSS: DIFF_VIEW_SCROLL_CSS,
            }}
          />
        ) : (
          <div className="workflow-patch-empty">无 diff 预览</div>
        )}
      </div>
    </div>
  );
}
