import { ShieldCheck } from "lucide-react";
import {
  SettingsCard,
  SettingsSelect,
  SettingsTextarea,
  SettingsTextField,
} from "@/components/settings";
import type { AgentSettings } from "@shared/types";

const PERMISSION_MODE_OPTIONS = [
  { value: "default", label: "请求批准" },
  { value: "auto", label: "替我审批" },
  { value: "bypassPermissions", label: "完全访问" },
];

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function RuntimeSettings({
  draft,
  isPermissionTimeoutManaged,
  onCommitDraft,
}: {
  draft: AgentSettings;
  isPermissionTimeoutManaged: boolean;
  onCommitDraft: (nextDraft: AgentSettings) => void;
}) {
  const policy = draft.toolPermissionPolicy;
  const sensitiveToolAllowlist = policy?.sensitiveToolAllowlist ?? [
    "Read",
    "Glob",
    "Grep",
    "LS",
    "TodoWrite",
  ];

  return (
    <SettingsCard
      title="运行限制"
      description="让长任务保持可控，并方便检查执行过程。"
      icon={<ShieldCheck size={16} />}
    >
      <label className="settings-field">
        <span>权限模式</span>
        <SettingsSelect
          ariaLabel="权限模式"
          value={draft.permissionMode}
          options={PERMISSION_MODE_OPTIONS}
          onChange={(value) =>
            onCommitDraft({
              ...draft,
              permissionMode: value as typeof draft.permissionMode,
            })
          }
        />
      </label>
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
        label="审批超时（秒）"
        type="number"
        min={10}
        max={3600}
        disabled={isPermissionTimeoutManaged}
        title={
          isPermissionTimeoutManaged
            ? "由企业配置管理"
            : "设置敏感工具审批自动拒绝时间"
        }
        value={Math.round(
          (draft.permissionApprovalTimeoutMs ?? 120_000) / 1000,
        )}
        onValueChange={(value) =>
          onCommitDraft({
            ...draft,
            permissionApprovalTimeoutMs:
              Math.min(Math.max(Number(value) || 120, 10), 3600) * 1000,
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
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={policy?.requireConfirmationForSensitiveTools ?? true}
          onChange={(event) =>
            onCommitDraft({
              ...draft,
              toolPermissionPolicy: {
                ...policy,
                sensitiveToolAllowlist,
                requireConfirmationForSensitiveTools: event.target.checked,
              },
            })
          }
        />
        敏感工具需要确认
      </label>
      <SettingsTextarea
        label="敏感工具白名单"
        value={sensitiveToolAllowlist.join("\n")}
        onValueChange={(value) =>
          onCommitDraft({
            ...draft,
            toolPermissionPolicy: {
              ...policy,
              requireConfirmationForSensitiveTools:
                policy?.requireConfirmationForSensitiveTools ?? true,
              sensitiveToolAllowlist: splitLines(value),
            },
          })
        }
      />
      <SettingsTextarea
        label="allowedTools"
        readOnly
        value={(policy?.allowedTools ?? []).join("\n")}
      />
      <SettingsTextarea
        label="disallowedTools"
        readOnly
        value={(policy?.disallowedTools ?? []).join("\n")}
      />
    </SettingsCard>
  );
}
