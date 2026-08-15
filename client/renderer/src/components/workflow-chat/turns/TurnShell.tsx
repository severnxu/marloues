import type { ReactNode } from "react";
import { AssistantTurnHeader } from "./AssistantTurnHeader";
import { WorkflowThinkingPlaceholder } from "./ThinkingPlaceholder";
import type { TurnPresentationModel } from "./turn-presentation-model";

/**
 * 回合外壳：布局容器 + 状态 header + thinking 占位。
 * 从 AssistantTurn 提取（Phase 4），渲染逻辑不变。
 */
interface Props {
  model: TurnPresentationModel;
  children: ReactNode;
  duration: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  modelName?: string;
}

export function WorkflowTurnShell({
  model,
  children,
  duration,
  expanded,
  onToggle,
  modelName,
}: Props) {
  const { chrome, process, runtime } = model;
  const { presentation } = chrome;
  return (
    <div className="group relative" data-kind="assistant-turn">
      {presentation.showHeader ? (
        <AssistantTurnHeader
          activity={runtime.activity}
          duration={duration}
          expanded={expanded}
          hasActivityItems={process.hasActivityItems}
          canToggle={!runtime.isLastStreaming}
          label={model.chrome.label}
          tone={chrome.tone}
          usage={model.metadata.usage}
          modelName={modelName}
          onToggle={onToggle}
        />
      ) : null}

      {children}

      {presentation.showThinkingPlaceholder ? (
        <WorkflowThinkingPlaceholder
          label={presentation.statusLabel}
          visible={presentation.thinkingVisible ?? true}
        />
      ) : null}
    </div>
  );
}
