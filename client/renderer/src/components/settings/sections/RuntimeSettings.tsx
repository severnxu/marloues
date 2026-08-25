import { ShieldCheck } from "lucide-react";
import { SettingsCard } from "@/components/settings";
import type { AgentSettings } from "@shared/types";

export function RuntimeSettings({
  draft,
  onCommitDraft,
}: {
  draft: AgentSettings;
  onCommitDraft: (nextDraft: AgentSettings) => void;
}) {
  return (
    <SettingsCard
      title="任务运行"
      description="控制任务轮次和模型思考预算。"
      icon={<ShieldCheck size={16} />}
    >
      <label>
        最大轮次
        <input
          type="number"
          value={draft.maxTurns}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              maxTurns: Number(event.target.value) || 50,
            })
          }
        />
      </label>
      <label>
        最大思考 Token
        <input
          type="number"
          value={draft.maxThinkingTokens}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              maxThinkingTokens: Number(event.target.value) || 0,
            })
          }
        />
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={draft.thinkingEnabled}
          onChange={(event) =>
            onCommitDraft({ ...draft, thinkingEnabled: event.target.checked })
          }
        />
        启用思考
      </label>
    </SettingsCard>
  );
}
