import { ShieldCheck } from "lucide-react";
import { SettingsCard, SettingsTextField } from "@/components/settings";
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
      <SettingsTextField
        label="最大轮次"
        type="number"
        value={draft.maxTurns}
        onValueChange={(value) =>
          onCommitDraft({
            ...draft,
            maxTurns: Number(value) || 50,
          })
        }
      />
      <SettingsTextField
        label="最大思考 Token"
        type="number"
        value={draft.maxThinkingTokens}
        onValueChange={(value) =>
          onCommitDraft({
            ...draft,
            maxThinkingTokens: Number(value) || 0,
          })
        }
      />
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
