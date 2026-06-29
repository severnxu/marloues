import { ArrowDown } from "lucide-react";

interface WorkflowScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function WorkflowScrollToBottomButton({ visible, onClick }: WorkflowScrollToBottomButtonProps) {
  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label="滚动到底部"
      data-kind="scroll-to-bottom"
      onClick={onClick}
      className="scroll-to-bottom-button"
    >
      <ArrowDown size={18} />
    </button>
  );
}
