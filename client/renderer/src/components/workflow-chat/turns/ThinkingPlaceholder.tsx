/**
 * 思考状态行：流式期间的 thinking 占位（ThinkingDots 动画）。
 */
export function WorkflowThinkingPlaceholder({
  label = "正在思考",
  visible,
}: {
  label?: string;
  visible: boolean;
}) {
  return (
    <div
      className={`workflow-thinking-status flex items-center gap-2 text-text-muted ${visible ? "" : "invisible"}`}
      data-kind="activity-row"
      data-activity-kind="thinking-status"
    >
      <span className="workflow-thinking-shimmer">{label}</span>
      <ThinkingDots />
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="workflow-thinking-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
